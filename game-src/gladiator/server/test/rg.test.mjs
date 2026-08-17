// Responsible-gaming surface: status fields, reality-check due + acknowledge,
// and self-exclusion blocking play until it expires. Headless (injected clock).
import assert from "node:assert/strict";
import { ResponsibleGaming, defaultLimits } from "../dist/responsible.js";
import { GameService } from "../dist/gameService.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { SeedManager } from "../dist/seeds.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const fixedSeeds = () => new SeedManager((len) => Buffer.alloc(len, 0x2a));

console.log("=".repeat(64));
console.log("  RESPONSIBLE GAMING — status / reality-check / self-exclusion");
console.log("=".repeat(64));

// 1. status fields
{
  let now = 0;
  const rg = new ResponsibleGaming({ ...defaultLimits, maxBet: 50, maxLossPerSession: 200 }, () => now);
  const w = new InMemoryWallet(); w.fund("p", 1000);
  const svc = new GameService(w, rg, fixedSeeds());
  const st = svc.rgStatus("p");
  ok(st.netLoss === 0 && st.rounds === 0 && st.maxBet === 50 && st.maxLossPerSession === 200, "rgStatus exposes limits + a zeroed session");
  ok(st.realityCheckDue === false && st.selfExcludedUntil === null, "no reality-check due / not excluded at start");
}

// 2. reality-check becomes due, acknowledge resets it
{
  let now = 0;
  const rg = new ResponsibleGaming({ ...defaultLimits, realityCheckEveryMs: 1000 }, () => now);
  const w = new InMemoryWallet(); w.fund("p", 1000);
  const svc = new GameService(w, rg, fixedSeeds());
  svc.rgStatus("p"); // opens the session at t=0
  now = 1500;
  ok(svc.rgStatus("p").realityCheckDue === true, "reality-check becomes due after the interval");
  ok(svc.acknowledgeRealityCheck("p").realityCheckDue === false, "acknowledge resets the reality-check");
}

// 3. self-exclusion blocks play until it expires
{
  let now = 0;
  const rg = new ResponsibleGaming(defaultLimits, () => now);
  const w = new InMemoryWallet(); w.fund("p", 1000);
  const svc = new GameService(w, rg, fixedSeeds());
  ok(svc.selfExclude("p", 60000).selfExcludedUntil === 60000, "self-exclude sets the exclusion deadline");
  await assert.rejects(() => svc.openRound("p", 10, "s", "o1"), /self-excluded/);
  ok(w.balance("p") === 1000, "self-excluded: openRound blocked, no debit");
  now = 60001;
  await svc.openRound("p", 10, "s", "o2");
  ok(w.balance("p") === 990, "after the exclusion expires, play resumes (stake debited)");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
