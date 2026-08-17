// Scheduled auto-resolution: tick() resolves only finished tournaments, pays once
// (idempotent), emits ops notifications, and operators read them over the ops WS.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { InMemoryAudit } from "../dist/audit.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { TournamentService, InMemoryTournamentStore } from "../dist/tournaments.js";
import { TournamentScheduler, InMemoryNotifications } from "../dist/scheduler.js";
import { FraudService } from "../dist/fraud.js";
import { JwtAuth } from "../dist/auth.js";
import { signJwt } from "../dist/jwt.js";
import { startOpsServer } from "../dist/index.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
let seq = 0;
const rec = (account, ts, o = {}) => ({
  account, roundId: "r" + ++seq, bet: o.bet ?? 10,
  serverSeedHash: "h".repeat(64), serverSeed: "s".repeat(64), clientSeed: "c", nonce: 0,
  rounds: o.rounds ?? 1, payoutMult: o.payoutMult ?? 0, payout: o.payout ?? 0, busted: o.busted ?? false, ts,
});

console.log("=".repeat(64));
console.log("  TOURNAMENT SCHEDULER — auto-resolve + ops notifications");
console.log("=".repeat(64));

const audit = new InMemoryAudit();
audit.record(rec("hero", 100, { payoutMult: 5, payout: 50 }));
const wallet = new InMemoryWallet();
const store = new InMemoryTournamentStore();
store.add({ id: "t1", name: "T1", from: 0, to: 1000, metric: "biggestMultiplier", prizePool: 100, payoutSplit: [1.0] });
store.add({ id: "t2", name: "T2", from: 0, to: 5000, metric: "biggestMultiplier", prizePool: 50, payoutSplit: [1.0] });

let now = 500;
const tourn = new TournamentService(audit, wallet, store, () => now);
const notes = new InMemoryNotifications();
const sched = new TournamentScheduler(tourn, store, notes, () => now);

ok(sched.tick().length === 0 && notes.recent().length === 0, "tick before any end resolves nothing");

now = 1500; // t1 finished, t2 not
const r1 = sched.tick();
ok(r1.length === 1 && r1[0].id === "t1", "tick resolves only the finished tournament (t1)");
ok(wallet.balance("hero") === 100, "scheduler paid the winner");
ok(notes.recent().length === 1 && notes.recent()[0].id === "t1" && notes.recent()[0].paid === 100, "an ops notification was emitted for t1");

const r2 = sched.tick();
ok(r2.length === 0 && notes.recent().length === 1 && wallet.balance("hero") === 100, "re-tick does not re-resolve, re-notify, or double-pay");

now = 6000; // t2 finished
const r3 = sched.tick();
ok(r3.length === 1 && r3[0].id === "t2", "later tick resolves t2 once its window passes");
ok(notes.recent().length === 2 && notes.recent()[0].id === "t2", "newest notification is first");

// operators read the notifications over the ops channel
const SECRET = "ops-secret";
const PORT = 8803;
const ops = startOpsServer({ port: PORT, auth: new JwtAuth(SECRET, "sub", "operator"), fraud: new FraudService(audit), tournaments: tourn, notifications: notes });
const token = signJwt({ sub: "admin", role: "operator" }, SECRET, { expiresInSec: 60 });

const res = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/?token=${token}`);
  ws.on("open", () => ws.send(JSON.stringify({ type: "notifications" })));
  ws.on("message", (d) => { const m = JSON.parse(String(d)); ws.close(); resolve(m); });
  ws.on("error", () => {});
});
ok(res.type === "notifications" && res.items.length === 2 && res.items[0].id === "t2", "operator reads resolution notifications over the ops channel");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
ops.close(() => process.exit(0));
setTimeout(() => process.exit(0), 500).unref();
