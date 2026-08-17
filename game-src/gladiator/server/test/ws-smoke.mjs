// Boots the WebSocket server, connects a real client and plays one full round
// over the wire — proving the transport adapter wires through to GameService.
import { WebSocket } from "ws";
import { startWsServer } from "../dist/wsServer.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { GameService } from "../dist/gameService.js";
import { SeedManager } from "../dist/seeds.js";

const PORT = 8791;
const wallet = new InMemoryWallet();
wallet.fund("ws-player", 1000);
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager());
const wss = startWsServer({ port: PORT, service: svc });

const ws = new WebSocket(`ws://localhost:${PORT}/?account=ws-player`);
const decide = (mult) => (mult >= 1.3 ? { type: "cashout", idemKey: "c1" } : { type: "continue" });
const fail = setTimeout(() => finish("TIMEOUT", 1), 5000);

function finish(note, code = 0) {
  clearTimeout(fail);
  try { ws.close(); } catch {}
  wss.close(() => {
    console.log("=".repeat(56));
    console.log(`  WS SMOKE: ${note}`);
    console.log("=".repeat(56));
    process.exit(code);
  });
}

console.log("=".repeat(56));
console.log(`  WebSocket smoke — ws://localhost:${PORT}`);
console.log("=".repeat(56));

ws.on("open", () => ws.send(JSON.stringify({ type: "open", bet: 10, clientSeed: "abc", idemKey: "o1" })));

ws.on("message", (data) => {
  const m = JSON.parse(String(data));
  if (m.type === "opened") {
    console.log(`  << opened  hash=${m.serverSeedHash.slice(0, 12)}…  opp=${m.opponent.name}(${m.opponent.power})  bal=${m.balance}`);
    console.log(`     R0 won=${m.event.won} x${m.event.multiplier.toFixed(3)}`);
    if (m.ended) return finish("entry bust — round resolved over WS ✓");
    return ws.send(JSON.stringify(decide(m.event.multiplier)));
  }
  if (m.type === "fight") {
    console.log(`     R${m.event.roundIndex} won=${m.event.won} x${m.event.multiplier.toFixed(3)}${m.ended ? " (bust)" : ""}`);
    if (m.ended) return finish("bust — round resolved over WS ✓");
    return ws.send(JSON.stringify(decide(m.event.multiplier)));
  }
  if (m.type === "cashout") {
    console.log(`  << cashout x${m.payoutMult.toFixed(3)} = $${m.payout.toFixed(2)}  bal=${m.balance}  seed revealed=${m.serverSeed.slice(0, 12)}…`);
    return finish("cashout — round resolved over WS ✓");
  }
  if (m.type === "error") {
    console.log("  << error", m);
    return finish("error", 1);
  }
});

ws.on("error", (e) => finish("socket error: " + e.message, 1));
