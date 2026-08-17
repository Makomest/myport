import type { AuditRecord, AuditSource } from "./audit.js";

// Meta layer derived entirely from the audit log: match history, leaderboards
// and per-player stats. Read-only over an AuditSource (in-memory now, the same
// queries run over a Postgres/warehouse source later).

export interface MatchSummary {
  roundId: string;
  account: string;
  bet: number;
  rounds: number;
  payoutMult: number;
  payout: number;
  busted: boolean;
  net: number;
  ts: number;
}

export type LeaderboardKind = "biggestMultiplier" | "biggestPayout" | "longestRun";

export interface LeaderboardEntry {
  account: string;
  value: number;
  roundId: string;
  ts: number;
}

export interface PlayerStats {
  account: string;
  rounds: number;
  staked: number;
  returned: number;
  net: number;
  winRate: number;
  biggestMultiplier: number;
  biggestPayout: number;
  longestRun: number;
}

const toSummary = (r: AuditRecord): MatchSummary => ({
  roundId: r.roundId, account: r.account, bet: r.bet, rounds: r.rounds,
  payoutMult: r.payoutMult, payout: r.payout, busted: r.busted, net: r.payout - r.bet, ts: r.ts,
});

const metricOf = (kind: LeaderboardKind) => (r: AuditRecord): number =>
  kind === "longestRun" ? r.rounds : kind === "biggestPayout" ? r.payout : r.payoutMult;

export class MetaService {
  constructor(private source: AuditSource) {}

  /** An account's most recent rounds, newest first (insertion order breaks ties). */
  history(account: string, limit = 20): MatchSummary[] {
    return this.source
      .all()
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.account === account)
      .sort((a, b) => b.r.ts - a.r.ts || b.i - a.i)
      .slice(0, limit)
      .map((x) => toSummary(x.r));
  }

  /** Top players by a metric — best round per account, descending. */
  leaderboard(kind: LeaderboardKind = "biggestMultiplier", limit = 10): LeaderboardEntry[] {
    const metric = metricOf(kind);
    const best = new Map<string, LeaderboardEntry>();
    for (const r of this.source.all()) {
      const value = metric(r);
      const cur = best.get(r.account);
      if (!cur || value > cur.value) best.set(r.account, { account: r.account, value, roundId: r.roundId, ts: r.ts });
    }
    return [...best.values()].sort((a, b) => b.value - a.value).slice(0, limit);
  }

  playerStats(account: string): PlayerStats {
    const recs = this.source.all().filter((r) => r.account === account);
    let staked = 0, returned = 0, wins = 0, biggestMultiplier = 0, biggestPayout = 0, longestRun = 0;
    for (const r of recs) {
      staked += r.bet;
      returned += r.payout;
      if (!r.busted) wins++;
      if (r.payoutMult > biggestMultiplier) biggestMultiplier = r.payoutMult;
      if (r.payout > biggestPayout) biggestPayout = r.payout;
      if (r.rounds > longestRun) longestRun = r.rounds;
    }
    return {
      account, rounds: recs.length, staked, returned, net: returned - staked,
      winRate: recs.length ? wins / recs.length : 0, biggestMultiplier, biggestPayout, longestRun,
    };
  }
}
