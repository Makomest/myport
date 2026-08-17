// =============================================================================
//  Redline Rush — OFFLINE DEMO "server".
//
//  Drop-in replacement for the WebSocket transport: instead of talking to a
//  backend, it runs the whole round loop in the browser using the SAME engine
//  (RedlineRound) the real server uses. Crash points come from a provably-fair
//  HMAC-SHA256 stream (Web Crypto) that is byte-identical to the server's, so
//  the in-game "Provably fair" verifier still validates every round.
//
//  This lets the game run as a 100% static site (e.g. a portfolio page) with no
//  backend, database or sockets. Money is play-money kept in localStorage.
// =============================================================================
import { RedlineRound } from "./engine/round.js";
import { baseConfig } from "./engine/config.js";

const CLIENT_SEED = "redline-house";
const BETTING_MS = 6000;
const SETTLE_MS = 4000;
const DEMO_FUND = 1000;

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : randomHex(16));
const mask = (a) => (a.length <= 3 ? a[0] + "**" : a.slice(0, 3) + "***");

async function sha256Hex(s) {
  const buf = await subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Reproduce ProvablyFairRng.next(): HMAC_SHA256(serverSeed, `${client}:${nonce}:${counter}`)/2^48.
async function hmacFloat(serverSeed, msg) {
  const key = await subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await subtle.sign("HMAC", key, enc.encode(msg)));
  let v = 0;
  for (let i = 0; i < 6; i++) v = v * 256 + sig[i];
  return v / 2 ** 48;
}

/** A ClientSocket-shaped local engine. Returns the same interface as reconnectingSocket(). */
export function demoSocket(account = "demo") {
  const msgCbs = [], openCbs = [];
  const emit = (o) => { const d = JSON.stringify(o); for (const cb of msgCbs) queueMicrotask(() => cb(d)); };

  const cfg = baseConfig;
  let round = null, commit = null, phase = "settled", roundStartMs = 0, bettingEndsAt = 0, nonce = 0;
  const bets = new Map(); // betId -> { betId, account, carId, slot, stake }
  let balance = Number(localStorage.getItem("rr-demo-bal") ?? DEMO_FUND);
  const setBal = (v) => { balance = Math.round(v * 100) / 100; localStorage.setItem("rr-demo-bal", String(balance)); };
  let tickTimer = null; const timers = [];

  // ---- DTOs (mirror the real GameService) ----
  const roundOpenDto = () => ({
    type: "round-open", roundId: commit.roundId, serverSeedHash: commit.serverSeedHash, nonce: commit.nonce,
    cars: cfg.cars, phase, bettingMs: BETTING_MS, bettingEndsAt, betsPerPlayer: cfg.betsPerPlayer,
    maxWinCap: cfg.maxWinCap, serverNow: Date.now(),
  });
  const tickDto = (now) => ({ type: "tick", roundId: commit.roundId, elapsed: phase === "betting" ? 0 : now - roundStartMs, cars: round.carStates() });
  const liveDto = () => {
    const byPlayer = new Map();
    for (const slot of round.settle()) {
      if (!byPlayer.has(slot.playerId)) byPlayer.set(slot.playerId, { player: mask(slot.playerId), carId: slot.carId, bets: [] });
      const lb = bets.get(slot.betId);
      byPlayer.get(slot.playerId).bets.push({ slot: lb?.slot ?? 0, multiplier: slot.cashoutMult, status: slot.status });
    }
    return { type: "live", roundId: commit.roundId, drivers: [...byPlayer.values()] };
  };

  // ---- lifecycle ----
  async function openRound() {
    const serverSeed = randomHex(32);
    commit = { roundId: uuid(), serverSeed, serverSeedHash: await sha256Hex(serverSeed), clientSeed: CLIENT_SEED, nonce: nonce++ };
    // Pre-draw the HMAC float stream and feed RedlineRound a sync RNG over it.
    const need = cfg.cars.length * 6 + 6;
    const floats = [];
    for (let c = 0; c < need; c++) floats.push(await hmacFloat(serverSeed, `${CLIENT_SEED}:${commit.nonce}:${c}`));
    let i = 0;
    round = new RedlineRound(cfg, { next: () => floats[i++] });
    bets.clear();
    phase = "betting";
    bettingEndsAt = Date.now() + BETTING_MS;
    emit(roundOpenDto());
    timers.push(setTimeout(beginRace, BETTING_MS));
  }
  function beginRace() {
    phase = "racing";
    roundStartMs = Date.now();
    round.start(roundStartMs);
    emit({ type: "race-start", roundId: commit.roundId, serverNow: roundStartMs });
    tickTimer = setInterval(tick, cfg.tickMs);
  }
  function tick() {
    if (phase !== "racing") return;
    const now = Date.now();
    const events = round.tick(now);
    let liveChanged = false;
    for (const ev of events) {
      if (ev.type === "breakdown") { liveChanged = true; continue; }
      const bet = ev.betId ? bets.get(ev.betId) : null;
      if (!bet) continue;
      liveChanged = true;
      if (ev.multiplier > 0) payout(bet, ev.multiplier, true);
      else emit({ type: "lost", account: bet.account, roundId: commit.roundId, betId: bet.betId, carId: bet.carId });
    }
    emit(tickDto(now));
    if (liveChanged) emit(liveDto());
    if (round.phase === "ended") settleRound();
  }
  function settleRound() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    phase = "settled";
    emit({ type: "settled", roundId: commit.roundId, serverSeed: commit.serverSeed, cars: round.carStates() });
    timers.push(setTimeout(openRound, SETTLE_MS));
  }
  function payout(bet, multiplier, auto) {
    const pay = bet.stake * multiplier;
    setBal(balance + pay);
    emit({ type: "cashed", account: bet.account, roundId: commit.roundId, betId: bet.betId, carId: bet.carId, multiplier, payout: pay, balance, auto });
  }

  // ---- inbound protocol ----
  function handle(m) {
    switch (m.type) {
      case "snapshot": return snapshot();
      case "place-bet": return placeBet(m);
      case "cashout": return cashOut(m.slot);
      case "topup": { setBal(balance + DEMO_FUND); return emit({ type: "balance", balance }); }
      case "chat": return emit({ type: "chat", player: mask(account), text: m.text, ts: Date.now() });
      default: return; // rg-status / set-limits etc — not used offline
    }
  }
  function snapshot() {
    if (round && commit) {
      emit(roundOpenDto());
      if (phase !== "betting") emit(tickDto(Date.now()));
      emit(liveDto());
      const slots = round.settle();
      for (const lb of bets.values()) {
        if (lb.account !== account) continue;
        const es = slots.find((s) => s.betId === lb.betId);
        emit({ type: "bet-confirmed", account, roundId: commit.roundId, betId: lb.betId, carId: lb.carId, slot: lb.slot, stake: lb.stake, autoCashout: es?.autoCashout, balance });
        if (es?.status === "cashed") emit({ type: "cashed", account, roundId: commit.roundId, betId: lb.betId, carId: lb.carId, multiplier: es.cashoutMult, payout: lb.stake * (es.payoutMult ?? 0), balance, auto: false });
        else if (es?.status === "lost") emit({ type: "lost", account, roundId: commit.roundId, betId: lb.betId, carId: lb.carId });
      }
    }
    emit({ type: "balance", balance });
  }
  function placeBet(m) {
    if (phase !== "betting" || !round) return emit({ type: "error", error: "InvalidState", message: "betting is closed" });
    if (m.slot !== 1 && m.slot !== 2) return emit({ type: "error", error: "InvalidState", message: "slot must be 1 or 2" });
    if (!(m.stake > 0)) return emit({ type: "error", error: "InvalidState", message: "stake must be positive" });
    if (m.stake > balance) return emit({ type: "error", error: "InsufficientFunds", message: "Not enough balance — top up to keep playing." });
    const betId = `${commit.roundId}:${account}:${m.slot}`;
    try {
      round.placeBet({ betId, playerId: account, carId: m.carId, stake: m.stake, autoCashout: m.autoCashout });
    } catch (e) { return emit({ type: "error", error: "InvalidState", message: e.message }); }
    setBal(balance - m.stake);
    bets.set(betId, { betId, account, carId: m.carId, slot: m.slot, stake: m.stake });
    emit({ type: "bet-confirmed", account, roundId: commit.roundId, betId, carId: m.carId, slot: m.slot, stake: m.stake, autoCashout: m.autoCashout, balance });
    emit(liveDto());
  }
  function cashOut(slot) {
    if (phase !== "racing" || !round) return emit({ type: "error", error: "InvalidState", message: "not racing" });
    const betId = `${commit.roundId}:${account}:${slot}`;
    const bet = bets.get(betId);
    if (!bet) return emit({ type: "error", error: "InvalidState", message: "no such bet" });
    let ev;
    try { ev = round.cashOut(betId, Date.now()); } catch (e) { return emit({ type: "error", error: "InvalidState", message: e.message }); }
    payout(bet, ev.multiplier, false);
    emit(liveDto());
  }

  // kick off the loop after the client has wired its handlers
  setTimeout(() => { for (const cb of openCbs) cb(); openRound(); }, 0);

  return {
    send: (d) => { try { handle(JSON.parse(d)); } catch { /* ignore malformed */ } },
    close: () => { if (tickTimer) clearInterval(tickTimer); for (const t of timers) clearTimeout(t); },
    onMessage: (cb) => msgCbs.push(cb),
    onOpen: (cb) => openCbs.push(cb),
    onClose: () => {},
  };
}
