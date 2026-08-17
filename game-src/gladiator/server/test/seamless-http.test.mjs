// SEAMLESS over real HTTP: stand up a mock operator wallet server that verifies
// the HMAC signature on every request, point HttpOperatorWallet at it, and run a
// full bet -> win -> rollback flow. Proves the wire format + signing end-to-end.
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { HttpOperatorWallet } from "../dist/persistence/httpOperatorWallet.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };

console.log("=".repeat(64));
console.log("  SEAMLESS over HTTP — signed wire protocol against a mock operator");
console.log("=".repeat(64));

const SECRET = "shared-secret";
const bal = new Map([["pid", 10000]]); // minor units (cents)
const txns = new Map();
let badSig = 0, requests = 0;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests++;
    const ts = req.headers["x-timestamp"];
    const sig = req.headers["x-signature"];
    const want = crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
    if (sig !== want) { badSig++; res.writeHead(401); return res.end(JSON.stringify({ code: "BAD_SIGNATURE" })); }
    const p = JSON.parse(body || "{}");
    const acc = p.account;
    const send = (o, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const url = req.url;
    if (url === "/balance") return send({ balance: bal.get(acc) ?? 0 });
    if (url === "/bet") {
      if (txns.has(p.txId)) return send({ balance: txns.get(p.txId).balance, txId: p.txId });
      const cur = bal.get(acc) ?? 0;
      if (cur < p.amount) return send({ code: "INSUFFICIENT_FUNDS" }, 402);
      const next = cur - p.amount; bal.set(acc, next);
      txns.set(p.txId, { kind: "bet", amount: p.amount, balance: next });
      return send({ balance: next, txId: p.txId });
    }
    if (url === "/win") {
      if (txns.has(p.txId)) return send({ balance: txns.get(p.txId).balance, txId: p.txId });
      const next = (bal.get(acc) ?? 0) + p.amount; bal.set(acc, next);
      txns.set(p.txId, { kind: "win", balance: next });
      return send({ balance: next, txId: p.txId });
    }
    if (url === "/rollback") {
      const t = txns.get(p.txId);
      if (t && !t.rolledBack && t.kind === "bet") { bal.set(acc, (bal.get(acc) ?? 0) + t.amount); t.rolledBack = true; }
      return send({ balance: bal.get(acc) ?? 0, txId: p.txId });
    }
    send({ code: "NOT_FOUND" }, 404);
  });
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const api = new HttpOperatorWallet({ baseUrl: `http://127.0.0.1:${port}`, apiKey: "game", secret: SECRET });

ok((await api.balance("pid", "USD")) === 100, "balance() returns major units ($100 from 10000 cents)");

const bet = await api.bet({ account: "pid", amount: 25, currency: "USD", roundId: "r1", txId: "t-bet", gameId: "g" });
ok(bet.balance === 75, "bet $25 -> operator balance $75 (HMAC verified)");

const dup = await api.bet({ account: "pid", amount: 25, currency: "USD", roundId: "r1", txId: "t-bet", gameId: "g" });
ok(dup.balance === 75, "duplicate bet (same txId) is idempotent over the wire ($75)");

const win = await api.win({ account: "pid", amount: 60, currency: "USD", roundId: "r1", txId: "t-win", gameId: "g" });
ok(win.balance === 135, "win $60 -> operator balance $135");

let declined = null;
try { await api.bet({ account: "pid", amount: 1000, currency: "USD", roundId: "r2", txId: "t-big", gameId: "g" }); }
catch (e) { declined = e; }
ok(declined && declined.name === "OperatorError" && declined.code === "INSUFFICIENT_FUNDS", "402 decline surfaced as OperatorError(INSUFFICIENT_FUNDS)");

const rb = await api.rollback("pid", "t-bet", "r1", "USD");
ok(rb.balance === 160, "rollback of the $25 bet -> $135 + $25 = $160");

ok(badSig === 0 && requests >= 6, `every request carried a valid HMAC signature (${requests} requests, 0 rejected)`);

server.close();
console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
