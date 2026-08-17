import fs from "node:fs";
import type { AuditSink, AuditSource, AuditRecord } from "../audit.js";

/** Append-only JSONL audit log. Swap for a Postgres/warehouse sink in prod. */
export class FileAudit implements AuditSink, AuditSource {
  constructor(private readonly path: string) {}

  record(r: AuditRecord): void {
    fs.appendFileSync(this.path, JSON.stringify(r) + "\n");
  }

  all(): AuditRecord[] {
    if (!fs.existsSync(this.path)) return [];
    return fs
      .readFileSync(this.path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AuditRecord);
  }
}
