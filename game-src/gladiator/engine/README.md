# Gladiator Engine — Phase 1 (TypeScript, server-authoritative)

The certifiable RGS core: the Phase-0 validated math, ported to strict TypeScript,
plus a server-authoritative round state machine and the provably-fair RNG.

> Requires the Phase-0 `../sim` package for the parity check.

## Commands

```bash
cd engine
npm install          # typescript + @types/node (already vendored)
npm run build        # tsc -> dist/
npm run parity       # build + verify TS == JS reference, bit-exact (1M runs)
npm run demo         # build + play one provably-fair round via the server API
```

## What's inside

| File | Role |
|---|---|
| `src/types.ts` | shared interfaces (`GameConfig`, `Item`, `Rng`, …) |
| `src/config.ts` | the Phase-0 validated config (mirrors `sim/src/config.mjs`) |
| `src/rng.ts` | `makeFastRng` (tests) + `ProvablyFairRng` (HMAC-SHA256, production) |
| `src/engine.ts` | pure resolver: `buildOutcomes`, `expectedGrowth`, `resolveFight`, `playRun` |
| `src/round.ts` | **`GladiatorRound`** — the round state machine the WS/RGS layer drives |
| `src/index.ts` | public exports |
| `parity.mjs` | proves bit-exact equivalence with the validated JS engine |
| `demo.mjs` | commit → start/continue/cashOut → reveal, end to end |

## Server-authoritative API

```ts
import { GladiatorRound, ProvablyFairRng, baseConfig } from "gladiator-engine";

const rng = new ProvablyFairRng(serverSeed, clientSeed, nonce); // seed committed beforehand
const round = new GladiatorRound(baseConfig, rng, betAmount);

round.start();            // entry fight (carries the house edge)
// -> phase "decision" on a win, "ended" on a bust
round.continue();         // next fight
round.cashOut();          // { payoutMult, payout, rounds }
```

The client only ever receives `FightEvent`s — every win chance, loot roll and set
id is derived from the seed on the server. After the round, reveal `serverSeed`
so anyone can recompute and verify (`ProvablyFairRng.serverSeedHash`).

## Parity guarantee

`npm run parity` runs 1,000,000 paired runs (same seed + same config through both
engines) across every build/variance and cash-out point. Result: **0 mismatches,
max payout diff 0** — the TS engine is a faithful, certifiable port of the math
validated in Phase 0.

## Next (rest of Phase 1 → 2)

- **Wallet service** with idempotent debit/credit + audit trail around `cashOut()`.
- **Responsible-gaming** hooks (loss/session limits, reality checks) at round start.
- **WebSocket layer** wrapping `GladiatorRound` (one instance per active round).
- **Opponent/seed derivation** service (NPC identity from the same seed).
- Phase 2: PixiJS client driving this API with deterministic fight replay.
