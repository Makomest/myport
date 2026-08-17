const uuid = () => globalThis.crypto?.randomUUID?.() ?? String(Math.random());
/**
 * Framework-agnostic real-time client for Redline Rush. Maintains one ClientState
 * fed by the server's broadcast/targeted events, and notifies onUpdate after each.
 * Rendering binds to this; no DOM logic lives here.
 */
export class GameClient {
    socket;
    state = {
        phase: "connecting", roundId: "", serverSeedHash: "", nonce: 0,
        carIds: [], cars: [], drivers: [], myBets: {}, balance: 0,
        bettingMs: 0, bettingEndsAt: 0, betsPerPlayer: 2, maxWinCap: 0,
        elapsed: 0, selectedCar: "",
    };
    updateCbs = [];
    chatCbs = [];
    settledCbs = [];
    lastRgStatus = null;
    constructor(socket) {
        this.socket = socket;
        socket.onMessage((d) => this.handle(JSON.parse(d)));
        socket.onOpen(() => this.send({ type: "snapshot" }));
    }
    onUpdate(cb) { this.updateCbs.push(cb); }
    onChat(cb) { this.chatCbs.push(cb); }
    onSettled(cb) { this.settledCbs.push(cb); }
    emit() { for (const cb of this.updateCbs)
        cb(this.state); }
    send(o) { this.socket.send(JSON.stringify(o)); }
    // ---- player actions -------------------------------------------------------
    selectCar(carId) {
        if (this.state.carIds.includes(carId)) {
            this.state.selectedCar = carId;
            this.emit();
        }
    }
    placeBet(slot, stake, autoCashout, carId) {
        const car = carId && this.state.carIds.includes(carId) ? carId : this.state.selectedCar;
        this.send({ type: "place-bet", carId: car, slot, stake, autoCashout, idemKey: uuid() });
    }
    cashOut(slot) { this.send({ type: "cashout", slot }); }
    chat(text) { this.send({ type: "chat", text }); }
    topUp() { this.send({ type: "topup" }); }
    requestRgStatus() { this.send({ type: "rg-status" }); }
    setLimits(limits) { this.send({ type: "set-limits", limits }); }
    selfExclude(ms) { this.send({ type: "self-exclude", ms }); }
    handle(m) {
        const s = this.state;
        switch (m.type) {
            case "round-open": {
                const keep = s.carIds.length && m.cars.includes(s.selectedCar) ? s.selectedCar : m.cars[0];
                s.phase = m.phase;
                s.roundId = m.roundId;
                s.serverSeedHash = m.serverSeedHash;
                s.nonce = m.nonce;
                s.carIds = m.cars;
                s.cars = m.cars.map((id) => ({ id, multiplier: 1, brokenDown: false }));
                s.drivers = [];
                s.myBets = {};
                s.bettingMs = m.bettingMs;
                // Map the server's absolute deadline onto the local clock so a mid-betting
                // join shows the REAL remaining time, not a fresh full window.
                s.bettingEndsAt = Date.now() + Math.max(0, m.bettingEndsAt - m.serverNow);
                s.betsPerPlayer = m.betsPerPlayer;
                s.maxWinCap = m.maxWinCap;
                s.elapsed = 0;
                s.selectedCar = keep;
                s.settled = undefined;
                s.error = undefined;
                s.errorCode = undefined;
                break;
            }
            case "race-start":
                s.phase = "racing";
                break;
            case "tick":
                s.phase = "racing";
                s.cars = m.cars;
                s.elapsed = m.elapsed;
                break;
            case "live":
                s.drivers = m.drivers;
                break;
            case "settled":
                s.phase = "settled";
                s.cars = m.cars;
                s.settled = { serverSeed: m.serverSeed, cars: m.cars };
                for (const cb of this.settledCbs)
                    cb({ serverSeed: m.serverSeed, cars: m.cars, roundId: s.roundId, serverSeedHash: s.serverSeedHash, nonce: s.nonce });
                break;
            case "bet-confirmed":
                s.myBets[m.slot] = { slot: m.slot, carId: m.carId, stake: m.stake, autoCashout: m.autoCashout, status: "active" };
                s.balance = m.balance;
                break;
            case "cashed": {
                const slot = bySlot(s, m.betId);
                if (slot != null && s.myBets[slot]) {
                    s.myBets[slot].status = "cashed";
                    s.myBets[slot].multiplier = m.multiplier;
                    s.myBets[slot].payout = m.payout;
                }
                s.balance = m.balance;
                break;
            }
            case "lost": {
                const slot = bySlot(s, m.betId);
                if (slot != null && s.myBets[slot])
                    s.myBets[slot].status = "lost";
                break;
            }
            case "balance":
                s.balance = m.balance;
                break;
            case "chat":
                for (const cb of this.chatCbs)
                    cb(m);
                return; // chat is not a state update
            case "rg-status":
                this.lastRgStatus = m.status;
                return;
            case "error":
                s.error = m.message ?? m.error;
                s.errorCode = m.error;
                break;
        }
        this.emit();
    }
}
// betId is `${roundId}:${account}:${slot}` — recover the slot for my own bets.
function bySlot(s, betId) {
    const slot = Number(betId.split(":").pop());
    return Number.isFinite(slot) ? slot : null;
}
//# sourceMappingURL=gameClient.js.map