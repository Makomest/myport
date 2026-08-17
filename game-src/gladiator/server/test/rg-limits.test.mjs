// Player-set limits: tighten applies immediately, loosen waits out a cool-off,
// player loss-limit blocks sooner, and limits persist across a restart.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ResponsibleGaming, defaultLimits } from "../dist/responsible.js";
import { FileLimitsStore } from "../dist/persistence/fileLimitsStore.js";
import { GameService } from "../dist/gameService.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { SeedManager } from "../dist/seeds.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const fixedSeeds = () => new SeedManager((len) => Buffer.alloc(len, 0x2a));
const DAY = 24 * 60 * 60 * 1000;

console.log("=".repeat(64));
console.log("  PLAYER-SET LIMITS — tighten now / loosen delayed / persist");
console.log("=".repeat(64));

// 1. tighten applies immediately
{
  let now = 0;
  const svc = new GameService(new InMemoryWallet(), new ResponsibleGaming(defaultLimits, () => now), fixedSeeds());
  const w = new InMemoryWallet(); w.fund("p", 10000);
  const svc2 = new GameService(w, new ResponsibleGaming(defaultLimits, () => now), fixedSeeds());
  const st = svc2.setLimits("p", { maxBet: 5 });
  ok(st.maxBet === 5, "tightening maxBet applies immediately");
  await assert.rejects(() => svc2.openRound("p", 10, "s", "o1"), /bet exceeds limit/);
  ok(w.balance("p") === 10000, "bet above the new tighter limit is blocked");
  await svc2.openRound("p", 5, "s", "o2");
  ok(w.balance("p") === 9995, "bet within the limit is allowed");
  void svc;
}

// 2. loosen is delayed by the cool-off
{
  let now = 0;
  const w = new InMemoryWallet(); w.fund("p", 10000);
  const svc = new GameService(w, new ResponsibleGaming(defaultLimits, () => now), fixedSeeds());
  svc.setLimits("p", { maxBet: 5 }); // tighten (immediate)
  const st = svc.setLimits("p", { maxBet: 50 }); // loosen -> pending
  ok(st.maxBet === 5, "loosening does not take effect immediately (still 5)");
  ok(st.pendingLimits?.changes.maxBet === 50 && st.pendingLimits?.effectiveAt === DAY, "loosening is queued with a cool-off deadline");
  await assert.rejects(() => svc.openRound("p", 10, "s", "o1"), /bet exceeds limit/);
  ok(true, "during the cool-off the tighter limit still blocks");
  now = DAY + 1; // wait out the cool-off
  ok(svc.rgStatus("p").maxBet === 50, "after the cool-off the looser limit applies");
  await svc.openRound("p", 10, "s", "o2");
  ok(w.balance("p") === 9990, "now a larger bet is allowed");
}

// 3. player-set session loss limit blocks sooner
{
  let now = 0;
  const w = new InMemoryWallet(); w.fund("p", 100000);
  const svc = new GameService(w, new ResponsibleGaming(defaultLimits, () => now), fixedSeeds());
  svc.setLimits("p", { maxLossPerSession: 30 });
  let blocked = false;
  for (let i = 0; i < 50; i++) {
    try {
      const o = await svc.openRound("p", 20, "s" + i, "k" + i);
      if (!o.ended) await svc.cashOut(o.roundId, "c" + i);
    } catch (e) {
      blocked = e.name === "RgBlockedError";
      break;
    }
  }
  ok(blocked, "player-set session loss limit blocks once reached");
}

// 4. persistence across restart (FileLimitsStore)
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glad-lim-"));
  const file = path.join(dir, "limits.json");
  let now = 0;
  new ResponsibleGaming(defaultLimits, () => now, new FileLimitsStore(file)).setLimits("p", { maxBet: 7 });
  const rg2 = new ResponsibleGaming(defaultLimits, () => now, new FileLimitsStore(file));
  ok(rg2.effectiveLimits("p").maxBet === 7, "player limit survives restart (reloaded from disk)");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
