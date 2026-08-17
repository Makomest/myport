// DAILY RESET — at UTC-midnight rollover the FINISHED window is archived under a
// date id and resolved (prizes paid), THEN the new day's window opens. This locks
// the fix for "prizes never distributed because the window rolled before resolve".
// It reproduces the exact archive+resolve sequence serve.mjs' ensureDaily() runs.
import assert from "node:assert/strict";
import { InMemoryAudit } from "../dist/audit.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { TournamentService, InMemoryTournamentStore } from "../dist/tournaments.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const star = (account, ts, stars) => ({
  account, roundId: "r" + account + ts, bet: 10, serverSeedHash: "h".repeat(64), serverSeed: "s".repeat(64),
  clientSeed: "c", nonce: 0, rounds: 1, payoutMult: 0, payout: 0, busted: true, ts, stars,
});

console.log("=".repeat(64));
console.log("  DAILY RESET — prizes paid out when the window rolls over");
console.log("=".repeat(64));

const DAY = 24 * 3600 * 1000;
const day0 = Date.UTC(2026, 5, 11); // a UTC midnight
const audit = new InMemoryAudit();
// yesterday's stars (inside [day0, day0+DAY))
audit.record(star("kakak", day0 + 1000, 40));
audit.record(star("starA", day0 + 2000, 9));
audit.record(star("starB", day0 + 3000, 5));
const wallet = new InMemoryWallet();
const store = new InMemoryTournamentStore();

let now = day0 + 1000;
const tournaments = new TournamentService(audit, wallet, store, () => now);

// the exact ensureDaily() rollover logic (id "daily" live; archive+resolve the finished one)
const utcDayWindow = (t) => { const d = new Date(t); const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); return { from, to: from + DAY }; };
function ensureDaily() {
  const w = utcDayWindow(now);
  const cur = store.list().find((t) => t.id === "daily");
  if (cur && cur.from === w.from) return;
  if (cur && cur.to <= now) {
    const archiveId = "daily-" + new Date(cur.from).toISOString().slice(0, 10);
    if (!store.result(archiveId)) { store.add({ ...cur, id: archiveId }); tournaments.resolve(archiveId); }
  }
  const def = { id: "daily", name: "Daily Arena", from: w.from, to: w.to, metric: "stars", prizePool: 100, payoutSplit: [0.5, 0.3, 0.2] };
  store.upsert(def);
}

// day 0: open the arena, players accrue stars
ensureDaily();
ok(store.list().some((t) => t.id === "daily" && t.from === day0), "day-0 Daily Arena window is open");
ok(wallet.balance("kakak") === 0, "no prizes paid mid-day");

// roll to the next UTC day
now = day0 + DAY + 5000;
ensureDaily();

ok(wallet.balance("kakak") === 50, "1st (kakak, ★40) paid 50% of $100 = $50 at reset");
ok(wallet.balance("starA") === 30, "2nd (starA, ★9) paid 30% = $30");
ok(wallet.balance("starB") === 20, "3rd (starB, ★5) paid 20% = $20");
ok(store.list().some((t) => t.id === "daily" && t.from === day0 + DAY), "new day-1 window opened after payout");
ok(!!store.result("daily-2026-06-11"), "finished window archived + result persisted");

// idempotent: another tick the same day must not double-pay
now += 60_000;
ensureDaily();
ok(wallet.balance("kakak") === 50, "rollover is idempotent — no double payout on later ticks");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
