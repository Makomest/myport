// Seasons over WS: play a round, then query the player's sessions and the
// current season (windowed leaderboard + operator stats).
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { GameClient } from "../dist/gameClient.js";
import { InMemoryWallet } from "../../server/dist/wallet.js";
import { ResponsibleGaming } from "../../server/dist/responsible.js";
import { SeedManager } from "../../server/dist/seeds.js";
import { GameService } from "../../server/dist/gameService.js";
import { InMemoryAudit } from "../../server/dist/audit.js";
import { SeasonsService } from "../../server/dist/seasons.js";
import { startWsServer } from "../../server/dist/wsServer.js";

const PORT = 8798;
const wallet = new InMemoryWallet();
wallet.fund("hero", 1000);
const audit = new InMemoryAudit();
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager(), undefined, audit);
const wss = startWsServer({ port: PORT, service: svc, account: "hero", seasons: new SeasonsService(audit) });

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

const startedAt = Date.now();
await new Promise((resolve) => {
  let done = false;
  client.onUpdate((s) => {
    if (done) return;
    if (s.phase === "decision") (s.multiplier >= 1.3 ? client.cashOut() : client.continue());
    else if (s.phase === "ended" || s.phase === "error") { done = true; resolve(); }
  });
  socket.onOpen(() => client.open(20, "hero-seed"));
});

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
console.log("=".repeat(64));
console.log("  CLIENT SEASONS / SESSIONS over WS");
console.log("=".repeat(64));

const sessions = await client.requestSessions();
ok(sessions.length === 1 && sessions[0].rounds === 1 && sessions[0].staked === 20, "requestSessions() returns the played round as one session");
ok(client.lastSessions === sessions, "client caches lastSessions");

const season = await client.requestSeason(startedAt - 1000, Date.now() + 1000, "biggestMultiplier");
ok(season.stats && season.stats.rounds === 1 && season.stats.players === 1, "requestSeason() stats cover the window (1 round, 1 player)");
ok(season.leaderboard.some((e) => e.account === "hero"), "season leaderboard includes the player");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
socket.close();
wss.close(() => process.exit(0));
setTimeout(() => process.exit(0), 500).unref();
