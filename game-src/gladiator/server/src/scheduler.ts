import type { TournamentService, TournamentStore, TournamentResult } from "./tournaments.js";

// Scheduled auto-resolution of tournaments. A `tick()` (driven by setInterval/
// cron in prod, or called directly in tests) resolves every tournament whose
// window has closed and isn't resolved yet — idempotently — and emits an ops
// notification per newly-resolved tournament.

export interface OpsEvent {
  kind: "tournament-resolved";
  id: string;
  paid: number;
  winners: number;
  at: number;
}

export interface NotificationSink {
  notify(e: OpsEvent): void;
}

export class InMemoryNotifications implements NotificationSink {
  private events: OpsEvent[] = [];
  notify(e: OpsEvent): void {
    this.events.push(e);
  }
  recent(limit = 50): OpsEvent[] {
    return this.events.slice(-limit).reverse(); // newest first
  }
}

export class TournamentScheduler {
  constructor(
    private tournaments: TournamentService,
    private store: TournamentStore,
    private notify: NotificationSink,
    private now: () => number = Date.now,
  ) {}

  /** Resolve every tournament whose end time has passed and isn't resolved yet. */
  tick(): TournamentResult[] {
    const resolved: TournamentResult[] = [];
    for (const t of this.store.list()) {
      if (this.store.result(t.id)) continue; // already resolved — idempotent
      if (this.now() < t.to) continue; // window still open
      const r = this.tournaments.resolve(t.id);
      this.notify.notify({
        kind: "tournament-resolved",
        id: t.id,
        paid: r.paid,
        winners: r.standings.filter((s) => s.prize > 0).length,
        at: this.now(),
      });
      resolved.push(r);
    }
    return resolved;
  }
}
