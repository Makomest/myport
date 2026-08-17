// Unit tests for the deterministic replay timeline (no network, no browser).
import assert from "node:assert/strict";
import { buildTimeline, Replayer, totalDuration, defaultTimings } from "../dist/replay.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const ev = (roundIndex, won, multiplier, extra = {}) => ({ roundIndex, winChance: 0.85, won, jackpot: false, multiplier, ...extra });

console.log("=".repeat(64));
console.log("  REPLAY TIMELINE — deterministic fight playback");
console.log("=".repeat(64));

// 1. win / win / cashout
{
  const events = [
    ev(0, true, 1.05, { rarity: "Common", itemMult: 1.05, setId: 0 }),
    ev(1, true, 1.418, { rarity: "Epic", itemMult: 1.35, setId: 1 }),
  ];
  const beats = buildTimeline({ events, opponent: { name: "Crixus", id: 1, power: 1.1 }, payout: 14.18, payoutMult: 1.418 });
  ok(JSON.stringify(beats.map((b) => b.kind)) === JSON.stringify(["intro", "clash", "loot", "clash", "loot", "cashout"]),
    "win/win/cashout → intro → (clash,loot)×2 → cashout");
  ok(beats[2].from === 1 && Math.abs(beats[2].to - 1.05) < 1e-9, "first loot tweens 1.00 → 1.05");
  ok(Math.abs(beats[4].from - 1.05) < 1e-9 && Math.abs(beats[4].to - 1.418) < 1e-9, "second loot tweens 1.05 → 1.418");
  ok(beats[5].kind === "cashout" && beats[5].payout === 14.18, "cashout beat carries the payout");
}

// 2. win then bust (no cashout)
{
  const events = [ev(0, true, 1.15, { rarity: "Rare", itemMult: 1.15, setId: 0 }), ev(1, false, 1.15)];
  const beats = buildTimeline({ events });
  ok(JSON.stringify(beats.map((b) => b.kind)) === JSON.stringify(["intro", "clash", "loot", "clash", "bust"]),
    "win then loss ends on bust, no cashout");
}

// 3. jackpot drop gets the longer beat
{
  const events = [ev(0, true, 10, { rarity: "Golden Crown", itemMult: 10, setId: 2, jackpot: true })];
  const beats = buildTimeline({ events, payout: 100, payoutMult: 10 });
  const loot = beats.find((b) => b.kind === "loot");
  ok(loot.jackpot === true && loot.duration === defaultTimings.jackpot, "jackpot loot uses the longer jackpot beat");
}

// 4. Replayer emits every beat once, in order, then finishes
{
  const events = [ev(0, true, 1.05, { rarity: "Common", itemMult: 1.05, setId: 0 })];
  const beats = buildTimeline({ events, payout: 10.5, payoutMult: 1.05 }); // intro, clash, loot, cashout
  const r = new Replayer(beats);
  const seen = [];
  let guard = 0;
  while (!r.finished && guard++ < 10000) for (const b of r.step(50)) seen.push(b.kind);
  ok(JSON.stringify(seen) === JSON.stringify(beats.map((b) => b.kind)), "Replayer emits every beat once, in order");
  ok(r.finished, "Replayer reaches finished");
  ok(Math.abs(totalDuration(beats) - (700 + 800 + 600 + 1100)) < 1e-9, "totalDuration sums beat durations (3200ms)");
}

// 5. progress stays in [0,1]
{
  const beats = buildTimeline({ events: [ev(0, true, 1.2, { rarity: "Rare", itemMult: 1.2, setId: 0 })], payout: 12, payoutMult: 1.2 });
  const r = new Replayer(beats);
  r.step(300);
  ok(r.progress >= 0 && r.progress <= 1, "progress is clamped to [0,1] mid-beat");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
