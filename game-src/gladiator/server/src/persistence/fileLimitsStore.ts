import fs from "node:fs";
import type { LimitsStore, PlayerLimitState } from "../responsible.js";

/** Durable player-limits store (single JSON file). Swap for Postgres in prod. */
export class FileLimitsStore implements LimitsStore {
  private map: Record<string, PlayerLimitState> = {};

  constructor(private readonly path: string) {
    if (fs.existsSync(path)) this.map = JSON.parse(fs.readFileSync(path, "utf8")) as Record<string, PlayerLimitState>;
  }

  all(): Record<string, PlayerLimitState> {
    return { ...this.map };
  }
  set(account: string, state: PlayerLimitState): void {
    this.map[account] = state;
    fs.writeFileSync(this.path, JSON.stringify(this.map));
  }
}
