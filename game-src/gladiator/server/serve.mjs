// Single-process container entry: runs the WS game server AND serves the web
// client (so the import-map paths to client/dist + engine/dist resolve).
//
// Storage: when DATABASE_URL is set, all money/audit/limits/tournaments live in
// Postgres via the Pg* adapters (durable across restarts). The sync read-side
// services (meta/seasons/tournaments) get a write-through in-memory mirror that
// is preloaded from Postgres on boot. Without DATABASE_URL: pure in-memory.
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startWsServer } from "./dist/wsServer.js";
import { JwtAuth } from "./dist/auth.js";
import { InMemoryWallet } from "./dist/wallet.js";
import { ResponsibleGaming, InMemoryLimitsStore } from "./dist/responsible.js";
import { GameService } from "./dist/gameService.js";
import { SeedManager } from "./dist/seeds.js";
import { InMemoryAudit } from "./dist/audit.js";
import { MetaService } from "./dist/meta.js";
import { SeasonsService } from "./dist/seasons.js";
import { TournamentService, InMemoryTournamentStore } from "./dist/tournaments.js";
import { TournamentScheduler, InMemoryNotifications } from "./dist/scheduler.js";
import { PgWallet } from "./dist/persistence/pgWallet.js";
import { PgAudit } from "./dist/persistence/pgAudit.js";
import { PgLimitsStore } from "./dist/persistence/pgLimitsStore.js";
import { PgTournamentStore } from "./dist/persistence/pgTournamentStore.js";
import { SeamlessWallet } from "./dist/persistence/seamlessWallet.js";
import { HttpOperatorWallet } from "./dist/persistence/httpOperatorWallet.js";
import { InMemoryRoundStore } from "./dist/persistence/roundStore.js";
import { RedisRoundStore } from "./dist/persistence/redisRoundStore.js";

const WS_PORT = Number(process.env.PORT) || 8790;
const WEB_PORT = Number(process.env.WEB_PORT) || 3000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // repo root
const DEMO_FUND = 1000;
const STARTED_AT = Date.now();

// Structured (JSON-line) logger — one object per line, easy for log shippers to parse.
function slog(level, msg, fields = {}) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n");
}

// --- secret hardening: never boot production with placeholder secrets ---
// (secrets come from env, injected by the platform / Vault / Docker secrets).
const PROD = process.env.NODE_ENV === "production";
if (PROD && process.env.OPERATOR_WALLET_URL) {
  const s = process.env.OPERATOR_SECRET;
  if (!s || s === "change-me") {
    console.error("FATAL: OPERATOR_SECRET must be a strong secret in production (set via env/Vault).");
    process.exit(1);
  }
}

// Demo top-up so any username can play without a deposit flow. The idempotency
// key makes it exactly-once per account even across restarts (durable wallets).
function demoWallet(inner) {
  const seen = new Set();
  const ensure = async (account) => {
    if (seen.has(account)) return;
    seen.add(account);
    await inner.credit(account, DEMO_FUND, "demo-fund", `demo-fund:${account}`);
  };
  return {
    async balance(a) { await ensure(a); return inner.balance(a); },
    async debit(a, amt, ref, k) { await ensure(a); return inner.debit(a, amt, ref, k); },
    async credit(a, amt, ref, k) { await ensure(a); return inner.credit(a, amt, ref, k); },
    fund: (a, amt) => inner.fund(a, amt),
    ledger: (a) => inner.ledger(a),
  };
}

// Sync in-memory audit mirror + durable Postgres write-through.
class DurableAudit {
  constructor(pg) { this.pg = pg; this.mem = new InMemoryAudit(); }
  async load() { for (const r of await this.pg.all()) this.mem.record(r); return this.mem.all().length; }
  record(r) { this.mem.record(r); this.pg.record(r).catch((e) => console.error("audit persist failed:", e.message)); }
  all() { return this.mem.all(); }
}

// Sync limits store preloaded from Postgres, persisting on every set().
function durableLimits(pgStore, preloaded) {
  const mem = new InMemoryLimitsStore();
  for (const [account, state] of Object.entries(preloaded)) mem.set(account, state);
  return {
    all: () => mem.all(),
    set: (account, state) => { mem.set(account, state); pgStore.set(account, state).catch((e) => console.error("limits persist failed:", e.message)); },
  };
}

// Sync tournament store mirrored to Postgres.
function durableTournaments(pgStore, defs, results) {
  const mem = new InMemoryTournamentStore();
  for (const t of defs) mem.add(t);
  for (const r of results) mem.saveResult(r);
  return {
    list: () => mem.list(),
    add: (t) => { mem.add(t); pgStore.add(t).catch((e) => console.error("tournament persist failed:", e.message)); },
    upsert: (t) => { mem.upsert(t); pgStore.upsert(t).catch((e) => console.error("tournament upsert failed:", e.message)); },
    result: (id) => mem.result(id),
    saveResult: (r) => { mem.saveResult(r); pgStore.saveResult(r).catch((e) => console.error("result persist failed:", e.message)); },
  };
}

// Wallet selection: a real operator (seamless) when OPERATOR_WALLET_URL is set —
// the casino owns the balance; otherwise the local wallet (`fallback`) + demo-fund.
function chooseWallet(fallback) {
  const opUrl = process.env.OPERATOR_WALLET_URL;
  if (!opUrl) return { wallet: demoWallet(fallback), walletKind: "local+demo-fund" };
  const api = new HttpOperatorWallet({
    baseUrl: opUrl,
    apiKey: process.env.OPERATOR_API_KEY ?? "gladiator",
    secret: process.env.OPERATOR_SECRET ?? "change-me",
  });
  const wallet = new SeamlessWallet({ api, gameId: process.env.GAME_ID ?? "gladiator", currency: process.env.CURRENCY ?? "USD" });
  return { wallet, walletKind: `seamless(${opUrl})` };
}

async function buildStorage() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    const { wallet, walletKind } = chooseWallet(new InMemoryWallet());
    return { kind: "in-memory", walletKind, wallet, audit: new InMemoryAudit(), limitsStore: new InMemoryLimitsStore(), tStore: new InMemoryTournamentStore(), ping: async () => {} };
  }
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url });
  // wait for postgres (compose healthcheck usually beats us, but be robust)
  for (let i = 0; ; i++) {
    try { await pool.query("SELECT 1"); break; }
    catch (e) { if (i > 30) throw e; await new Promise((r) => setTimeout(r, 1000)); }
  }
  const pgWallet = new PgWallet(pool);
  const pgAudit = new PgAudit(pool);
  const pgLimits = new PgLimitsStore(pool);
  const pgTours = new PgTournamentStore(pool);
  await pgWallet.init(); await pgAudit.init(); await pgLimits.init(); await pgTours.init();

  const audit = new DurableAudit(pgAudit);
  const loaded = await audit.load();
  const limitsStore = durableLimits(pgLimits, await pgLimits.all());
  const defs = await pgTours.list();
  const results = (await Promise.all(defs.map((t) => pgTours.result(t.id)))).filter(Boolean);
  const tStore = durableTournaments(pgTours, defs, results);
  const { wallet, walletKind } = chooseWallet(pgWallet);
  slog("info", "storage ready", { kind: "postgres", auditRowsReloaded: loaded });
  return { kind: "postgres", walletKind, wallet, audit, limitsStore, tStore, ping: () => pool.query("SELECT 1") };
}

const storage = await buildStorage();
const { wallet, audit, limitsStore, tStore } = storage;

// Daily Arena window = current UTC day, so stars/leaderboard reset at UTC midnight
// (in lock-step with the client's per-UTC-day XP/level). Rolls over without a restart.
function utcDayWindow(t = Date.now()) {
  const d = new Date(t);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { from, to: from + 24 * 3_600_000 };
}
function ensureDaily() {
  const w = utcDayWindow();
  const cur = tStore.list().find((t) => t.id === "daily");
  if (cur && cur.from === w.from) return; // already today's window — nothing to do
  // A day rolled over (or we booted past midnight): archive the finished window under a
  // date-stamped id and RESOLVE it — pays the $100 prize pool (idempotent) — then open today's.
  if (cur && cur.to <= Date.now()) {
    const archiveId = "daily-" + new Date(cur.from).toISOString().slice(0, 10);
    if (!tStore.result(archiveId)) {
      tStore.add({ ...cur, id: archiveId }); // same window, unique id so the result can be stored
      try {
        const r = tournaments.resolve(archiveId);
        slog("info", "daily-arena resolved", { id: archiveId, paid: r.paid, winners: r.standings.filter((s) => s.prize > 0).length });
      } catch (e) {
        slog("error", "daily-arena resolve failed", { id: archiveId, error: e.message });
      }
    }
  }
  const def = { id: "daily", name: "Daily Arena", from: w.from, to: w.to, metric: "stars", prizePool: 100, payoutSplit: [0.5, 0.3, 0.2] };
  (tStore.upsert ? tStore.upsert(def) : tStore.add(def));
}

// Authentication: with AUTH_JWT_SECRET set, players must connect with an
// operator-signed JWT (?token=...) — the account comes from its `sub` claim, NOT
// a spoofable ?account= query param. Without it, the open demo trusts ?account=
// (dev only). Production REFUSES to boot unauthenticated.
function chooseAuth() {
  const secret = process.env.AUTH_JWT_SECRET;
  if (secret) return { auth: new JwtAuth(secret, process.env.AUTH_ACCOUNT_CLAIM ?? "sub"), authKind: "jwt" };
  if (PROD) {
    console.error("FATAL: AUTH_JWT_SECRET must be set in production — players authenticate with an operator-signed JWT. (Run with NODE_ENV!=production for the open ?account= demo.)");
    process.exit(1);
  }
  return { auth: undefined, authKind: "query-param (dev)" };
}
const { auth, authKind } = chooseAuth();

// Stateless rounds: Redis when REDIS_URL is set (shared across the fleet — no
// sticky sessions), else per-process in-memory.
async function buildRoundStore() {
  const url = process.env.REDIS_URL;
  if (!url) return { store: new InMemoryRoundStore(), kind: "in-memory", ping: async () => {} };
  const { createClient } = await import("redis");
  const client = createClient({ url });
  client.on("error", (e) => slog("error", "redis error", { error: e.message }));
  await client.connect();
  return { store: new RedisRoundStore(client), kind: `redis(${url})`, ping: () => client.ping() };
}
const roundStore = await buildRoundStore();

const rg = new ResponsibleGaming(undefined, undefined, limitsStore); // (limits, now, store)
const svc = new GameService(wallet, rg, new SeedManager(), undefined, audit, roundStore.store);
const tournaments = new TournamentService(audit, wallet, tStore);
const scheduler = new TournamentScheduler(tournaments, tStore, new InMemoryNotifications());
setInterval(() => scheduler.tick(), 60_000).unref();

// open today's Daily Arena (resolving + paying out any finished window first) and keep it
// rolling at UTC midnight — needs `tournaments` in scope, so it runs after the service is built.
ensureDaily();
setInterval(ensureDaily, 60_000).unref();

// ---- TLS (optional) — direct HTTPS/WSS when cert+key provided; otherwise
//      terminate TLS at a reverse proxy (nginx/traefik/cloud LB) in front. ----
const tls = process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
  ? { cert: fs.readFileSync(process.env.TLS_CERT_FILE), key: fs.readFileSync(process.env.TLS_KEY_FILE) }
  : null;
const scheme = tls ? "https" : "http";
const wsScheme = tls ? "wss" : "ws";
if (PROD && !tls && !process.env.TRUST_PROXY_TLS) {
  console.warn("WARNING: production without direct TLS — terminate TLS at a reverse proxy (set TRUST_PROXY_TLS=1 to silence).");
}

// ---- security headers + CSP on every static response ----
// frame-ancestors is env-driven: an iGaming game is embedded in the operator's
// iframe, so allow the operator origins (default '*' for dev; lock down in prod).
const FRAME_ANCESTORS = process.env.FRAME_ANCESTORS ?? "*";
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // inline SW-reg + importmap + font onload
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self' ws: wss: https://fonts.googleapis.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  `frame-ancestors ${FRAME_ANCESTORS}`,
].join("; ");
function secHeaders(res) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  if (tls) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".map": "application/json", ".woff2": "font/woff2",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".webm": "audio/webm",
  ".webmanifest": "application/manifest+json",
};
const staticHandler = (req, res) => {
  secHeaders(res);
  let p = decodeURIComponent((req.url || "/").split("?")[0]);
  if (p === "/" || p === "") p = "/client/web/index.html";
  const fp = path.normalize(path.join(ROOT, p));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(data);
  });
};

// demo top-up only when the balance is ours (local wallet); seamless = operator cashier
const demoTopUp = storage.walletKind.startsWith("local")
  ? async (account) => { await wallet.fund(account, DEMO_FUND); return wallet.balance(account); }
  : undefined;

// game WS — on its own TLS server (WSS) when certs are present
const wsHttpServer = tls ? https.createServer(tls) : null;
const wss = startWsServer({ ...(wsHttpServer ? { server: wsHttpServer } : { port: WS_PORT }), service: svc, auth, account: "web", meta: new MetaService(audit), seasons: new SeasonsService(audit), tournaments, demoTopUp });
if (wsHttpServer) wsHttpServer.listen(WS_PORT);

// ---- observability: liveness, readiness, Prometheus metrics ----
const sendJson = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

// live RTP, volumes and counts straight from the audit (settled rounds only)
function gameMetrics() {
  let rounds = 0, busts = 0, staked = 0, returned = 0, stars = 0;
  for (const r of audit.all()) { rounds++; if (r.busted) busts++; staked += r.bet; returned += r.payout; stars += r.stars ?? 0; }
  return { rounds, busts, staked, returned, stars, rtp: staked > 0 ? returned / staked : 0 };
}
function prometheus() {
  const g = gameMetrics();
  const mem = process.memoryUsage();
  const conns = wss?.clients?.size ?? 0;
  const lines = [
    "# HELP gladiator_up 1 if the process is serving",
    "# TYPE gladiator_up gauge", `gladiator_up 1`,
    "# TYPE gladiator_uptime_seconds gauge", `gladiator_uptime_seconds ${((Date.now() - STARTED_AT) / 1000).toFixed(0)}`,
    "# TYPE gladiator_ws_connections gauge", `gladiator_ws_connections ${conns}`,
    "# TYPE gladiator_rounds_total counter", `gladiator_rounds_total ${g.rounds}`,
    "# TYPE gladiator_busts_total counter", `gladiator_busts_total ${g.busts}`,
    "# TYPE gladiator_staked_total counter", `gladiator_staked_total ${g.staked.toFixed(2)}`,
    "# TYPE gladiator_returned_total counter", `gladiator_returned_total ${g.returned.toFixed(2)}`,
    "# TYPE gladiator_stars_total counter", `gladiator_stars_total ${g.stars}`,
    "# HELP gladiator_rtp realised return-to-player (returned/staked)",
    "# TYPE gladiator_rtp gauge", `gladiator_rtp ${g.rtp.toFixed(5)}`,
    "# TYPE process_resident_memory_bytes gauge", `process_resident_memory_bytes ${mem.rss}`,
    "# TYPE nodejs_heap_used_bytes gauge", `nodejs_heap_used_bytes ${mem.heapUsed}`,
  ];
  return lines.join("\n") + "\n";
}

const appHandler = async (req, res) => {
  const p = (req.url || "/").split("?")[0];
  if (p === "/health" || p === "/healthz" || p === "/livez") return sendJson(res, 200, { status: "ok", uptime: (Date.now() - STARTED_AT) / 1000 });
  if (p === "/ready" || p === "/readyz") {
    try { await storage.ping(); await roundStore.ping(); return sendJson(res, 200, { status: "ready", storage: storage.kind, rounds: roundStore.kind }); }
    catch (e) { return sendJson(res, 503, { status: "not-ready", error: e.message }); }
  }
  if (p === "/metrics") { res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }); return res.end(prometheus()); }
  return staticHandler(req, res);
};

// static web client + ops endpoints
(tls ? https.createServer(tls, appHandler) : http.createServer(appHandler)).listen(WEB_PORT);

slog("info", "gladiator running", {
  storage: storage.kind, wallet: storage.walletKind, rounds: roundStore.kind,
  tls: !!tls, auth: authKind, wsPort: WS_PORT, webPort: WEB_PORT,
});
console.log(`  game   ${wsScheme}://localhost:${WS_PORT}`);
console.log(`  web    ${scheme}://localhost:${WEB_PORT}/client/web/index.html`);
console.log(`  ops    ${scheme}://localhost:${WEB_PORT}/health  /ready  /metrics`);
