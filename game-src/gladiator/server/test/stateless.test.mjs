// STATELESS ROUNDS — a round opened on one instance is continued and cashed out
// on ANOTHER, with only a shared store + wallet between them (no sticky session).
// The live round is reconstructed from its seed descriptor on each instance.
import assert from "node:assert/strict";
import { GameService } from "../dist/gameService.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";
import { InMemoryRoundStore } from "../dist/persistence/roundStore.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const seeds = () => new SeedManager((len) => Buffer.alloc(len, 0x2a));

console.log("=".repeat(64));
console.log("  STATELESS ROUNDS — open on A, continue/cashout on B (shared store)");
console.log("=".repeat(64));

// shared across the "fleet"
const wallet = new InMemoryWallet();
await wallet.fund("hero", 1000);
const store = new InMemoryRoundStore();

// two independent server instances — DIFFERENT SeedManagers, SAME store + wallet
const A = new GameService(wallet, new ResponsibleGaming(), seeds(), undefined, undefined, store);
const B = new GameService(wallet, new ResponsibleGaming(), seeds(), undefined, undefined, store);

// open on A
const open = await A.openRound("hero", 50, "cs", "o1");
ok(wallet.balance("hero") === 950, "instance A: openRound debited (1000 -> 950)");
ok(!open.ended, "round is live (entry win) — fixed seed");

// resume on B (no prior knowledge — only the shared store)
const snap = await B.resume("hero");
ok(snap && snap.roundId === open.roundId, "instance B resumed the SAME round from the shared store");
ok(Math.abs(snap.multiplier - open.event.multiplier) < 1e-9, "B reconstructed the exact multiplier by seed-replay");

// continue on B, then continue on A — they stay in lock-step via the store
let last = open.event, ended = false, who = B;
let cashed = null;
while (!ended) {
  if (last.multiplier >= 1.4) { cashed = await who.cashOut(open.roundId, "c1"); break; }
  const f = await who.continueRound(open.roundId);
  ok(f.roundId === open.roundId, `${who === A ? "A" : "B"}: continued the shared round (mult ${f.event.multiplier.toFixed(2)})`);
  last = f.event; ended = f.ended;
  who = who === A ? B : A; // bounce between instances every fight
}

if (cashed) {
  ok(wallet.balance("hero") === 950 + cashed.payout, "cashout credited the shared wallet from whichever instance");
  ok((await A.resume("hero")) === null && (await B.resume("hero")) === null, "round cleared from the store on both instances");
} else {
  ok(wallet.balance("hero") === 950, "busted across instances: stake forfeit, nothing credited");
  ok((await A.resume("hero")) === null, "busted round removed from the store");
}

// idempotency is shared too: replaying open o1 on B returns A's exact result
const replay = await B.openRound("hero", 50, "cs", "o1");
ok(replay.roundId === open.roundId, "open idempotency is cross-instance (B replays A's o1 result)");

// ownership binding (IDOR): another account cannot continue/cashout someone else's round
await wallet.fund("victim", 1000);
const vOpen = await A.openRound("victim", 30, "vc", "v1");
if (!vOpen.ended) {
  let blockedCont = false, blockedCash = false;
  try { await B.continueRound(vOpen.roundId, "thief"); } catch { blockedCont = true; }
  try { await B.cashOut(vOpen.roundId, "steal", "thief"); } catch { blockedCash = true; }
  ok(blockedCont, "a thief cannot CONTINUE the victim's round (reported not-found)");
  ok(blockedCash, "a thief cannot CASH OUT the victim's round (reported not-found)");
  ok((await A.resume("victim")) !== null, "the victim's round is untouched after the attempts");
  // the rightful owner still can
  ok((await A.cashOut(vOpen.roundId, "v-cash", "victim")).roundId === vOpen.roundId, "the owner can cash out their own round");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
