import { drawCars } from "gladiator-engine/dist/engine.js";
import { baseConfig } from "gladiator-engine/dist/config.js";
// =============================================================================
//  Client-side provably-fair verifier. Does NOT trust the server: it recomputes
//  the three cars' crash points from the revealed seed using the SAME engine
//  logic, with an RNG reproduced via Web Crypto (HMAC-SHA256 — byte-identical to
//  the server's node:crypto stream). If any revealed crash point disagrees, the
//  round was rigged.
// =============================================================================
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
async function sha256Hex(s) {
    const buf = await subtle.digest("SHA-256", enc.encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Reproduces ProvablyFairRng.next(): HMAC_SHA256(serverSeed, `${client}:${nonce}:${counter}`),
// first 6 bytes big-endian / 2^48.
async function hmacFloat(serverSeed, msg) {
    const key = await subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await subtle.sign("HMAC", key, enc.encode(msg)));
    let v = 0;
    for (let i = 0; i < 6; i++)
        v = v * 256 + sig[i];
    return v / 2 ** 48;
}
const CLIENT_SEED = "redline-house"; // matches the server's house client seed
export async function verifyRound(inp) {
    if ((await sha256Hex(inp.serverSeed)) !== inp.serverSeedHash) {
        return { ok: false, reason: "serverSeedHash does not match the revealed serverSeed" };
    }
    // drawCars uses, per car: 1 crash draw + 4 cosmetic curve draws = 15 total for 3 cars.
    const clientSeed = inp.clientSeed || CLIENT_SEED;
    const need = baseConfig.cars.length * 6 + 4; // generous buffer
    const floats = [];
    for (let c = 0; c < need; c++)
        floats.push(await hmacFloat(inp.serverSeed, `${clientSeed}:${inp.nonce}:${c}`));
    let i = 0;
    const rng = { next: () => floats[i++] };
    const recomputed = drawCars(rng, baseConfig).map((c) => ({ id: c.id, crashPoint: c.crashPoint }));
    for (const car of inp.cars) {
        const mine = recomputed.find((c) => c.id === car.id);
        if (!mine || Math.abs(mine.crashPoint - car.crashPoint) > 1e-9) {
            return {
                ok: false,
                reason: `crash point mismatch for ${car.id} — server x${car.crashPoint}; recomputed x${mine?.crashPoint}`,
                recomputed,
            };
        }
    }
    return { ok: true, recomputed };
}
//# sourceMappingURL=verifier.js.map