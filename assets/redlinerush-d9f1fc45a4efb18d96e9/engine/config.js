// =============================================================================
//  REDLINE RUSH — certified economic model. Mirror of sim/src/config.mjs.
//
//  Invariant (classic crash):  P(crashPoint >= M) = targetRTP / M  (M >= 1)
//  => cashing out at ANY target T returns EV = T·(RTP/T) = RTP. Strategy-proof.
//  All 3 cars draw independently from this same distribution; their visible
//  speed / overtakes are a presentation layer that never touches the money.
// =============================================================================
export const baseConfig = {
    targetRTP: 0.97, // certified RTP. House edge = 3.0%.
    baseBet: 10,
    cars: ["red", "blue", "yellow"],
    betsPerPlayer: 2,
    maxWinCap: 10000,
    maxCrashPoint: 1_000_000,
    tickMs: 100,
    growthPerSecond: 0.07,
};
//# sourceMappingURL=config.js.map