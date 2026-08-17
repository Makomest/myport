import type { SeedCommit } from "../seeds.js";

// =============================================================================
//  ROUND STORE — makes in-progress rounds STATELESS so the game scales across
//  instances with no sticky sessions. A round is fully reproducible from its
//  provably-fair seed, so we persist only a tiny descriptor; any instance
//  reconstructs the live engine round by replaying it forward (exactly what the
//  client-side verifier does). When backed by Redis the round survives a
//  reconnect to a *different* server.
// =============================================================================

export interface RoundDescriptor {
  roundId: string;
  account: string;
  bet: number;
  commit: SeedCommit;
  fightsPlayed: number; // start() + continue()×(n-1) replays back to this state
  stars: number;
}

export interface RoundStore {
  /** upsert the active round + the account->round index. */
  save(d: RoundDescriptor): Promise<void> | void;
  load(roundId: string): Promise<RoundDescriptor | null> | RoundDescriptor | null;
  /** the account's single active round (for resume). */
  byAccount(account: string): Promise<RoundDescriptor | null> | RoundDescriptor | null;
  remove(roundId: string, account: string): Promise<void> | void;
  /** cross-instance operation idempotency (open/cashout results). */
  getIdem(key: string): Promise<string | null> | string | null;
  setIdem(key: string, value: string): Promise<void> | void;
  /**
   * Best-effort mutual exclusion, used to serialise the money path per account.
   * Returns false when someone else holds the lock. The ttl bounds a crashed
   * holder, so a lost unlock cannot wedge a player out of their own game.
   */
  lock(key: string, ttlMs: number): Promise<boolean> | boolean;
  unlock(key: string): Promise<void> | void;
}

/** Default: per-process. Behaves exactly like the old in-memory maps. */
export class InMemoryRoundStore implements RoundStore {
  private rounds = new Map<string, RoundDescriptor>();
  private byAcc = new Map<string, string>();
  private idem = new Map<string, string>();
  private locks = new Map<string, number>(); // key -> expiry (epoch ms)

  save(d: RoundDescriptor): void {
    this.rounds.set(d.roundId, d);
    this.byAcc.set(d.account, d.roundId);
  }
  load(roundId: string): RoundDescriptor | null {
    return this.rounds.get(roundId) ?? null;
  }
  byAccount(account: string): RoundDescriptor | null {
    const id = this.byAcc.get(account);
    return id ? this.rounds.get(id) ?? null : null;
  }
  remove(roundId: string, account: string): void {
    this.rounds.delete(roundId);
    if (this.byAcc.get(account) === roundId) this.byAcc.delete(account);
  }
  getIdem(key: string): string | null {
    return this.idem.get(key) ?? null;
  }
  setIdem(key: string, value: string): void {
    this.idem.set(key, value);
  }
  lock(key: string, ttlMs: number): boolean {
    const now = Date.now();
    const held = this.locks.get(key);
    if (held !== undefined && held > now) return false;
    this.locks.set(key, now + ttlMs);
    return true;
  }
  unlock(key: string): void {
    this.locks.delete(key);
  }
}
