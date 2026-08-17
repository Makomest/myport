// Client meta over WS: play a round against the real server (with a MetaService
// over the same audit log), then query stats / leaderboard / history.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { GameClient } from "../dist/gameClient.js";
import { InMemoryWallet } from "../../server/dist/wallet.js";
import { ResponsibleGaming } from "../../server/dist/responsible.js";
import { SeedManager } from "../../server/dist/seeds.js";
import { GameService } from "../../server/dist/gameService.js";
import { InMemoryAudit } from "../../server/dist/audit.js";
import { MetaService } from "../../server/dist/meta.js";
import { startWsServer } from "../../server/dist/wsServer.js";

const PORT = 8796;
const wallet = new InMemoryWallet();
wallet.fund("hero", 1000);
const audit = new InMemoryAudit();
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager(), undefined, audit);
const wss = startWsServer({ port: PORT, service: svc, account: "hero", meta: new MetaService(audit) });

const nodeSocket = (url) => {
  const ws = new WebSocket(url);
  return {
    send: (d) => ws.send(d), close: () => ws.close(),
    onMessage: (cb) => ws.on("message", (d) => cb(String(d))),
    onOpen: (cb) => ws.on("open", cb), onClose: (cb) => ws.on("close", cb),
  };
};

const socket = nodeSocket(`ws://localhost:${PORT}/`);
const client = new GameClient(socket);

// play one round to completion
await new Promise((resolve) => {
  let done = false;
  client.onUpdate((s) => {
    if (done) return;
    if (s.phase === "decision") (s.multiplier >= 1.3 ? client.cashOut() : client.continue());
    else if (s.phase === "ended" || s.phase === "error") { done = true; resolve(); }
  });
  socket.onOpen(() => client.open(10, "hero-seed"));
});

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
console.log("=".repeat(64));
console.log("  CLIENT META over WS");
console.log("=".repeat(64));

const stats = await client.requestStats();
ok(stats && stats.account === "hero" && stats.rounds >= 1, "requestStats() returns the player's stats");
ok(client.lastStats === stats, "client caches lastStats");

const lb = await client.requestLeaderboard("biggestMultiplier");
ok(Array.isArray(lb) && lb.some((e) => e.account === "hero"), "requestLeaderboard() includes the player");

const hist = await client.requestHistory();
ok(hist.length >= 1 && typeof hist[0].roundId === "string", "requestHistory() returns the played round(s)");
ok(hist[0].net === hist[0].payout - hist[0].bet, "history rows carry net = payout - bet");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
socket.close();
wss.close(() => process.exit(0));
setTimeout(() => process.exit(0), 500).unref();
