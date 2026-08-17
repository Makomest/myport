import type { GameConfig, Slot, Outcome, Rng } from "./types.js";
import { buildOutcomes, resolveFight } from "./engine.js";

// =============================================================================
//  Server-authoritative round state machine. This is what the WebSocket / RGS
//  layer drives: one instance per active round, fed a ProvablyFairRng. The
//  client only ever receives events — it cannot influence the outcome.
//
//   idle --start()--> (win) decision --continue()--> (win) decision ...
//                     (loss) ended                   (loss) ended
//        decision --cashOut()--> ended
// =============================================================================

export type Phase = "idle" | "decision" | "ended";

export interface FightEvent {
  roundIndex: number;
  winChance: number;
  won: boolean;
  jackpot: boolean;
  rarity?: string;
  itemMult?: number;
  multiplier: number; // running payout multiplier after this fight
  upgraded?: boolean; // new/replaced gear (a new or changed gem)
  stacked?: boolean; // duplicate of an equipped tier (gem gains a +1 stack)
}

export interface CashOutResult {
  payoutMult: number;
  payout: number;
  rounds: number;
}

export class GladiatorRound {
  private slots: Slot[] = [];
  private round = 0;
  private mult = 1; // running payout multiplier
  private readonly outcomes: Outcome[];
  phase: Phase = "idle";
  jackpotHit = false;

  constructor(
    private readonly cfg: GameConfig,
    private readonly rng: Rng,
    readonly bet: number,
    varianceScale = 1,
  ) {
    this.outcomes = buildOutcomes(cfg, varianceScale);
  }

  get multiplier(): number {
    return this.mult;
  }
  get roundsPlayed(): number {
    return this.round;
  }
  get equipped(): readonly Slot[] {
    return this.slots;
  }

  /** Entry fight (carries the house edge). */
  start(): FightEvent {
    if (this.phase !== "idle") throw new Error("round already started");
    return this.fight();
  }

  /** Next fight after a win. */
  continue(): FightEvent {
    if (this.phase !== "decision") throw new Error("not awaiting a decision");
    return this.fight();
  }

  /** Take the money. */
  cashOut(): CashOutResult {
    if (this.phase !== "decision") throw new Error("nothing to cash out");
    this.phase = "ended";
    const cap = this.cfg.maxWinCap ?? Infinity;
    const payoutMult = Math.min(this.multiplier, cap);
    return { payoutMult, payout: this.bet * payoutMult, rounds: this.round };
  }

  private fight(): FightEvent {
    const r = resolveFight(this.outcomes, this.slots, this.mult, this.round + 1, this.round === 0, this.rng, this.cfg);
    const ev: FightEvent = {
      roundIndex: this.round,
      winChance: r.winChance,
      won: r.won,
      jackpot: r.jackpot,
      multiplier: r.multiplier,
      upgraded: r.upgraded,
      stacked: r.stacked,
    };
    if (r.won) {
      this.mult = r.multiplier;
      this.slots = r.newSlots;
      if (r.jackpot) this.jackpotHit = true;
      if (r.item) {
        ev.rarity = r.item.name;
        ev.itemMult = r.item.mult;
      }
      this.phase = "decision";
    } else {
      this.phase = "ended";
    }
    this.round++;
    return ev;
  }
}
