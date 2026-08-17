import type { AuditRecord, AuditSource } from "./audit.js";
import type { Wallet } from "./wallet.js";

// Tournaments over the audit log: players accrue a score within a time window;
// at the end the prize pool is split among the top ranks, paid to wallets
// (idempotently) and the result is persisted. Standings/list are player-facing;
// resolution is an operator/scheduled action.

export type TournamentMetric = "biggestMultiplier" | "biggestPayout" | "longestRun" | "netWin" | "stars";

export interface Tournament {
  id: string;
  name: string;
  from: number;
  to: number; // half-open [from, to)
  metric: TournamentMetric;
  prizePool: number;
  payoutSplit: number[]; // fractions for ranks 1..k (should sum <= 1)
}

export interface Standing {
  rank: number;
  account: string;
  score: number;
  prize: number;
}

export interface TournamentResult {
  id: string;
  resolvedAt: number;
  standings: Standing[];
  paid: number;
}

export interface TournamentStore {
  list(): Tournament[];
  add(t: Tournament): void;
  upsert?(t: Tournament): void; // replace a def in place (used to roll the daily window)
  result(id: string): TournamentResult | undefined;
  saveResult(r: TournamentResult): void;
}

export class InMemoryTournamentStore implements TournamentStore {
  private ts: Tournament[] = [];
  private results = new Map<string, TournamentResult>();
  list(): Tournament[] { return [...this.ts]; }
  add(t: Tournament): void { this.ts.push(t); }
  upsert(t: Tournament): void {
    const i = this.ts.findIndex((x) => x.id === t.id);
    if (i >= 0) this.ts[i] = t; else this.ts.push(t);
  }
  result(id: string): TournamentResult | undefined { return this.results.get(id); }
  saveResult(r: TournamentResult): void { this.results.set(r.id, r); }
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

export class TournamentService {
  constructor(
    private source: AuditSource,
    private wallet: Wallet,
    private store: TournamentStore,
    private now: () => number = Date.now,
  ) {}

  list(): Tournament[] { return this.store.list(); }
  get(id: string): Tournament | undefined { return this.store.list().find((t) => t.id === id); }

  private scores(t: Tournament): Array<{ account: string; score: number }> {
    const inWindow = this.source.all().filter((r) => r.ts >= t.from && r.ts < t.to);
    const map = new Map<string, number>();
    if (t.metric === "netWin") {
      for (const r of inWindow) map.set(r.account, (map.get(r.account) ?? 0) + (r.payout - r.bet));
    } else if (t.metric === "stars") {
      for (const r of inWindow) map.set(r.account, (map.get(r.account) ?? 0) + (r.stars ?? 0));
    } else {
      const metric = (r: AuditRecord) =>
        t.metric === "longestRun" ? r.rounds : t.metric === "biggestPayout" ? r.payout : r.payoutMult;
      for (const r of inWindow) {
        const v = metric(r);
        if (!map.has(r.account) || v > map.get(r.account)!) map.set(r.account, v);
      }
    }
    return [...map.entries()]
      .map(([account, score]) => ({ account, score }))
      .sort((a, b) => b.score - a.score);
  }

  private rank(t: Tournament): Standing[] {
    return this.scores(t).map((s, i) => {
      const rank = i + 1;
      const frac = rank <= t.payoutSplit.length ? t.payoutSplit[rank - 1]! : 0;
      return { rank, account: s.account, score: s.score, prize: round2(t.prizePool * frac) };
    });
  }

  /** Live (provisional) standings with the current prize allocation. */
  standings(id: string): Standing[] {
    const t = this.get(id);
    if (!t) throw new Error(`tournament not found: ${id}`);
    return this.rank(t);
  }

  /** Resolve at/after the end time: pay prizes (idempotent) and persist the result. */
  resolve(id: string): TournamentResult {
    const t = this.get(id);
    if (!t) throw new Error(`tournament not found: ${id}`);
    const existing = this.store.result(id);
    if (existing) return existing; // already resolved — idempotent
    if (this.now() < t.to) throw new Error("tournament not finished");

    const standings = this.rank(t);
    let paid = 0;
    for (const s of standings) {
      if (s.prize > 0) {
        this.wallet.credit(s.account, s.prize, `tournament:${id}`, `tournament:${id}:${s.account}`);
        paid = round2(paid + s.prize);
      }
    }
    const result: TournamentResult = { id, resolvedAt: this.now(), standings, paid };
    this.store.saveResult(result);
    return result;
  }
}
