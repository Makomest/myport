// Token auth at the WS handshake: invalid token is rejected before any action;
// valid token resolves to its account and can play.
import { WebSocket } from "ws";
import { startWsServer } from "../dist/wsServer.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { GameService } from "../dist/gameService.js";
import { SeedManager } from "../dist/seeds.js";
import { TokenAuth } from "../dist/auth.js";

const PORT = 8792;
const wallet = new InMemoryWallet();
wallet.fund("premium", 1000);
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager());
const auth = new TokenAuth(new Map([["tok-123", "premium"]]));
const wss = startWsServer({ port: PORT, service: svc, auth });

const result = {};
const finish = () => {
  const pass = result.badCode === 4401 && result.goodType === "opened";
  wss.close(() => {
    console.log("=".repeat(56));
    console.log(`  invalid token -> close code ${result.badCode}`);
    console.log(`  valid token   -> ${result.goodType}`);
    console.log("  AUTH:", pass ? "✓ PASS" : "✗ FAIL");
    console.log("=".repeat(56));
    process.exit(pass ? 0 : 1);
  });
};
const safety = setTimeout(finish, 5000);

console.log("=".repeat(56));
console.log("  AUTH — token gate at WS handshake");
console.log("=".repeat(56));

// invalid token: expect the server to close with 4401
const bad = new WebSocket(`ws://localhost:${PORT}/?token=nope`);
bad.on("error", () => {}); // a 4401 close is clean; ignore any stray error
bad.on("close", (code) => {
  result.badCode = code;
  // valid token: expect to open a round
  const good = new WebSocket(`ws://localhost:${PORT}/?token=tok-123`);
  good.on("open", () => good.send(JSON.stringify({ type: "open", bet: 10, clientSeed: "x", idemKey: "o1" })));
  good.on("message", (d) => {
    result.goodType = JSON.parse(String(d)).type;
    clearTimeout(safety);
    good.close();
    finish();
  });
});
