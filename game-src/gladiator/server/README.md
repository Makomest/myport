# Gladiator Server — Phase 1 backend core

The application layer around the certifiable [`../engine`](../engine): wallet,
responsible gaming, round orchestration, provably-fair seed lifecycle, NPC
opponent derivation, and a WebSocket transport. House-banked — outcomes come from
the engine; opponents are seed-derived theatre.

> Depends on `gladiator-engine` via `file:../engine` (build the engine first).

## Commands

```bash
cd server
npm install            # links the engine + installs ws
npm run build          # tsc -> dist/
npm run test           # build + integration (18) + persistence (9) + auth checks
npm run test:persist   # durable wallet + audit, restart durability
npm run test:auth      # token gate at the WS handshake
npm run test:jwt       # HS256 JWT: sign/verify + handshake (valid plays, expired → 4401)
npm run test:meta      # leaderboards / history / stats from the audit log + WS query
npm run test:rg        # reality-check / self-exclusion / status (headless, injected clock)
npm run test:rg-limits # player-set limits: tighten now / loosen after cool-off / persist
npm run test:seasons   # sessionization / daily buckets / windowed season leaderboard + stats
npm run test:fraud     # anti-fraud detectors (velocity / escalation / rtp / jackpot) + clean account
npm run test:tournaments # standings / prizes / resolve (idempotent) / window / netWin
npm run test:ops       # operator-only channel: risk + tournament-resolve; non-operator → 4403
npm run test:scheduler # auto-resolve ended tournaments (idempotent) + ops notifications
npm run test:pg        # Postgres wallet adapter — real SQL via pg-mem (no DB needed)
npm run test:pg-stores # Postgres audit / limits / tournament adapters via pg-mem
npm run test:pg-gameservice # GameService driving the async PgWallet (round + idempotency) on pg-mem
npm run ws             # build + boot WS server and play a round over a real socket
```

## Modules

| File | Role |
|---|---|
| `src/wallet.ts` | `Wallet` + `InMemoryWallet` — idempotent debit/credit ledger (audit trail) |
| `src/persistence/fileWallet.ts` | `FileWallet` — **durable** event-sourced ledger (JSONL), restart-safe |
| `src/persistence/fileAudit.ts` | `FileAudit` — append-only round audit log |
| `src/audit.ts` | `AuditSink` / `AuditSource` / `AuditRecord` + `InMemoryAudit` — one record per round (incl. seeds) |
| `src/meta.ts` | **`MetaService`** — match history, leaderboards, player stats from the audit log |
| `src/seasons.ts` | **`SeasonsService`** — play sessions, daily buckets, time-windowed season leaderboard + operator stats |
| `src/fraud.ts` | **`FraudService`** — operator-only risk signals (velocity / stake-escalation / rtp-outlier / jackpot-rate) |
| `src/tournaments.ts` | **`TournamentService`** — windowed standings, prize-pool split, idempotent resolve (pays wallets) |
| `src/auth.ts` | `AuthProvider` + `TokenAuth` + **`JwtAuth`** (optional `requiredRole` for the ops channel) — credential → account |
| `src/jwt.ts` | dependency-free **HS256** `signJwt` / `verifyJwt` (alg, signature, exp/nbf) |
| `src/responsible.ts` | `ResponsibleGaming` — limits, sessions, reality check, self-exclusion, **player-set limits** (`setLimits`: tighten now, loosen after cool-off) |
| `src/persistence/fileLimitsStore.ts` | `FileLimitsStore` — durable player limits (JSON file) |
| `src/persistence/pgWallet.ts` | **`PgWallet`** — async Postgres ledger adapter (prod), verified on pg-mem |
| `src/persistence/pgAudit.ts` · `pgLimitsStore.ts` · `pgTournamentStore.ts` | async Postgres adapters for audit / limits / tournaments, verified on pg-mem |
| `db/schema.sql` + `docker-compose.yml` | Postgres schema + Postgres/Redis compose for deployment |
| `src/seeds.ts` | `SeedManager` — provably-fair commit/reveal lifecycle |
| `src/opponent.ts` | `deriveOpponent` — NPC from a separate seed stream (never disturbs fight RNG) |
| `src/gameService.ts` | **`GameService`** — `openRound` / `continueRound` / `cashOut`, idempotent, settled, audited |
| `src/wsServer.ts` | `startWsServer` — player JSON-over-WS: auth + game + meta + RG + seasons + tournaments |
| `src/opsServer.ts` | **`startOpsServer`** — separate operator-only WS: risk scans + tournament resolve + notifications (role-gated) |
| `src/scheduler.ts` | **`TournamentScheduler.tick()`** auto-resolves ended tournaments (idempotent) + `InMemoryNotifications` ops feed |
| `test/integration.mjs` | full-flow verification (no network) |
| `test/persistence.mjs` | durable wallet + audit, restart durability |
| `test/auth.mjs` | token gate (invalid → close 4401, valid → plays) |
| `test/jwt.test.mjs` | HS256 sign/verify + JwtAuth + handshake (12 checks) |
| `test/meta.test.mjs` | leaderboards / history / stats + WS query round-trip (11 checks) |
| `test/rg.test.mjs` | RG status / reality-check ack / self-exclusion blocking (7 checks) |
| `test/rg-limits.test.mjs` | player-set limits: tighten/loosen-delay/persist (10 checks) |
| `test/seasons.test.mjs` | sessionization / daily buckets / windowed season leaderboard + stats (13 checks) |
| `test/fraud.test.mjs` | each anti-fraud detector triggers/doesn't + scanAll + clean account (13 checks) |
| `test/tournaments.test.mjs` | standings/prizes, resolve pays + idempotent, window, netWin (10 checks) |
| `test/ops.test.mjs` | operator scan + resolve; non-operator/invalid → 4403; player WS hides risk (6 checks) |
| `test/scheduler.test.mjs` | auto-resolve finished tournaments (idempotent) + ops notifications over WS (8 checks) |
| `test/pg-wallet.test.mjs` | Postgres wallet adapter run against pg-mem (real SQL): idempotency/funds/durability (7 checks) |
| `test/pg-stores.test.mjs` | Postgres audit/limits/tournament adapters on pg-mem: round-trip/idempotency/durability (10 checks) |
| `test/gameservice-pg.test.mjs` | GameService on the async PgWallet (pg-mem): debit/credit + idempotent open/cashout (6 checks) |
| `test/ws-smoke.mjs` | real client ↔ server round trip |

## Flow

```
openRound  → RG gate → idempotent stake debit → seed commit (hash published)
           → ProvablyFairRng + GladiatorRound + NPC opponent → entry fight
continueRound → next fight (round ends on a loss)
cashOut    → credit payout (one per round) → reveal serverSeed
```

Guarantees proven by `npm run test`:

- **Idempotency** — retried `openRound`/`cashOut` never moves money twice.
- **RG enforced before money moves** — over-limit bet, session loss limit, reality check.
- **Settlement** — credit on cashout, nothing on bust; session net-loss tracked.
- **Provably fair** — seed secret until the round ends, published hash verifies,
  the round replays bit-identically from the revealed seed.
- **Durability** — `FileWallet` rebuilds balances + idempotency from disk on
  restart; every settled round is written to the audit log with its seeds.
- **Auth** — `JwtAuth` validates an HS256 token (signature + expiry) at the
  handshake; tampered / wrong-secret / expired / `alg:none` are all rejected.
- **Meta** — leaderboards / history / player stats are derived purely from the
  audit log and queryable over the socket.
- **Responsible gaming** — status (net loss / limits), reality-check + acknowledge,
  self-exclusion (blocks play), and **player-set limits** (tighten immediately,
  loosen only after a cool-off) — all surfaced over the socket and persisted.
- **Seasons** — play sessions (gap-split), daily buckets and time-windowed season
  leaderboards / operator stats are derived from the audit log.
- **Anti-fraud** — `FraudService` flags velocity, stake-escalation, RTP outliers
  (with a sample guard) and jackpot-rate anomalies. **Operator-only** — never sent
  to the player over the socket.
- **Tournaments** — windowed standings + prize-pool split; `resolve()` pays the
  winners' wallets idempotently and persists the result (list/standings are
  player-facing; resolve is operator/scheduled).
- **Ops channel** — `startOpsServer` is a **separate, role-gated** socket for
  risk scans, tournament resolution and resolution notifications; non-operators
  get 4403, and the risk surface is unreachable from the player socket.
- **Scheduling** — `TournamentScheduler.tick()` auto-resolves ended tournaments
  idempotently (no double payout) and emits an ops notification per resolution.
  Drive it from `setInterval`/cron in prod; tests use an injected clock.

## Production storage

The full persistence layer has Postgres adapters — **wallet, audit, player
limits, tournaments** (`src/persistence/pg*.ts`) — each with its SQL verified
headless against **pg-mem** (`npm run test:pg`, `test:pg-stores`); no DB needed
to prove the logic. `db/schema.sql` + `docker-compose.yml` bring up real
Postgres + Redis.

The async migration is **done**: the `Wallet` interface allows sync-or-async
returns, `GameService.openRound`/`cashOut` are async and `await` the wallet, and
`PgWallet implements Wallet`. `test/gameservice-pg.test.mjs` runs the full
GameService money path on `PgWallet`/pg-mem (debit, credit, idempotent
open/cashout). The sync `InMemoryWallet`/`FileWallet` still satisfy the interface,
so **all existing tests and the WS client are unchanged** (the player e2e suites
pass as-is — async is hidden behind the socket).

> Remaining for full prod: a Redis store for live round state (active
> `GladiatorRound` per session) + cross-instance ops pub/sub; `await` the wallet
> in `TournamentService.resolve` when backed by Postgres; and ledger hardening —
> wrap each apply in a SERIALIZABLE tx with `SELECT … FOR UPDATE`, `NUMERIC` money.

## Next

- Wire a Redis round store + Postgres stores end-to-end (audit/limits/tournaments
  are async-ready), `await` the wallet in tournament resolve, move the JWT secret
  to per-environment key management.
- Phase 2 client is in [`../client`](../client) (SDK + provably-fair verifier +
  deterministic replay + meta/RG/seasons/tournaments); next is richer PixiJS art.
