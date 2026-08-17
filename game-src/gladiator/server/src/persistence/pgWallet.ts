import crypto from "node:crypto";
import { InsufficientFundsError } from "../errors.js";
import type { LedgerEntry, Wallet } from "../wallet.js";

// Postgres-backed wallet: a durable, idempotent SQL ledger. This is the
// production reference adapter. Note it is ASYNC (real DBs are) — unlike the
// sync in-memory/file wallets — so adopting it means making the GameService
// wallet path async. The SQL logic here is verified headless against pg-mem.
//
// Production hardening (left as deployment concerns): wrap apply() in a
// SERIALIZABLE transaction with `SELECT ... FOR UPDATE`, and use NUMERIC(cents)
// instead of double precision for money.

/** Minimal pg-compatible client (pg.Pool / pg.Client / pg-mem all satisfy it). */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export class PgWallet implements Wallet {
  constructor(private db: Queryable) {}

  async init(): Promise<void> {
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS accounts (account text PRIMARY KEY, balance double precision NOT NULL DEFAULT 0)`,
    );
    await this.db.query(
      `CREATE TABLE IF NOT EXISTS ledger (
         id serial PRIMARY KEY,
         account text NOT NULL,
         kind text NOT NULL,
         amount double precision NOT NULL,
         ref text,
         idem_key text UNIQUE NOT NULL,
         balance_after double precision NOT NULL,
         ts bigint NOT NULL
       )`,
    );
  }

  async balance(account: string): Promise<number> {
    const r = await this.db.query(`SELECT balance FROM accounts WHERE account = $1`, [account]);
    return r.rows[0]?.balance ?? 0;
  }

  async fund(account: string, amount: number): Promise<void> {
    await this.apply(account, amount, "credit", "fund", `fund:${crypto.randomUUID()}`);
  }

  async debit(account: string, amount: number, ref: string, idemKey: string): Promise<LedgerEntry> {
    return this.apply(account, amount, "debit", ref, idemKey);
  }
  async credit(account: string, amount: number, ref: string, idemKey: string): Promise<LedgerEntry> {
    return this.apply(account, amount, "credit", ref, idemKey);
  }

  async ledger(account: string): Promise<LedgerEntry[]> {
    const r = await this.db.query(`SELECT * FROM ledger WHERE account = $1 ORDER BY id`, [account]);
    return r.rows.map(this.toEntry);
  }

  private toEntry = (row: any): LedgerEntry => ({
    id: Number(row.id), account: row.account, kind: row.kind, amount: row.amount,
    ref: row.ref, idemKey: row.idem_key, balanceAfter: row.balance_after, ts: Number(row.ts),
  });

  private async apply(account: string, amount: number, kind: "debit" | "credit", ref: string, idemKey: string): Promise<LedgerEntry> {
    const existing = await this.db.query(`SELECT * FROM ledger WHERE idem_key = $1`, [idemKey]);
    if (existing.rows[0]) return this.toEntry(existing.rows[0]); // idempotent — never double-apply

    const cur = await this.balance(account);
    const next = kind === "debit" ? cur - amount : cur + amount;
    if (kind === "debit" && next < 0) throw new InsufficientFundsError();

    const ins = await this.db.query(
      `INSERT INTO ledger (account, kind, amount, ref, idem_key, balance_after, ts)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [account, kind, amount, ref, idemKey, next, Date.now()],
    );
    const upd = await this.db.query(`UPDATE accounts SET balance = $2 WHERE account = $1`, [account, next]);
    if (!upd.rowCount) await this.db.query(`INSERT INTO accounts (account, balance) VALUES ($1, $2)`, [account, next]);

    return this.toEntry(ins.rows[0]);
  }
}
