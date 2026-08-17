import crypto from "node:crypto";
import type { Rng } from "./types.js";

/** Fast seeded PRNG (mulberry32) — for tests / simulation parity. */
export function makeFastRng(seed = 0x9e3779b9): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * Provably-fair RNG — the production method. Outcomes derive deterministically
 * from (serverSeed, clientSeed, nonce). Publish SHA256(serverSeed) before the
 * round; reveal serverSeed after so anyone can recompute and verify.
 */
export class ProvablyFairRng implements Rng {
  private counter = 0;
  constructor(
    private readonly serverSeed: string,
    private readonly clientSeed: string,
    private readonly nonce = 0,
  ) {}

  static serverSeedHash(serverSeed: string): string {
    return crypto.createHash("sha256").update(serverSeed).digest("hex");
  }

  next(): number {
    const msg = `${this.clientSeed}:${this.nonce}:${this.counter++}`;
    const h = crypto.createHmac("sha256", this.serverSeed).update(msg).digest();
    let v = 0;
    for (let i = 0; i < 6; i++) v = v * 256 + h[i]!; // 48 bits
    return v / 2 ** 48;
  }
}
