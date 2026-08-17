import type { GameConfig } from "./types.js";

// Mirrors sim/src/config.mjs exactly — the values validated in Phase 0.
export const baseConfig: GameConfig = {
  targetRTP: 0.96,
  baseBet: 10,
  slots: 3,
  jackpots: [
    { name: "Golden Crown", mult: 10, prob: 1 / 5000 },
    { name: "Emperor's Sword", mult: 15, prob: 1 / 20000 },
    { name: "God Armor", mult: 25, prob: 1 / 100000 },
  ],
  rarities: [
    { name: "Common", mult: 1.05, weight: 5000 },
    { name: "Rare", mult: 1.15, weight: 3000 },
    { name: "Epic", mult: 1.35, weight: 1400 },
    { name: "Legendary", mult: 1.75, weight: 500 },
    { name: "Mythic", mult: 2.5, weight: 100 },
  ],
  sets: { count: 4, bonus: 1.5 },
  streakFloors: [
    { win: 3, minMult: 1.15 },
    { win: 5, minMult: 1.35 },
    { win: 10, minMult: 1.75 },
  ],
  maxWinCap: 1000, // payout cap (multiplier can climb higher; payout bounded for bankroll safety)
  maxRounds: 1000,
  minGain: 1.02, // every win grows the multiplier by at least +2% (fair reward for the risk)
};

export const variants = {
  safe: 0.3,
  standard: 1.0,
  aggressive: 4.0,
  risk: 8.0,
} as const;
