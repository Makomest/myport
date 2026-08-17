// Durable wallet + audit: idempotency, insufficient-funds, restart durability,
// and one full round writing an audit record (with provably-fair seeds).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileWallet } from "../dist/persistence/fileWallet.js";
import { FileAudit } from "../dist/persistence/fileAudit.js";
import { ResponsibleGaming } from "../dist/responsible.js";
import { SeedManager } from "../dist/seeds.js";
import { GameService } from "../dist/gameService.js";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); console.log("  ✓", m); n++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glad-"));
const wPath = path.join(dir, "ledger.jsonl");
const aPath = path.join(dir, "audit.jsonl");

console.log("=".repeat(64));
console.log("  PERSISTENCE & AUDIT — durable file-backed stores");
console.log("=".repeat(64));

// idempotency + insufficient funds
{
  const w = new FileWallet(wPath);
  w.fund("p", 100);
  w.debit("p", 30, "bet", "k1");
  w.debit("p", 30, "bet", "k1"); // retry same key
  ok(w.balance("p") === 70, "idempotent debit: retry does not double-charge");
  assert.throws(() => w.debit("p", 1000, "bet", "k2"), /insufficient/);
  ok(w.balance("p") === 70, "insufficient funds rejected; balance intact");
}

// durability across restart (a fresh instance rebuilds state from disk)
{
  const w2 = new FileWallet(wPath);
  ok(w2.balance("p") === 70, "balance survives restart (rebuilt from disk)");
  ok(w2.ledger("p").length >= 2, "ledger persisted to disk");
  w2.debit("p", 30, "bet", "k1"); // same key as before the restart
  ok(w2.balance("p") === 70, "idempotency set survives restart");
}

// full round via GameService -> durable wallet + audit record carrying seeds
{
  const w = new FileWallet(path.join(dir, "hero.jsonl"));
  w.fund("hero", 1000);
  const audit = new FileAudit(aPath);
  const seeds = new SeedManager((len) => Buffer.alloc(len, 0x2a));
  const svc = new GameService(w, new ResponsibleGaming(), seeds, undefined, audit);

  const open = await svc.openRound("hero", 50, "hero-seed", "open-hero");
  let last = open.event;
  let ended = open.ended;
  while (!ended) {
    if (last.multiplier >= 1.4) { await svc.cashOut(open.roundId, "cash-hero"); break; }
    const f = await svc.continueRound(open.roundId);
    last = f.event;
    ended = f.ended;
  }
  ok(w.balance("hero") !== 1000, "stake moved through the durable wallet");

  const recs = new FileAudit(aPath).all(); // re-read from disk
  ok(recs.length === 1, "exactly one audit record written for the round");
  ok(recs[0].serverSeed.length === 64 && recs[0].serverSeedHash.length === 64, "audit record carries provably-fair seeds");
  ok(recs[0].roundId === open.roundId && typeof recs[0].busted === "boolean", "audit record carries the round outcome");
}

console.log("=".repeat(64));
console.log(`  RESULT: ✓ ALL ${n} CHECKS PASSED`);
console.log("=".repeat(64));
fs.rmSync(dir, { recursive: true, force: true });
