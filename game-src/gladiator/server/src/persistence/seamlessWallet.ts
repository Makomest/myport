import { InsufficientFundsError } from "../errors.js";
import type { LedgerEntry, Wallet } from "../wallet.js";

// =============================================================================
//  SEAMLESS WALLET — the B2B aggregator model: the OPERATOR (casino) owns the
//  player's real balance; the game (RGS) calls the operator's wallet API in real
//  time for every bet/win. This is a `Wallet` impl, so it drops straight into
//  GameService with no game-logic changes.
//
//  Contract (game -> operator):
//    balance  — read the player's wallet
//    bet      — debit a wager (idempotent on txId; declines on insufficient funds)
//    win      — credit a payout (idempotent on txId)
//    rollback — reverse a bet (used only on a *technical* failure mid-round)
//
//  Every bet/win of one round shares a roundId so the operator can reconcile.
//  Idempotency is keyed by txId so retries (network blips) never double-charge.
// =============================================================================

export interface WalletTxn {
  account: string; // operator player id (resolved from the session token)
  amount: number;
  currency: string;
  roundId: string; // groups bet + win(s) of one game round
  txId: string; // unique per operation — the idempotency key
  gameId: string;
}

export interface WalletResult {
  balance: number; // operator balance AFTER the operation
  txId: string;
}

/** The operator's wallet API as the game sees it (HTTP impl in httpOperatorWallet.ts). */
export interface OperatorWalletApi {
  balance(account: string, currency: string): Promise<number>;
  bet(t: WalletTxn): Promise<WalletResult>;
  win(t: WalletTxn): Promise<WalletResult>;
  rollback(account: string, txId: string, roundId: string, currency: string): Promise<WalletResult>;
}

/** Operator-side decline (insufficient funds, bad token, locked wallet…). */
export class OperatorError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = "OperatorError";
  }
}

export interface SeamlessConfig {
  api: OperatorWalletApi;
  gameId: string;
  /** fixed currency, or resolve per player (e.g. from the session). */
  currency: string | ((account: string) => string);
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Adapts the operator API to the game's `Wallet`. The game calls
 * debit/credit with a ref of `"<type>:<roundId>"`; we forward txId = idemKey so
 * the operator dedupes retries. We keep a tiny in-process mirror of applied ops
 * only to know a bet's roundId for rollback (the operator is the source of truth).
 */
export class SeamlessWallet implements Wallet {
  private applied = new Map<string, { entry: LedgerEntry; roundId: string }>();

  constructor(private cfg: SeamlessConfig) {}

  private cur(account: string): string {
    return typeof this.cfg.currency === "function" ? this.cfg.currency(account) : this.cfg.currency;
  }
  private roundOf(ref: string): string {
    const i = ref.indexOf(":");
    return i >= 0 ? ref.slice(i + 1) : ref;
  }
  private entryOf(account: string, amount: number, kind: "debit" | "credit", ref: string, idemKey: string, balanceAfter: number): LedgerEntry {
    return { id: 0, account, kind, amount, ref, idemKey, balanceAfter, ts: Date.now() };
  }

  async balance(account: string): Promise<number> {
    return this.cfg.api.balance(account, this.cur(account));
  }

  fund(): never {
    throw new Error("seamless wallet: balance is owned by the operator — funding is out of scope");
  }

  async debit(account: string, amount: number, ref: string, idemKey: string): Promise<LedgerEntry> {
    const seen = this.applied.get(idemKey);
    if (seen) return seen.entry; // retried before reaching the operator
    const roundId = this.roundOf(ref);
    try {
      const r = await this.cfg.api.bet({ account, amount: round2(amount), currency: this.cur(account), roundId, txId: idemKey, gameId: this.cfg.gameId });
      const entry = this.entryOf(account, amount, "debit", ref, idemKey, r.balance);
      this.applied.set(idemKey, { entry, roundId });
      return entry;
    } catch (e) {
      // map an operator "insufficient funds" decline to the game's own error
      if (e instanceof OperatorError && /INSUFFICIENT|FUNDS|BALANCE/i.test(e.code)) throw new InsufficientFundsError();
      throw e;
    }
  }

  async credit(account: string, amount: number, ref: string, idemKey: string): Promise<LedgerEntry> {
    const seen = this.applied.get(idemKey);
    if (seen) return seen.entry;
    const roundId = this.roundOf(ref);
    const r = await this.cfg.api.win({ account, amount: round2(amount), currency: this.cur(account), roundId, txId: idemKey, gameId: this.cfg.gameId });
    const entry = this.entryOf(account, amount, "credit", ref, idemKey, r.balance);
    this.applied.set(idemKey, { entry, roundId });
    return entry;
  }

  async rollback(account: string, debitIdemKey: string): Promise<void> {
    const seen = this.applied.get(debitIdemKey);
    const roundId = seen?.roundId ?? "";
    await this.cfg.api.rollback(account, debitIdemKey, roundId, this.cur(account));
    this.applied.delete(debitIdemKey);
  }

  /** The operator owns the ledger; history comes from their reporting API. */
  ledger(): LedgerEntry[] {
    return [];
  }
}

// -----------------------------------------------------------------------------
//  Reference MOCK operator — an in-process casino wallet for local runs + tests.
//  Same idempotency/decline/rollback semantics a real operator must provide.
// -----------------------------------------------------------------------------
interface MockTxn { kind: "bet" | "win"; amount: number; account: string; roundId: string; balance: number; rolledBack: boolean }

export class MockOperatorWallet implements OperatorWalletApi {
  private bal = new Map<string, number>();
  private txns = new Map<string, MockTxn>();

  /** `seed` = starting balances per player; `latencyMs` simulates network. */
  constructor(seed: Record<string, number> = {}, public latencyMs = 0) {
    for (const [a, v] of Object.entries(seed)) this.bal.set(a, v);
  }

  private async lag(): Promise<void> { if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs)); }
  get(account: string): number { return this.bal.get(account) ?? 0; }

  async balance(account: string): Promise<number> { await this.lag(); return this.get(account); }

  async bet(t: WalletTxn): Promise<WalletResult> {
    await this.lag();
    const prior = this.txns.get(t.txId);
    if (prior) return { balance: prior.balance, txId: t.txId }; // idempotent replay
    const cur = this.get(t.account);
    if (cur < t.amount) throw new OperatorError("INSUFFICIENT_FUNDS", "operator declined: insufficient funds");
    const next = round2(cur - t.amount);
    this.bal.set(t.account, next);
    this.txns.set(t.txId, { kind: "bet", amount: t.amount, account: t.account, roundId: t.roundId, balance: next, rolledBack: false });
    return { balance: next, txId: t.txId };
  }

  async win(t: WalletTxn): Promise<WalletResult> {
    await this.lag();
    const prior = this.txns.get(t.txId);
    if (prior) return { balance: prior.balance, txId: t.txId };
    const next = round2(this.get(t.account) + t.amount);
    this.bal.set(t.account, next);
    this.txns.set(t.txId, { kind: "win", amount: t.amount, account: t.account, roundId: t.roundId, balance: next, rolledBack: false });
    return { balance: next, txId: t.txId };
  }

  async rollback(account: string, txId: string): Promise<WalletResult> {
    await this.lag();
    const orig = this.txns.get(txId);
    if (!orig || orig.rolledBack || orig.kind !== "bet") return { balance: this.get(account), txId };
    const next = round2(this.get(account) + orig.amount); // give the stake back
    this.bal.set(account, next);
    orig.rolledBack = true;
    return { balance: next, txId };
  }
}
