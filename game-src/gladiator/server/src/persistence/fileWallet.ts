import fs from "node:fs";
import crypto from "node:crypto";
import { InsufficientFundsError } from "../errors.js";
import type { Wallet, LedgerEntry, LedgerKind } from "../wallet.js";

/**
 * Durable, event-sourced wallet backed by an append-only JSONL ledger.
 * Balance = fold over entries; idempotency = the set of seen idemKeys; both are
 * rebuilt from disk on construction, so money and audit survive a restart.
 * Production swaps this for a Postgres-backed impl behind the same `Wallet`
 * interface — the ledger-as-source-of-truth design is identical.
 */
export class FileWallet implements Wallet {
  private balances = new Map<string, number>();
  private idem = new Map<string, LedgerEntry>();
  private entries: LedgerEntry[] = [];
  private seq = 0;

  constructor(private readonly path: string) {
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.path)) return;
    for (const line of fs.readFileSync(this.path, "utf8").split("\n")) {
      if (!line) continue;
      const e = JSON.parse(line) as LedgerEntry;
      this.entries.push(e);
      this.balances.set(e.account, e.balanceAfter);
      this.idem.set(e.idemKey, e);
      if (e.id > this.seq) this.seq = e.id;
    }
  }

  private apply(account: string, amount: number, kind: LedgerKind, ref: string, idemKey: string): LedgerEntry {
    const cached = this.idem.get(idemKey);
    if (cached) return cached;

    const cur = this.balance(account);
    const next = kind === "debit" ? cur - amount : cur + amount;
    if (kind === "debit" && next < 0) throw new InsufficientFundsError();

    const entry: LedgerEntry = {
      id: ++this.seq, account, kind, amount, ref, idemKey, balanceAfter: next, ts: Date.now(),
    };
    this.balances.set(account, next);
    this.idem.set(idemKey, entry);
    this.entries.push(entry);
    fs.appendFileSync(this.path, JSON.stringify(entry) + "\n"); // durable
    return entry;
  }

  balance(account: string): number {
    return this.balances.get(account) ?? 0;
  }
  fund(account: string, amount: number): void {
    this.apply(account, amount, "credit", "fund", `fund:${crypto.randomUUID()}`);
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
