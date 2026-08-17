// Meta layer from the audit log: leaderboards, history, player stats — plus a
// WS round-trip proving a played round is queryable over the socket.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { InMemoryAudit } from "../dist/audit.js";
import { MetaService } from "../dist/meta.js";
import { GameService } from "../dist/gameService.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";
import { startWsServer } from "../dist/wsServer.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };

console.log("=".repeat(64));
console.log("  META — leaderboards / history / stats from the audit log");
console.log("=".repeat(64));

// --- synthetic records (precise) ---
let seq = 0;
const rec = (account, o) => ({
  account, roundId: "r" + ++seq, bet: o.bet ?? 10,
  serverSeedHash: "h".repeat(64), serverSeed: "s".repeat(64), clientSeed: "c", nonce: 0,
  rounds: o.rounds ?? 1, payoutMult: o.payoutMult ?? 0, payout: o.payout ?? 0,
  busted: o.busted ?? false, ts: o.ts ?? 1000 + seq,
});

const audit = new InMemoryAudit();
audit.record(rec("alice", { rounds: 5, payoutMult: 5, payout: 50 }));
audit.record(rec("alice", { rounds: 2, busted: true }));
audit.record(rec("bob", { rounds: 8, payoutMult: 12, payout: 120 }));
audit.record(rec("carol", { rounds: 1, busted: true }));
const meta = new MetaService(audit);

{
  const lb = meta.leaderboard("biggestMultiplier");
  ok(lb.length === 3 && lb[0].account === "bob" && lb[0].value === 12, "leaderboard biggestMultiplier: bob top at 12");
  ok(lb[1].account === "alice" && lb[1].value === 5, "alice second at her best (5)");
  ok(lb[2].account === "carol" && lb[2].value === 0, "carol last at 0");
}
ok(meta.leaderboard("longestRun")[0].value === 8, "leaderboard longestRun: top is 8 (bob)");
ok(meta.leaderboard("biggestPayout")[0].value === 120, "leaderboard biggestPayout: top is 120 (bob)");

{
  const h = meta.history("alice");
  ok(h.length === 2 && h[0].busted === true && h[1].busted === false, "history is newest-first (alice: bust then earlier win)");
  ok(h[1].net === 40, "history net = payout - bet (50 - 10)");
}
{
  const s = meta.playerStats("alice");
  ok(s.rounds === 2 && s.staked === 20 && s.returned === 50 && s.net === 30, "playerStats aggregates rounds/staked/returned/net");
  ok(s.winRate === 0.5 && s.biggestMultiplier === 5 && s.longestRun === 5, "playerStats winRate + bests");
}

// --- WS round-trip: play a round, then query stats + leaderboard over the socket ---
const PORT = 8794;
const wallet = new InMemoryWallet();
wallet.fund("metahero", 1000);
const liveAudit = new InMemoryAudit();
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager(), undefined, liveAudit);
const wss = startWsServer({ port: PORT, service: svc, account: "metahero", meta: new MetaService(liveAudit) });

const res = {};
let finished = false;
const finish = () => {
  if (finished) return;
  finished = true;
  ok(res.roundRecorded === true, "WS: a played round shows up in stats over the socket");
  ok(res.lbHasHero === true, "WS: leaderboard returns the player over the socket");
  try { ws.close(); } catch {}
  console.log("=".repeat(64));
  console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
  console.log("=".repeat(64));
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref(); // fallback if close callback stalls
};
const safety = setTimeout(finish, 5000);

const ws = new WebSocket(`ws://localhost:${PORT}/`);
ws.on("open", () => ws.send(JSON.stringify({ type: "open", bet: 10, clientSeed: "x", idemKey: "o1" })));
ws.on("message", (d) => {
  const m = JSON.parse(String(d));
  if (m.type === "opened") ws.send(JSON.stringify(m.ended ? { type: "stats" } : { type: "cashout", idemKey: "c1" }));
  else if (m.type === "cashout") ws.send(JSON.stringify({ type: "stats" }));
  else if (m.type === "stats") {
    res.roundRecorded = !!m.stats && m.stats.rounds >= 1;
    ws.send(JSON.stringify({ type: "leaderboard", kind: "biggestMultiplier" }));
  } else if (m.type === "leaderboard") {
    res.lbHasHero = Array.isArray(m.items) && m.items.some((e) => e.account === "metahero");
    clearTimeout(safety);
    finish();
  } else if (m.type === "error") {
    clearTimeout(safety);
    finish();
  }
});
