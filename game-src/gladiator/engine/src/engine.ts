import type { GameConfig, Slot, Outcome, Rng, Strategy, RunResult } from "./types.js";

// =============================================================================
//  Server-authoritative resolver.
//  pWin = stepTargetRTP / E[g]; the house edge is taken once on the entry fight,
//  every "continue" is EV-fair, so RTP is invariant to player strategy.
//
//  Growth model ("stacking"): up to 3 distinct tier-slots, each with a stack
//  count; gear = product of tier^count. A drop that is:
//    • a DUPLICATE of an equipped tier  -> stacks it (gain = full tier mult)   [stacked]
//    • a NEW tier on a free slot        -> equips it (gain = its mult)         [upgraded]
//    • strictly BETTER than the weakest -> replaces it                         [upgraded]
//    • strictly WORSE (and not a dup)   -> consolation: gain = cfg.minGain
//  So every win pays, E[g] never collapses to 1 (no stall), and the multiplier
//  can grow without bound (payout is bounded only by cfg.maxWinCap).
// =============================================================================

export function buildOutcomes(cfg: GameConfig, varianceScale = 1): Outcome[] {
  const jackpots: Outcome[] = cfg.jackpots.map((j) => ({ name: j.name, mult: j.mult, p: j.prob * varianceScale }));
  const jackpotProb = jackpots.reduce((s, j) => s + j.p, 0);

  const scaled = cfg.rarities.map((r) => ({
    name: r.name,
    mult: r.mult,
    w: r.mult >= 1.5 ? r.weight * varianceScale : r.weight,
  }));
  const totW = scaled.reduce((s, r) => s + r.w, 0);
  const regularProb = 1 - jackpotProb;
  const regular: Outcome[] = scaled.map((r) => ({ name: r.name, mult: r.mult, p: (regularProb * r.w) / totW }));

  return [...regular, ...jackpots];
}

function outcomesForWin(base: Outcome[], winNumber: number, cfg: GameConfig): Outcome[] {
  const floor = cfg.streakFloors.find((s) => s.win === winNumber);
  if (!floor) return base;
  const kept = base.filter((o) => o.mult >= floor.minMult);
  const total = kept.reduce((s, o) => s + o.p, 0);
  return kept.map((o) => ({ ...o, p: o.p / total }));
}

/** Gear multiplier: product of tier^count across the equipped slots. */
export function multiplierOf(slots: Slot[]): number {
  let m = 1;
  for (const s of slots) m *= Math.pow(s.tier, s.count);
  return m;
}

export interface Placement {
  slots: Slot[];
  gain: number; // pre-floor multiplicative gain to the running multiplier
  upgraded: boolean; // new/replaced gear slot (a new or changed gem)
  stacked: boolean; // duplicate of an equipped tier (gem gains a +1 stack)
}

/** Place an item of multiplier `m` into the slots (returns a fresh slot array). */
export function place(slots: Slot[], m: number, maxSlots: number): Placement {
  const before = multiplierOf(slots);
  const next = slots.map((s) => ({ ...s }));

  const dup = next.find((s) => Math.abs(s.tier - m) < 1e-9);
  if (dup) { dup.count++; return { slots: next, gain: multiplierOf(next) / before, upgraded: false, stacked: true }; }

  if (next.length < maxSlots) {
    next.push({ tier: m, count: 1 });
    return { slots: next, gain: multiplierOf(next) / before, upgraded: true, stacked: false };
  }

  let lo = 0;
  for (let i = 1; i < next.length; i++) if (next[i]!.tier < next[lo]!.tier) lo = i;
  if (m > next[lo]!.tier) {
    next[lo] = { tier: m, count: 1 };
    return { slots: next, gain: multiplierOf(next) / before, upgraded: true, stacked: false };
  }
  return { slots, gain: 1, upgraded: false, stacked: false }; // discard
}

// E[g] = E[max(placementGain, minGain)] over the loot table for this win.
export function expectedGrowth(outcomes: Outcome[], slots: Slot[], cfg: GameConfig): number {
  const floor = cfg.minGain;
  let eg = 0;
  for (const o of outcomes) eg += o.p * Math.max(place(slots, o.mult, cfg.slots).gain, floor);
  return eg;
}

function drawRarity(outcomes: Outcome[], r: number): Outcome {
  let acc = 0;
  for (const o of outcomes) { acc += o.p; if (r < acc) return o; }
  return outcomes[outcomes.length - 1]!;
}

export interface FightResolution {
  winChance: number;
  won: boolean;
  jackpot: boolean;
  item?: Outcome;
  newSlots: Slot[];
  multiplier: number; // running payout multiplier AFTER this fight
  upgraded: boolean;
  stacked: boolean;
}

/**
 * Resolve a single fight. `mult` is the running payout multiplier coming in; on a
 * win it grows by the placement gain (upgrade ratio / full tier mult on a stack),
 * or by at least cfg.minGain (consolation) when the drop is worse and not a dup.
 */
export function resolveFight(
  baseOutcomes: Outcome[],
  slots: Slot[],
  mult: number,
  winNumber: number,
  isEntry: boolean,
  rng: Rng,
  cfg: GameConfig,
): FightResolution {
  const outs = outcomesForWin(baseOutcomes, winNumber, cfg);
  const eg = expectedGrowth(outs, slots, cfg);
  const stepRTP = isEntry ? cfg.targetRTP : 1.0;
  const winChance = Math.min(1, stepRTP / eg);

  if (rng.next() >= winChance) {
    return { winChance, won: false, jackpot: false, newSlots: slots, multiplier: mult, upgraded: false, stacked: false };
  }
  const item = drawRarity(outs, rng.next());
  const res = place(slots, item.mult, cfg.slots);
  const gain = Math.max(res.gain, cfg.minGain);
  return {
    winChance,
    won: true,
    jackpot: item.mult >= 10,
    item,
    newSlots: res.slots,
    multiplier: mult * gain,
    upgraded: res.upgraded,
    stacked: res.stacked,
  };
}

/** Full run under a strategy — used for Monte-Carlo parity with the JS sim. */
export function playRun(
  rng: Rng,
  baseOutcomes: Outcome[],
  cfg: GameConfig,
  strategy: Strategy,
  onFight?: (round: number, winChance: number) => void,
): RunResult {
  let slots: Slot[] = [];
  let mult = 1;
  let jackpotHit = false;
  const cap = cfg.maxWinCap ?? Infinity;

  for (let round = 0; round < cfg.maxRounds; round++) {
    if (round > 0 && strategy(round, mult, slots) === "cash") {
      return { payoutMult: Math.min(mult, cap), rounds: round, busted: false, jackpotHit };
    }
    const r = resolveFight(baseOutcomes, slots, mult, round + 1, round === 0, rng, cfg);
    if (onFight) onFight(round, r.winChance);
    if (!r.won) return { payoutMult: 0, rounds: round, busted: true, jackpotHit };
    mult = r.multiplier;
    slots = r.newSlots;
    if (r.jackpot) jackpotHit = true;
  }
  return { payoutMult: Math.min(mult, cap), rounds: cfg.maxRounds, busted: false, jackpotHit };
}
