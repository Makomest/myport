// End-to-end test of the backend core: wallet idempotency, RG gates,
// round orchestration, settlement and provably-fair reveal/replay.
import assert from "node:assert/strict";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming, defaultLimits } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";
import { GameService } from "../dist/gameService.js";
import { GladiatorRound, ProvablyFairRng, baseConfig } from "gladiator-engine";

let n = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  console.log("  ✓", msg);
  n++;
};
// Deterministic server seeds so the run is reproducible.
const fixedSeeds = () => new SeedManager((len) => Buffer.alloc(len, 0x2a));

console.log("=".repeat(64));
console.log("  BACKEND CORE — integration");
console.log("=".repeat(64));

// 1) open debits the stake and commits a hashed seed + opponent
{
  const w = new InMemoryWallet();
  w.fund("alice", 1000);
  const svc = new GameService(w, new ResponsibleGaming(), fixedSeeds());
  const r = await svc.openRound("alice", 10, "alice-seed", "open-alice");
  ok(w.balance("alice") === 990, "open() debits the stake (1000 -> 990)");
  ok(r.serverSeedHash.length === 64, "serverSeedHash is committed before the round");
  ok(r.serverSeed === undefined || r.ended, "serverSeed stays secret until the round ends");
  ok(typeof r.opponent.name === "string" && r.opponent.power >= 0.8, "NPC opponent derived from seed");
  ok(r.event.roundIndex === 0, "first event is the entry fight");
  ok(w.ledger("alice").length === 1 && w.ledger("alice")[0].kind === "debit", "audit trail records the debit");
}

// 2) open() is idempotent — a retried request never double-charges
{
  const w = new InMemoryWallet();
  w.fund("bob", 1000);
  const svc = new GameService(w, new ResponsibleGaming(), fixedSeeds());
  const a = await svc.openRound("bob", 25, "s", "open-bob");
  const b = await svc.openRound("bob", 25, "s", "open-bob"); // retry, same idemKey
  ok(w.balance("bob") === 975, "retry with same idemKey does not double-debit");
  ok(a.roundId === b.roundId, "retry returns the same round");
}

// 3) full session — play to cashout or bust; money + RG stay consistent
{
  const w = new InMemoryWallet();
  w.fund("carol", 1000);
  const rg = new ResponsibleGaming();
  const svc = new GameService(w, rg, fixedSeeds());
  const open = await svc.openRound("carol", 20, "carol-seed", "open-carol");
  ok(w.balance("carol") === 980, "stake debited at open");

  let last = open.event;
  let ended = open.ended;
  let cashed = null;
  while (!ended) {
    if (last.multiplier >= 1.5) {
      cashed = await svc.cashOut(open.roundId, "cash-carol");
      break;
    }
    const f = await svc.continueRound(open.roundId);
    last = f.event;
    ended = f.ended;
  }
  if (cashed) {
    ok(cashed.payout === cashed.payoutMult * 20, "payout = cappedMultiplier * bet");
    ok(w.balance("carol") === 980 + cashed.payout, "cashout credits the payout");
    ok(rg.netLoss("carol") === 20 - cashed.payout, "RG session net-loss = stake - payout");
  } else {
    ok(w.balance("carol") === 980, "bust: stake lost, nothing credited");
    ok(rg.netLoss("carol") === 20, "RG session net-loss = full stake on bust");
  }
}

// 4) provably-fair: revealed seed verifies AND replays bit-identically
{
  const w = new InMemoryWallet();
  w.fund("dave", 1000);
  const svc = new GameService(w, new ResponsibleGaming(), fixedSeeds());
  const open = await svc.openRound("dave", 10, "dave-seed", "open-dave");
  // reveal the seed by ending the round (cash out immediately if still alive)
  const serverSeed = open.ended ? open.serverSeed : (await svc.cashOut(open.roundId, "cash-dave")).serverSeed;
  ok(ProvablyFairRng.serverSeedHash(serverSeed) === open.serverSeedHash, "revealed serverSeed matches the published hash");

  const replayRng = new ProvablyFairRng(serverSeed, "dave-seed", open.nonce);
  const replay = new GladiatorRound(baseConfig, replayRng, 10);
  const ev = replay.start();
  ok(ev.won === open.event.won && Math.abs(ev.multiplier - open.event.multiplier) < 1e-12, "entry fight replays identically from the revealed seed");
}

// 5) RG blocks an over-limit bet BEFORE any money moves
{
  const w = new InMemoryWallet();
  w.fund("eve", 1000);
  const rg = new ResponsibleGaming({ ...defaultLimits, maxBet: 5 });
  const svc = new GameService(w, rg, fixedSeeds());
  await assert.rejects(() => svc.openRound("eve", 10, "s", "open-eve"), /responsible-gaming/);
  ok(w.balance("eve") === 1000, "RG blocks over-limit bet with no debit");
}

// 6) RG blocks once the session loss limit is hit
{
  const w = new InMemoryWallet();
  w.fund("frank", 100000);
  const rg = new ResponsibleGaming({ ...defaultLimits, maxLossPerSession: 50, maxBet: 100, maxRoundsPerSession: 100000 });
  const svc = new GameService(w, rg, fixedSeeds());
  let blocked = false;
  for (let i = 0; i < 500; i++) {
    try {
      const o = await svc.openRound("frank", 20, "s" + i, "open-frank-" + i);
      if (!o.ended) await svc.cashOut(o.roundId, "cash-frank-" + i);
    } catch (e) {
      blocked = e.name === "RgBlockedError";
      break;
    }
  }
  ok(blocked, "RG blocks new rounds once session net-loss limit is reached");
}

// 7) reality-check nudge fires after the configured interval
{
  let now = 0;
  const rg = new ResponsibleGaming({ ...defaultLimits, realityCheckEveryMs: 1000 }, () => now);
  const w = new InMemoryWallet();
  w.fund("gwen", 1000);
  const svc = new GameService(w, rg, fixedSeeds());
  const first = await svc.openRound("gwen", 10, "s", "g1");
  ok(first.realityCheckDue === false, "no reality check at session start");
  if (!first.ended) await svc.cashOut(first.roundId, "g1-cash", "gwen"); // one live round per account
  now += 1500; // advance past the interval
  const second = await svc.openRound("gwen", 10, "s", "g2");
  ok(second.realityCheckDue === true, "reality check becomes due after the interval");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
