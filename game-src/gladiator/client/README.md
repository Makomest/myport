# Gladiator Client — Phase 2 core

Framework-agnostic client for the WS game API, plus a **portable provably-fair
verifier** and a minimal PixiJS view. The verifier is the trust centerpiece: it
does not trust the server — it recomputes every fight from the revealed seed.

> Depends on `gladiator-engine` (for the verifier's pure logic + types).

## Commands

```bash
cd client
npm install
npm run build        # tsc -> dist/
npm run replay       # unit-test the deterministic replay timeline (headless)
npm run e2e          # boots the REAL server, plays a round over WS, verifies the seed
npm run meta-e2e     # plays a round, then queries stats/leaderboard/history over WS
npm run rg-e2e       # reality-check ack + self-exclusion blocking over WS
npm run seasons-e2e  # play a round, then query sessions + current season over WS
npm run limits-e2e   # set a player limit, see it enforced + loosening queued
npm run tournaments-e2e # list tournaments + live standings over WS
npm test             # replay + e2e + meta/rg/seasons/limits/tournaments e2e
```

## Modules

| File | Role |
|---|---|
| `src/protocol.ts` | wire message types (mirrors the server DTOs) |
| `src/socket.ts` | `ClientSocket` abstraction + `browserSocket` (global WebSocket) |
| `src/gameClient.ts` | **`GameClient`** — protocol + `ClientState`/`onUpdate`; promise-based meta (`requestHistory`/`requestLeaderboard`/`requestStats`) + RG (`requestRgStatus`/`acknowledgeRealityCheck`/`selfExclude`/`setLimits`) + seasons (`requestSessions`/`requestSeason`) + tournaments (`requestTournaments`/`requestStandings`) |
| `src/verifier.ts` | **`verifyRound`** — Web Crypto HMAC + engine logic, recomputes every fight |
| `src/replay.ts` | **`buildTimeline` / `Replayer`** — round events → deterministic animation beats |
| `test/replay.test.mjs` | unit tests for the timeline + stepper (headless) |
| `test/e2e.mjs` | real server ↔ client round trip + provably-fair verification |
| `test/meta-e2e.mjs` | play a round, then query stats/leaderboard/history over WS |
| `test/rg-e2e.mjs` | reality-check acknowledge + self-exclusion blocking over WS |
| `test/seasons-e2e.mjs` | query play sessions + current season over WS |
| `test/limits-e2e.mjs` | set a player limit; enforced immediately, loosening queued |
| `test/tournaments-e2e.mjs` | list tournaments + live standings include the player |
| `web/` | PixiJS view (no-build) — timeline playback + Replay + Verify + Leaderboard + **Arena (tournaments)** + reality-check banner |

## The verifier

`verifyRound` reproduces `ProvablyFairRng` with **Web Crypto** (HMAC-SHA256 —
byte-identical to the server's `node:crypto` stream, and browser-portable), feeds
it through the **same engine** `GladiatorRound`, and checks every reported
`won` / `multiplier`. It also confirms `SHA256(serverSeed) === serverSeedHash`.
If the server ever lied about an outcome, this fails — proven in `npm run e2e`.

## Run the browser demo

```bash
# from the repo root, with engine + client built:
npm --prefix engine run build
npm --prefix client run build
npm --prefix server start            # ws://localhost:8790, demo account funded
# then serve the repo root and open the page, e.g.:
npx serve .                          # → http://localhost:3000/client/web/index.html
```

Set a bet → **Start** → **Continue**/**Cash Out** → **Verify last round**.

## Deterministic replay

`buildTimeline` turns a round's `FightEvent`s into ordered animation beats
(intro → clash → loot/bust → cashout) with timings; `Replayer.step(dtMs)` drives
them frame by frame. The view plays this live and via the **Replay** button.
Because the beats derive only from the (verifiable) events, the replay is exactly
what happened — `test/replay.test.mjs` covers ordering, tweens, jackpot and bust.

## Next

- Richer PixiJS art: gladiator skins per equipped set, clash choreography,
  win-streak / jackpot FX, set-complete highlight (the `setBonus` beat hint).
- Bundle the engine's pure modules for production (avoid pulling `node:crypto`);
  Web Crypto in the verifier is already browser-universal.
