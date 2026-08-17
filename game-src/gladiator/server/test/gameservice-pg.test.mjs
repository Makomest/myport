// GameService driving the async Postgres wallet (PgWallet on pg-mem): a full
// round debits/credits the SQL ledger, with idempotent open + cashout.
import assert from "node:assert/strict";
import { newDb } from "pg-mem";
import { PgWallet } from "../dist/persistence/pgWallet.js";
import { GameService } from "../dist/gameService.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const fixedSeeds = () => new SeedManager((len) => Buffer.alloc(len, 0x2a));

console.log("=".repeat(64));
console.log("  GAMESERVICE on POSTGRES WALLET (pg-mem) — async money path");
console.log("=".repeat(64));

const db = newDb();
const { Pool } = db.adapters.createPg();
const pool = new Pool();
const wallet = new PgWallet(pool);
await wallet.init();
await wallet.fund("hero", 1000);

const svc = new GameService(wallet, new ResponsibleGaming(), fixedSeeds());

const open = await svc.openRound("hero", 50, "seed", "o1");
ok((await wallet.balance("hero")) === 950, "openRound debited the Postgres ledger (1000 -> 950)");
ok(typeof open.event.won === "boolean" && open.serverSeedHash.length === 64, "round started over the async backend");

const open2 = await svc.openRound("hero", 50, "seed", "o1"); // retry, same idem key
ok(open2.roundId === open.roundId && (await wallet.balance("hero")) === 950, "idempotent open: no double-debit on the SQL ledger");

let last = open.event;
let ended = open.ended;
let cashed = null;
while (!ended) {
  if (last.multiplier >= 1.4) { cashed = await svc.cashOut(open.roundId, "c1"); break; }
  const f = await svc.continueRound(open.roundId);
  last = f.event;
  ended = f.ended;
}

if (cashed) {
  ok((await wallet.balance("hero")) === 950 + cashed.payout, "cashout credited the Postgres ledger");
  const dup = await svc.cashOut(open.roundId, "c1"); // idempotent retry
  ok(dup.payout === cashed.payout && (await wallet.balance("hero")) === 950 + cashed.payout, "idempotent cashout: no double-credit");
} else {
  ok((await wallet.balance("hero")) === 950, "bust: stake stays debited, nothing credited");
}

ok((await wallet.ledger("hero")).length >= 2, "the round's entries are persisted in the SQL ledger");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
