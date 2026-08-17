import type { FightEvent, Opponent } from "./protocol.js";

// =============================================================================
//  Deterministic fight replay. A round's FightEvents (already provably-fair) are
//  turned into a timed list of animation "beats". This is pure logic — the same
//  timeline can drive the PixiJS view live, a "watch replay", or be unit-tested.
//  Rendering lives in the view; nothing here touches the DOM.
// =============================================================================

export interface BeatTimings {
  intro: number;
  clash: number;
  loot: number;
  jackpot: number;
  bust: number;
  cashout: number;
}

export const defaultTimings: BeatTimings = {
  intro: 700,
  clash: 800,
  loot: 600,
  jackpot: 1200,
  bust: 900,
  cashout: 1100,
};

export type Beat =
  | { kind: "intro"; opponent: Opponent | null; duration: number }
  | { kind: "clash"; roundIndex: number; winChance: number; duration: number }
  | {
      kind: "loot";
      rarity: string;
      itemMult: number;
      from: number;
      to: number;
      jackpot: boolean;
      stacked: boolean;
      duration: number;
    }
  | { kind: "bust"; roundIndex: number; duration: number }
  | { kind: "cashout"; payoutMult: number; payout: number; duration: number };

export interface TimelineInput {
  events: FightEvent[];
  opponent?: Opponent | null;
  payout?: number;
  payoutMult?: number;
  timings?: Partial<BeatTimings>;
}

/** Beats for a single fight, given the running multiplier before it. */
export function beatsForFight(from: number, ev: FightEvent, t: BeatTimings): Beat[] {
  const beats: Beat[] = [{ kind: "clash", roundIndex: ev.roundIndex, winChance: ev.winChance, duration: t.clash }];
  if (!ev.won) {
    beats.push({ kind: "bust", roundIndex: ev.roundIndex, duration: t.bust });
    return beats;
  }
  const itemMult = ev.itemMult ?? 1;
  const jackpot = ev.jackpot === true || itemMult >= 10;
  beats.push({
    kind: "loot",
    rarity: ev.rarity ?? "Common",
    itemMult,
    from,
    to: ev.multiplier,
    jackpot,
    stacked: ev.stacked === true,
    duration: jackpot ? t.jackpot : t.loot,
  });
  return beats;
}

/** Full-round timeline: intro → (clash → loot|bust)* → cashout? */
export function buildTimeline(input: TimelineInput): Beat[] {
  const t = { ...defaultTimings, ...(input.timings ?? {}) };
  const beats: Beat[] = [{ kind: "intro", opponent: input.opponent ?? null, duration: t.intro }];
  let from = 1;
  for (const ev of input.events) {
    for (const b of beatsForFight(from, ev, t)) beats.push(b);
    if (!ev.won) break;
    from = ev.multiplier;
  }
  const last = input.events[input.events.length - 1];
  if (last?.won && input.payout !== undefined) {
    beats.push({ kind: "cashout", payoutMult: input.payoutMult ?? 0, payout: input.payout, duration: t.cashout });
  }
  return beats;
}

export const totalDuration = (beats: Beat[]): number => beats.reduce((s, b) => s + b.duration, 0);

/**
 * Time-stepper for a fixed beat list. The view calls `step(dtMs)` each frame:
 * it returns the beats that *started* this tick (fire FX there) and exposes the
 * `current` beat plus its 0..1 `progress` (for tweening, e.g. the multiplier).
 */
export class Replayer {
  index = -1;
  private elapsed = 0;
  constructor(readonly beats: Beat[], public speed = 1) {}

  get finished(): boolean {
    return this.index >= this.beats.length;
  }
  get current(): Beat | undefined {
    return this.index >= 0 ? this.beats[this.index] : undefined;
  }
  get progress(): number {
    const b = this.current;
    return b ? Math.min(1, this.elapsed / b.duration) : 1;
  }

  step(dtMs: number): Beat[] {
    const started: Beat[] = [];
    if (this.index === -1 && this.beats.length > 0) {
      this.index = 0;
      started.push(this.beats[0]!);
    }
    this.elapsed += dtMs * this.speed;
    while (!this.finished && this.elapsed >= this.beats[this.index]!.duration) {
      this.elapsed -= this.beats[this.index]!.duration;
      this.index++;
      if (!this.finished) started.push(this.beats[this.index]!);
    }
    return started;
  }
}
