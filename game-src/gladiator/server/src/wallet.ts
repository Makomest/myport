import { InsufficientFundsError } from "./errors.js";

export type LedgerKind = "debit" | "credit";

export interface LedgerEntry {
  id: number;
  account: string;
  kind: LedgerKind;
  amount: number;
  ref: string;
  idemKey: string;
  balanceAfter: number;
  ts: number;
}

// Returns are sync-or-async: in-memory/file impls are synchronous; the Postgres
// impl is async. GameService `await`s them, so both kinds work behind this type.
export interface Wallet {
  balance(account: string): number | Promise<number>;
  fund(account: string, amount: number): void | Promise<void>;
  debit(account: string, amount: number, ref: string, idemKey: string): LedgerEntry | Promise<LedgerEntry>;
  credit(account: string, amount: number, ref: string, idemKey: string): LedgerEntry | Promise<LedgerEntry>;
  ledger(account: string): LedgerEntry[] | Promise<LedgerEntry[]>;
  /**
   * Optional: reverse a prior debit (its `idemKey`) — used by the seamless wallet
   * to roll a bet back to the operator when a round fails *technically* after the
   * stake was taken (NOT on a normal loss, where the stake is correctly forfeit).
   */
  rollback?(account: string, debitIdemKey: string): void | Promise<void>;
}

/**
 * In-memory wallet with an idempotent, append-only ledger (the audit trail).
 * `idemKey` guarantees a debit/credit is applied at most once — a retried
 * request returns the original entry instead of moving money again.
 * (Swap this impl for a Postgres-backed one with the same interface later.)
 */
export class InMemoryWallet implements Wallet {
  private balances = new Map<string, number>();
  private entries: LedgerEntry[] = [];
  private idem = new Map<string, LedgerEntry>();
  private seq = 0;

  balance(account: string): number {
    return this.balances.get(account) ?? 0;
  }

  fund(account: string, amount: number): void {
    this.balances.set(account, this.balance(account) + amount);
  }

  private apply(account: string, amount: number, kind: LedgerKind, ref: string, idemKey: string): LedgerEntry {
    const cached = this.idem.get(idemKey);
    if (cached) return cached; // idempotent — never double-apply

    const cur = this.balance(account);
    const next = kind === "debit" ? cur - amount : cur + amount;
    if (kind === "debit" && next < 0) throw new InsufficientFundsError();

    this.balances.set(account, next);
    const entry: LedgerEntry = {
      id: ++this.seq, account, kind, amount, ref, idemKey, balanceAfter: next, ts: Date.now(),
    };
    this.entries.push(entry);
    this.idem.set(idemKey, entry);
    return entry;
  }

  debit(account: string, amount: number, ref: string, idemKey: string): LedgerEntry {
    return this.apply(account, amount, "debit", ref, idemKey);
  }
  credit(account: string, amount: number, ref: string, idemKey: string): LedgerEntry {
    return this.apply(account, amount, "credit", ref, idemKey);
  }
  ledger(account: string): LedgerEntry[] {
    return this.entries.filter((e) => e.account === account);
  }
}
