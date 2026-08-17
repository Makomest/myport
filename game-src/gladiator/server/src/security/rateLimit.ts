// Rate limiting to keep a single socket (or a flooding IP) from overwhelming the
// server. Two layers:
//   • TokenBucket — per-connection message rate (steady rate + small burst).
//   • ConnectionLimiter — new connections per IP in a sliding window.
// Pure, dependency-free, and easy to unit-test.

export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private capacity = 30, // burst
    private refillPerSec = 15, // sustained messages/sec
    private now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }
  /** consume 1 token; returns false if the bucket is empty (rate exceeded). */
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class ConnectionLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max = 30, // max new connections
    private windowMs = 10_000, // per IP per window
    private now: () => number = Date.now,
  ) {}
  /** record a connection attempt from `ip`; returns false if over the limit. */
  allow(ip: string): boolean {
    const t = this.now();
    const arr = (this.hits.get(ip) ?? []).filter((ts) => t - ts < this.windowMs);
    arr.push(t);
    this.hits.set(ip, arr);
    if (this.hits.size > 10_000) this.gc(t); // bound memory under churn
    return arr.length <= this.max;
  }
  private gc(t: number): void {
    for (const [ip, arr] of this.hits) {
      const kept = arr.filter((ts) => t - ts < this.windowMs);
      if (kept.length === 0) this.hits.delete(ip);
      else this.hits.set(ip, kept);
    }
  }
}
