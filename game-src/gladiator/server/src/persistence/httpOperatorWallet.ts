import crypto from "node:crypto";
import { OperatorError, type OperatorWalletApi, type WalletResult, type WalletTxn } from "./seamlessWallet.js";

// HTTP implementation of the operator wallet API. Each call is HMAC-SHA256 signed
// over `timestamp.body` (the operator verifies it), times out, and — because
// bet/win/rollback are idempotent on txId — retries safely on transient network
// errors. Money is sent in MINOR units (cents) on the wire, a common operator
// convention; balances come back in minor units too and are converted to major.

export interface HttpOperatorConfig {
  baseUrl: string; // e.g. https://operator.example/wallet
  apiKey: string; // identifies this game/studio
  secret: string; // HMAC signing secret (shared with the operator)
  timeoutMs?: number; // per-request timeout (default 4000)
  retries?: number; // transient-failure retries for idempotent calls (default 2)
  minorUnits?: number; // 100 => cents (default 100)
}

interface Endpoints { balance: string; bet: string; win: string; rollback: string }

export class HttpOperatorWallet implements OperatorWalletApi {
  private ep: Endpoints;
  private timeout: number;
  private retries: number;
  private scale: number;

  constructor(private cfg: HttpOperatorConfig) {
    const b = cfg.baseUrl.replace(/\/$/, "");
    this.ep = { balance: `${b}/balance`, bet: `${b}/bet`, win: `${b}/win`, rollback: `${b}/rollback` };
    this.timeout = cfg.timeoutMs ?? 4000;
    this.retries = cfg.retries ?? 2;
    this.scale = cfg.minorUnits ?? 100;
  }

  private toMinor(x: number): number { return Math.round(x * this.scale); }
  private toMajor(x: number): number { return x / this.scale; }

  private sign(ts: string, body: string): string {
    return crypto.createHmac("sha256", this.cfg.secret).update(`${ts}.${body}`).digest("hex");
  }

  /** POST signed JSON; retries idempotent calls on network/5xx; never on a 4xx decline. */
  private async post(url: string, payload: unknown, idempotent: boolean): Promise<any> {
    const body = JSON.stringify(payload);
    let lastErr: unknown;
    for (let attempt = 0; attempt <= (idempotent ? this.retries : 0); attempt++) {
      const ts = Date.now().toString();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeout);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.cfg.apiKey,
            "x-timestamp": ts,
            "x-signature": this.sign(ts, body),
          },
          body,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        const text = await res.text();
        const json = text ? JSON.parse(text) : {};
        if (res.status >= 400) {
          // operator decline (4xx) is final; 5xx is transient and retried
          if (res.status < 500) throw new OperatorError(json.code ?? `HTTP_${res.status}`, json.message);
          lastErr = new OperatorError(json.code ?? `HTTP_${res.status}`, json.message);
          continue;
        }
        return json;
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof OperatorError && !/HTTP_5/.test(e.code)) throw e; // final decline
        lastErr = e; // network/timeout — retry if idempotent
      }
    }
    throw lastErr instanceof Error ? lastErr : new OperatorError("OPERATOR_UNREACHABLE", String(lastErr));
  }

  async balance(account: string, currency: string): Promise<number> {
    const r = await this.post(this.ep.balance, { account, currency }, true);
    return this.toMajor(r.balance ?? 0);
  }

  async bet(t: WalletTxn): Promise<WalletResult> {
    const r = await this.post(this.ep.bet, { ...t, amount: this.toMinor(t.amount) }, true);
    return { balance: this.toMajor(r.balance ?? 0), txId: r.txId ?? t.txId };
  }

  async win(t: WalletTxn): Promise<WalletResult> {
    const r = await this.post(this.ep.win, { ...t, amount: this.toMinor(t.amount) }, true);
    return { balance: this.toMajor(r.balance ?? 0), txId: r.txId ?? t.txId };
  }

  async rollback(account: string, txId: string, roundId: string, currency: string): Promise<WalletResult> {
    const r = await this.post(this.ep.rollback, { account, txId, roundId, currency }, true);
    return { balance: this.toMajor(r.balance ?? 0), txId: r.txId ?? txId };
  }
}
