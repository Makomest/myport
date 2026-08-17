import type { Queryable } from "./pgWallet.js";
import type { AuditRecord } from "../audit.js";

// Postgres audit log (async reference adapter; verified on pg-mem). Same role as
// FileAudit/InMemoryAudit but durable in SQL. Async — so wiring it into the
// (sync) MetaService/Seasons/Fraud sources is part of the async-storage migration.
export class PgAudit {
  constructor(private db: Queryable) {}

  async init(): Promise<void> {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS audit (
         round_id text PRIMARY KEY, account text NOT NULL, bet double precision NOT NULL,
         server_seed_hash text NOT NULL, server_seed text NOT NULL, client_seed text NOT NULL,
         nonce bigint NOT NULL, rounds int NOT NULL, payout_mult double precision NOT NULL,
         payout double precision NOT NULL, busted boolean NOT NULL, ts bigint NOT NULL,
         stars int NOT NULL DEFAULT 0
       )`,
    );
    // migrate pre-stars tables in place (no-op when the column already exists)
    try { await this.db.query(`ALTER TABLE audit ADD COLUMN IF NOT EXISTS stars int NOT NULL DEFAULT 0`); } catch { /* pg-mem may not support it; CREATE above covers fresh DBs */ }
  }

  async record(r: AuditRecord): Promise<void> {
    const seen = await this.db.query(`SELECT 1 FROM audit WHERE round_id = $1`, [r.roundId]);
    if (seen.rows[0]) return; // one immutable row per round
    await this.db.query(
      `INSERT INTO audit (round_id, account, bet, server_seed_hash, server_seed, client_seed, nonce, rounds, payout_mult, payout, busted, ts, stars)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [r.roundId, r.account, r.bet, r.serverSeedHash, r.serverSeed, r.clientSeed, r.nonce, r.rounds, r.payoutMult, r.payout, r.busted, r.ts, r.stars ?? 0],
    );
  }

  async all(): Promise<AuditRecord[]> {
    const res = await this.db.query(`SELECT * FROM audit ORDER BY ts, round_id`);
    return res.rows.map((row) => ({
      roundId: row.round_id, account: row.account, bet: row.bet,
      serverSeedHash: row.server_seed_hash, serverSeed: row.server_seed, clientSeed: row.client_seed,
      nonce: Number(row.nonce), rounds: Number(row.rounds), payoutMult: row.payout_mult,
      payout: row.payout, busted: row.busted, ts: Number(row.ts), stars: Number(row.stars ?? 0),
    }));
  }
}
