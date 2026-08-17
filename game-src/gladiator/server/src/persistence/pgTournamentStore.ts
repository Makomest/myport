import type { Queryable } from "./pgWallet.js";
import type { Tournament, TournamentResult } from "../tournaments.js";

// Postgres tournament store (async reference adapter; verified on pg-mem).
// Definitions + persisted results; JSON columns stored as text for portability.
export class PgTournamentStore {
  constructor(private db: Queryable) {}

  async init(): Promise<void> {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS tournaments (
         id text PRIMARY KEY, name text NOT NULL, from_ts bigint NOT NULL, to_ts bigint NOT NULL,
         metric text NOT NULL, prize_pool double precision NOT NULL, payout_split text NOT NULL
       )`,
    );
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS tournament_results (
         id text PRIMARY KEY, resolved_at bigint NOT NULL, paid double precision NOT NULL, standings text NOT NULL
       )`,
    );
  }

  async list(): Promise<Tournament[]> {
    const res = await this.db.query(`SELECT * FROM tournaments`);
    return res.rows.map((r) => ({
      id: r.id, name: r.name, from: Number(r.from_ts), to: Number(r.to_ts), metric: r.metric,
      prizePool: r.prize_pool, payoutSplit: typeof r.payout_split === "string" ? JSON.parse(r.payout_split) : r.payout_split,
    }));
  }

  async add(t: Tournament): Promise<void> {
    const seen = await this.db.query(`SELECT 1 FROM tournaments WHERE id = $1`, [t.id]);
    if (seen.rows[0]) return;
    await this.db.query(
      `INSERT INTO tournaments (id, name, from_ts, to_ts, metric, prize_pool, payout_split) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [t.id, t.name, t.from, t.to, t.metric, t.prizePool, JSON.stringify(t.payoutSplit)],
    );
  }

  async upsert(t: Tournament): Promise<void> {
    const upd = await this.db.query(
      `UPDATE tournaments SET name=$2, from_ts=$3, to_ts=$4, metric=$5, prize_pool=$6, payout_split=$7 WHERE id=$1`,
      [t.id, t.name, t.from, t.to, t.metric, t.prizePool, JSON.stringify(t.payoutSplit)],
    );
    if (!upd.rowCount) await this.add(t);
  }

  async result(id: string): Promise<TournamentResult | undefined> {
    const res = await this.db.query(`SELECT * FROM tournament_results WHERE id = $1`, [id]);
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      id: row.id, resolvedAt: Number(row.resolved_at), paid: row.paid,
      standings: typeof row.standings === "string" ? JSON.parse(row.standings) : row.standings,
    };
  }

  async saveResult(r: TournamentResult): Promise<void> {
    const seen = await this.db.query(`SELECT 1 FROM tournament_results WHERE id = $1`, [r.id]);
    if (seen.rows[0]) return; // resolved once
    await this.db.query(
      `INSERT INTO tournament_results (id, resolved_at, paid, standings) VALUES ($1,$2,$3,$4)`,
      [r.id, r.resolvedAt, r.paid, JSON.stringify(r.standings)],
    );
  }
}
