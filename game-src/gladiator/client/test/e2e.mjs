// End-to-end: boot the REAL server, drive a full round with GameClient over a
// real WebSocket, then have the client INDEPENDENTLY verify the revealed seed.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { GameClient } from "../dist/gameClient.js";
import { verifyRound } from "../dist/verifier.js";
// the real backend (relative import — runtime only, keeps the client lib decoupled)
import { InMemoryWallet } from "../../server/dist/wallet.js";
import { ResponsibleGaming } from "../../server/dist/responsible.js";
import { SeedManager } from "../../server/dist/seeds.js";
import { GameService } from "../../server/dist/gameService.js";
import { startWsServer } from "../../server/dist/wsServer.js";

const PORT = 8795;
const wallet = new InMemoryWallet();
wallet.fund("hero", 1000);
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager());
const wss = startWsServer({ port: PORT, service: svc });

// node `ws` -> ClientSocket adapter (browser uses browserSocket instead)
function nodeSocket(url) {
  const ws = new WebSocket(url);
  return {
    send: (d) => ws.send(d),
    close: () => ws.close(),
    onMessage: (cb) => ws.on("message", (d) => cb(String(d))),
    onOpen: (cb) => ws.on("open", cb),
    onClose: (cb) => ws.on("close", cb),
  };
}

console.log("=".repeat(64));
console.log("  CLIENT <-> SERVER e2e + provably-fair verification");
console.log("=".repeat(64));

const socket = nodeSocket(`ws://localhost:${PORT}/?account=hero`);
const client = new GameClient(socket);

const final = await new Promise((resolve) => {
  let done = false;
  client.onUpdate((s) => {
    if (done) return;
    if (s.phase === "decision") {
      const last = s.events[s.events.length - 1];
      console.log(`  R${last.roundIndex} won=${last.won} x${last.multiplier.toFixed(3)} (chance ${(last.winChance * 100).toFixed(1)}%)`);
      if (s.multiplier >= 1.4) client.cashOut();
      else client.continue();
    } else if (s.phase === "ended" || s.phase === "error") {
      done = true;
      resolve(s);
    }
  });
  socket.onOpen(() => {
    console.log("  socket open -> open round, bet $10");
    client.open(10, "hero-client-seed");
  });
});

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };

ok(final.phase === "ended", "round reached a terminal state over WS");
ok(typeof final.serverSeed === "string" && final.serverSeed.length === 64, "serverSeed revealed on round end");
ok(final.serverSeedHash.length === 64, "serverSeedHash was committed up front");

const v = await verifyRound({
  serverSeed: final.serverSeed,
  serverSeedHash: final.serverSeedHash,
  clientSeed: final.clientSeed,
  nonce: final.nonce,
  bet: final.bet,
  events: final.events,
});
ok(v.ok, "client independently re-derives every fight from the seed" + (v.ok ? "" : ` — ${v.reason}`));

if (final.payout !== undefined) {
  console.log(`  cashed out x${final.payoutMult.toFixed(3)} = $${final.payout.toFixed(2)}`);
  ok(final.balance === 990 + final.payout, "balance = 990 + payout after cashout");
} else {
  console.log("  busted");
  ok(final.balance === 990, "bust: stake lost, balance stays 990");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
socket.close();
wss.close(() => process.exit(0));
setTimeout(() => process.exit(0), 1000).unref();
