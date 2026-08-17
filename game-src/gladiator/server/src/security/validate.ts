// Input validation for the WS protocol: every inbound frame is parsed and
// checked against a strict allow-list of types + bounded fields BEFORE it
// reaches GameService. Anything malformed is rejected with a clear error and
// never touches game/money logic. Untrusted strings are length-capped; numbers
// must be finite and in range; unknown types are dropped.

const TYPES = new Set([
  "open", "continue", "cashout", "resume", "topup",
  "history", "leaderboard", "stats",
  "rg-status", "ack-reality", "self-exclude", "set-limits",
  "sessions", "season", "tournaments", "standings",
]);
const KINDS = new Set(["biggestMultiplier", "biggestPayout", "longestRun", "netWin", "stars"]);

const MAX_BET = 1_000_000; // hard ceiling regardless of operator/RG limits
const MAX_STR = 256; // clientSeed
const MAX_ID = 128; // idemKey / roundId / id
const FIVE_YEARS_MS = 5 * 365 * 24 * 3600 * 1000;

export interface ValidMsg { type: string; [k: string]: unknown }
export type ValidationResult = { ok: true; msg: ValidMsg } | { ok: false; error: string };

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fail = (error: string): ValidationResult => ({ ok: false, error });

/** Parse + validate one raw frame. Returns a sanitized message or an error. */
export function validateFrame(raw: string): ValidationResult {
  if (raw.length > 8192) return fail("frame too large");
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return fail("bad json"); }
  if (typeof m !== "object" || m === null || Array.isArray(m)) return fail("not an object");
  const o = m as Record<string, unknown>;
  if (!isStr(o.type, 32) || !TYPES.has(o.type)) return fail("unknown message type");

  switch (o.type) {
    case "open": {
      if (!num(o.bet) || o.bet <= 0 || o.bet > MAX_BET) return fail("invalid bet");
      if (o.clientSeed !== undefined && !isStr(o.clientSeed, MAX_STR)) return fail("invalid clientSeed");
      if (o.idemKey !== undefined && !isStr(o.idemKey, MAX_ID)) return fail("invalid idemKey");
      const out: ValidMsg = { type: "open", bet: o.bet, clientSeed: isStr(o.clientSeed, MAX_STR) ? o.clientSeed : "", idemKey: isStr(o.idemKey, MAX_ID) ? o.idemKey : undefined };
      out.level = clampLevel(o.level);
      return { ok: true, msg: out };
    }
    case "continue":
      if (o.roundId !== undefined && !isStr(o.roundId, MAX_ID)) return fail("invalid roundId");
      return { ok: true, msg: { type: "continue", roundId: o.roundId, level: clampLevel(o.level) } };
    case "cashout":
      if (o.roundId !== undefined && !isStr(o.roundId, MAX_ID)) return fail("invalid roundId");
      if (o.idemKey !== undefined && !isStr(o.idemKey, MAX_ID)) return fail("invalid idemKey");
      return { ok: true, msg: { type: "cashout", roundId: o.roundId, idemKey: o.idemKey } };
    case "leaderboard":
      if (o.kind !== undefined && !(isStr(o.kind, 32) && KINDS.has(o.kind))) return fail("invalid kind");
      return { ok: true, msg: { type: "leaderboard", kind: o.kind } };
    case "self-exclude":
      if (!num(o.ms) || o.ms < 0 || o.ms > FIVE_YEARS_MS) return fail("invalid ms");
      return { ok: true, msg: { type: "self-exclude", ms: Math.floor(o.ms) } };
    case "set-limits": {
      const lim = validateLimits(o.limits);
      if (!lim.ok) return lim;
      return { ok: true, msg: { type: "set-limits", limits: lim.value } };
    }
    case "season": {
      if (o.from !== undefined && !num(o.from)) return fail("invalid from");
      if (o.to !== undefined && !num(o.to)) return fail("invalid to");
      if (o.kind !== undefined && !(isStr(o.kind, 32) && KINDS.has(o.kind))) return fail("invalid kind");
      return { ok: true, msg: { type: "season", from: o.from, to: o.to, kind: o.kind } };
    }
    case "standings":
      if (!isStr(o.id, MAX_ID)) return fail("invalid tournament id");
      return { ok: true, msg: { type: "standings", id: o.id } };
    default:
      // parameterless queries (resume/history/stats/rg-status/ack-reality/sessions/tournaments)
      return { ok: true, msg: { type: o.type } };
  }
}

function clampLevel(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(7, Math.floor(v))) : 1;
}

function validateLimits(v: unknown): { ok: true; value: Record<string, number> } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, value: {} };
  if (typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "invalid limits" };
  const out: Record<string, number> = {};
  for (const key of ["maxBet", "maxLossPerSession", "maxRoundsPerSession"]) {
    const x = (v as Record<string, unknown>)[key];
    if (x === undefined) continue;
    if (!num(x) || x < 0 || x > Number.MAX_SAFE_INTEGER) return { ok: false, error: `invalid ${key}` };
    out[key] = x;
  }
  return { ok: true, value: out };
}
