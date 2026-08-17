// Anti-fraud detectors over the audit log: velocity, stake-escalation,
// rtp-outlier (with sample guard), jackpot-rate, plus scanAll + a clean account.
import assert from "node:assert/strict";
import { InMemoryAudit } from "../dist/audit.js";
import { FraudService } from "../dist/fraud.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };

let seq = 0;
const rec = (account, ts, o = {}) => ({
  account, roundId: "r" + ++seq, bet: o.bet ?? 10,
  serverSeedHash: "h".repeat(64), serverSeed: "s".repeat(64), clientSeed: "c", nonce: 0,
  rounds: o.rounds ?? 1, payoutMult: o.payoutMult ?? 0, payout: o.payout ?? 0, busted: o.busted ?? true, ts,
});
const audit = (recs) => { const a = new InMemoryAudit(); recs.forEach((r) => a.record(r)); return new FraudService(a); };
const SPACED = 60_000; // gap that avoids the velocity detector
const kinds = (sigs) => sigs.map((s) => s.kind).sort();

console.log("=".repeat(64));
console.log("  ANTI-FRAUD — risk signals from the audit log");
console.log("=".repeat(64));

// velocity
{
  const recs = Array.from({ length: 12 }, (_, i) => rec("speed", i * 500)); // 12 rounds in 5.5s
  const sigs = audit(recs).scanAccount("speed");
  ok(kinds(sigs).join() === "velocity", "velocity: 12 rounds in <10s flags ONLY velocity");
  ok(sigs[0].severity === "high" && sigs[0].evidence.rounds === 12, "velocity signal is high with the round count as evidence");
}
{
  const recs = Array.from({ length: 12 }, (_, i) => rec("slow", i * SPACED, { payout: 9 }));
  ok(audit(recs).scanAccount("slow").length === 0, "spaced-out play raises no velocity signal");
}

// stake escalation
{
  const bets = [5, 10, 20, 40, 80, 160];
  const recs = bets.map((bet, i) => rec("martin", i * SPACED, { bet }));
  const sigs = audit(recs).scanAccount("martin");
  ok(kinds(sigs).join() === "stake-escalation", "stake-escalation: doubling bets flags ONLY stake-escalation");
  ok(sigs[0].evidence.escalations === 5 && sigs[0].evidence.peakBet === 160, "escalation evidence: streak length + peak bet");
}

// rtp outlier + sample guard
{
  const recs = Array.from({ length: 60 }, (_, i) => rec("lucky", i * SPACED, { bet: 10, payout: 13, payoutMult: 1.3, busted: false }));
  const sigs = audit(recs).scanAccount("lucky");
  ok(kinds(sigs).join() === "rtp-outlier", "rtp-outlier: 130% return over 60 rounds flags rtp-outlier");
  const recs2 = Array.from({ length: 10 }, (_, i) => rec("newbie", i * SPACED, { bet: 10, payout: 50, payoutMult: 5, busted: false }));
  ok(audit(recs2).scanAccount("newbie").length === 0, "rtp sample guard: huge return over only 10 rounds is NOT flagged");
}

// jackpot rate
{
  const recs = Array.from({ length: 20 }, (_, i) => rec("jp", i * SPACED, i < 3 ? { payoutMult: [10, 15, 25][i], payout: 200, busted: false } : {}));
  const sigs = audit(recs).scanAccount("jp");
  ok(kinds(sigs).join() === "jackpot-rate", "jackpot-rate: 3 jackpots in 20 rounds flags jackpot-rate");
  ok(audit(Array.from({ length: 30 }, (_, i) => rec("rare", i * SPACED, i === 0 ? { payoutMult: 10, payout: 100 } : {}))).scanAccount("rare").length === 0, "1 jackpot in 30 rounds is not flagged");
}

// clean account + scanAll across accounts
{
  const a = new InMemoryAudit();
  Array.from({ length: 60 }, (_, i) => a.record(rec("normal", i * SPACED, { bet: 10, payout: 9.6, busted: false })));
  Array.from({ length: 12 }, (_, i) => a.record(rec("speed", i * 400)));
  const bets = [5, 10, 20, 40, 80];
  bets.forEach((bet, i) => a.record(rec("martin", 9_000_000 + i * SPACED, { bet })));
  const all = new FraudService(a).scanAll();
  ok(new FraudService(a).scanAccount("normal").length === 0, "a normal high-volume-but-fair player raises no signals");
  ok(all.some((s) => s.account === "speed" && s.kind === "velocity"), "scanAll surfaces the velocity account");
  ok(all.some((s) => s.account === "martin" && s.kind === "stake-escalation"), "scanAll surfaces the escalation account");
  ok(!all.some((s) => s.account === "normal"), "scanAll raises nothing for the clean account");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
