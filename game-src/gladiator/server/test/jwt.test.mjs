// HS256 JWT: sign/verify, tamper/secret/expiry/alg-none rejection, JwtAuth, and
// the WS handshake (valid token plays; expired token rejected with 4401).
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { signJwt, verifyJwt, JwtError } from "../dist/jwt.js";
import { JwtAuth } from "../dist/auth.js";
import { startWsServer } from "../dist/wsServer.js";
import { InMemoryWallet } from "../dist/wallet.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { GameService } from "../dist/gameService.js";
import { SeedManager } from "../dist/seeds.js";

const SECRET = "test-secret-please-change";
let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };

console.log("=".repeat(64));
console.log("  JWT (HS256) AUTH");
console.log("=".repeat(64));

// roundtrip
{
  const c = verifyJwt(signJwt({ sub: "alice", role: "player" }, SECRET, { expiresInSec: 3600 }), SECRET);
  ok(c.sub === "alice" && c.role === "player", "sign/verify roundtrip preserves claims");
  ok(typeof c.iat === "number" && typeof c.exp === "number", "iat and exp are set");
}
// tampered payload
{
  const t = signJwt({ sub: "alice" }, SECRET, { expiresInSec: 60 }).split(".");
  const forged = `${t[0]}.${Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url")}.${t[2]}`;
  assert.throws(() => verifyJwt(forged, SECRET), /bad signature/);
  ok(true, "tampered payload rejected (signature mismatch)");
}
// wrong secret
{
  assert.throws(() => verifyJwt(signJwt({ sub: "alice" }, SECRET, { expiresInSec: 60 }), "other-secret"), JwtError);
  ok(true, "wrong secret rejected");
}
// expired
{
  assert.throws(() => verifyJwt(signJwt({ sub: "alice" }, SECRET, { expiresInSec: -10 }), SECRET), /expired/);
  ok(true, "expired token rejected");
}
// alg:none downgrade
{
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url");
  assert.throws(() => verifyJwt(`${header}.${payload}.`, SECRET), /unsupported alg/);
  ok(true, '"alg:none" downgrade rejected');
}
// JwtAuth
{
  const auth = new JwtAuth(SECRET);
  ok(auth.resolve(signJwt({ sub: "bob" }, SECRET, { expiresInSec: 60 })) === "bob", "JwtAuth resolves account from a valid token");
  ok(auth.resolve(signJwt({ sub: "bob" }, SECRET, { expiresInSec: -1 })) === null, "JwtAuth rejects an expired token");
  ok(auth.resolve("garbage") === null, "JwtAuth rejects garbage");
  ok(auth.resolve(null) === null, "JwtAuth rejects a missing token");
}

// WS handshake with JwtAuth
const PORT = 8793;
const wallet = new InMemoryWallet();
wallet.fund("jwtuser", 1000);
const svc = new GameService(wallet, new ResponsibleGaming(), new SeedManager());
const wss = startWsServer({ port: PORT, service: svc, auth: new JwtAuth(SECRET) });

const result = {};
const finish = () => {
  ok(result.bad === 4401, "WS: expired JWT rejected at handshake (close 4401)");
  ok(result.good === "opened", "WS: valid JWT connects and opens a round");
  wss.close(() => {
    console.log("=".repeat(64));
    console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
    console.log("=".repeat(64));
    process.exit(0);
  });
};
const safety = setTimeout(finish, 5000);

const expired = signJwt({ sub: "jwtuser" }, SECRET, { expiresInSec: -5 });
const valid = signJwt({ sub: "jwtuser" }, SECRET, { expiresInSec: 60 });

const bad = new WebSocket(`ws://localhost:${PORT}/?token=${expired}`);
bad.on("error", () => {});
bad.on("close", (code) => {
  result.bad = code;
  const good = new WebSocket(`ws://localhost:${PORT}/?token=${valid}`);
  good.on("open", () => good.send(JSON.stringify({ type: "open", bet: 10, clientSeed: "x", idemKey: "o1" })));
  good.on("message", (d) => {
    result.good = JSON.parse(String(d)).type;
    clearTimeout(safety);
    good.close();
    finish();
  });
});
