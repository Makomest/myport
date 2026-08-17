import type { ClientSocket } from "./socket.js";
import type {
  ServerMsg, FightEvent, Opponent,
  MatchSummary, LeaderboardEntry, PlayerStats, LeaderboardKind, RgStatus,
  SessionSummary, SeasonView, PlayerSetLimits, Tournament, Standing,
} from "./protocol.js";

export type Phase = "idle" | "opening" | "decision" | "ended" | "error";

export interface ClientState {
  phase: Phase;
  balance: number;
  bet: number;
  multiplier: number;
  opponent: Opponent | null;
  serverSeedHash: string;
  nonce: number;
  roundId: string;
  clientSeed: string;
  events: Array<FightEvent & { starsGained?: number }>;
  serverSeed?: string;
  payout?: number;
  payoutMult?: number;
  realityCheckDue: boolean;
  error?: string;
  errorCode?: string; // machine-readable (e.g. "InsufficientFundsError")
  /** present only on a resumed round, so the view can rebuild the gem slots */
  equipped?: { tier: number; count: number }[];
}

const uuid = (): string => globalThis.crypto.randomUUID();
const randomSeed = (): string => globalThis.crypto.randomUUID().replace(/-/g, "");

/**
 * Framework-agnostic game client: drives the WS protocol, keeps a single
 * `ClientState`, and notifies `onUpdate` after every server message. The PixiJS
 * view (and the e2e test) bind to this — no rendering logic lives here.
 */
export class GameClient {
  state: ClientState = {
    phase: "idle", balance: 0, bet: 0, multiplier: 1, opponent: null,
    serverSeedHash: "", nonce: 0, roundId: "", clientSeed: "", events: [], realityCheckDue: false,
  };
  private listeners: Array<(s: ClientState) => void> = [];

  // meta query state + FIFO resolvers (request/response correlated by message type)
  lastHistory: MatchSummary[] = [];
  lastLeaderboard: LeaderboardEntry[] = [];
  lastStats: PlayerStats | null = null;
  private metaListeners: Array<() => void> = [];
  lastRgStatus: RgStatus | null = null;
  lastSessions: SessionSummary[] = [];
  lastSeason: SeasonView | null = null;
  private histQ: Array<(v: MatchSummary[]) => void> = [];
  private lbQ: Array<(v: LeaderboardEntry[]) => void> = [];
  private statsQ: Array<(v: PlayerStats | null) => void> = [];
  private rgQ: Array<(v: RgStatus) => void> = [];
  lastTournaments: Tournament[] = [];
  private sessQ: Array<(v: SessionSummary[]) => void> = [];
  private seasonQ: Array<(v: SeasonView) => void> = [];
  private tournQ: Array<(v: Tournament[]) => void> = [];
  private standQ: Array<(v: Standing[]) => void> = [];

  constructor(private socket: ClientSocket) {
    socket.onMessage((d) => this.handle(JSON.parse(d) as ServerMsg));
    // on every (re)connect, ask the server to restore any in-progress round
    socket.onOpen(() => this.resume());
  }

  /** Re-fetch the live round after a (re)connect; server replies with `resumed`. */
  resume(): void {
    this.socket.send(JSON.stringify({ type: "resume" }));
  }

  onUpdate(cb: (s: ClientState) => void): void {
    this.listeners.push(cb);
  }
  onMeta(cb: () => void): void {
    this.metaListeners.push(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb(this.state);
  }
  private emitMeta(): void {
    for (const cb of this.metaListeners) cb();
  }

  requestHistory(): Promise<MatchSummary[]> {
    return new Promise((resolve) => { this.histQ.push(resolve); this.socket.send(JSON.stringify({ type: "history" })); });
  }
  requestLeaderboard(kind?: LeaderboardKind): Promise<LeaderboardEntry[]> {
    return new Promise((resolve) => { this.lbQ.push(resolve); this.socket.send(JSON.stringify({ type: "leaderboard", kind })); });
  }
  requestStats(): Promise<PlayerStats | null> {
    return new Promise((resolve) => { this.statsQ.push(resolve); this.socket.send(JSON.stringify({ type: "stats" })); });
  }
  requestRgStatus(): Promise<RgStatus> {
    return new Promise((resolve) => { this.rgQ.push(resolve); this.socket.send(JSON.stringify({ type: "rg-status" })); });
  }
  acknowledgeRealityCheck(): Promise<RgStatus> {
    return new Promise((resolve) => { this.rgQ.push(resolve); this.socket.send(JSON.stringify({ type: "ack-reality" })); });
  }
  selfExclude(ms: number): Promise<RgStatus> {
    return new Promise((resolve) => { this.rgQ.push(resolve); this.socket.send(JSON.stringify({ type: "self-exclude", ms })); });
  }
  setLimits(limits: PlayerSetLimits): Promise<RgStatus> {
    return new Promise((resolve) => { this.rgQ.push(resolve); this.socket.send(JSON.stringify({ type: "set-limits", limits })); });
  }
  requestSessions(): Promise<SessionSummary[]> {
    return new Promise((resolve) => { this.sessQ.push(resolve); this.socket.send(JSON.stringify({ type: "sessions" })); });
  }
  requestSeason(from?: number, to?: number, kind?: LeaderboardKind): Promise<SeasonView> {
    return new Promise((resolve) => { this.seasonQ.push(resolve); this.socket.send(JSON.stringify({ type: "season", from, to, kind })); });
  }
  requestTournaments(): Promise<Tournament[]> {
    return new Promise((resolve) => { this.tournQ.push(resolve); this.socket.send(JSON.stringify({ type: "tournaments" })); });
  }
  requestStandings(id: string): Promise<Standing[]> {
    return new Promise((resolve) => { this.standQ.push(resolve); this.socket.send(JSON.stringify({ type: "standings", id })); });
  }

  private level = 1;
  /** player level (for the server's star bonus roll); set by the view. */
  setLevel(level: number): void { this.level = level; }

  open(bet: number, clientSeed: string = randomSeed()): void {
    this.state = {
      ...this.state, phase: "opening", bet, clientSeed, events: [], multiplier: 1,
      serverSeed: undefined, payout: undefined, payoutMult: undefined, error: undefined, errorCode: undefined, equipped: undefined,
    };
    this.socket.send(JSON.stringify({ type: "open", bet, clientSeed, idemKey: uuid(), level: this.level }));
  }
  continue(): void {
    this.socket.send(JSON.stringify({ type: "continue", roundId: this.state.roundId, level: this.level }));
  }
  /** Demo top-up (operator deposit in prod) — server replies with the new balance. */
  topUp(): void {
    this.socket.send(JSON.stringify({ type: "topup" }));
  }
  cashOut(): void {
    this.socket.send(JSON.stringify({ type: "cashout", idemKey: uuid(), roundId: this.state.roundId }));
  }

  private handle(m: ServerMsg): void {
    // meta responses are not round-state updates — route them separately
    if (m.type === "history") { this.lastHistory = m.items; this.histQ.shift()?.(m.items); this.emitMeta(); return; }
    if (m.type === "leaderboard") { this.lastLeaderboard = m.items; this.lbQ.shift()?.(m.items); this.emitMeta(); return; }
    if (m.type === "stats") { this.lastStats = m.stats; this.statsQ.shift()?.(m.stats); this.emitMeta(); return; }
    if (m.type === "rg-status") { this.lastRgStatus = m.status; this.rgQ.shift()?.(m.status); this.emitMeta(); return; }
    if (m.type === "sessions") { this.lastSessions = m.items; this.sessQ.shift()?.(m.items); this.emitMeta(); return; }
    if (m.type === "season") { const v = { leaderboard: m.leaderboard, stats: m.stats }; this.lastSeason = v; this.seasonQ.shift()?.(v); this.emitMeta(); return; }
    if (m.type === "tournaments") { this.lastTournaments = m.items; this.tournQ.shift()?.(m.items); this.emitMeta(); return; }
    if (m.type === "standings") { this.standQ.shift()?.(m.items); this.emitMeta(); return; }

    const s = this.state;
    switch (m.type) {
      case "opened":
        s.roundId = m.roundId; s.serverSeedHash = m.serverSeedHash; s.nonce = m.nonce;
        s.opponent = m.opponent; s.bet = m.bet; s.balance = m.balance;
        s.events = [{ ...m.event, starsGained: m.starsGained }]; s.multiplier = m.event.multiplier; s.realityCheckDue = m.realityCheckDue;
        s.phase = m.ended ? "ended" : "decision";
        if (m.ended) s.serverSeed = m.serverSeed;
        break;
      case "fight":
        s.events = [...s.events, { ...m.event, starsGained: m.starsGained }]; s.multiplier = m.event.multiplier;
        s.phase = m.ended ? "ended" : "decision";
        if (m.ended) s.serverSeed = m.serverSeed;
        break;
      case "cashout":
        s.payout = m.payout; s.payoutMult = m.payoutMult; s.balance = m.balance;
        s.serverSeed = m.serverSeed; s.phase = "ended";
        break;
      case "resumed":
        // restore an in-progress round, but don't clobber a richer in-page state
        // (brief blip where we already hold this exact round mid-decision)
        if (m.roundId && !(this.state.roundId === m.roundId && this.state.phase === "decision")) {
          s.roundId = m.roundId;
          s.serverSeedHash = m.serverSeedHash ?? "";
          s.nonce = m.nonce ?? 0;
          s.opponent = m.opponent ?? null;
          s.bet = m.bet ?? 0;
          s.balance = m.balance ?? s.balance;
          s.multiplier = m.multiplier ?? 1;
          s.events = [{ roundIndex: m.roundIndex ?? 0, winChance: 1, won: true, jackpot: false, multiplier: m.multiplier ?? 1 }];
          s.equipped = m.slots ?? [];
          s.serverSeed = undefined; s.payout = undefined; s.payoutMult = undefined; s.error = undefined;
          s.phase = "decision";
          break;
        }
        // no round to restore — but the server still tells us the wallet balance,
        // so the HUD is correct immediately on connect (before any START)
        if (!m.roundId && typeof m.balance === "number" && this.state.phase !== "decision") {
          s.balance = m.balance;
          break;
        }
        return; // already holding this round — stay silent
      case "topup":
        s.balance = m.balance; s.error = undefined; s.errorCode = undefined;
        break;
      case "error":
        // A ConflictError means the server rejected a duplicate action (double click,
        // autoplay racing a manual press). The round it rejected never happened, so the
        // state we already hold is still correct — tearing it down would be the bug.
        if (m.error === "ConflictError") {
          s.errorCode = m.error;
          this.resume(); // `open` already moved us to "opening"; re-sync to what the server really has
          break;
        }
        s.phase = "error"; s.error = m.message ?? m.error; s.errorCode = m.error;
        break;
    }
    this.emit();
  }
}
