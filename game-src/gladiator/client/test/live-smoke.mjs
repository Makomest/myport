// Drives the full player feature set against the ALREADY-RUNNING dev server
// (ws://localhost:8790). Run after `npm --prefix server start`.
import { WebSocket } from "ws";
import { GameClient } from "../dist/gameClient.js";

const PORT = Number(process.env.PORT) || 8790;
const log = (...a) => console.log("  ", ...a);
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

console.log("=".repeat(60));
console.log(`  LIVE FEATURE TOUR — ws://localhost:${PORT}`);
console.log("=".repeat(60));

// 1) play a full round
const final = await new Promise((res) => {
  let done = false;
  client.onUpdate((s) => {
    if (done) return;
    if (s.phase === "decision") {
      const last = s.events[s.events.length - 1];
      log(`R${last.roundIndex} won=${last.won} x${last.multiplier.toFixed(3)} (chance ${(last.winChance * 100).toFixed(1)}%)`);
      s.multiplier >= 1.4 ? client.cashOut() : client.continue();
    } else if (s.phase === "ended" || s.phase === "error") { done = true; res(s); }
  });
  log("opening round, bet $20 vs", "(opponent set on open)…");
  client.open(20, "live-seed");
});
log(final.opponent ? `opponent: ${final.opponent.name} (power ${final.opponent.power})` : "");
log(final.payout !== undefined ? `CASHED OUT $${final.payout.toFixed(2)} (x${final.payoutMult.toFixed(3)})` : "BUSTED — stake lost");
log("balance:", final.balance, "| serverSeed revealed:", final.serverSeed?.slice(0, 12) + "…");

// 2) meta
log("stats:", JSON.stringify(await client.requestStats()));
log("leaderboard:", JSON.stringify(await client.requestLeaderboard("biggestMultiplier")));
log("history rounds:", (await client.requestHistory()).length);

// 3) responsible gaming
log("rg status:", JSON.stringify(await client.requestRgStatus()));
log("after setLimits maxBet=50 ->", (await client.setLimits({ maxBet: 50 })).maxBet);

// 4) seasons
log("sessions:", (await client.requestSessions()).length);
log("season stats:", JSON.stringify((await client.requestSeason(0, Date.now() + 1000)).stats));

// 5) tournaments
const tours = await client.requestTournaments();
log("tournaments:", tours.map((t) => `${t.name} ($${t.prizePool})`).join(", "));
if (tours[0]) log(`standings[${tours[0].id}]:`, JSON.stringify(await client.requestStandings(tours[0].id)));

console.log("=".repeat(60));
console.log("  ✓ ALL FEATURES RESPONDED OVER THE LIVE SOCKET");
console.log("=".repeat(60));
socket.close();
process.exit(0);
