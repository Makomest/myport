import type { AuditSource } from "./audit.js";

// Operator-facing risk/anti-fraud signals derived from the audit log. NOT
// surfaced to the player (you don't tip off a suspected account). Read-only;
// the same detectors run over a Postgres/warehouse source later.

export type RiskKind = "velocity" | "stake-escalation" | "rtp-outlier" | "jackpot-rate";
export type Severity = "low" | "medium" | "high";

export interface RiskSignal {
  account: string;
  kind: RiskKind;
  severity: Severity;
  message: string;
  evidence: Record<string, number>;
  ts: number;
}

export interface FraudConfig {
  velocity: { windowMs: number; maxRoundsPerWindow: number };
  stakeEscalation: { minStreak: number; factor: number };
  rtpOutlier: { minRounds: number; ratioThreshold: number };
  jackpotRate: { minJackpots: number; rateThreshold: number; jackpotMinMult: number };
}

export const defaultFraudConfig: FraudConfig = {
  velocity: { windowMs: 10_000, maxRoundsPerWindow: 10 }, // >10 rounds in 10s = bot-like
  stakeEscalation: { minStreak: 4, factor: 2 }, // 4 consecutive >=2x stakes (Martingale/chasing)
  rtpOutlier: { minRounds: 50, ratioThreshold: 1.15 }, // returning >115% over a real sample
  jackpotRate: { minJackpots: 3, rateThreshold: 0.05, jackpotMinMult: 10 },
};

export class FraudService {
  constructor(private source: AuditSource, private config: FraudConfig = defaultFraudConfig) {}

  scanAccount(account: string): RiskSignal[] {
    const recs = this.source.all().filter((r) => r.account === account).sort((a, b) => a.ts - b.ts);
    if (recs.length === 0) return [];
    const out: RiskSignal[] = [];
    const ts = recs[recs.length - 1]!.ts;

    // velocity — max rounds in any sliding window (two-pointer)
    {
      const { windowMs, maxRoundsPerWindow } = this.config.velocity;
      let j = 0, max = 0;
      for (let i = 0; i < recs.length; i++) {
        while (recs[i]!.ts - recs[j]!.ts > windowMs) j++;
        if (i - j + 1 > max) max = i - j + 1;
      }
      if (max > maxRoundsPerWindow) {
        out.push({ account, kind: "velocity", severity: "high", message: `${max} rounds within ${windowMs}ms`, evidence: { rounds: max, windowMs }, ts });
      }
    }

    // stake escalation — consecutive bets growing by >= factor
    {
      const { minStreak, factor } = this.config.stakeEscalation;
      let streak = 0, best = 0, peak = 0;
      for (let i = 1; i < recs.length; i++) {
        if (recs[i]!.bet >= recs[i - 1]!.bet * factor) {
          streak++;
          best = Math.max(best, streak);
          peak = Math.max(peak, recs[i]!.bet);
        } else streak = 0;
      }
      if (best >= minStreak) {
        out.push({ account, kind: "stake-escalation", severity: "medium", message: `${best} consecutive ${factor}x stake increases`, evidence: { escalations: best, peakBet: peak }, ts });
      }
    }

    // rtp outlier — realized return far above expected over a meaningful sample
    {
      const { minRounds, ratioThreshold } = this.config.rtpOutlier;
      if (recs.length >= minRounds) {
        let staked = 0, returned = 0;
        for (const r of recs) { staked += r.bet; returned += r.payout; }
        const ratio = staked > 0 ? returned / staked : 0;
        if (ratio >= ratioThreshold) {
          out.push({
            account, kind: "rtp-outlier", severity: ratio >= 1.5 ? "high" : "medium",
            message: `return ratio ${ratio.toFixed(3)} over ${recs.length} rounds`,
            evidence: { rounds: recs.length, ratioPct: Math.round(ratio * 1000) / 10, staked, returned }, ts,
          });
        }
      }
    }

    // jackpot rate — too many top-tier hits
    {
      const { minJackpots, rateThreshold, jackpotMinMult } = this.config.jackpotRate;
      const jackpots = recs.filter((r) => r.payoutMult >= jackpotMinMult).length;
      const rate = jackpots / recs.length;
      if (jackpots >= minJackpots && rate >= rateThreshold) {
        out.push({ account, kind: "jackpot-rate", severity: "high", message: `${jackpots} jackpots in ${recs.length} rounds`, evidence: { jackpots, rounds: recs.length, ratePct: Math.round(rate * 1000) / 10 }, ts });
      }
    }

    return out;
  }

  /** Scan every account that appears in the audit log. */
  scanAll(): RiskSignal[] {
    const accounts = new Set(this.source.all().map((r) => r.account));
    return [...accounts].flatMap((a) => this.scanAccount(a));
  }
}
