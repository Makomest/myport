// Compliance audit trail: one immutable record per settled round, including the
// provably-fair seeds so any round can be independently re-verified.

export interface AuditRecord {
  roundId: string;
  account: string;
  bet: number;
  serverSeedHash: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  rounds: number;
  payoutMult: number;
  payout: number;
  busted: boolean;
  ts: number;
  /** consolation stars earned this round (the Daily Arena metric). */
  stars?: number;
}

export interface AuditSink {
  record(r: AuditRecord): void;
}

/** Read side for the meta layer (history / leaderboards / stats). */
export interface AuditSource {
  all(): AuditRecord[];
}

/** No-op sink (default) for when auditing isn't wired in. */
export class NullAudit implements AuditSink {
  record(): void {}
}

/** In-memory audit usable as both sink and query source (tests + live meta). */
export class InMemoryAudit implements AuditSink, AuditSource {
  private records: AuditRecord[] = [];
  record(r: AuditRecord): void {
    this.records.push(r);
  }
  all(): AuditRecord[] {
    return this.records.slice();
  }
}
