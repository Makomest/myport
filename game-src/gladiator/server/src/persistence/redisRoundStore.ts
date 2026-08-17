import type { RoundDescriptor, RoundStore } from "./roundStore.js";

// Redis-backed round store: in-progress rounds (and open/cashout idempotency)
// live in Redis, shared by every server instance — so a player can hit any node
// (no sticky sessions) and resume/continue/cashout their live round. Abandoned
// rounds expire by TTL. Money is never stored here; only the reproducible
// descriptor (seed + fights-played + stars).

/** Minimal client surface (node-redis v4 / ioredis both satisfy it). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** NX + PX are used for the per-account lock; node-redis v4 option names. */
  set(key: string, value: string, opts?: { EX?: number; PX?: number; NX?: boolean }): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
}

export class RedisRoundStore implements RoundStore {
  constructor(
    private redis: RedisLike,
    private ttlSeconds = 6 * 3600, // an abandoned round self-expires
    private prefix = "gl:",
  ) {}

  private kRound(id: string) { return `${this.prefix}round:${id}`; }
  private kAcct(a: string) { return `${this.prefix}acct:${a}`; }
  private kIdem(k: string) { return `${this.prefix}idem:${k}`; }
  private kLock(k: string) { return `${this.prefix}lock:${k}`; }

  async save(d: RoundDescriptor): Promise<void> {
    const json = JSON.stringify(d);
    await this.redis.set(this.kRound(d.roundId), json, { EX: this.ttlSeconds });
    await this.redis.set(this.kAcct(d.account), d.roundId, { EX: this.ttlSeconds });
  }

  async load(roundId: string): Promise<RoundDescriptor | null> {
    const v = await this.redis.get(this.kRound(roundId));
    return v ? (JSON.parse(v) as RoundDescriptor) : null;
  }

  async byAccount(account: string): Promise<RoundDescriptor | null> {
    const id = await this.redis.get(this.kAcct(account));
    return id ? this.load(id) : null;
  }

  async remove(roundId: string, account: string): Promise<void> {
    await this.redis.del([this.kRound(roundId), this.kAcct(account)]);
  }

  async getIdem(key: string): Promise<string | null> {
    return this.redis.get(this.kIdem(key));
  }
  async setIdem(key: string, value: string): Promise<void> {
    await this.redis.set(this.kIdem(key), value, { EX: this.ttlSeconds });
  }

  /** SET NX PX — the whole fleet contends for the same key, so the lock spans instances. */
  async lock(key: string, ttlMs: number): Promise<boolean> {
    const res = await this.redis.set(this.kLock(key), "1", { NX: true, PX: ttlMs });
    return res !== null;
  }
  async unlock(key: string): Promise<void> {
    await this.redis.del(this.kLock(key));
  }
}
