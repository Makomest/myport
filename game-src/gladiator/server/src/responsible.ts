// Responsible-gaming guard: bet/loss/round limits, session windows, reality
// checks, self-exclusion, and PLAYER-SET limits (tighten now, loosen delayed).
// Enforced BEFORE any money moves (see GameService).

export interface RgLimits {
  maxBet: number;
  maxLossPerSession: number;
  maxRoundsPerSession: number;
  sessionMs: number;
  realityCheckEveryMs: number;
}

// NOTE: operator hard-limits are OFF by default (no bet/loss/round cap) per
// product decision. A certified build (GLI-19/UKGC) MUST pass explicit RgLimits.
// Self-exclusion, player-set limits and the reality-check nudge still apply.
const NO_LIMIT = Number.MAX_SAFE_INTEGER;
export const defaultLimits: RgLimits = {
  maxBet: NO_LIMIT,
  maxLossPerSession: NO_LIMIT,
  maxRoundsPerSession: NO_LIMIT,
  sessionMs: 60 * 60 * 1000, // 1h rolling session
  realityCheckEveryMs: 15 * 60 * 1000, // non-blocking nudge every 15 min
};

/** Limits a player may set themselves (subset of RgLimits). */
export interface PlayerSetLimits {
  maxBet?: number;
  maxLossPerSession?: number;
  maxRoundsPerSession?: number;
}

const PLAYER_FIELDS: Array<keyof PlayerSetLimits> = ["maxBet", "maxLossPerSession", "maxRoundsPerSession"];

export interface PlayerLimitState {
  effective: PlayerSetLimits; // applied now (only tightenings are immediate)
  pending?: { changes: PlayerSetLimits; effectiveAt: number }; // loosenings waiting out the cool-off
}

/** Durable store for player limits (in-memory default; file-backed in persistence/). */
export interface LimitsStore {
  all(): Record<string, PlayerLimitState>;
  set(account: string, state: PlayerLimitState): void;
}

export class InMemoryLimitsStore implements LimitsStore {
  private map: Record<string, PlayerLimitState> = {};
  all(): Record<string, PlayerLimitState> {
    return { ...this.map };
  }
  set(account: string, state: PlayerLimitState): void {
    this.map[account] = state;
  }
}

interface Session {
  start: number;
  staked: number;
  returned: number;
  rounds: number;
  lastRealityCheck: number;
}

export interface RgDecision {
  ok: boolean;
  reason?: string;
  realityCheckDue: boolean;
  netLoss: number;
}

/** Player-facing responsible-gaming status (shown in the client). */
export interface RgStatus {
  netLoss: number;
  rounds: number;
  maxBet: number;
  maxLossPerSession: number;
  maxRoundsPerSession: number;
  realityCheckDue: boolean;
  selfExcludedUntil: number | null;
  pendingLimits: { changes: PlayerSetLimits; effectiveAt: number } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class ResponsibleGaming {
  private sessions = new Map<string, Session>();
  private excluded = new Map<string, number>();
  private playerLimits = new Map<string, PlayerLimitState>();

  // `now` is injectable so tests can advance time deterministically.
  constructor(
    private limits: RgLimits = defaultLimits,
    private now: () => number = Date.now,
    private store: LimitsStore = new InMemoryLimitsStore(),
    private loosenDelayMs: number = DAY_MS,
  ) {
    for (const [account, state] of Object.entries(store.all())) this.playerLimits.set(account, state);
  }

  selfExclude(account: string, ms: number): void {
    this.excluded.set(account, this.now() + ms);
  }

  // --- player-set limits ---------------------------------------------------
  private limitState(account: string): PlayerLimitState {
    let st = this.playerLimits.get(account);
    if (!st) {
      st = { effective: {} };
      this.playerLimits.set(account, st);
    }
    // promote any pending loosening whose cool-off has elapsed
    if (st.pending && this.now() >= st.pending.effectiveAt) {
      st.effective = { ...st.effective, ...st.pending.changes };
      st.pending = undefined;
      this.store.set(account, st);
    }
    return st;
  }

  /** Limits actually enforced for an account = defaults overlaid with their effective set. */
  effectiveLimits(account: string): RgLimits {
    const eff = this.limitState(account).effective;
    const merged: RgLimits = { ...this.limits };
    for (const f of PLAYER_FIELDS) if (eff[f] !== undefined) merged[f] = eff[f]!;
    return merged;
  }

  /** Player sets limits: tighter values apply immediately, looser ones after a cool-off. */
  setLimits(account: string, requested: PlayerSetLimits): RgStatus {
    const st = this.limitState(account);
    const cur = this.effectiveLimits(account);
    const pendingChanges: PlayerSetLimits = { ...(st.pending?.changes ?? {}) };
    let loosened = false;

    for (const f of PLAYER_FIELDS) {
      const v = requested[f];
      if (v === undefined || !(v > 0)) continue;
      if (v <= cur[f]) {
        st.effective[f] = v; // tighten (or equal) — immediate
        delete pendingChanges[f]; // cancel any queued loosening of this field
      } else {
        pendingChanges[f] = v; // loosen — schedule
        loosened = true;
      }
    }

    if (Object.keys(pendingChanges).length === 0) {
      st.pending = undefined;
    } else {
      st.pending = {
        changes: pendingChanges,
        effectiveAt: loosened ? this.now() + this.loosenDelayMs : st.pending?.effectiveAt ?? this.now() + this.loosenDelayMs,
      };
    }
    this.store.set(account, st);
    return this.status(account);
  }

  private session(account: string): Session {
    const t = this.now();
    let s = this.sessions.get(account);
    if (!s || t - s.start > this.limits.sessionMs) {
      s = { start: t, staked: 0, returned: 0, rounds: 0, lastRealityCheck: t };
      this.sessions.set(account, s);
    }
    return s;
  }

  /** Pre-bet gate. Pure decision — caller decides what to do with it. */
  check(account: string, bet: number): RgDecision {
    const t = this.now();
    const lim = this.effectiveLimits(account);
    const s = this.session(account);
    const netLoss = s.staked - s.returned;
    const realityCheckDue = t - s.lastRealityCheck >= lim.realityCheckEveryMs;
    const excludedUntil = this.excluded.get(account);

    if (excludedUntil && t < excludedUntil) return { ok: false, reason: "self-excluded", realityCheckDue, netLoss };
    if (!(bet > 0)) return { ok: false, reason: "invalid bet", realityCheckDue, netLoss };
    if (bet > lim.maxBet) return { ok: false, reason: "bet exceeds limit", realityCheckDue, netLoss };
    if (s.rounds >= lim.maxRoundsPerSession) return { ok: false, reason: "round limit reached", realityCheckDue, netLoss };
    if (netLoss + bet > lim.maxLossPerSession) return { ok: false, reason: "session loss limit", realityCheckDue, netLoss };
    return { ok: true, realityCheckDue, netLoss };
  }

  acknowledgeRealityCheck(account: string): void {
    this.session(account).lastRealityCheck = this.now();
  }
  recordStake(account: string, bet: number): void {
    const s = this.session(account);
    s.staked += bet;
    s.rounds += 1;
  }
  recordReturn(account: string, payout: number): void {
    this.session(account).returned += payout;
  }
  netLoss(account: string): number {
    const s = this.session(account);
    return s.staked - s.returned;
  }

  status(account: string): RgStatus {
    const t = this.now();
    const lim = this.effectiveLimits(account);
    const st = this.limitState(account);
    const s = this.session(account);
    const ex = this.excluded.get(account);
    return {
      netLoss: s.staked - s.returned,
      rounds: s.rounds,
      maxBet: lim.maxBet,
      maxLossPerSession: lim.maxLossPerSession,
      maxRoundsPerSession: lim.maxRoundsPerSession,
      realityCheckDue: t - s.lastRealityCheck >= lim.realityCheckEveryMs,
      selfExcludedUntil: ex && ex > t ? ex : null,
      pendingLimits: st.pending ? { changes: st.pending.changes, effectiveAt: st.pending.effectiveAt } : null,
    };
  }
}
