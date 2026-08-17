import crypto from "node:crypto";

// Minimal HS256 JWT (no external deps). Validates algorithm, signature (constant
// time), and exp/nbf. Swap the shared secret for per-environment key management
// in production; the public surface (signJwt / verifyJwt) stays the same.

export interface JwtClaims {
  sub?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
  [k: string]: unknown;
}

export class JwtError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "JwtError";
  }
}

const b64url = (s: string): string => Buffer.from(s, "utf8").toString("base64url");
const fromB64url = (s: string): Buffer => Buffer.from(s, "base64url");
const nowSec = (): number => Math.floor(Date.now() / 1000);

export function signJwt(payload: JwtClaims, secret: string, opts: { expiresInSec?: number } = {}): string {
  const body: JwtClaims = { iat: nowSec(), ...payload };
  if (opts.expiresInSec !== undefined) body.exp = nowSec() + opts.expiresInSec;
  const data = `${b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed token");
  const [h, p, s] = parts as [string, string, string];

  const header = JSON.parse(fromB64url(h).toString("utf8")) as { alg?: string };
  if (header.alg !== "HS256") throw new JwtError(`unsupported alg: ${header.alg}`); // blocks "none" downgrade

  const expected = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const got = fromB64url(s);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) throw new JwtError("bad signature");

  const claims = JSON.parse(fromB64url(p).toString("utf8")) as JwtClaims;
  const t = nowSec();
  if (typeof claims.exp === "number" && t >= claims.exp) throw new JwtError("token expired");
  if (typeof claims.nbf === "number" && t < claims.nbf) throw new JwtError("token not yet valid");
  return claims;
}
