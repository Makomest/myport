import crypto from "node:crypto";
import { ProvablyFairRng } from "gladiator-engine";

export interface SeedCommit {
  roundId: string;
  serverSeed: string; // SECRET — server-side only until the round ends
  serverSeedHash: string; // published BEFORE the round
  clientSeed: string;
  nonce: number;
}

/**
 * Provably-fair seed lifecycle: commit a hashed server seed before the round,
 * keep the secret until the round ends, then reveal it for verification.
 * `rngBytes` is injectable so tests can pin the server seed deterministically.
 */
export class SeedManager {
  private commits = new Map<string, SeedCommit>();
  private nonce = 0;

  constructor(private rngBytes: (n: number) => Buffer = (n) => crypto.randomBytes(n)) {}

  commit(clientSeed: string): SeedCommit {
    const serverSeed = this.rngBytes(32).toString("hex");
    const commit: SeedCommit = {
      roundId: crypto.randomUUID(),
      serverSeed,
      serverSeedHash: ProvablyFairRng.serverSeedHash(serverSeed),
      clientSeed: clientSeed || crypto.randomBytes(8).toString("hex"),
      nonce: this.nonce++,
    };
    this.commits.set(commit.roundId, commit);
    return commit;
  }

  get(roundId: string): SeedCommit | undefined {
    return this.commits.get(roundId);
  }
}
