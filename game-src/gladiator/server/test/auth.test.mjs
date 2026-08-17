// AUTH — players authenticate with an operator-signed JWT; the account comes from
// the token's `sub` claim, NOT a spoofable ?account= query param.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { JwtAuth } from "../dist/auth.js";
import { signJwt } from "../dist/jwt.js";
import { startWsServer } from "../dist/wsServer.js";
import { GameService } from "../dist/gameService.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const SECRET = "test-secret-please-change";
const auth = new JwtAuth(SECRET);

console.log("=".repeat(64));
console.log("  AUTH — JWT session gating");
console.log("=".repeat(64));

// --- unit: token validation ---
ok(auth.resolve(signJwt({ sub: "alice" }, SECRET)) === "alice", "valid JWT resolves to its sub account");
ok(auth.resolve(null) === null, "missing token rejected");
ok(auth.resolve(signJwt({ sub: "x" }, "wrong-secret")) === null, "wrong-secret signature rejected");
ok(auth.resolve(signJwt({ sub: "x" }, SECRET) + "tamper") === null, "tampered token rejected");
ok(auth.resolve(signJwt({ sub: "x" }, SECRET, { expiresInSec: -1 })) === null, "expired token rejected");

// --- integration: WS gates on the token ---
const wallet = new InMemoryWallet();
await wallet.fund("alice", 1000);
const svc = new GameService(wallet, new ResponsibleGaming());
const PORT = 8799;
const wss = startWsServer({ port: PORT, service: svc, auth });

const expectClose = (q) => new Promise((res) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/${q}`);
  ws.on("close", (code) => res(code));
  ws.on("error", () => {});
});

ok((await expectClose("")) === 4401, "WS without a token is closed 4401 (unauthorized)");
ok((await expectClose("?account=admin")) === 4401, "spoofed ?account= without a token is still rejected");

// valid token -> authenticated as sub=alice (her balance comes back on resume)
const token = signJwt({ sub: "alice" }, SECRET);
const bal = await new Promise((res) => {
  const ws = new WebSocket(`ws://localhost:${PORT}/?token=${token}`);
  ws.on("open", () => ws.send(JSON.stringify({ type: "resume" })));
  ws.on("message", (d) => { const m = JSON.parse(d); if (m.type === "resumed") { ws.close(); res(m.balance); } });
});
ok(bal === 1000, "valid JWT authenticates as sub=alice (resume returns her $1000)");

wss.close();
console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
