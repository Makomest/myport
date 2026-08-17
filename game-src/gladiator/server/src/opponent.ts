import { ProvablyFairRng } from "gladiator-engine";
import type { OpponentDto } from "./types.js";

const NAMES = ["Maximus", "Crixus", "Spartacus", "Commodus", "Varro", "Gannicus", "Flamma", "Priscus"];

/**
 * NPC opponent, deterministically derived from the round seed on a SEPARATE
 * stream (clientSeed + ":opp"). Using a distinct stream means deriving the
 * opponent never consumes — and never shifts — the fight RNG, while staying
 * fully reproducible and verifiable. The opponent is theatre, not a real bettor.
 */
export function deriveOpponent(serverSeed: string, clientSeed: string, nonce: number): OpponentDto {
  const rng = new ProvablyFairRng(serverSeed, `${clientSeed}:opp`, nonce);
  const name = NAMES[Math.floor(rng.next() * NAMES.length)]!;
  const id = Math.floor(rng.next() * 1_000_000);
  const power = Math.round((0.8 + rng.next() * 0.6) * 100) / 100;
  return { name, id, power };
}
