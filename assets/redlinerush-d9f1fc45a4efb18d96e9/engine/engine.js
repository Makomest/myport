// =============================================================================
//  REDLINE RUSH — server-authoritative resolver.
//
//  MONEY MATH (certified, parity-tested vs sim/src/engine.mjs):
//    Classic provably-fair crash. One RNG draw -> one crash point with survival
//    function  P(C >= m) = RTP / m  (m >= 1). Cashing at ANY target T returns
//    EV = T·(RTP/T) = RTP, so RTP is invariant to player strategy and car choice.
//
//  PRESENTATION (cosmetic, NEVER touches money):
//    Each car climbs its multiplier along exp(∫ speed dt) where speed gusts up
//    and down -> cars accelerate, decelerate and overtake. The curve is paced to
//    reach the pre-drawn crash point; it only changes *how* the number ticks up,
//    not the probability of reaching any multiplier.
// =============================================================================
// ---- MONEY MATH (keep bit-identical to the sim) -----------------------------
/** Sample ONE car's crash point (the multiplier at which it breaks down). */
export function sampleCrashPoint(rng, cfg) {
    const v = rng.next(); // [0,1)
    const raw = cfg.targetRTP / (1 - v); // (RTP, ∞)
    if (raw < 1)
        return 1.0; // instant breakdown — bet lost at x1.00
    return Math.min(raw, cfg.maxCrashPoint);
}
/**
 * Resolve ONE bet against a car. `target` is the cash-out multiplier the player
 * locks. Returns 0 if the car broke down before the target, else min(target,cap).
 */
export function resolveBet(crashPoint, target, cfg) {
    if (target > crashPoint)
        return 0;
    return Math.min(target, cfg.maxWinCap ?? Infinity);
}
/** Play ONE bet under a blind target-choosing strategy. For Monte-Carlo parity. */
export function playBet(rng, cfg, chooseTarget) {
    const crashPoint = sampleCrashPoint(rng, cfg);
    const target = chooseTarget();
    return { payoutMult: resolveBet(crashPoint, target, cfg), crashPoint, target };
}
// ---- PRESENTATION (cosmetic) ------------------------------------------------
/** Draw a cosmetic speed curve for one car (independent of its crash point). */
function drawCurve(rng, cfg) {
    return {
        base: cfg.growthPerSecond * (0.85 + rng.next() * 0.3), // 0.85x–1.15x base rate (tighter -> steadier)
        gustAmp: rng.next() * 0.22, // 0–0.22 gentle speed variation (no sudden surges)
        gustFreq: 0.2 + rng.next() * 0.35, // 0.2–0.55 rad/s (slow, smooth swings)
        gustPhase: rng.next() * Math.PI * 2,
    };
}
/**
 * Draw the full round: 3 independent cars, each with a crash point (money) and a
 * cosmetic speed curve (presentation). The crash point is drawn FIRST so the
 * money RNG stream is identical to the sim regardless of curve params.
 */
export function drawCars(rng, cfg) {
    return cfg.cars.map((id) => {
        const crashPoint = sampleCrashPoint(rng, cfg);
        const curve = drawCurve(rng, cfg);
        return { id, crashPoint, curve };
    });
}
/** Cumulative growth ∫0^t speed ds (closed form). t in seconds. */
export function cumulativeGrowth(curve, t) {
    const { base, gustAmp, gustFreq: w, gustPhase: p } = curve;
    return base * (t + (gustAmp * (Math.cos(p) - Math.cos(w * t + p))) / w);
}
/** On-screen multiplier for a car at elapsed `ms`, clamped to its crash point. */
export function multiplierAt(car, ms, cfg) {
    const m = Math.exp(cumulativeGrowth(car.curve, ms / 1000));
    return Math.min(m, car.crashPoint, cfg.maxWinCap);
}
/** Has the car broken down by elapsed `ms`? */
export function isBrokenDown(car, ms, cfg) {
    return multiplierAt(car, ms, cfg) >= car.crashPoint - 1e-9;
}
/**
 * Time (ms) at which a car reaches its crash point. Found by bisection — speed is
 * strictly positive (gustAmp < 1) so cumulativeGrowth is monotonically increasing.
 */
export function breakdownMs(car) {
    const targetGrowth = Math.log(car.crashPoint);
    if (targetGrowth <= 0)
        return 0; // crash at x1.00 -> instant breakdown
    let lo = 0;
    let hi = 1;
    while (cumulativeGrowth(car.curve, hi) < targetGrowth)
        hi *= 2;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (cumulativeGrowth(car.curve, mid) < targetGrowth)
            lo = mid;
        else
            hi = mid;
    }
    return ((lo + hi) / 2) * 1000;
}
//# sourceMappingURL=engine.js.map