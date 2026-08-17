// Tournaments: windowed standings + prizes, resolve pays wallets idempotently,
// not-finished guard, out-of-window exclusion, netWin metric, short split.
import assert from "node:assert/strict";
import { InMemoryAudit } from "../dist/audit.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { TournamentService, InMemoryTournamentStore } from "../dist/tournaments.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
let seq = 0;
const rec = (account, ts, o = {}) => ({
  account, roundId: "r" + ++seq, bet: o.bet ?? 10,
  serverSeedHash: "h".repeat(64), serverSeed: "s".repeat(64), clientSeed: "c", nonce: 0,
  rounds: o.rounds ?? 1, payoutMult: o.payoutMult ?? 0, payout: o.payout ?? 0, busted: o.busted ?? true, ts,
});

console.log("=".repeat(64));
console.log("  TOURNAMENTS — standings, prizes, resolution");
console.log("=".repeat(64));

// biggestMultiplier: standings, guard, resolve, idempotency, out-of-window
{
  const a = new InMemoryAudit();
  a.record(rec("alice", 100, { payoutMult: 5, payout: 50, busted: false }));
  a.record(rec("bob", 200, { payoutMult: 12, payout: 120, busted: false }));
  a.record(rec("carol", 300, { payoutMult: 3, payout: 30, busted: false }));
  a.record(rec("bob", 2000, { payoutMult: 99, payout: 990, busted: false })); // outside [0,1000)
  const w = new InMemoryWallet();
  const store = new InMemoryTournamentStore();
  store.add({ id: "t1", name: "Daily", from: 0, to: 1000, metric: "biggestMultiplier", prizePool: 100, payoutSplit: [0.5, 0.3, 0.2] });
  let now = 500;
  const ts = new TournamentService(a, w, store, () => now);

  const st = ts.standings("t1");
  ok(st[0].account === "bob" && st[0].score === 12 && st[0].prize === 50, "standings: bob 1st (score 12, prize 50)");
  ok(st[1].account === "alice" && st[1].prize === 30 && st[2].account === "carol" && st[2].prize === 20, "alice 2nd (30) / carol 3rd (20)");
  ok(st[0].score === 12, "out-of-window record (mult 99) is excluded");

  assert.throws(() => ts.resolve("t1"), /not finished/);
  ok(w.balance("bob") === 0, "no payout before the end time");

  now = 1000;
  const res = ts.resolve("t1");
  ok(w.balance("bob") === 50 && w.balance("alice") === 30 && w.balance("carol") === 20, "resolve pays prizes to the wallets");
  ok(res.paid === 100, "total paid equals the prize pool");

  now = 2000;
  const res2 = ts.resolve("t1");
  ok(res2.resolvedAt === res.resolvedAt && w.balance("bob") === 50, "resolve is idempotent (no double pay)");
}

// netWin metric + short payout split
{
  const a = new InMemoryAudit();
  a.record(rec("alice", 100, { bet: 10, payout: 50, busted: false }));
  a.record(rec("alice", 200, { bet: 10, payout: 0, busted: true }));
  a.record(rec("bob", 150, { bet: 10, payout: 5, busted: false }));
  const store = new InMemoryTournamentStore();
  store.add({ id: "t2", name: "Net", from: 0, to: 1000, metric: "netWin", prizePool: 60, payoutSplit: [1.0] });
  const ts = new TournamentService(a, new InMemoryWallet(), store, () => 2000);
  const st = ts.standings("t2");
  ok(st[0].account === "alice" && st[0].score === 30, "netWin: alice top with net 30 (50-10-10)");
  ok(st[1].account === "bob" && st[1].score === -5, "netWin: bob net -5");
  ok(st[0].prize === 60 && st[1].prize === 0, "short split [1.0]: only rank 1 is paid");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
