// Tournaments over WS: with an active tournament, play a round and confirm the
// player appears in the live standings (and the tournament is listed).
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { GameClient } from "../dist/gameClient.js";
import { InMemoryWallet } from "../../server/dist/wallet.js";
import { ResponsibleGaming } from "../../server/dist/responsible.js";
import { SeedManager } from "../../server/dist/seeds.js";
import { GameService } from "../../server/dist/gameService.js";
import { InMemoryAudit } from "../../server/dist/audit.js";
import { TournamentService, InMemoryTournamentStore } from "../../server/dist/tournaments.js";
import { startWsServer } from "../../server/dist/wsServer.js";

const PORT = 8800;
const wallet = new InMemoryWallet();
wallet.fund("hero", 1000);
const audit = new InMemoryAudit();
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager(), undefined, audit);
const store = new InMemoryTournamentStore();
store.add({ id: "daily", name: "Daily Arena", from: 0, to: Date.now() + 3_600_000, metric: "biggestMultiplier", prizePool: 100, payoutSplit: [1.0] });
const wss = startWsServer({ port: PORT, service: svc, account: "hero", tournaments: new TournamentService(audit, wallet, store) });

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
console.log("  CLIENT TOURNAMENTS over WS");
console.log("=".repeat(64));

const list = await client.requestTournaments();
ok(list.length === 1 && list[0].id === "daily" && list[0].prizePool === 100, "requestTournaments() lists the active tournament");
ok(client.lastTournaments === list, "client caches lastTournaments");

const standings = await client.requestStandings("daily");
ok(standings.length === 1 && standings[0].account === "hero" && standings[0].rank === 1, "standings include the player at rank 1");
ok(standings[0].prize === 100, "the sole entrant is allocated the full prize pool");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
socket.close();
wss.close(() => process.exit(0));
setTimeout(() => process.exit(0), 500).unref();
