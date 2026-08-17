// Shared types for the server-authoritative game engine.

export interface Rarity {
  name: string;
  mult: number;
  weight: number;
}

export interface Jackpot {
  name: string;
  mult: number;
  prob: number;
}

export interface SetConfig {
  count: number;
  bonus: number;
}

export interface StreakFloor {
  win: number;
  minMult: number;
}

export interface GameConfig {
  targetRTP: number;
  baseBet: number;
  slots: number;
  jackpots: Jackpot[];
  rarities: Rarity[];
  sets: SetConfig;
  streakFloors: StreakFloor[];
  maxWinCap: number;
  maxRounds: number;
  /** Guaranteed minimum multiplier growth per win (consolation when no gear upgrade). */
  minGain: number;
}

/** An equipped item: a multiplier factor belonging to one set. (legacy) */
export interface Item {
  mult: number;
  setId: number;
}

/** A gear slot: a tier (multiplier value) with a stack count (Tier ×count). */
export interface Slot {
  tier: number;
  count: number;
}

/** A loot outcome with an absolute draw probability. */
export interface Outcome {
  name: string;
  mult: number;
  p: number;
}

/** Random source: a single .next() -> [0,1). */
export interface Rng {
  next(): number;
}

export type Decision = "cash" | "continue";
export type Strategy = (round: number, m: number, slots: Slot[]) => Decision;

export interface RunResult {
  payoutMult: number;
  rounds: number;
  busted: boolean;
  jackpotHit: boolean;
}
