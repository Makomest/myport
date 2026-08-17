// Seasons / sessions aggregation over the audit log: gap-based sessionization,
// daily period buckets, and time-windowed season leaderboard + operator stats.
import assert from "node:assert/strict";
import { InMemoryAudit } from "../dist/audit.js";
import { SeasonsService } from "../dist/seasons.js";
import { GameService } from "../dist/gameService.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const DAY = 86_400_000;
let seq = 0;
const rec = (account, ts, o) => ({
  account, roundId: "r" + ++seq, bet: o.bet ?? 10,
  serverSeedHash: "h".repeat(64), serverSeed: "s".repeat(64), clientSeed: "c", nonce: 0,
  rounds: o.rounds ?? 1, payoutMult: o.payoutMult ?? 0, payout: o.payout ?? 0, busted: o.busted ?? false, ts,
});

console.log("=".repeat(64));
console.log("  SEASONS / SESSIONS — period aggregation");
console.log("=".repeat(64));

const audit = new InMemoryAudit();
// alice session A (two rounds close together on day 0)
audit.record(rec("alice", 1000, { rounds: 5, payoutMult: 5, payout: 50 }));
audit.record(rec("alice", 2000, { rounds: 2, busted: true }));
// alice session B (much later, day 2) — separated by a big gap
audit.record(rec("alice", 2 * DAY + 5000, { rounds: 1, payoutMult: 2, payout: 20 }));
// bob, day 0
audit.record(rec("bob", 1500, { rounds: 8, payoutMult: 12, payout: 120 }));
const seasons = new SeasonsService(audit);

// sessions (newest first)
{
  const s = seasons.sessions("alice"); // default 30-min gap
  ok(s.length === 2, "alice's rounds split into 2 sessions by the inactivity gap");
  ok(s[0].start === 2 * DAY + 5000 && s[0].rounds === 1 && s[0].biggestMultiplier === 2, "newest session first (the later single round)");
  ok(s[1].rounds === 2 && s[1].staked === 20 && s[1].returned === 50 && s[1].net === 30, "older session aggregates two rounds");
  ok(s[1].wins === 1 && s[1].busts === 1, "older session counts wins + busts");
}

// daily period buckets
{
  const p = seasons.periodTotals("alice", DAY);
  ok(p.length === 2, "alice's rounds bucketed into 2 days");
  ok(p[0].start === 0 && p[0].rounds === 2 && p[0].net === 30, "day 0 bucket aggregates the first session");
  ok(p[1].start === 2 * DAY && p[1].rounds === 1, "day 2 bucket holds the later round");
}

// season window [0, 3000): excludes alice's day-2 round
{
  const w = { name: "S1", from: 0, to: 3000 };
  const lb = seasons.seasonLeaderboard(w, "biggestMultiplier");
  ok(lb.length === 2 && lb[0].account === "bob" && lb[0].value === 12, "season leaderboard ranks bob top within the window");
  ok(lb[1].account === "alice" && lb[1].value === 5, "alice's in-window best is 5 (day-2 x2 excluded)");
  const st = seasons.seasonStats(w);
  ok(st.players === 2 && st.rounds === 3, "season stats: 2 players, 3 rounds in window");
  ok(st.staked === 30 && st.returned === 170 && st.houseNet === -140, "season stats: turnover/payout/houseNet");
}

// integration: a real round shows up in the player's sessions
{
  const w = new InMemoryWallet(); w.fund("hero", 1000);
  const liveAudit = new InMemoryAudit();
  const svc = new GameService(w, new ResponsibleGaming(), new SeedManager(), undefined, liveAudit);
  const open = await svc.openRound("hero", 25, "hero-seed", "o1");
  if (!open.ended) await svc.cashOut(open.roundId, "c1");
  const sv = new SeasonsService(liveAudit);
  const sess = sv.sessions("hero");
  ok(sess.length === 1 && sess[0].rounds === 1 && sess[0].staked === 25, "played round appears as one session with the staked bet");
  ok(sv.seasonStats({ from: 0, to: Date.now() + 1000 }).rounds === 1, "season stats over 'now' counts the round");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
