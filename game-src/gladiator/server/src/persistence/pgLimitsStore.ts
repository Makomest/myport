import type { Queryable } from "./pgWallet.js";
import type { PlayerLimitState } from "../responsible.js";

// Postgres player-limits store (async reference adapter; verified on pg-mem).
// State is stored as JSON text for portability (schema.sql uses jsonb in prod).
export class PgLimitsStore {
  constructor(private db: Queryable) {}

  async init(): Promise<void> {
    await this.db.query(`CREATE TABLE IF NOT EXISTS player_limits (account text PRIMARY KEY, state text NOT NULL)`);
  }

  async all(): Promise<Record<string, PlayerLimitState>> {
    const res = await this.db.query(`SELECT account, state FROM player_limits`);
    const out: Record<string, PlayerLimitState> = {};
    for (const row of res.rows) out[row.account] = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
    return out;
  }

  async set(account: string, state: PlayerLimitState): Promise<void> {
    const json = JSON.stringify(state);
    const upd = await this.db.query(`UPDATE player_limits SET state = $2 WHERE account = $1`, [account, json]);
    if (!upd.rowCount) await this.db.query(`INSERT INTO player_limits (account, state) VALUES ($1, $2)`, [account, json]);
  }
}
