// CONCURRENCY / DOUBLE-SPEND — a QA pass found that two fast clicks on START (or
// CONTINUE) reached the service as two frames carrying different idempotency keys.
// Per-operation idempotency did not cover them, and nothing enforced "one live round
// per account", so both debited a stake while the account index could only point at
// one round — the other stake was unreachable money. These lock the invariants down.
import assert from "node:assert/strict";
import { GameService } from "../dist/gameService.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";
import { InMemoryRoundStore } from "../dist/persistence/roundStore.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const seeds = () => new SeedManager((len) => Buffer.alloc(len, 0x2a));
const svc = () => {
  const wallet = new InMemoryWallet();
  wallet.fund("hero", 1000);
  return { wallet, service: new GameService(wallet, new ResponsibleGaming(), seeds(), undefined, undefined, new InMemoryRoundStore()) };
};
const conflict = (e) => e && e.name === "ConflictError";

console.log("=".repeat(64));
console.log("  CONCURRENCY — one live round, one debit, one payout");
console.log("=".repeat(64));

// 1) two simultaneous STARTs with different idempotency keys -> a single stake
{
  const { wallet, service } = svc();
  const r = await Promise.allSettled([
    service.openRound("hero", 10, "cs", "k1"),
    service.openRound("hero", 10, "cs", "k2"),
  ]);
  const okCount = r.filter((x) => x.status === "fulfilled").length;
  const rejected = r.filter((x) => x.status === "rejected").map((x) => x.reason);
  ok(okCount === 1, "parallel START: exactly one round opened");
  ok(rejected.every(conflict), "parallel START: the loser got ConflictError");
  ok(wallet.balance("hero") === 990, "parallel START: charged once (1000 -> 990)");
}

// 2) the same key twice stays idempotent (unchanged behaviour, guarded against regressions)
{
  const { wallet, service } = svc();
  const a = await service.openRound("hero", 10, "cs", "same");
  const b = await service.openRound("hero", 10, "cs", "same");
  ok(a.roundId === b.roundId, "same idemKey: same round returned");
  ok(wallet.balance("hero") === 990, "same idemKey: charged once");
}

// 3) a second START while a round is live is refused, and refused for free
{
  const { wallet, service } = svc();
  const first = await service.openRound("hero", 10, "cs", "k1");
  ok(!first.ended, "fixed seed: entry fight won, round is live");
  const before = wallet.balance("hero");
  let err = null;
  try { await service.openRound("hero", 10, "cs", "k2"); } catch (e) { err = e; }
  ok(conflict(err), "START with a live round: ConflictError");
  ok(wallet.balance("hero") === before, "START with a live round: balance untouched");
}

// 4) two simultaneous CONTINUEs advance the round by exactly one fight
{
  const { service } = svc();
  const open = await service.openRound("hero", 10, "cs", "k1");
  const before = open.event.roundIndex;
  const r = await Promise.allSettled([
    service.continueRound(open.roundId, "hero"),
    service.continueRound(open.roundId, "hero"),
  ]);
  const wins = r.filter((x) => x.status === "fulfilled").map((x) => x.value);
  ok(wins.length === 1, "parallel CONTINUE: only one fight resolved");
  ok(wins[0].event.roundIndex === before + 1, "parallel CONTINUE: advanced by exactly one round");
}

// 5) two simultaneous CASH OUTs pay once
{
  const { wallet, service } = svc();
  const open = await service.openRound("hero", 10, "cs", "k1");
  const staked = wallet.balance("hero");
  const r = await Promise.allSettled([
    service.cashOut(open.roundId, "c1", "hero"),
    service.cashOut(open.roundId, "c2", "hero"),
  ]);
  const paid = r.filter((x) => x.status === "fulfilled").map((x) => x.value);
  ok(paid.length === 1, "parallel CASH OUT: one payout");
  ok(Math.abs(wallet.balance("hero") - (staked + paid[0].payout)) < 1e-9, "parallel CASH OUT: credited exactly once");
}

// 6) loss -> new START debits exactly one stake, for every denomination
{
  for (const bet of [10, 20, 50]) {
    const { wallet, service } = svc();
    let open = await service.openRound("hero", bet, "cs", "o1");
    let guard = 0;
    while (!open.ended && guard++ < 50) {
      const f = await service.continueRound(open.roundId, "hero");
      if (f.ended) break;
    }
    const afterLoss = wallet.balance("hero");
    await service.openRound("hero", bet, "cs", "o2");
    ok(Math.abs(afterLoss - wallet.balance("hero") - bet) < 1e-9, `loss -> START at $${bet}: exactly one stake debited`);
  }
}

// 7) resume reports the same 0-based round index the fight events carry
{
  const { service } = svc();
  const open = await service.openRound("hero", 10, "cs", "k1");
  const snap = await service.resume("hero");
  ok(snap.roundIndex === open.event.roundIndex, "resume: roundIndex matches the last event (no off-by-one)");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
