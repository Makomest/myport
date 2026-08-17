// PgAudit / PgLimitsStore / PgTournamentStore verified against pg-mem (real SQL,
// pure JS — no database). Closes the persistence layer headless.
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { PgAudit } from "../dist/persistence/pgAudit.js";
import { PgLimitsStore } from "../dist/persistence/pgLimitsStore.js";
import { PgTournamentStore } from "../dist/persistence/pgTournamentStore.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const rec = (roundId, account, o = {}) => ({
  roundId, account, bet: o.bet ?? 10, serverSeedHash: "h".repeat(64), serverSeed: "s".repeat(64),
  clientSeed: "c", nonce: o.nonce ?? 7, rounds: o.rounds ?? 1, payoutMult: o.payoutMult ?? 0,
  payout: o.payout ?? 0, busted: o.busted ?? true, ts: o.ts ?? 1000,
});

const db = newDb();
const { Pool } = db.adapters.createPg();
const pool = new Pool();

console.log("=".repeat(64));
console.log("  POSTGRES STORES (pg-mem) — audit / limits / tournaments");
console.log("=".repeat(64));

// --- PgAudit ---
{
  const audit = new PgAudit(pool);
  await audit.init();
  await audit.record(rec("r1", "alice", { ts: 100, payoutMult: 5, payout: 50, busted: false }));
  await audit.record(rec("r2", "bob", { ts: 200, busted: true }));
  await audit.record(rec("r1", "alice", { ts: 100 })); // duplicate round_id
  const all = await audit.all();
  ok(all.length === 2, "PgAudit: duplicate round_id ignored (one row per round)");
  ok(all[0].roundId === "r1" && all[0].payoutMult === 5 && all[0].busted === false, "PgAudit: fields round-trip (incl. boolean/number)");
  ok(typeof all[0].nonce === "number" && typeof all[0].ts === "number", "PgAudit: bigints mapped to numbers");
}

// --- PgLimitsStore ---
{
  const limits = new PgLimitsStore(pool);
  await limits.init();
  await limits.set("p", { effective: { maxBet: 5 } });
  ok((await limits.all())["p"].effective.maxBet === 5, "PgLimitsStore: set + all round-trip");
  await limits.set("p", { effective: { maxBet: 7 }, pending: { changes: { maxBet: 50 }, effectiveAt: 999 } });
  const reread = (await limits.all())["p"];
  ok(reread.effective.maxBet === 7 && reread.pending.effectiveAt === 999, "PgLimitsStore: update path persists effective + pending");
  ok((await new PgLimitsStore(pool).all())["p"].effective.maxBet === 7, "PgLimitsStore: fresh instance reads persisted state");
}

// --- PgTournamentStore ---
{
  const store = new PgTournamentStore(pool);
  await store.init();
  await store.add({ id: "t1", name: "Daily", from: 0, to: 1000, metric: "biggestMultiplier", prizePool: 100, payoutSplit: [0.5, 0.3, 0.2] });
  await store.add({ id: "t1", name: "Daily", from: 0, to: 1000, metric: "biggestMultiplier", prizePool: 100, payoutSplit: [1] }); // dup id ignored
  const list = await store.list();
  ok(list.length === 1 && list[0].from === 0 && list[0].to === 1000, "PgTournamentStore: add + list (from/to mapped)");
  ok(Array.isArray(list[0].payoutSplit) && list[0].payoutSplit[0] === 0.5, "PgTournamentStore: payoutSplit JSON round-trips");
  ok((await store.result("t1")) === undefined, "PgTournamentStore: no result before resolution");
  await store.saveResult({ id: "t1", resolvedAt: 1234, paid: 100, standings: [{ rank: 1, account: "alice", score: 5, prize: 100 }] });
  const res = await store.result("t1");
  ok(res.paid === 100 && res.standings[0].account === "alice", "PgTournamentStore: saveResult + result round-trip");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
