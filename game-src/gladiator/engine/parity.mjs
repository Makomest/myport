// Proves the TypeScript engine reproduces the Phase-0 validated JS engine
// bit-for-bit: same seed + same config => identical outcomes. Uses the JS sim's
// own config for BOTH engines so any difference is pure engine-logic drift.
import { makeFastRng as tsRng } from "./dist/rng.js";
import { buildOutcomes as tsBuild, playRun as tsPlay } from "./dist/engine.js";
import { makeFastRng as jsRng } from "../sim/src/rng.mjs";
import { buildOutcomes as jsBuild, playRun as jsPlay } from "../sim/src/engine.mjs";
import { baseConfig as cfg } from "../sim/src/config.mjs";

const variants = { safe: 0.3, standard: 1.0, aggressive: 4.0, risk: 8.0 };
const cashAfter = (n) => (round) => (round >= n ? "cash" : "continue");
const RUNS = 50_000;

let total = 0, mism = 0, maxDiff = 0;
let tsSum = 0, jsSum = 0;

for (const [, v] of Object.entries(variants)) {
  for (const n of [1, 3, 5, 8, 15]) {
    const tsOut = tsBuild(cfg, v);
    const jsOut = jsBuild(cfg, v);
    const r1 = tsRng(0xc0ffee);
    const r2 = jsRng(0xc0ffee);
    for (let i = 0; i < RUNS; i++) {
      const a = tsPlay(r1, tsOut, cfg, cashAfter(n));
      const b = jsPlay(r2, jsOut, cfg, cashAfter(n));
      total++;
      tsSum += a.payoutMult;
      jsSum += b.payoutMult;
      const d = Math.abs(a.payoutMult - b.payoutMult);
      if (d > 1e-12 || a.rounds !== b.rounds || a.busted !== b.busted) {
        mism++;
        if (d > maxDiff) maxDiff = d;
      }
    }
  }
}

console.log("=".repeat(60));
console.log("  TS ENGINE  vs  JS REFERENCE  — parity");
console.log("=".repeat(60));
console.log(`  runs compared : ${total.toLocaleString()}`);
console.log(`  TS aggregate RTP : ${(tsSum / total).toFixed(6)}`);
console.log(`  JS aggregate RTP : ${(jsSum / total).toFixed(6)}`);
console.log(`  mismatches    : ${mism}   (max payout diff ${maxDiff})`);
console.log("=".repeat(60));
console.log(mism === 0
  ? "  PARITY ✓  TypeScript engine == validated JS reference (bit-exact)."
  : "  PARITY ✗  divergence detected — inspect the port.");
console.log("=".repeat(60));
process.exit(mism === 0 ? 0 : 1);
