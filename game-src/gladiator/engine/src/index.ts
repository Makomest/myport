export * from "./types.js";
export { baseConfig, variants } from "./config.js";
export { makeFastRng, ProvablyFairRng } from "./rng.js";
export {
  buildOutcomes,
  multiplierOf,
  expectedGrowth,
  resolveFight,
  playRun,
  type FightResolution,
} from "./engine.js";
export { GladiatorRound, type Phase, type FightEvent, type CashOutResult } from "./round.js";
