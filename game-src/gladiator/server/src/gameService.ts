import {
  GladiatorRound,
  ProvablyFairRng,
  baseConfig,
  type GameConfig,
  type FightEvent,
} from "gladiator-engine";
import type { Wallet } from "./wallet.js";
import { ResponsibleGaming, type RgStatus, type PlayerSetLimits } from "./responsible.js";
import { SeedManager, type SeedCommit } from "./seeds.js";
import { deriveOpponent } from "./opponent.js";
import type { OpenRoundResult, FightResult, CashOutDto } from "./types.js";
import { RgBlockedError, RoundNotFoundError, InvalidStateError, ConflictError } from "./errors.js";
import { NullAudit, type AuditSink } from "./audit.js";
import { InMemoryRoundStore, type RoundDescriptor, type RoundStore } from "./persistence/roundStore.js";

const isStar = (e: { won: boolean; upgraded?: boolean; stacked?: boolean }): boolean =>
  e.won && !e.upgraded && !e.stacked;

// higher level => higher chance a consolation pays 2 stars instead of 1 (never affects
// the multiplier/RTP — stars are only the Daily Arena metric). Uses Math.random (cosmetic).
const starChance = (level: number): number => Math.min(0.3, 0.03 * Math.max(1, level || 1));
// Server-authoritative level (1..7) from the player's own round count this session —
// NEVER from a client-supplied value (which would let a cheater inflate their 2-star
// chance and skim the Daily Arena prize pool). Derived from the RG session counter.
const LEVEL_ROUNDS = [0, 8, 20, 45, 90, 175, 320]; // rounds played to reach L1..L7
const levelFromRounds = (n: number): number => {
  let l = 1;
  for (let i = 1; i < LEVEL_ROUNDS.length; i++) if (n >= LEVEL_ROUNDS[i]!) l = i + 1;
  return Math.min(7, l);
};
const STAR_DROP_CHANCE = 0.2; // chance a star also "just drops" on a normal (gear) win
const rollStars = (event: { won: boolean; upgraded?: boolean; stacked?: boolean }, level: number): number => {
  if (!event.won) return 0;
  // consolation win (no better gear): a star always drops (1, or 2 on the level-boosted roll)
  if (isStar(event)) return Math.random() < starChance(level) ? 2 : 1;
  // a normal win that DID upgrade/stack can still drop a bonus star sometimes — on top of the
  // multiplier (stars never touch the money/RTP; they're only the Daily Arena metric)
  if (Math.random() < STAR_DROP_CHANCE) return Math.random() < starChance(level) ? 2 : 1;
  return 0;
};

export interface ResumeSnapshot {
  roundId: string;
  serverSeedHash: string;
  nonce: number;
  bet: number;
  opponent: ReturnType<typeof deriveOpponent>;
  multiplier: number;
  roundIndex: number;
  slots: { tier: number; count: number }[];
  balance: number;
}

/**
 * Orchestrates a round: RG gate -> idempotent stake debit -> seed commit ->
 * provably-fair round + NPC opponent -> fights -> settle.
 *
 * STATELESS: the in-progress round is a tiny descriptor in the RoundStore
 * (seed + fights-played + stars). The live engine round is *reconstructed by
 * replaying it forward from the seed* (exactly what the verifier does), so any
 * instance can serve continue/cashout/resume — no sticky sessions. Back the
 * store with Redis to share rounds across a horizontally-scaled fleet.
 */
export class GameService {
  constructor(
    private wallet: Wallet,
    private rg: ResponsibleGaming,
    private seeds: SeedManager = new SeedManager(),
    private cfg: GameConfig = baseConfig,
    private audit: AuditSink = new NullAudit(),
    private store: RoundStore = new InMemoryRoundStore(),
  ) {}

  /** Rebuild the live engine round from its descriptor by replaying the seed. */
  private reconstruct(d: RoundDescriptor): GladiatorRound {
    const rng = new ProvablyFairRng(d.commit.serverSeed, d.commit.clientSeed, d.commit.nonce);
    const round = new GladiatorRound(this.cfg, rng, d.bet);
    if (d.fightsPlayed >= 1) round.start();
    for (let i = 1; i < d.fightsPlayed; i++) round.continue();
    return round;
  }

  // Loads a round and (when an account is given) verifies ownership. A round
  // belonging to someone else is reported as "not found" so we never confirm its
  // existence to a non-owner (prevents IDOR / cross-account continue/cashout).
  private async mustLoad(roundId: string, account?: string): Promise<RoundDescriptor> {
    const d = await this.store.load(roundId);
    if (!d || (account !== undefined && d.account !== account)) throw new RoundNotFoundError(roundId);
    return d;
  }

  /** Server-side player level (drives the cosmetic 2-star bonus) — from RG round count, not the client. */
  private levelOf(account: string): number {
    return levelFromRounds(this.rg.status(account).rounds);
  }

  /**
   * Serialise everything that can move money for one account. Two rapid START or
   * CONTINUE clicks arrive as two frames with different idempotency keys, so
   * per-operation idempotency does not cover them: without this, both passed the
   * "is a round open?" check and both debited a stake.
   */
  private async withAccountLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
    const key = `acct:${account}`;
    if (!(await this.store.lock(key, 15_000))) throw new ConflictError("another action is already in flight");
    try {
      return await fn();
    } finally {
      await this.store.unlock(key);
    }
  }

  async openRound(account: string, bet: number, clientSeed: string, idemKey: string): Promise<OpenRoundResult> {
    const cached = await this.store.getIdem(`open:${idemKey}`);
    if (cached) return JSON.parse(cached) as OpenRoundResult; // whole-operation idempotency (cross-instance)
    return this.withAccountLock(account, () => this.openRoundLocked(account, bet, clientSeed, idemKey));
  }

  private async openRoundLocked(account: string, bet: number, clientSeed: string, idemKey: string): Promise<OpenRoundResult> {
    const cached = await this.store.getIdem(`open:${idemKey}`); // re-check: a racing twin may have finished while we waited
    if (cached) return JSON.parse(cached) as OpenRoundResult;

    // One live round per account — the store index assumes it, and a second
    // stake here is money the player can never cash out.
    const live = await this.store.byAccount(account);
    if (live) throw new ConflictError("a round is already in progress");

    const decision = this.rg.check(account, bet);
    if (!decision.ok) throw new RgBlockedError(decision.reason ?? "blocked");

    // Commit the seed FIRST so the bet carries the roundId (seamless operators
    // reconcile bet+win by roundId). The wager debit is the real money point.
    const commit = this.seeds.commit(clientSeed);
    const betIdem = `bet:${idemKey}`;
    await this.wallet.debit(account, bet, `bet:${commit.roundId}`, betIdem);
    this.rg.recordStake(account, bet);

    let round: GladiatorRound;
    let event: FightEvent;
    try {
      const rng = new ProvablyFairRng(commit.serverSeed, commit.clientSeed, commit.nonce);
      round = new GladiatorRound(this.cfg, rng, bet);
      event = round.start();
    } catch (err) {
      // stake taken but the round couldn't start — roll the wager back (technical failure)
      await this.wallet.rollback?.(account, betIdem);
      throw err;
    }

    const opponent = deriveOpponent(commit.serverSeed, commit.clientSeed, commit.nonce);
    const starsGained = rollStars(event, this.levelOf(account));
    const ended = !event.won; // a fight only ends the round by a loss
    if (ended) {
      this.writeAudit(commit, account, bet, { rounds: event.roundIndex, payoutMult: 0, payout: 0, busted: true, stars: starsGained });
    } else {
      await this.store.save({ roundId: commit.roundId, account, bet, commit, fightsPlayed: 1, stars: starsGained });
    }

    const result: OpenRoundResult = {
      roundId: commit.roundId,
      serverSeedHash: commit.serverSeedHash,
      nonce: commit.nonce,
      opponent,
      bet,
      balance: await this.wallet.balance(account),
      event,
      ended,
      realityCheckDue: decision.realityCheckDue,
      starsGained,
      ...(ended ? { serverSeed: commit.serverSeed } : {}),
    };
    await this.store.setIdem(`open:${idemKey}`, JSON.stringify(result));
    return result;
  }

  async continueRound(roundId: string, account?: string): Promise<FightResult> {
    const acct = account ?? (await this.mustLoad(roundId)).account;
    return this.withAccountLock(acct, () => this.continueRoundLocked(roundId, account));
  }

  private async continueRoundLocked(roundId: string, account?: string): Promise<FightResult> {
    const d = await this.mustLoad(roundId, account);
    const round = this.reconstruct(d);
    if (round.phase !== "decision") throw new InvalidStateError("round not awaiting a decision");

    const event = round.continue();
    const starsGained = rollStars(event, this.levelOf(d.account));
    const stars = d.stars + starsGained;
    const ended = !event.won;
    if (ended) {
      await this.store.remove(roundId, d.account);
      this.writeAudit(d.commit, d.account, d.bet, { rounds: event.roundIndex, payoutMult: 0, payout: 0, busted: true, stars });
    } else {
      await this.store.save({ ...d, fightsPlayed: d.fightsPlayed + 1, stars });
    }

    return { roundId, event, ended, starsGained, ...(ended ? { serverSeed: d.commit.serverSeed } : {}) };
  }

  async cashOut(roundId: string, idemKey: string, account?: string): Promise<CashOutDto> {
    const cached = await this.store.getIdem(`cash:${idemKey}`);
    if (cached) return JSON.parse(cached) as CashOutDto;
    const acct = account ?? (await this.mustLoad(roundId)).account;
    return this.withAccountLock(acct, () => this.cashOutLocked(roundId, idemKey, account));
  }

  private async cashOutLocked(roundId: string, idemKey: string, account?: string): Promise<CashOutDto> {
    const cached = await this.store.getIdem(`cash:${idemKey}`);
    if (cached) return JSON.parse(cached) as CashOutDto;

    const d = await this.mustLoad(roundId, account);
    const round = this.reconstruct(d);
    if (round.phase !== "decision") throw new InvalidStateError("nothing to cash out");

    const result = round.cashOut();
    // keyed by roundId => at most one payout per round even across idemKeys
    await this.wallet.credit(d.account, result.payout, `payout:${roundId}`, `payout:${roundId}`);
    this.rg.recordReturn(d.account, result.payout);
    await this.store.remove(roundId, d.account);
    this.writeAudit(d.commit, d.account, d.bet, {
      rounds: result.rounds, payoutMult: result.payoutMult, payout: result.payout, busted: false, stars: d.stars,
    });

    const dto: CashOutDto = {
      roundId,
      payoutMult: result.payoutMult,
      payout: result.payout,
      rounds: result.rounds,
      balance: await this.wallet.balance(d.account),
      serverSeed: d.commit.serverSeed,
    };
    await this.store.setIdem(`cash:${idemKey}`, JSON.stringify(dto));
    return dto;
  }

  /**
   * Snapshot of the player's in-progress round (if any) for reconnect/resume.
   * Read from the shared store, so it works after a reconnect to ANY instance.
   */
  async resume(account: string): Promise<ResumeSnapshot | null> {
    const d = await this.store.byAccount(account);
    if (!d) return null;
    const round = this.reconstruct(d);
    if (round.phase !== "decision") return null;
    return {
      roundId: d.roundId,
      serverSeedHash: d.commit.serverSeedHash,
      nonce: d.commit.nonce,
      bet: d.bet,
      opponent: deriveOpponent(d.commit.serverSeed, d.commit.clientSeed, d.commit.nonce),
      multiplier: round.multiplier,
      roundIndex: Math.max(0, round.roundsPlayed - 1), // 0-based, matching FightEvent.roundIndex
      slots: round.equipped.map((s) => ({ tier: s.tier, count: s.count })),
      balance: await this.wallet.balance(account),
    };
  }

  /** Current wallet balance (used by resume so the HUD is correct before any round). */
  balance(account: string): Promise<number> | number {
    return this.wallet.balance(account);
  }

  // --- responsible gaming, surfaced to the player ---
  rgStatus(account: string): RgStatus {
    return this.rg.status(account);
  }
  acknowledgeRealityCheck(account: string): RgStatus {
    this.rg.acknowledgeRealityCheck(account);
    return this.rg.status(account);
  }
  selfExclude(account: string, ms: number): RgStatus {
    this.rg.selfExclude(account, ms);
    return this.rg.status(account);
  }
  setLimits(account: string, limits: PlayerSetLimits): RgStatus {
    return this.rg.setLimits(account, limits);
  }

  private writeAudit(
    commit: SeedCommit,
    account: string,
    bet: number,
    o: { rounds: number; payoutMult: number; payout: number; busted: boolean; stars?: number },
  ): void {
    this.audit.record({
      roundId: commit.roundId,
      account,
      bet,
      serverSeedHash: commit.serverSeedHash,
      serverSeed: commit.serverSeed,
      clientSeed: commit.clientSeed,
      nonce: commit.nonce,
      ts: Date.now(),
      ...o,
    });
  }
}
