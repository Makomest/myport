// Responsible-gaming signals to the client over WS: status, acknowledge a
// reality check, self-exclude, then confirm play is blocked.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { GameClient } from "../dist/gameClient.js";
import { InMemoryWallet } from "../../server/dist/wallet.js";
import { ResponsibleGaming, defaultLimits } from "../../server/dist/responsible.js";
import { SeedManager } from "../../server/dist/seeds.js";
import { GameService } from "../../server/dist/gameService.js";
import { startWsServer } from "../../server/dist/wsServer.js";

const PORT = 8797;
const wallet = new InMemoryWallet();
wallet.fund("hero", 1000);
// injected clock (server runs in-process, so the test controls time)
let clock = 0;
const rg = new ResponsibleGaming({ ...defaultLimits, realityCheckEveryMs: 1000 }, () => clock);
const svc = new GameService(wallet, rg, new SeedManager());
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
console.log("  CLIENT RESPONSIBLE-GAMING over WS");
console.log("=".repeat(64));

await client.requestRgStatus(); // warm up the session at t=0
clock = 2000; // advance past the 1s reality-check interval

const st = await client.requestRgStatus();
ok(st && typeof st.netLoss === "number" && st.maxBet > 0, "requestRgStatus() returns limits + session");
ok(st.realityCheckDue === true, "reality-check is flagged due to the player");
ok(client.lastRgStatus === st, "client caches lastRgStatus");

const acked = await client.acknowledgeRealityCheck();
ok(acked.realityCheckDue === false, "acknowledgeRealityCheck() clears the flag");

const ex = await client.selfExclude(60000);
ok(ex.selfExcludedUntil !== null, "selfExclude() sets an exclusion deadline");

// after self-exclusion, opening a round must be rejected
const blocked = await new Promise((resolve) => {
  client.onUpdate((s) => { if (s.phase === "error") resolve(s.error); });
  client.open(10);
});
ok(/self-excluded/.test(blocked), "open after self-exclusion is blocked with a self-excluded error");
ok(wallet.balance("hero") === 1000, "no debit while self-excluded");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
socket.close();
wss.close(() => process.exit(0));
setTimeout(() => process.exit(0), 500).unref();
