// Verifies the Postgres wallet adapter by running its real SQL against pg-mem
// (a pure-JS in-memory Postgres) — no database or native build required.
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { PgWallet } from "../dist/persistence/pgWallet.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };

console.log("=".repeat(64));
console.log("  POSTGRES WALLET (pg-mem) — durable SQL ledger");
console.log("=".repeat(64));

const db = newDb();
const { Pool } = db.adapters.createPg();
const pool = new Pool();
const w = new PgWallet(pool);
await w.init();

await w.fund("p", 100);
ok((await w.balance("p")) === 100, "fund credits the account (balance 100)");

await w.debit("p", 30, "bet", "k1");
await w.debit("p", 30, "bet", "k1"); // retry, same idem key
ok((await w.balance("p")) === 70, "idempotent debit: a retry does not double-charge (70)");

await assert.rejects(() => w.debit("p", 1000, "bet", "k2"), /insufficient/);
ok((await w.balance("p")) === 70, "insufficient funds rejected; balance intact");

await w.credit("p", 5, "payout", "k3");
ok((await w.balance("p")) === 75, "credit adds to the balance (75)");

const led = await w.ledger("p");
ok(led.length === 3 && led.every((e) => typeof e.idemKey === "string"), "ledger persisted (fund + debit + credit) with idem keys");
ok(led[1].kind === "debit" && led[1].balanceAfter === 70, "ledger row carries kind + running balance");

// a fresh adapter instance over the same DB reads the same state (durability)
const w2 = new PgWallet(pool);
ok((await w2.balance("p")) === 75, "a fresh adapter instance reads the persisted balance");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
