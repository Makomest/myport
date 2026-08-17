// Player-set limits over WS: tighten maxBet, see it reflected in status, and
// confirm a larger bet is then rejected; loosening is queued (pending).
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { GameClient } from "../dist/gameClient.js";
import { InMemoryWallet } from "../../server/dist/wallet.js";
import { ResponsibleGaming } from "../../server/dist/responsible.js";
import { SeedManager } from "../../server/dist/seeds.js";
import { GameService } from "../../server/dist/gameService.js";
import { startWsServer } from "../../server/dist/wsServer.js";

const PORT = 8799;
const wallet = new InMemoryWallet();
wallet.fund("hero", 1000);
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager());
const wss = startWsServer({ port: PORT, service: svc, account: "hero" });

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
await new Promise((r) => socket.onOpen(r));

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
console.log("=".repeat(64));
console.log("  CLIENT PLAYER-SET LIMITS over WS");
console.log("=".repeat(64));

const tightened = await client.setLimits({ maxBet: 5 });
ok(tightened.maxBet === 5, "setLimits() tightens maxBet immediately (status reflects 5)");

const blocked = await new Promise((resolve) => {
  client.onUpdate((s) => { if (s.phase === "error") resolve(s.error); });
  client.open(10);
});
ok(/bet exceeds limit/.test(blocked), "a bet above the self-set limit is rejected");
ok(wallet.balance("hero") === 1000, "no debit on a rejected bet");

const loosened = await client.setLimits({ maxBet: 50 });
ok(loosened.maxBet === 5, "loosening is NOT immediate (status still 5)");
ok(loosened.pendingLimits?.changes.maxBet === 50, "loosening is queued as a pending change");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
socket.close();
wss.close(() => process.exit(0));
setTimeout(() => process.exit(0), 500).unref();
