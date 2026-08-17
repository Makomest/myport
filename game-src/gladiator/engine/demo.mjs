// Demonstrates the server-authoritative round API with provably-fair RNG.
import crypto from "node:crypto";
import { GladiatorRound } from "./dist/round.js";
import { ProvablyFairRng } from "./dist/rng.js";
import { baseConfig } from "./dist/config.js";

const serverSeed = crypto.randomBytes(32).toString("hex");
const clientSeed = "player-seed-xyz";
const nonce = 1;

console.log("=".repeat(64));
console.log("  GladiatorRound — server-authoritative API + provably-fair");
console.log("=".repeat(64));
console.log("  commit serverSeedHash =", ProvablyFairRng.serverSeedHash(serverSeed));
console.log(`  clientSeed = ${clientSeed}  nonce = ${nonce}  bet = $${baseConfig.baseBet}\n`);

const rng = new ProvablyFairRng(serverSeed, clientSeed, nonce);
const round = new GladiatorRound(baseConfig, rng, baseConfig.baseBet);

const log = (ev) =>
  console.log(
    `  R${ev.roundIndex}: chance ${(ev.winChance * 100).toFixed(1)}%  ` +
      (ev.won
        ? `WIN  +${ev.rarity}(x${ev.itemMult}, set ${ev.setId})  -> total x${ev.multiplier.toFixed(3)}`
        : "BUST — stake lost"),
  );

// Simple bot policy: cash once the multiplier reaches 2x, else keep fighting.
let ev = round.start();
log(ev);
while (round.phase === "decision") {
  if (round.multiplier >= 2.0) {
    const c = round.cashOut();
    console.log(`\n  CASH OUT after ${c.rounds} rounds: x${c.payoutMult.toFixed(3)} = $${c.payout.toFixed(2)}`);
    break;
  }
  ev = round.continue();
  log(ev);
}
if (round.phase === "ended" && !ev.won) console.log("\n  Run ended: busted, payout $0.00");

console.log("\n  reveal serverSeed =", serverSeed);
console.log("=".repeat(64));
