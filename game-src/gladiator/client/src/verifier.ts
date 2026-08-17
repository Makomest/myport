import { GladiatorRound } from "gladiator-engine/dist/round.js";
import { baseConfig } from "gladiator-engine/dist/config.js";
import type { Rng } from "gladiator-engine/dist/types.js";
import type { FightEvent } from "./protocol.js";

// =============================================================================
//  Client-side provably-fair verifier. Does NOT trust the server: it recomputes
//  every fight from the revealed seed using the SAME engine logic, with an RNG
//  reproduced via Web Crypto (HMAC-SHA256 — byte-identical to the server's
//  node:crypto stream, and portable to the browser). If any reported outcome
//  disagrees, the round is provably rigged.
// =============================================================================

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

async function sha256Hex(s: string): Promise<string> {
  const buf = await subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Reproduces ProvablyFairRng.next(): HMAC_SHA256(serverSeed, `${client}:${nonce}:${counter}`),
// first 6 bytes big-endian / 2^48.
async function hmacFloat(serverSeed: string, msg: string): Promise<number> {
  const key = await subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await subtle.sign("HMAC", key, enc.encode(msg)));
  let v = 0;
  for (let i = 0; i < 6; i++) v = v * 256 + sig[i]!;
  return v / 2 ** 48;
}

export interface VerifyInput {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  bet: number;
  events: FightEvent[];
}
export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

export async function verifyRound(inp: VerifyInput): Promise<VerifyResult> {
  if ((await sha256Hex(inp.serverSeed)) !== inp.serverSeedHash) {
    return { ok: false, reason: "serverSeedHash does not match the revealed serverSeed" };
  }

  const count = inp.events.length * 3 + 8; // <=3 rng draws per fight + buffer
  const floats: number[] = [];
  for (let c = 0; c < count; c++) floats.push(await hmacFloat(inp.serverSeed, `${inp.clientSeed}:${inp.nonce}:${c}`));

  let i = 0;
  const rng: Rng = { next: () => floats[i++]! };
  const round = new GladiatorRound(baseConfig, rng, inp.bet);

  for (let k = 0; k < inp.events.length; k++) {
    const ev = k === 0 ? round.start() : round.continue();
    const exp = inp.events[k]!;
    if (ev.won !== exp.won || ev.roundIndex !== exp.roundIndex || Math.abs(ev.multiplier - exp.multiplier) > 1e-9) {
      return {
        ok: false,
        reason: `fight ${k} mismatch — server: won=${exp.won} x${exp.multiplier}; recomputed: won=${ev.won} x${ev.multiplier}`,
      };
    }
    if (!ev.won) break; // round ended on a loss
  }
  return { ok: true };
}
