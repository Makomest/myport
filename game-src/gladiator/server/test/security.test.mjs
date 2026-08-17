// SECURITY — input validation (bounds/types) and rate limiting (token bucket +
// per-IP connection limiter). These guard the WS server before any game logic.
import assert from "node:assert/strict";
import { validateFrame } from "../dist/security/validate.js";
import { TokenBucket, ConnectionLimiter } from "../dist/security/rateLimit.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };

console.log("=".repeat(64));
console.log("  SECURITY — input validation + rate limiting");
console.log("=".repeat(64));

// ---- input validation ----
ok(validateFrame("{ not json").ok === false, "malformed JSON rejected");
ok(validateFrame(JSON.stringify([1, 2])).ok === false, "non-object frame rejected");
ok(validateFrame(JSON.stringify({ type: "hack" })).ok === false, "unknown message type rejected");
ok(validateFrame(JSON.stringify({ type: "open", bet: -5 })).ok === false, "negative bet rejected");
ok(validateFrame(JSON.stringify({ type: "open", bet: 1e12 })).ok === false, "absurd bet rejected (> ceiling)");
ok(validateFrame(JSON.stringify({ type: "open", bet: "50" })).ok === false, "non-numeric bet rejected");
ok(validateFrame(JSON.stringify({ type: "open", bet: 50, clientSeed: "x".repeat(9999) })).ok === false, "over-long clientSeed rejected");
ok(validateFrame("x".repeat(9000)).ok === false, "over-large frame rejected");

const okOpen = validateFrame(JSON.stringify({ type: "open", bet: 50, clientSeed: "abc", level: 99 }));
ok(okOpen.ok && okOpen.msg.bet === 50 && okOpen.msg.level === 7, "valid open accepted; level clamped 99 -> 7");

const okLim = validateFrame(JSON.stringify({ type: "set-limits", limits: { maxBet: 100, evil: 1 } }));
ok(okLim.ok && okLim.msg.limits.maxBet === 100 && okLim.msg.limits.evil === undefined, "set-limits sanitized (unknown field dropped)");
ok(validateFrame(JSON.stringify({ type: "set-limits", limits: { maxBet: -1 } })).ok === false, "negative limit rejected");
ok(validateFrame(JSON.stringify({ type: "self-exclude", ms: 1e20 })).ok === false, "absurd self-exclude duration rejected");
ok(validateFrame(JSON.stringify({ type: "resume" })).ok === true, "parameterless query accepted");
ok(validateFrame(JSON.stringify({ type: "leaderboard", kind: "drop-table" })).ok === false, "invalid leaderboard kind rejected");

// ---- rate limiting: token bucket ----
{
  let t = 0;
  const b = new TokenBucket(5, 2, () => t); // capacity 5, 2/sec
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (b.take()) allowed++;
  ok(allowed === 5, "burst capped at capacity (5 of 20 instant messages allowed)");
  t = 1000; // +1s -> +2 tokens
  ok(b.take() && b.take() && !b.take(), "refilled exactly 2 tokens after 1s, then empty");
}

// ---- connection limiter (per IP) ----
{
  let t = 0;
  const cl = new ConnectionLimiter(3, 1000, () => t); // 3 per 1s
  ok(cl.allow("1.2.3.4") && cl.allow("1.2.3.4") && cl.allow("1.2.3.4"), "first 3 connections from an IP allowed");
  ok(cl.allow("1.2.3.4") === false, "4th connection in window blocked");
  ok(cl.allow("9.9.9.9") === true, "a different IP is unaffected");
  t = 1100;
  ok(cl.allow("1.2.3.4") === true, "window slides — IP allowed again after 1s");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
