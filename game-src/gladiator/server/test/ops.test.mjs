// Operator ops channel: separate, role-gated WS. Operators read risk signals and
// resolve tournaments; non-operators / bad tokens are closed (4403); and the
// player WS never exposes the risk surface.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { signJwt } from "../dist/jwt.js";
import { JwtAuth } from "../dist/auth.js";
import { FraudService } from "../dist/fraud.js";
import { TournamentService, InMemoryTournamentStore } from "../dist/tournaments.js";
import { InMemoryAudit } from "../dist/audit.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";
import { GameService } from "../dist/gameService.js";
import { startOpsServer, startWsServer } from "../dist/index.js";

const SECRET = "ops-secret";
const OPS_PORT = 8801;
const PLAYER_PORT = 8802;
let seq = 0;
const rec = (account, ts, o = {}) => ({
  account, roundId: "r" + ++seq, bet: o.bet ?? 10,
  serverSeedHash: "h".repeat(64), serverSeed: "s".repeat(64), clientSeed: "c", nonce: 0,
  rounds: o.rounds ?? 1, payoutMult: o.payoutMult ?? 0, payout: o.payout ?? 0, busted: o.busted ?? true, ts,
});

const audit = new InMemoryAudit();
for (let i = 0; i < 12; i++) audit.record(rec("speed", i * 400)); // velocity signal
audit.record(rec("hero", 100, { payoutMult: 5, payout: 50, busted: false })); // tournament entrant
const wallet = new InMemoryWallet();
const store = new InMemoryTournamentStore();
store.add({ id: "t1", name: "T", from: 0, to: 1000, metric: "biggestMultiplier", prizePool: 100, payoutSplit: [1.0] });
let now = 2000;
const tourn = new TournamentService(audit, wallet, store, () => now);

const opsWss = startOpsServer({ port: OPS_PORT, auth: new JwtAuth(SECRET, "sub", "operator"), fraud: new FraudService(audit), tournaments: tourn });
const playerWss = startWsServer({ port: PLAYER_PORT, service: new GameService(new InMemoryWallet(), new ResponsibleGaming(), new SeedManager()), account: "x" });

const opToken = signJwt({ sub: "admin", role: "operator" }, SECRET, { expiresInSec: 60 });
const playerToken = signJwt({ sub: "hero", role: "player" }, SECRET, { expiresInSec: 60 });

// open ops WS, send one message, resolve {msg} or {closed:code}
const opsCall = (token, msg) =>
  new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${OPS_PORT}/?token=${token}`);
    let got = false;
    ws.on("open", () => ws.send(JSON.stringify(msg)));
    ws.on("message", (d) => { got = true; const m = JSON.parse(String(d)); ws.close(); res({ msg: m }); });
    ws.on("close", (code) => { if (!got) res({ closed: code }); });
    ws.on("error", () => {});
  });

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
console.log("=".repeat(64));
console.log("  OPS CHANNEL — operator-only risk + tournament resolution");
console.log("=".repeat(64));

const r1 = await opsCall(opToken, { type: "risk-scan" });
ok(r1.msg?.type === "risk" && r1.msg.signals.some((s) => s.account === "speed" && s.kind === "velocity"), "operator: risk-scan returns fraud signals");

const r2 = await opsCall(opToken, { type: "tournament-resolve", id: "t1" });
ok(r2.msg?.type === "tournament-result" && r2.msg.result.paid === 100 && r2.msg.by === "admin", "operator: tournament-resolve pays out (and records who)");
ok(wallet.balance("hero") === 100, "resolve credited the winner's wallet");

const r3 = await opsCall(playerToken, { type: "risk-scan" });
ok(r3.closed === 4403, "non-operator (player) token is forbidden (4403)");

const r4 = await opsCall("garbage.token.here", { type: "risk-scan" });
ok(r4.closed === 4403, "invalid token is forbidden (4403)");

// separation: the player WS does not handle ops messages
const sep = await new Promise((res) => {
  const ws = new WebSocket(`ws://localhost:${PLAYER_PORT}/?account=x`);
  ws.on("open", () => ws.send(JSON.stringify({ type: "risk-scan" })));
  ws.on("message", (d) => { res(JSON.parse(String(d))); ws.close(); });
  ws.on("error", () => {});
});
ok(sep.type === "error", "player WS rejects ops messages (risk is not reachable from the game socket)");

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
opsWss.close();
playerWss.close(() => process.exit(0));
setTimeout(() => process.exit(0), 500).unref();
