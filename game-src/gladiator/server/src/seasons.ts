import type { AuditRecord, AuditSource } from "./audit.js";
import type { LeaderboardKind, LeaderboardEntry } from "./meta.js";

// Period aggregations over the audit log: a player's play SESSIONS (split by an
// inactivity gap), fixed-size period buckets, and time-windowed SEASON
// leaderboards / operator totals. Read-only over the same AuditSource.

export interface SessionSummary {
  start: number;
  end: number;
  rounds: number;
  staked: number;
  returned: number;
  net: number;
  wins: number;
  busts: number;
  biggestMultiplier: number;
}

export interface PeriodBucket {
  start: number;
  rounds: number;
  staked: number;
  returned: number;
  net: number;
}

export interface SeasonWindow {
  name?: string;
  from: number;
  to: number; // half-open [from, to)
}

export interface SeasonStats {
  name?: string;
  from: number;
  to: number;
  rounds: number;
  players: number;
  staked: number;
  returned: number;
  houseNet: number; // operator view: staked - returned
}

const DAY_MS = 86_400_000;

export class SeasonsService {
  constructor(private source: AuditSource) {}

  /** A player's rounds split into sessions by inactivity gap; newest session first. */
  sessions(account: string, gapMs = 30 * 60 * 1000): SessionSummary[] {
    const recs = this.source.all().filter((r) => r.account === account).sort((a, b) => a.ts - b.ts);
    const out: SessionSummary[] = [];
    let cur: SessionSummary | null = null;
    let prevTs = -Infinity;
    for (const r of recs) {
      if (!cur || r.ts - prevTs > gapMs) {
        cur = { start: r.ts, end: r.ts, rounds: 0, staked: 0, returned: 0, net: 0, wins: 0, busts: 0, biggestMultiplier: 0 };
        out.push(cur);
      }
      cur.end = r.ts;
      cur.rounds++;
      cur.staked += r.bet;
      cur.returned += r.payout;
      cur.net = cur.returned - cur.staked;
      if (r.busted) cur.busts++;
      else cur.wins++;
      if (r.payoutMult > cur.biggestMultiplier) cur.biggestMultiplier = r.payoutMult;
      prevTs = r.ts;
    }
    return out.reverse();
  }

  /** Fixed-size period buckets for a player (default = daily), oldest first. */
  periodTotals(account: string, bucketMs = DAY_MS): PeriodBucket[] {
    const buckets = new Map<number, PeriodBucket>();
    for (const r of this.source.all()) {
      if (r.account !== account) continue;
      const start = Math.floor(r.ts / bucketMs) * bucketMs;
      let b = buckets.get(start);
      if (!b) {
        b = { start, rounds: 0, staked: 0, returned: 0, net: 0 };
        buckets.set(start, b);
      }
      b.rounds++;
      b.staked += r.bet;
      b.returned += r.payout;
      b.net = b.returned - b.staked;
    }
    return [...buckets.values()].sort((a, b) => a.start - b.start);
  }

  private inWindow(r: AuditRecord, w: SeasonWindow): boolean {
    return r.ts >= w.from && r.ts < w.to;
  }

  /** Best round per account within a season window, descending. */
  seasonLeaderboard(w: SeasonWindow, kind: LeaderboardKind = "biggestMultiplier", limit = 10): LeaderboardEntry[] {
    const metric = (r: AuditRecord) => (kind === "longestRun" ? r.rounds : kind === "biggestPayout" ? r.payout : r.payoutMult);
    const best = new Map<string, LeaderboardEntry>();
    for (const r of this.source.all()) {
      if (!this.inWindow(r, w)) continue;
      const value = metric(r);
      const cur = best.get(r.account);
      if (!cur || value > cur.value) best.set(r.account, { account: r.account, value, roundId: r.roundId, ts: r.ts });
    }
    return [...best.values()].sort((a, b) => b.value - a.value).slice(0, limit);
  }

  /** Operator totals over a season window. */
  seasonStats(w: SeasonWindow): SeasonStats {
    const players = new Set<string>();
    let rounds = 0, staked = 0, returned = 0;
    for (const r of this.source.all()) {
      if (!this.inWindow(r, w)) continue;
      players.add(r.account);
      rounds++;
      staked += r.bet;
      returned += r.payout;
    }
    return { name: w.name, from: w.from, to: w.to, rounds, players: players.size, staked, returned, houseNet: staked - returned };
  }
}
