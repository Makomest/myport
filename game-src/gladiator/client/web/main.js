// Image-driven arena UI bound to the GameClient SDK (assets in ./assets/).
import { GameClient, reconnectingSocket, verifyRound } from "../dist/index.js";

const PORT = 8790;
const A = "./assets/";
const $ = (id) => document.getElementById(id);
let autoSpeed = 1; // autoplay acceleration (1× / 2× / 3×); 1 during manual play
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / autoSpeed));
const retrigger = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
// Run a cue on the frame that paints the visual it belongs to. Class changes only show
// up at the next paint, so firing a sound inline makes it lead the picture by a frame.
const onPaint = (fn) => requestAnimationFrame(fn);
const rndInt = (n) => 1 + Math.floor(Math.random() * n);
if (localStorage.getItem("gladiator-lowfx") === "1") document.body.classList.add("lowfx");
const LOW = () => document.body.classList.contains("lowfx"); // quality mode: fewer particles

const el = {
  mult: $("mult"), fighters: $("fighters"), player: $("player"), playerImg: $("player-img"),
  enemy: $("enemy"), enemyImg: $("enemy-img"), spark: $("spark"), gemsEl: $("gems"),
  stamp: $("stamp"), flash: $("flash"), coins: $("coins"), bal: $("bal"), cashAmt: $("cashAmt"),
  status: $("status"), gain: $("gain"), points: $("points"), round: $("round"), avatar: $("avatar"),
};

// restore idle sway after a one-shot swap-pop
for (const img of [el.playerImg, el.enemyImg]) img.addEventListener("animationend", () => img.classList.remove("swap"));

// Warm every sprite up front — fetch AND decode, holding a reference so the decoded
// frame is not dropped. A cold `img.src = ...` mid-round paints a frame or more after
// the cue that goes with it, which reads as the sound running ahead of the picture.
const IMG_CACHE = new Map(); // url -> Image, kept alive on purpose
function warm(url) {
  let img = IMG_CACHE.get(url);
  if (img) return img;
  img = new Image();
  img.src = url;
  if (img.decode) img.decode().catch(() => {}); // pre-decode; missing files just no-op
  IMG_CACHE.set(url, img);
  return img;
}
const SPRITES = [
  "arena-bg", "BGsecond", "banner-round", "banner-win", "banner-bigwin", "banner-megawin",
  "banner-epicwin", "banner-defeat", "btn-start", "btn-continue", "btn-cashout", "btn-sound",
  "btn-soundmute", "coin", "coin-10", "coin-20", "coin-50", "frame-player", "rose",
  "icon-shield", "icon-swords", "icon-trophy",
];
for (let i = 1; i <= 6; i++) SPRITES.push(`player-${i}`, `enemy-${i}`);
for (let i = 1; i <= 7; i++) SPRITES.push(`opponent-avatar${i}`);
for (const key of ["common", "rare", "epic", "legendary", "mythic", "jackpot"]) {
  for (let v = 1; v <= 3; v++) SPRITES.push(`${key}-${v}`);
}
for (const n of SPRITES) warm(`${A}${n}.png`);

// which attack poses exist (player & enemy, tiers 1..6) - used during the clash lunge
const hasAttack = new Set();
const hasEnemyAtk = new Set();
for (let i = 1; i <= 6; i++) {
  const p = warm(`${A}playerAttack-${i}.png`);
  const e = warm(`${A}enemyattack-${i}.png`);
  const addP = () => hasAttack.add(i), addE = () => hasEnemyAtk.add(i);
  p.complete ? addP() : p.addEventListener("load", addP, { once: true });
  e.complete ? addE() : e.addEventListener("load", addE, { once: true });
}

// build 3 gem slots
for (let i = 0; i < 3; i++) {
  const slot = document.createElement("div");
  slot.className = "gem-slot";
  slot.innerHTML = `<div class="gem"><img class="gem-img" alt=""/><span class="stack"></span></div><div class="label"></div>`;
  el.gemsEl.appendChild(slot);
}

// colors MATCH the rarity frame of each item asset:
// common=silver, rare=blue, epic=purple, legendary=gold/orange, mythic=orange-red, jackpot=cosmic violet
const rarity = (m) =>
  m >= 10 ? { key: "jackpot", color: "#a86bff", stage: 6, name: "Jackpot" }
  : m >= 2.5 ? { key: "mythic", color: "#ff6a2a", stage: 5, name: "Mythic" }
  : m >= 1.75 ? { key: "legendary", color: "#f2a73b", stage: 4, name: "Legendary" }
  : m >= 1.35 ? { key: "epic", color: "#b94dff", stage: 3, name: "Epic" }
  : m >= 1.15 ? { key: "rare", color: "#3f9bff", stage: 2, name: "Rare" }
  : { key: "common", color: "#c2c8d4", stage: 1, name: "Common" };

// loot-reel rarity descriptors, weighted toward low tiers so the won item stands out
const RARITIES = [
  { key: "common", color: "#c2c8d4", stage: 1 },
  { key: "rare", color: "#3f9bff", stage: 2 },
  { key: "epic", color: "#b94dff", stage: 3 },
  { key: "legendary", color: "#f2a73b", stage: 4 },
  { key: "mythic", color: "#ff6a2a", stage: 5 },
  { key: "jackpot", color: "#a86bff", stage: 6 },
];
const REEL_WEIGHTS = [40, 26, 16, 10, 6, 2];
function randomRarity() {
  let r = Math.random() * REEL_WEIGHTS.reduce((a, b) => a + b, 0);
  for (let i = 0; i < RARITIES.length; i++) if ((r -= REEL_WEIGHTS[i]) < 0) return RARITIES[i];
  return RARITIES[0];
}

// --- gem model (mirrors engine stacking: tier + count) + chosen item-icon variant ---
let slots = [];
function placeGem(m, variant = rndInt(3)) {
  const dup = slots.findIndex((s) => Math.abs(s.tier - m) < 1e-9);
  if (dup >= 0) { slots[dup].count++; return dup; }
  if (slots.length < 3) { slots.push({ tier: m, count: 1, variant }); return slots.length - 1; }
  let lo = 0;
  for (let i = 1; i < slots.length; i++) if (slots[i].tier < slots[lo].tier) lo = i;
  if (m > slots[lo].tier) { slots[lo] = { tier: m, count: 1, variant }; return lo; }
  return -1;
}
function paintGem(i) {
  const s = slots[i];
  if (!s) return;
  const r = rarity(s.tier);
  const slot = el.gemsEl.children[i];
  const gem = slot.querySelector(".gem");
  slot.querySelector(".gem-img").src = `${A}${r.key}-${s.variant}.png`;
  gem.style.setProperty("--gc", r.color);
  slot.classList.add("filled");
  gem.className = "gem filled t" + r.stage; // rarity tier drives entrance fx + glow strength
  const badge = slot.querySelector(".stack");
  if (s.count > 1) { badge.style.display = "block"; badge.textContent = "×" + s.count; } else badge.style.display = "none";
  const label = slot.querySelector(".label"); label.textContent = r.name; label.style.color = r.color;
  retrigger(gem, "show");
}
function clearGems() {
  slots = [];
  for (const slot of el.gemsEl.children) {
    slot.className = "gem-slot";
    slot.querySelector(".gem").className = "gem";
    slot.querySelector(".stack").style.display = "none";
    slot.querySelector(".label").textContent = "";
  }
}

// Both fighters scale with the MULTIPLIER (the bigger it is, the stronger they
// look), 6 tiers, top-tier (player-6 / enemy-6 demon) at x6+. Not random.
let curStage = 1;
const stageForMult = (m) => (m >= 6 ? 6 : m >= 4 ? 5 : m >= 2.5 ? 4 : m >= 1.75 ? 3 : m >= 1.25 ? 2 : 1);
function updateFighters(mult) {
  const st = stageForMult(mult);
  $("stage").style.setProperty("--cam", (1 + (st - 1) * 0.04).toFixed(3)); // camera pushes in by tier
  if (st === curStage) return false;
  const up = st > curStage;
  curStage = st;
  swapImg(el.playerImg, `${A}player-${st}.png`, () => retrigger(el.playerImg, "swap"));
  swapImg(el.enemyImg, `${A}enemy-${st}.png`, () => retrigger(el.enemyImg, "swap"));
  return up;
}

// --- fx ---
function flashFx(kind) { el.flash.className = "flash"; void el.flash.offsetWidth; el.flash.classList.add(kind); }

// varied spark burst at the point of contact - a random style each clash (no flash)
const SPARK_STYLES = [
  { c: ["#ffe08a", "#ffd766", "#fff3c0"], n: 26, spread: 80 },
  { c: ["#ff8a3a", "#ff5a2a", "#ffb060"], n: 24, spread: 72 },
  { c: ["#d6ecff", "#ffffff", "#9fd0ff"], n: 20, spread: 92 },
];
function sparkBurst() {
  const st = SPARK_STYLES[Math.floor(Math.random() * SPARK_STYLES.length)];
  const box = $("sparks");
  let n = st.n + Math.floor(Math.random() * 10);
  if (LOW()) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const s = document.createElement("div");
    s.className = "spk";
    const ang = Math.random() * Math.PI * 2;
    const dist = st.spread * (0.35 + Math.random());
    const sz = (2 + Math.random() * 4).toFixed(1);
    s.style.width = sz + "px"; s.style.height = sz + "px";
    s.style.setProperty("--c", st.c[Math.floor(Math.random() * st.c.length)]);
    s.style.setProperty("--dx", (Math.cos(ang) * dist).toFixed(0) + "px");
    s.style.setProperty("--dy", (Math.sin(ang) * dist * 0.85 - 6).toFixed(0) + "px"); // slight upward bias
    s.style.setProperty("--d", (0.3 + Math.random() * 0.4).toFixed(2) + "s");
    box.appendChild(s);
  }
  setTimeout(() => (box.innerHTML = ""), 900);
}
// LOOT REEL - a strip of items spins and decelerates to a stop on the item we won
// (the result is predetermined by the round; the reel is the reveal theatre).
const REEL_N = 38, REEL_WIN = 32;
let reelCtl = null; // { finalX, landed } while a reel is spinning (for click-to-fast-forward)
// Click anywhere (the reel, CONTINUE, the arena) while it spins -> snap quickly to the result.
function reelFastForward() {
  const c = reelCtl;
  if (!c || c.landed || c.ff) return;
  c.ff = true;
  const track = $("reel-track");
  const cur = getComputedStyle(track).transform; // freeze at the current position...
  track.style.transition = "none"; track.style.transform = cur;
  void track.offsetWidth;
  track.style.transition = "transform .28s cubic-bezier(.16,.74,.2,1)"; // ...then dash to the item
  track.style.transform = `translateX(${c.finalX}px)`;
}
// one reel tile from a spec:
//   { r, variant }            -> gem
//   { r, variant, star: n }   -> gem WITH a ★ badge in the corner (item + star dropped together)
//   { star: n } (no r)        -> a pure golden ★ tile (consolation, no item)
function reelTile(spec) {
  const t = document.createElement("div");
  if (spec.r) {
    t.className = "reel-tile";
    t.style.setProperty("--gc", spec.r.color);
    const img = new Image(); img.alt = ""; img.src = `${A}${spec.r.key}-${spec.variant}.png`;
    t.appendChild(img);
    if (spec.star) { const b = document.createElement("span"); b.className = "reel-badge"; b.textContent = "★"; t.appendChild(b); }
  } else {
    t.className = "reel-tile reel-star";
    t.style.setProperty("--gc", "#ffd766");
    t.innerHTML = `<span class="rs">★</span>`;
  }
  return t;
}
// filler tiles are mostly random gems with the odd star sprinkled in, so a star landing looks native
const fillerSpec = () => (Math.random() < 0.12 ? { star: 1 } : { r: randomRarity(), variant: rndInt(3) });

// winSpec: { itemMult, variant, star? } -> lands on that gem (with ★ badge if star>0)
//          { star: n } (no itemMult)    -> lands on a pure star (consolation, no item)
async function spinLoot(winSpec) {
  const reel = $("lootreel"), track = $("reel-track");
  if (!reel || LOW()) return; // low-fx mode skips straight to the drop
  const hasGem = winSpec.itemMult !== undefined;
  const winTileSpec = hasGem
    ? { r: rarity(winSpec.itemMult), variant: winSpec.variant, star: winSpec.star }
    : { star: winSpec.star ?? 1 };
  track.style.transition = "none"; track.style.transform = "translateX(0)";
  track.innerHTML = "";
  const tiles = [];
  for (let i = 0; i < REEL_N; i++) {
    const t = reelTile(i === REEL_WIN ? winTileSpec : fillerSpec());
    if (i === REEL_WIN) t.classList.add("winning");
    track.appendChild(t); tiles.push(t);
  }
  reel.classList.add("show"); reel.classList.remove("lit");
  await sleep(28); // lay the tiles out so we can measure
  // measure in LAYOUT px (offsetLeft/clientWidth) — getBoundingClientRect is skewed by body zoom,
  // which made the reel stop on empty space. Centre the winning tile under the marker.
  const win = tiles[REEL_WIN];
  const maskW = reel.querySelector(".reel-mask").clientWidth;
  const jitter = (Math.random() - 0.5) * win.offsetWidth * 0.4; // stop slightly off-centre for realism
  const finalX = maskW / 2 - (win.offsetLeft + win.offsetWidth / 2) + jitter;
  const pitch = (tiles[1].offsetLeft - tiles[0].offsetLeft) || (win.offsetWidth + 8); // tile + gap
  const dur = 1050 / autoSpeed; // snappier than before
  reelCtl = { finalX, landed: false };
  const skip = () => reelFastForward();
  document.addEventListener("pointerdown", skip);
  Sfx.reel();
  void track.offsetWidth; // commit the start frame before transitioning
  track.style.transition = `transform ${dur}ms cubic-bezier(.12,.70,.18,1)`;
  track.style.transform = `translateX(${finalX}px)`;
  // tick once per tile that crosses the marker — sampled from the LIVE transform so the
  // ticks decelerate exactly with the reel (authentic case-opening feel)
  let ticking = true, lastTick = 0;
  (function tickLoop() {
    if (!ticking) return;
    const tf = getComputedStyle(track).transform;
    if (tf && tf !== "none") {
      const idx = Math.floor(-new DOMMatrixReadOnly(tf).m41 / pitch);
      if (idx > lastTick) { lastTick = idx; Sfx.tick(); }
    }
    requestAnimationFrame(tickLoop);
  })();
  // resolve when the track actually settles (handles the fast-forward too), with a safety net
  await new Promise((res) => {
    const finish = () => { track.removeEventListener("transitionend", finish); clearTimeout(t); res(); };
    const t = setTimeout(finish, dur + 400);
    track.addEventListener("transitionend", finish);
  });
  ticking = false;
  document.removeEventListener("pointerdown", skip);
  reelCtl.landed = true;
  win.classList.add("landed");
  reel.classList.add("lit");
  onPaint(() => {
    if (hasGem) { Sfx.loot(winTileSpec.r.key); if (winSpec.star) Sfx.consolation(); } else Sfx.consolation();
    vibe(20);
  });
  await sleep(360 / autoSpeed);
  reel.classList.remove("show", "lit");
  reelCtl = null;
}
function showStamp(text, color, size) {
  const b = el.stamp.querySelector("b");
  b.textContent = text;
  b.style.fontSize = (size || 50) + "px";
  b.classList.remove("gold", "blood");
  if (color === "gold" || color === "blood") { b.classList.add(color); b.style.color = ""; }
  else { b.style.color = color; }
  retrigger(el.stamp, "show");
}
function showGain(text, color, size) {
  el.gain.textContent = text;
  el.gain.style.color = color;
  el.gain.style.fontSize = (size || 32) + "px";
  retrigger(el.gain, "go");
}
// the bigger the multiplier bonus, the bigger the floater
const gainSize = (dx) => (dx >= 5 ? 62 : dx >= 1.5 ? 50 : dx >= 0.5 ? 42 : dx >= 0.15 ? 34 : 27);
function burstCoins(n) {
  if (LOW()) n = Math.ceil(n / 3);
  for (let i = 0; i < n; i++) {
    const c = document.createElement("img");
    c.src = `${A}coin.png`; c.className = "coin";
    c.style.setProperty("--dx", (Math.random() * 300 - 150).toFixed(0) + "px");
    c.style.setProperty("--dy", (Math.random() * -220 - 70).toFixed(0) + "px");
    c.style.setProperty("--r", (Math.random() * 720 - 360).toFixed(0) + "deg");
    c.style.setProperty("--d", (0.8 + Math.random() * 0.7).toFixed(2) + "s");
    el.coins.appendChild(c);
  }
  setTimeout(() => (el.coins.innerHTML = ""), 1700);
}
function coinsToBalance(n) {
  const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
  const stageR = $("stage").getBoundingClientRect();
  const balR = el.bal.getBoundingClientRect();
  const tx = (balR.left + balR.width / 2 - (stageR.left + stageR.width / 2)) / z;
  const ty = (balR.top + balR.height / 2 - (stageR.top + stageR.height * 0.45)) / z;
  for (let i = 0; i < n; i++) {
    const c = document.createElement("img");
    c.src = `${A}coin.png`; c.className = "coinfly";
    c.style.setProperty("--sx", (Math.random() * 140 - 70).toFixed(0) + "px");
    c.style.setProperty("--sy", (Math.random() * 70 - 35).toFixed(0) + "px");
    c.style.setProperty("--tx", tx.toFixed(0) + "px");
    c.style.setProperty("--ty", ty.toFixed(0) + "px");
    c.style.animationDelay = (i * 60) + "ms";
    el.coins.appendChild(c);
  }
  setTimeout(() => (el.coins.innerHTML = ""), 900 + n * 60);
}
// compact money so a huge balance/payout never overflows the HUD/button
function fmtMoney(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (a >= 1e5) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function countUp(node, from, to, ms, fmt) {
  ms = ms / autoSpeed;
  return new Promise((res) => {
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      node.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}

// --- audio: plays the mp3 assets in ./assets/sfx/ (missing files just no-op) ---
const Sfx = (() => {
  const DIR = A + "sfx/";
  let vol = (() => { const v = parseFloat(localStorage.getItem("gladiator-vol")); return isNaN(v) ? 0.8 : Math.max(0, Math.min(1, v)); })();
  // One-shots go through WebAudio: each sample is decoded once and fired from a
  // buffer source, which starts on the next audio quantum. Cloning an <audio> per
  // hit re-spun the decode pipeline every time, so the same cue landed tens of ms
  // early or late and drifted against the animation it was meant to punctuate.
  const AC = window.AudioContext || window.webkitAudioContext;
  const ONE_SHOTS = [
    "bigwin", "bust", "cashout", "clash", "clash-2", "click", "coin-select",
    "coins-to-balance", "consolation", "crowd-boo", "crowd-cheer", "crowd-gasp",
    "epicwin", "loot-common", "loot-epic", "loot-jackpot", "loot-legendary",
    "loot-mythic", "loot-rare", "megawin", "mult-heat", "reel-tick", "stack",
    "tick", "tier-up", "toggle", "whoosh", "win",
  ];
  let ctx = null;
  const buffers = new Map(); // name -> AudioBuffer
  const loading = new Map(); // name -> in-flight promise, so a burst loads once
  function ac() {
    if (!ctx && AC) { try { ctx = new AC(); } catch { return null; } }
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  }
  function load(name) {
    if (buffers.has(name)) return Promise.resolve(buffers.get(name));
    if (loading.has(name)) return loading.get(name);
    const c = ac();
    if (!c) return Promise.resolve(null);
    const p = fetch(DIR + name + ".mp3")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
      .then((b) => c.decodeAudioData(b))
      .then((buf) => { buffers.set(name, buf); loading.delete(name); return buf; })
      .catch(() => { loading.delete(name); return null; }); // missing file: stays silent
    loading.set(name, p);
    return p;
  }
  // decode everything up front so the first hit of a cue is as prompt as the rest
  function preload() { for (const n of ONE_SHOTS) load(n); }
  function fire(name, gain, rate) {
    const c = ac(); if (!c) return;
    const buf = buffers.get(name);
    if (!buf) { load(name).then((b) => { if (b) fire(name, gain, rate); }); return; }
    const src = c.createBufferSource();
    src.buffer = buf;
    if (rate) src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = Math.max(0, Math.min(1, gain));
    src.connect(g).connect(c.destination);
    src.start();
  }
  function play(name, gain = 1) {
    if (vol <= 0) return;
    fire(name, vol * gain);
  }
  // loot-reel tick sample — fired per tile; slight pitch/volume jitter so the rapid
  // run doesn't sound robotic
  function tick() {
    if (vol <= 0) return;
    fire("reel-tick", vol * (0.5 + Math.random() * 0.15), 0.94 + Math.random() * 0.2);
  }
  // looping beds (single instances)
  let music = null, amb = null, bedsOn = false;
  function beds() {
    if (!music) { music = new Audio(DIR + "musicarena-loop.mp3"); music.loop = true; }
    if (!amb) { amb = new Audio(DIR + "ambientcrowd.mp3"); amb.loop = true; }
    music.volume = vol * 0.32; amb.volume = vol * 0.22;
    if (vol > 0) { music.play().catch(() => {}); amb.play().catch(() => {}); }
  }
  function applyVol() {
    if (music) { music.volume = vol * 0.32; if (vol <= 0) music.pause(); else if (bedsOn) music.play().catch(() => {}); }
    if (amb) { amb.volume = vol * 0.22; if (vol <= 0) amb.pause(); else if (bedsOn) amb.play().catch(() => {}); }
  }
  const pick = (...names) => names[Math.floor(Math.random() * names.length)];
  return {
    resume() { ac(); preload(); if (!bedsOn) { bedsOn = true; beds(); } },
    get muted() { return vol <= 0; },
    get volume() { return vol; },
    setVolume(v) { vol = Math.max(0, Math.min(1, v)); localStorage.setItem("gladiator-vol", vol.toFixed(2)); applyVol(); },
    play,
    click() { play("click", 0.7); },
    coinSelect() { play("coin-select", 0.8); },
    toggle() { play("toggle", 0.8); },
    clash() { play(pick("clash", "clash-2"), 0.9); play("whoosh", 0.5); },
    loot(key) { play("loot-" + key, 1); },
    stack() { play("stack", 1); },
    consolation() { play("consolation", 0.8); },
    reel() { play("whoosh", 0.55); },
    tick,
    coins() { play("coins-to-balance", 0.85); },
    tierUp() { play("tier-up", 0.9); },
    heat() { play("mult-heat", 0.7); },
    gasp() { play("crowd-gasp", 0.9); },
    cashout() { play("cashout", 1); },
    win(tier) { play(tier, 1); play("crowd-cheer", 0.8); },
    bust() { play("bust", 1); play("crowd-boo", 0.55); },
  };
})();
const vibe = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
// Speak a state change that is otherwise only shown through artwork.
const announce = (msg) => { const r = $("live"); if (r) r.textContent = msg; };
// Browser autoplay policy blocks audio until a gesture - so start the music/ambient
// on the FIRST interaction of ANY kind (tap/click/key), not just the START button.
const startAudioOnce = () => {
  Sfx.resume();
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(ev, startAudioOnce);
};
for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, startAudioOnce, { passive: true });

// --- ambient embers rising through the arena ---
(function embers() {
  const box = $("embers"); if (!box) return;
  for (let i = 0; i < 16; i++) {
    const e = document.createElement("div");
    e.className = "ember";
    e.style.left = Math.random() * 100 + "%";
    e.style.setProperty("--d", (5 + Math.random() * 6).toFixed(1) + "s");
    e.style.setProperty("--delay", (-Math.random() * 8).toFixed(1) + "s");
    e.style.setProperty("--drift", (Math.random() * 60 - 30).toFixed(0) + "px");
    box.appendChild(e);
  }
})();
const cheer = () => retrigger($("cheer"), "go");
const shake = () => retrigger($("stage"), "shake");
const zoom = () => retrigger($("stage"), "zoom");
let lastHeat = 0;
const setMultHeat = (m) => {
  el.mult.classList.toggle("red", m >= 10); el.mult.classList.toggle("hot", m >= 4 && m < 10);
  const lvl = m >= 10 ? 2 : m >= 4 ? 1 : 0;
  if (lvl > lastHeat) Sfx.heat();
  lastHeat = lvl;
};
// the deeper the run, the hotter the ROUND banner (round 1 = plain)
const setRoundFx = (n) => { el.round.className = "round-badge" + (n >= 9 ? " r4" : n >= 6 ? " r3" : n >= 4 ? " r2" : n >= 2 ? " r1" : ""); };
// Point an <img> at new artwork and only reveal it once that artwork is decoded.
// Revealing first leaves the element showing the previous frame's bitmap, which is
// how a win used to flash the defeat banner (and the other way round).
function swapImg(img, url, reveal) {
  if (img.getAttribute("src") === url) { reveal(); return; }
  img.src = url;
  if (img.decode) img.decode().then(reveal, reveal); // warm cache: resolves right away
  else reveal();
}
function showWinBanner(file) {
  const wb = $("winbanner");
  wb.classList.toggle("defeat", file === "defeat");
  swapImg($("winbanner-img"), `${A}banner-${file}.png`, () => retrigger(wb, "go"));
}
// blood splatter on defeat - organic dark-red blobs hit the screen, then fade
const rndBlob = () => `${38 + Math.random() * 30}% ${38 + Math.random() * 30}% ${38 + Math.random() * 30}% ${38 + Math.random() * 30}% / ${38 + Math.random() * 30}% ${38 + Math.random() * 30}% ${38 + Math.random() * 30}% ${38 + Math.random() * 30}%`;
function spawnBlood(n) {
  if (LOW()) n = Math.ceil(n / 3);
  const box = $("blood");
  for (let i = 0; i < n; i++) {
    const b = document.createElement("div");
    b.className = "splat";
    const sz = 16 + Math.random() * 46;
    b.style.width = sz.toFixed(0) + "px";
    b.style.height = (sz * (0.65 + Math.random() * 0.6)).toFixed(0) + "px";
    b.style.left = (Math.random() * 100).toFixed(1) + "%";
    b.style.top = (Math.random() * 82).toFixed(1) + "%";
    b.style.borderRadius = rndBlob();
    b.style.setProperty("--rot", (Math.random() * 50 - 25).toFixed(0) + "deg"); // gentle tilt, no spin
    b.style.animationDelay = (Math.random() * 0.18).toFixed(2) + "s";
    box.appendChild(b);
  }
  setTimeout(() => (box.innerHTML = ""), 1200);
}

// roses tossed from the stands on a win (image petals)
function throwRoses(n) {
  if (LOW()) n = Math.ceil(n / 3);
  const box = $("roses");
  for (let i = 0; i < n; i++) {
    const r = document.createElement("img");
    r.className = "rose"; r.src = `${A}rose.png`;
    // bias spawn toward the side stands, spread across the top
    r.style.left = (Math.random() < 0.5 ? Math.random() * 28 : 72 + Math.random() * 28) + "%";
    r.style.width = (22 + Math.random() * 18).toFixed(0) + "px";
    r.style.setProperty("--drift", (Math.random() * 160 - 80).toFixed(0) + "px");
    r.style.setProperty("--spin", (Math.random() * 900 - 450).toFixed(0) + "deg");
    r.style.setProperty("--dur", (1.6 + Math.random() * 1.4).toFixed(2) + "s");
    r.style.animationDelay = (Math.random() * 0.7).toFixed(2) + "s";
    box.appendChild(r);
  }
  setTimeout(() => (box.innerHTML = ""), 3400);
}

// --- controls ---
const betKey = "gladiator-bet";
let currentBet = Number(localStorage.getItem(betKey)) || 20, roundBet = 0, lastBalance = 1000;
// Daily Arena: dailyStars = committed (server) total over 24h; runStars = this run (provisional)
let dailyStars = 0, dailyRank = 0, runStars = 0, rankRefreshed = false;
const auto = { on: false, left: 0, cashAt: 2, stopBelow: 0 };
let autoEndSig = null;
const lock = () => { for (const id of ["start", "continue", "cash"]) $(id).disabled = true; $("bets").style.opacity = ".4"; };
function unlock(s) {
  const decision = s.phase === "decision";
  $("start").disabled = decision;
  $("continue").disabled = !decision;
  $("cash").disabled = !decision;
  $("verify").disabled = !s.serverSeed;
  $("bets").style.opacity = decision ? ".4" : "1";
  el.status.textContent =
    decision ? "Continue (risk it) or Cash Out"
    : s.phase === "ended" ? "Round over - START again" : s.phase === "error" ? ("Error: " + s.error) : "Press START";
  // autoplay drives the round itself - keep the manual buttons locked while it runs
  if (auto.on) { $("start").disabled = true; $("continue").disabled = true; $("cash").disabled = true; $("bets").style.opacity = ".4"; }
}
function updateHud(s) {
  if (typeof s.balance === "number" && Math.abs(s.balance - lastBalance) > 0.001) {
    countUp(el.bal, lastBalance, s.balance, 500, (v) => fmtMoney(v));
    lastBalance = s.balance;
  }
  // the cash amount is ticked up by the fight animation; only set it directly when
  // there is nothing pending to animate (else it would flash to the final value first)
  if (!animating && shownEvents >= s.events.length) {
    el.cashAmt.textContent = fmtMoney((s.bet || currentBet) * (s.multiplier || 1));
  }
}

// --- animation sequencing ---
async function animateFight(from, ev) {
  el.round.innerHTML = "<i>ROUND</i><b>" + (ev.roundIndex + 1) + "</b>";
  setRoundFx(ev.roundIndex + 1);
  const atk = hasAttack.has(curStage); // lunge with the attack pose if we have one for this tier
  const eatk = hasEnemyAtk.has(curStage);
  if (atk) el.playerImg.src = `${A}playerAttack-${curStage}.png`;
  if (eatk) el.enemyImg.src = `${A}enemyattack-${curStage}.png`;
  el.fighters.classList.add("clash");
  sparkBurst();
  // fire the hit on the frame that actually paints the lunge, not the one that queues it
  requestAnimationFrame(() => { Sfx.clash(); vibe(18); });
  await sleep(480);
  el.fighters.classList.remove("clash");
  if (atk) el.playerImg.src = `${A}player-${curStage}.png`; // back to idle stance
  if (eatk) el.enemyImg.src = `${A}enemy-${curStage}.png`;

  if (ev.won) {
    const dx = ev.multiplier - from;
    const gotItem = ev.itemMult && (ev.upgraded || ev.stacked);
    // stars can now drop on ANY win (server-rolled): on a gear win it's a bonus on top
    // of the multiplier; on a consolation win it's the whole reward (always ≥1).
    const sg = ev.starsGained || (gotItem ? 0 : 1);
    if (gotItem) {
      // the reel reveals the ITEM that dropped (with a ★ badge in the corner if a star
      // dropped too) - so it's always clear which item you won
      const variant = rndInt(3);
      await spinLoot({ itemMult: ev.itemMult, variant, ...(sg > 0 ? { star: sg } : {}) });
      const idx = placeGem(ev.itemMult, variant); if (idx >= 0) paintGem(idx);
      if (ev.stacked) Sfx.stack();
      if (sg > 0) { runStars += sg; renderRank(); retrigger(el.points, "credit"); }
      showGain(sg > 0 ? `★ +${sg}  ·  x${dx.toFixed(2)}` : `x${dx.toFixed(2)}`,
        sg > 0 ? "#ffe066" : rarity(ev.itemMult).color, gainSize(dx) + (sg > 0 ? 6 : 0));
    } else {
      // consolation win (no item to show): the reel lands on a pure star
      await spinLoot({ star: sg });
      runStars += sg; renderRank(); retrigger(el.points, "credit");
      showGain(`★ +${sg}  ·  x${dx.toFixed(2)}`, sg >= 2 ? "#ffe066" : "#ffd766", gainSize(dx) + (sg >= 2 ? 10 : 0));
    }
    el.mult.classList.add("win"); retrigger(el.mult, "pop");
    const bet = roundBet || currentBet;
    await Promise.all([
      countUp(el.mult, from, ev.multiplier, 480, (v) => "x" + v.toFixed(2)),
      countUp(el.cashAmt, bet * from, bet * ev.multiplier, 480, (v) => fmtMoney(v)),
    ]);
    setMultHeat(ev.multiplier);
    if (updateFighters(ev.multiplier)) { shake(); onPaint(() => Sfx.tierUp()); }
    if (ev.jackpot || (ev.itemMult && ev.itemMult >= 10)) { flashFx("gold"); cheer(); shake(); burstCoins(40); onPaint(() => { Sfx.gasp(); vibe([0, 30, 40, 50]); }); await sleep(300); }
    await sleep(120);
  } else {
    flashFx("red"); shake();
    el.player.classList.add("dead");
    showWinBanner("defeat");
    spawnBlood(9);
    onPaint(() => { Sfx.bust(); vibe(160); });
    announce(`Defeat - you lost ${fmtMoney(roundBet || currentBet)}. Press START for a new game.`);
    await sleep(1000);
  }
}
async function animateCashout(s) {
  const x = s.payoutMult || s.payout / (s.bet || currentBet);
  const tierFile = x >= 50 ? "epicwin" : x >= 15 ? "megawin" : x >= 5 ? "bigwin" : "win";
  showWinBanner(tierFile);
  flashFx("green"); cheer(); zoom();
  burstCoins(Math.min(160, Math.round(18 + x * 6))); // more coins the bigger the win
  throwRoses(x >= 50 ? 40 : x >= 15 ? 28 : x >= 5 ? 18 : 10);
  Sfx.cashout();
  setTimeout(() => Sfx.win(tierFile), 200);
  vibe([0, 40, 50, 60]);
  // place the amount just under the banner (taller banners → a bit lower)
  el.stamp.style.setProperty("--amt-top", x >= 50 ? "63%" : x >= 15 ? "58%" : "55%");
  // the bigger the win, the bigger the engraved gold amount - and it counts up
  showStamp("+$0.00", "gold", x >= 50 ? 84 : x >= 15 ? 72 : x >= 5 ? 62 : 50);
  await countUp(el.stamp.querySelector("b"), 0, s.payout, 850, (v) => "+" + fmtMoney(v));
  // credit the win to the balance: coins stream up into it while it ticks
  if (typeof s.balance === "number" && Math.abs(s.balance - lastBalance) > 0.001) {
    coinsToBalance(10);
    retrigger(el.bal, "credit");
    onPaint(() => Sfx.coins());
    const from = lastBalance;
    lastBalance = s.balance;
    await countUp(el.bal, from, s.balance, 950, (v) => fmtMoney(v));
  }
  await sleep(250);
}
function resetStage() {
  clearGems();
  renderRank();
  el.round.innerHTML = "<i>ROUND</i><b>1</b>"; setRoundFx(1);
  el.mult.textContent = "x1.00"; setMultHeat(1);
  $("stage").style.setProperty("--cam", "1"); // camera back to wide
  el.player.classList.remove("dead");
  curStage = 1; el.playerImg.src = `${A}player-1.png`; el.enemyImg.src = `${A}enemy-1.png`;
  el.stamp.classList.remove("show"); el.coins.innerHTML = "";
  el.gain.textContent = ""; el.gain.classList.remove("go");
  $("roses").innerHTML = ""; $("blood").innerHTML = ""; $("winbanner").classList.remove("go", "defeat");
}

// restore an in-progress round after reconnect/reload - no fight animations, just set the scene
function restoreGems(eq) {
  slots = (eq || []).map((e) => ({ tier: e.tier, count: e.count, variant: rndInt(3) }));
  slots.forEach((_, i) => paintGem(i));
}
function restoreResume(s) {
  shownEvents = s.events.length; // mark as shown so pump skips the synthetic event
  const m = s.multiplier || 1;
  el.mult.textContent = "x" + m.toFixed(2);
  setMultHeat(m); updateFighters(m);
  const r = ((s.events[0] && s.events[0].roundIndex) || 0) + 1;
  el.round.innerHTML = "<i>ROUND</i><b>" + r + "</b>"; setRoundFx(r);
  restoreGems(s.equipped);
  updateHud(s); unlock(s);
}

let animating = false, shownEvents = 0, roundKey = null, cashoutShown = false, lastEnded = null;
async function pump(s) {
  if (animating) return;
  animating = true; lock();
  try {
    while (shownEvents < s.events.length) {
      const ev = s.events[shownEvents];
      const from = shownEvents === 0 ? 1 : s.events[shownEvents - 1].multiplier;
      await animateFight(from, ev);
      shownEvents++;
    }
    if (s.phase === "ended" && s.payout !== undefined && !cashoutShown) { cashoutShown = true; await animateCashout(s); }
  } finally {
    animating = false; unlock(s); updateHud(s);
    if (s.phase === "ended" && !rankRefreshed) { rankRefreshed = true; addXp(s.events.length, s.payoutMult || 0); setTimeout(refreshRank, 300); }
    if (auto.on) afterAnim();
  }
}

// ---- autoplay: drive open/continue/cashout by rules ----
function autoKick() {
  if (!auto.on || animating) return;
  const s = client.state || {};
  if (s.phase === "decision") {
    if ((s.multiplier || 1) >= auto.cashAt) client.cashOut();
    else client.continue();
  } else {
    const bal = typeof s.balance === "number" ? s.balance : lastBalance;
    if (auto.stopBelow > 0 && bal < auto.stopBelow) { autoStop(); return showAutoStopped(auto.stopBelow); }
    if (currentBet > bal + 1e-9) { autoStop(); return showNoFunds(); }
    client.open(currentBet); // idle / ended -> start next round
  }
}
function showAutoStopped(limit) {
  el.status.textContent = `Autoplay stopped - balance is below ${fmtMoney(limit)}`;
}
function afterAnim() {
  if (animating) return;
  const s = client.state || {};
  if (s.phase === "ended") {
    if (autoEndSig !== s.roundId) { // count each finished round once
      autoEndSig = s.roundId;
      auto.left--; updateAutoBtn();
      const bal = typeof s.balance === "number" ? s.balance : lastBalance;
      if (auto.left <= 0 || (auto.stopBelow > 0 && bal < auto.stopBelow)) { autoStop(); return; }
    }
    setTimeout(autoKick, 650 / autoSpeed);
  } else if (s.phase === "decision") {
    setTimeout(autoKick, 280 / autoSpeed);
  }
}
function updateAutoBtn() {
  const b = $("auto-btn");
  b.classList.toggle("running", auto.on);
  b.textContent = auto.on ? "■" + (auto.left > 0 ? " " + auto.left : "") : "⚙";
  b.title = auto.on ? "Stop autoplay" : "Autoplay";
}
function autoStart(rounds, cashAt, stopBelow, speed = 1) {
  auto.on = true; auto.left = rounds; auto.cashAt = cashAt; auto.stopBelow = stopBelow; autoEndSig = null;
  autoSpeed = speed; // accelerate all animations + step delays while auto runs
  Sfx.resume();
  $("auto-modal").classList.remove("show");
  updateAutoBtn(); unlock(client.state || {});
  setTimeout(autoKick, 120);
}
function autoStop() { auto.on = false; autoSpeed = 1; updateAutoBtn(); unlock(client.state || {}); }

// --- username + connect ---
const username = (localStorage.getItem("gladiator-user") || "Player").slice(0, 24);
$("username").textContent = username;
$("username").onclick = () => {
  const u = prompt("Your name:", username);
  if (u && u.trim()) { localStorage.setItem("gladiator-user", u.trim()); location.reload(); }
};
// --- XP / level: earn XP each round, 7 levels, avatar = opponent-avatar{level} ---
// cumulative XP to REACH level 1..7. Even pace L1-L3 (100 each), then it ramps hard:
// deltas 100,100,400,900,2000,4500 → L7 needs 8000 XP (a long grind).
const LVL_XP = [0, 100, 200, 600, 1500, 3500, 8000];
const MAXLVL = 7;
const levelFor = (xp) => { let l = 1; for (let i = 1; i < LVL_XP.length; i++) if (xp >= LVL_XP[i]) l = i + 1; return Math.min(l, MAXLVL); };
// XP is per UTC day - it resets at UTC midnight, in lock-step with the Daily Arena
// leaderboard/star-pool (which the server windows to the same UTC day).
const utcDay = () => new Date().toISOString().slice(0, 10);
const xpKey = "gladiator-xp-" + username + "-" + utcDay();
let totalXp = parseInt(localStorage.getItem(xpKey) || "0", 10) || 0;
let level = levelFor(totalXp);
function setAvatarByLevel() { el.avatar.src = `${A}opponent-avatar${Math.min(level, MAXLVL)}.png`; }
function renderXp() {
  const base = LVL_XP[level - 1] ?? 0;
  const next = LVL_XP[level] ?? base;
  const pct = level >= MAXLVL ? 100 : Math.max(0, Math.min(100, ((totalXp - base) / (next - base)) * 100));
  $("xp-fill").style.width = pct.toFixed(1) + "%";
  $("lvl").textContent = level;
}
function addXp(rounds, payoutMult) {
  const gain = 5 + (rounds || 0) * 4 + Math.round((payoutMult || 0) * 3);
  totalXp += gain;
  localStorage.setItem(xpKey, String(totalXp));
  const old = level;
  level = levelFor(totalXp);
  renderXp();
  if (level > old) { // LEVEL UP - new avatar + fanfare
    if (typeof client !== "undefined") client.setLevel(level); // raise the 2-star chance
    setAvatarByLevel();
    retrigger(el.avatar, "levelup");
    const t = $("lvlup"); t.textContent = "LEVEL " + level; retrigger(t, "go");
    onPaint(() => { Sfx.tierUp(); vibe([0, 40, 60, 80]); });
  }
}
setAvatarByLevel();
renderXp();

const __isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
const __wsBase = __isLocal
  ? `ws://${location.hostname}:${PORT}`
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
const socket = reconnectingSocket(`${__wsBase}/?account=${encodeURIComponent(username)}`);
let everConnected = false;
socket.onOpen(() => { everConnected = true; $("reconnect").classList.remove("show"); });
socket.onClose(() => { if (everConnected) $("reconnect").classList.add("show"); });
const client = new GameClient(socket);
client.setLevel(level); // server uses level for the 2-star bonus chance
client.onUpdate((s) => {
  if (s.bet) roundBet = s.bet;
  if (s.roundId && s.roundId !== roundKey) {
    roundKey = s.roundId; shownEvents = 0; cashoutShown = false; rankRefreshed = false; resetStage();
    if (s.equipped) { restoreResume(s); return; } // resumed after reconnect/reload - restore instantly
  }
  if (s.phase === "ended") lastEnded = { ...s };
  // on cashout, hold the HUD totals until the win count-up plays (pump updates it after)
  const cashoutPending = s.phase === "ended" && s.payout !== undefined && !cashoutShown;
  if (!cashoutPending) updateHud(s);
  // out-of-coins: surface a clear prompt instead of a silent dead-end
  if (s.errorCode === "InsufficientFundsError") showNoFunds();
  if (s.errorCode === "deposit-required") { topupAvailable = false; showNoFunds(); }
  if (nfModal.classList.contains("show") && typeof s.balance === "number" && s.balance >= currentBet) nfModal.classList.remove("show");
  pump(s);
});

// --- Daily Arena: star total + leaderboard rank above the trophy, with credit fx ---
function renderRank() { el.points.textContent = "★ " + (dailyStars + runStars); }
// rank number under the Arena button: ticks DOWN when we climb, UP when pushed down
let shownRank = 0;
function setRankDisplay(newRank) {
  const r = $("rank-num");
  if (!newRank) { r.textContent = "#-"; shownRank = 0; return; }
  if (shownRank === 0 || newRank === shownRank) { r.textContent = "#" + newRank; shownRank = newRank; return; }
  r.classList.remove("up", "down"); void r.offsetWidth;
  r.classList.add(newRank < shownRank ? "up" : "down"); // lower number = climbed = green
  countUp(r, shownRank, newRank, 700, (v) => "#" + Math.round(v));
  shownRank = newRank;
}
async function refreshRank() {
  try {
    const st = await client.requestStandings("daily");
    const me = st.find((s) => s.account === username);
    const newStars = me ? Math.round(me.score) : 0;
    const newRank = me ? me.rank : st.length + 1;
    const gained = newStars - dailyStars;
    dailyStars = newStars; dailyRank = newRank; runStars = 0;
    renderRank();
    setRankDisplay(newRank);
    if (gained > 0) { retrigger(el.points, "credit"); onPaint(() => Sfx.coinSelect()); }
  } catch { /* offline - keep provisional */ }
}
setTimeout(refreshRank, 900); // initial rank once connected

// --- out-of-coins handling ---
const nfModal = $("nofunds-modal");
let topupAvailable = true; // flipped off if the server says deposit-required (seamless)
function showNoFunds() {
  $("nf-msg").innerHTML = `Need <b>$${currentBet}</b> to enter - your balance is <b>${fmtMoney(lastBalance)}</b>.`;
  $("nf-topup").style.display = topupAvailable ? "" : "none";
  $("nf-hint").textContent = topupAvailable ? "Demo top-up - instant." : "Add funds at the cashier to keep playing.";
  nfModal.classList.add("show");
}
$("nf-close").onclick = () => nfModal.classList.remove("show");
nfModal.onclick = (e) => { if (e.target === nfModal) nfModal.classList.remove("show"); };
$("nf-topup").onclick = () => { Sfx.click(); Sfx.resume(); client.topUp(); };

$("start").onclick = () => {
  Sfx.resume(); Sfx.click();
  if (currentBet > lastBalance + 1e-9) return showNoFunds(); // can't afford - prompt instead of a dead error
  lock(); // before the send, not after the reply: the second click of a double must find a dead button
  client.open(currentBet);
};
$("continue").onclick = () => { Sfx.click(); lock(); client.continue(); };
$("cash").onclick = () => { Sfx.click(); lock(); client.cashOut(); };
function paintChips() {
  for (const c of document.querySelectorAll("#bets .chip")) {
    const on = Number(c.dataset.bet) === currentBet;
    c.classList.toggle("active", on);
    c.setAttribute("aria-pressed", on ? "true" : "false"); // survives disabled/animation states
  }
}
for (const chip of document.querySelectorAll("#bets .chip")) {
  chip.onclick = () => {
    if ($("bets").style.opacity === "0.4") return;
    Sfx.coinSelect();
    currentBet = Number(chip.dataset.bet);
    localStorage.setItem(betKey, String(currentBet));
    paintChips();
  };
}
paintChips(); // reflect the stored stake on load, so the highlight cannot disagree with currentBet

// sound: bronze medallion icon opens a volume slider popover (0 = mute, else quieter/louder)
const muteBtn = $("mute"), muteImg = $("mute-img"), volPop = $("vol-pop"), volSlider = $("vol-slider");
const setMuteIcon = () => (muteImg.src = A + (Sfx.muted ? "btn-soundmute.png" : "btn-sound.png"));
volSlider.value = Math.round(Sfx.volume * 100);
paintVol();
setMuteIcon();
muteBtn.onclick = (e) => { e.stopPropagation(); Sfx.resume(); Sfx.toggle(); volPop.classList.toggle("show"); };
const paintVol = () => { const o = $("vol-out"); if (o) o.textContent = Math.round(Sfx.volume * 100) + "%"; };
volSlider.oninput = () => { Sfx.setVolume(volSlider.value / 100); setMuteIcon(); paintVol(); };
volSlider.onchange = () => { if (!Sfx.muted) Sfx.toggle(); };
volPop.onclick = (e) => e.stopPropagation();
document.addEventListener("click", () => volPop.classList.remove("show"));

// autoplay panel
const autoModal = $("auto-modal");
$("auto-btn").onclick = () => { Sfx.click(); if (auto.on) autoStop(); else { $("auto-rounds").value = auto.left || 10; autoModal.classList.add("show"); } };
$("auto-close").onclick = () => autoModal.classList.remove("show");
autoModal.onclick = (e) => { if (e.target === autoModal) autoModal.classList.remove("show"); };
// speed selector (×1/×2/×3) - remembered between sessions
let autoSpeedSel = Math.max(1, Math.min(3, parseInt(localStorage.getItem("gladiator-autospeed") || "1", 10) || 1));
const speedSeg = $("auto-speed");
function paintSpeed() { for (const b of speedSeg.children) b.classList.toggle("active", +b.dataset.sp === autoSpeedSel); }
for (const b of speedSeg.children) b.onclick = () => { autoSpeedSel = +b.dataset.sp; localStorage.setItem("gladiator-autospeed", String(autoSpeedSel)); paintSpeed(); Sfx.click(); };
paintSpeed();
function readAutoForm() {
  const num = (id) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : NaN; };
  const rounds = num("auto-rounds"), cashAt = num("auto-cash"), stopAt = $("auto-stop").value.trim() === "" ? 0 : num("auto-stop");
  const errs = [];
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 999) errs.push(["auto-rounds", "1-999 rounds"]);
  if (!(cashAt >= 1.01)) errs.push(["auto-cash", "at least x1.01"]);
  if (!(stopAt >= 0)) errs.push(["auto-stop", "0 or more"]);
  return { rounds, cashAt, stopAt, errs };
}
function paintAutoErrors() {
  const { errs } = readAutoForm();
  const bad = new Map(errs);
  for (const id of ["auto-rounds", "auto-cash", "auto-stop"]) {
    const field = $(id);
    field.classList.toggle("invalid", bad.has(id));
    field.setAttribute("aria-invalid", bad.has(id) ? "true" : "false");
    const hint = $(id + "-err");
    if (hint) hint.textContent = bad.get(id) || "";
  }
  $("auto-go").disabled = errs.length > 0;
}
for (const id of ["auto-rounds", "auto-cash", "auto-stop"]) $(id).addEventListener("input", paintAutoErrors);
$("auto-go").onclick = () => {
  const { rounds, cashAt, stopAt, errs } = readAutoForm();
  if (errs.length) return paintAutoErrors();
  // BUG-004: the stop-balance was only consulted after a round finished, so autoplay
  // always got one bet in even when it was already under the limit.
  if (stopAt > 0 && lastBalance < stopAt) { autoModal.classList.remove("show"); return showAutoStopped(stopAt); }
  autoStart(rounds, cashAt, stopAt, autoSpeedSel);
};
updateAutoBtn();

// --- modal (leaderboard / arena / verify) ---
const modal = $("modal");
const showModal = (title, body, html = false) => {
  $("modal-title").textContent = title;
  $("modal-body")[html ? "innerHTML" : "textContent"] = body;
  modal.classList.add("show");
};
let lbTimer = null;
const stopLbTimer = () => { if (lbTimer) { clearInterval(lbTimer); lbTimer = null; } };
const closeModal = () => { stopLbTimer(); modal.classList.remove("show"); };
$("modal-close").onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

// "5h 23m 11s" until the daily reset (the tournament window's `to` = UTC midnight)
const fmtLeft = (ms) => {
  if (ms <= 0) return "resetting…";
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`;
};
// live countdown bound to #lb-reset; self-stops when the element is gone (modal closed/replaced)
function startLbTimer(resetAt) {
  stopLbTimer();
  const tick = () => { const e = $("lb-reset"); if (!e) return stopLbTimer(); e.textContent = fmtLeft(resetAt - Date.now()); };
  tick();
  lbTimer = setInterval(tick, 1000);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const medal = (rank) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "#" + rank);
// one standings row; top 3 get the gold/silver/bronze glow (.r1/.r2/.r3)
const lbRow = (rank, name, score, prize, isMe = false) =>
  `<div class="lb-row${rank <= 3 ? " r" + rank : ""}${isMe ? " me" : ""}"><span class="lb-rank">${medal(rank)}</span>` +
  `<span class="lb-name">${esc(name)}${isMe ? ' <span class="lb-you">you</span>' : ""}</span><span class="lb-score">${score}</span>` +
  (prize !== undefined ? `<span class="lb-prize">${prize ? "$" + prize : ""}</span>` : "") + `</div>`;

$("leaders").onclick = async () => {
  const lb = await client.requestLeaderboard("biggestMultiplier");
  if (!lb.length) return showModal("🏆 Leaderboard - biggest multiplier", "(no rounds yet)");
  const rows = lb.slice(0, 8).map((e, i) => lbRow(i + 1, e.account, "x" + e.value.toFixed(2), undefined, e.account === username)).join("");
  showModal("🏆 Leaderboard - biggest multiplier", `<div class="lb">${rows}</div>`, true);
};
$("arena").onclick = async () => {
  const list = await client.requestTournaments();
  if (!list.length) return showModal("⚔️ Arena", "No active tournaments.");
  const t = list[0];
  const st = await client.requestStandings(t.id);
  const timer = `<div class="lb-timer">⏳ Resets in <b id="lb-reset"></b></div>`;
  let body;
  if (st.length) {
    let rows = st.slice(0, 8).map((s) => lbRow(s.rank, s.account, `★ ${Math.round(s.score)}`, s.prize, s.account === username)).join("");
    // if the player is below the top 8, pin their own row at the bottom so they see where they are
    const me = st.find((s) => s.account === username);
    if (me && me.rank > 8) rows += `<div class="lb-sep">· · ·</div>` + lbRow(me.rank, me.account, `★ ${Math.round(me.score)}`, me.prize, true);
    body = `<div class="lb">${rows}</div>`;
  } else {
    body = `<p class="hint" style="text-align:center">(no entries yet - play a round!)</p>`;
  }
  showModal(`⚔️ ${t.name} - pool $${t.prizePool}`, timer + body, true);
  startLbTimer(t.to); // live countdown to the UTC-midnight reset
};
$("verify").onclick = async () => {
  const s = lastEnded || client.state;
  if (!s.serverSeed) return;
  const v = await verifyRound({ serverSeed: s.serverSeed, serverSeedHash: s.serverSeedHash, clientSeed: s.clientSeed, nonce: s.nonce, bet: s.bet, events: s.events });
  showModal("🛡️ Provably fair",
    v.ok ? `<span class="verify-ok">✓ Verified.</span>\n\nEvery fight was re-derived from the revealed server seed - outcomes match exactly.\n\nserverSeed: ${s.serverSeed.slice(0, 24)}…` : `<span class="verify-bad">✗ ${v.reason}</span>`, true);
};

// --- info screens: How to Play / Paytable / Settings ---
const infoModal = $("info-modal");
$("menu").onclick = () => { Sfx.click(); infoModal.classList.add("show"); };
$("info-close").onclick = () => infoModal.classList.remove("show");
infoModal.onclick = (e) => { if (e.target === infoModal) infoModal.classList.remove("show"); };
for (const tab of document.querySelectorAll("#info-modal .tab")) {
  tab.onclick = () => {
    Sfx.click();
    document.querySelectorAll("#info-modal .tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll("#info-modal .tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== tab.dataset.tab));
  };
}
$("set-vol").value = Math.round(Sfx.volume * 100);
$("set-vol").oninput = () => { Sfx.setVolume($("set-vol").value / 100); setMuteIcon(); };
function setFx(low) {
  document.body.classList.toggle("lowfx", low);
  localStorage.setItem("gladiator-lowfx", low ? "1" : "0");
  $("fx-high").classList.toggle("active", !low);
  $("fx-low").classList.toggle("active", low);
}
$("fx-high").onclick = () => { Sfx.click(); setFx(false); };
$("fx-low").onclick = () => { Sfx.click(); setFx(true); };
setFx(LOW());
$("info-verify").onclick = async () => {
  const s = lastEnded || client.state;
  const out = $("info-verify-out");
  if (!s || !s.serverSeed) { out.textContent = "Play a round first, then verify."; return; }
  const v = await verifyRound({ serverSeed: s.serverSeed, serverSeedHash: s.serverSeedHash, clientSeed: s.clientSeed, nonce: s.nonce, bet: s.bet, events: s.events });
  out.textContent = v.ok ? "✓ Verified - outcomes match the revealed seed.\nserverSeed: " + s.serverSeed.slice(0, 24) + "…" : "✗ " + v.reason;
};
