// SEAMLESS WALLET — the operator owns the balance; the game calls its API per
// bet/win. Verified through GameService (full money path) plus direct checks of
// idempotency, the bet→win round flow, technical-failure rollback, and declines.
import assert from "node:assert/strict";
import { SeamlessWallet, MockOperatorWallet, OperatorError } from "../dist/persistence/seamlessWallet.js";
import { GameService } from "../dist/gameService.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const fixedSeeds = () => new SeedManager((len) => Buffer.alloc(len, 0x2a));

console.log("=".repeat(64));
console.log("  SEAMLESS WALLET — operator-owned balance, per-transaction API");
console.log("=".repeat(64));

// ---- 1) full round through GameService (operator holds the money) ----
{
  const op = new MockOperatorWallet({ hero: 1000 });
  const wallet = new SeamlessWallet({ api: op, gameId: "gladiator", currency: "USD" });
  const svc = new GameService(wallet, new ResponsibleGaming(), fixedSeeds());

  const open = await svc.openRound("hero", 50, "seed", "o1");
  ok(op.get("hero") === 950, "openRound called operator bet (1000 -> 950)");
  ok((await wallet.balance("hero")) === 950, "balance() reads through to the operator");

  // ride to a cashout (or accept an entry bust — either way the money is the operator's)
  if (!open.ended) {
    const cash = await svc.cashOut(open.roundId, "c1");
    ok(op.get("hero") === 950 + cash.payout, "cashOut called operator win — payout credited to the operator wallet");
    ok(Math.abs(cash.balance - op.get("hero")) < 1e-9, "DTO balance matches the operator's balance");
  } else {
    ok(op.get("hero") === 950, "entry bust: stake stays with the operator (no win)");
  }
}

// ---- 2) idempotency: a retried bet/win never double-charges ----
{
  const op = new MockOperatorWallet({ p: 200 });
  const w = new SeamlessWallet({ api: op, gameId: "g", currency: "EUR" });
  await w.debit("p", 30, "bet:r1", "tx-bet-1");
  await w.debit("p", 30, "bet:r1", "tx-bet-1"); // same txId — replay
  ok(op.get("p") === 170, "duplicate bet (same txId) charged once (200 -> 170)");
  await w.credit("p", 80, "payout:r1", "tx-win-1");
  await w.credit("p", 80, "payout:r1", "tx-win-1");
  ok(op.get("p") === 250, "duplicate win (same txId) credited once (170 -> 250)");
}

// ---- 3) operator decline (insufficient funds) maps to the game error ----
{
  const op = new MockOperatorWallet({ broke: 10 });
  const w = new SeamlessWallet({ api: op, gameId: "g", currency: "USD" });
  let threw = null;
  try { await w.debit("broke", 50, "bet:r2", "tx2"); } catch (e) { threw = e; }
  ok(threw && threw.name === "InsufficientFundsError", "operator INSUFFICIENT_FUNDS surfaced as InsufficientFundsError");
  ok(op.get("broke") === 10, "declined bet moved no money");
}

// ---- 4) rollback reverses a bet (technical failure mid-round) ----
{
  const op = new MockOperatorWallet({ q: 100 });
  const w = new SeamlessWallet({ api: op, gameId: "g", currency: "USD" });
  await w.debit("q", 40, "bet:r3", "tx-roll");
  ok(op.get("q") === 60, "bet taken (100 -> 60)");
  await w.rollback("q", "tx-roll");
  ok(op.get("q") === 100, "rollback returned the stake (60 -> 100)");
  await w.rollback("q", "tx-roll"); // idempotent rollback
  ok(op.get("q") === 100, "double rollback is a no-op (still 100)");
}

// ---- 5) GameService rolls the wager back if the round can't start (technical failure) ----
{
  const { baseConfig } = await import("gladiator-engine");
  const op = new MockOperatorWallet({ z: 500 });
  const wallet = new SeamlessWallet({ api: op, gameId: "g", currency: "USD" });
  const broken = { ...baseConfig, jackpots: null }; // GladiatorRound construction throws on this
  const svc = new GameService(wallet, new ResponsibleGaming(), fixedSeeds(), broken);
  let threw = null;
  try { await svc.openRound("z", 70, "seed", "ox"); } catch (e) { threw = e; }
  ok(threw, "a round that fails to start propagates the error");
  ok(op.get("z") === 500, "GameService rolled the wager back to the operator (balance restored to 500)");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
