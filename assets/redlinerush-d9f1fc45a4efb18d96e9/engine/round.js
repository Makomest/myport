import { drawCars, multiplierAt, isBrokenDown, breakdownMs } from "./engine.js";
export class RedlineRound {
    cfg;
    cars;
    phase = "betting";
    startMs = 0;
    elapsed = 0;
    bets = new Map();
    brokenAnnounced = new Set();
    constructor(cfg, rng) {
        this.cfg = cfg;
        this.cars = drawCars(rng, cfg);
    }
    /** Pre-computed breakdown time (ms) per car — lets the server schedule the round. */
    get breakdownTimes() {
        const out = {};
        for (const c of this.cars)
            out[c.id] = breakdownMs(c);
        return out;
    }
    /** Place a bet during the betting window. Enforces one car + bet cap per player. */
    placeBet(input) {
        if (this.phase !== "betting")
            throw new Error("betting is closed");
        if (!this.cars.some((c) => c.id === input.carId))
            throw new Error("unknown car");
        if (input.stake <= 0)
            throw new Error("stake must be positive");
        if (input.autoCashout != null && input.autoCashout <= 1)
            throw new Error("autoCashout must be > 1");
        if (this.bets.has(input.betId))
            throw new Error("duplicate betId");
        const mine = [...this.bets.values()].filter((b) => b.playerId === input.playerId);
        if (mine.length >= this.cfg.betsPerPlayer)
            throw new Error("bet limit reached");
        if (mine.length > 0 && mine[0].carId !== input.carId)
            throw new Error("all bets must be on one car");
        const slot = { ...input, status: "active" };
        this.bets.set(input.betId, slot);
        return slot;
    }
    /** Remove a just-placed bet (e.g. the RGS wallet debit failed). Betting only. */
    removeBet(betId) {
        if (this.phase !== "betting")
            throw new Error("cannot remove a bet after betting closes");
        this.bets.delete(betId);
    }
    /** Close betting and start the race. */
    start(nowMs) {
        if (this.phase !== "betting")
            throw new Error("round already started");
        this.phase = "running";
        this.startMs = nowMs;
    }
    /** Current car snapshot (crash points stay hidden until the round ends). */
    carStates() {
        const reveal = this.phase === "ended";
        return this.cars.map((c) => ({
            id: c.id,
            multiplier: this.phase === "betting" ? 1 : multiplierAt(c, this.elapsed, this.cfg),
            brokenDown: this.phase === "running" || this.phase === "ended"
                ? isBrokenDown(c, this.elapsed, this.cfg)
                : false,
            ...(reveal ? { crashPoint: c.crashPoint } : {}),
        }));
    }
    /** Manual cash-out of one active bet at the current multiplier. */
    cashOut(betId, nowMs) {
        if (this.phase !== "running")
            throw new Error("not racing");
        const bet = this.bets.get(betId);
        if (!bet)
            throw new Error("unknown bet");
        if (bet.status !== "active")
            throw new Error("bet not active");
        const car = this.cars.find((c) => c.id === bet.carId);
        const elapsed = nowMs - this.startMs;
        if (isBrokenDown(car, elapsed, this.cfg))
            throw new Error("car already broke down");
        const mult = multiplierAt(car, elapsed, this.cfg);
        bet.status = "cashed";
        bet.cashoutMult = mult;
        bet.payoutMult = mult;
        return { type: "cashout", betId, carId: bet.carId, multiplier: mult, auto: false };
    }
    /**
     * Advance the race clock and emit events: auto-cash-outs that triggered and
     * cars that broke down (losing their still-active bets). Idempotent per tick.
     */
    tick(nowMs) {
        if (this.phase !== "running")
            return [];
        this.elapsed = nowMs - this.startMs;
        const events = [];
        for (const car of this.cars) {
            const broke = isBrokenDown(car, this.elapsed, this.cfg);
            const newlyBroke = broke && !this.brokenAnnounced.has(car.id);
            const mult = multiplierAt(car, this.elapsed, this.cfg);
            for (const bet of this.bets.values()) {
                if (bet.carId !== car.id || bet.status !== "active")
                    continue;
                // Auto-cash-out fires first: if the target was reached, it locks at the
                // target (<= crashPoint), so it always wins before any breakdown.
                if (bet.autoCashout != null && mult >= bet.autoCashout) {
                    // pay the target, hard-capped at the max win multiplier (defence in depth;
                    // the RGS also validates autoCashout <= cap on the way in).
                    const paid = Math.min(bet.autoCashout, this.cfg.maxWinCap ?? Infinity);
                    bet.status = "cashed";
                    bet.cashoutMult = paid;
                    bet.payoutMult = paid;
                    events.push({ type: "cashout", betId: bet.betId, carId: car.id, multiplier: paid, auto: true });
                }
                else if (broke) {
                    bet.status = "lost";
                    bet.payoutMult = 0;
                    events.push({ type: "cashout", betId: bet.betId, carId: car.id, multiplier: 0 });
                }
            }
            if (newlyBroke) {
                this.brokenAnnounced.add(car.id);
                events.push({ type: "breakdown", carId: car.id, multiplier: car.crashPoint });
            }
        }
        if (this.cars.every((c) => isBrokenDown(c, this.elapsed, this.cfg)))
            this.phase = "ended";
        return events;
    }
    /** All bets (for settlement by the RGS layer). */
    settle() {
        return [...this.bets.values()];
    }
}
//# sourceMappingURL=round.js.map