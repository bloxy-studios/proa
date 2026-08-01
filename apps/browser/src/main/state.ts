import { join } from "node:path";
import Database from "better-sqlite3";
import type { GrantKey, LedgerEntry, LedgerStore, LedgerFilter } from "@proa/permissions";

/**
 * SQLite (WAL) local state: history, Spaces, grants, and the audit ledger. Scoped to the
 * app / main process (ADR-0004). Nothing leaves the machine.
 */
export class AppState implements LedgerStore {
  private db: Database.Database;

  constructor(userDataDir: string) {
    this.db = new Database(join(userDataDir, "proa.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, gradient TEXT NOT NULL, partition TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, title TEXT, space_id TEXT,
        visited_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS grants (
        agent TEXT, capability TEXT, domain TEXT, space TEXT,
        PRIMARY KEY (agent, capability, domain, space)
      );
      CREATE TABLE IF NOT EXISTS ledger (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, agent TEXT, space TEXT, domain TEXT,
        tool TEXT, capability TEXT, decision TEXT, remembered INTEGER, irreversible TEXT,
        target TEXT, reason TEXT
      );
      CREATE TABLE IF NOT EXISTS trace_index (
        trace_id TEXT PRIMARY KEY, task TEXT, provider TEXT, engine TEXT, created_at TEXT, path TEXT
      );
    `);
  }

  // ---- Spaces ---------------------------------------------------------------
  listSpaces(): { id: string; name: string; gradient: string; partition: string }[] {
    return this.db.prepare("SELECT id, name, gradient, partition FROM spaces ORDER BY created_at").all() as never;
  }
  addSpace(s: { id: string; name: string; gradient: string; partition: string }): void {
    this.db
      .prepare("INSERT OR REPLACE INTO spaces (id, name, gradient, partition, created_at) VALUES (?,?,?,?,?)")
      .run(s.id, s.name, s.gradient, s.partition, new Date().toISOString());
  }

  // ---- History --------------------------------------------------------------
  addHistory(url: string, title: string, spaceId: string): void {
    this.db
      .prepare("INSERT INTO history (url, title, space_id, visited_at) VALUES (?,?,?,?)")
      .run(url, title, spaceId, new Date().toISOString());
  }
  searchHistory(query: string, limit = 20): { url: string; title: string; visitedAt: string }[] {
    const rows = this.db
      .prepare("SELECT url, title, visited_at as visitedAt FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY id DESC LIMIT ?")
      .all(`%${query}%`, `%${query}%`, limit);
    return rows as never;
  }

  // ---- Trace index ----------------------------------------------------------
  indexTrace(t: { traceId: string; task: string; provider: string; engine: string; createdAt: string; path: string }): void {
    this.db
      .prepare("INSERT OR REPLACE INTO trace_index (trace_id, task, provider, engine, created_at, path) VALUES (?,?,?,?,?,?)")
      .run(t.traceId, t.task, t.provider, t.engine, t.createdAt, t.path);
  }

  // ---- LedgerStore implementation ------------------------------------------
  append(entry: Omit<LedgerEntry, "seq" | "ts"> & { ts?: string }): LedgerEntry {
    const ts = entry.ts ?? new Date().toISOString();
    const info = this.db
      .prepare(
        "INSERT INTO ledger (ts, agent, space, domain, tool, capability, decision, remembered, irreversible, target, reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        ts,
        entry.agent,
        entry.space,
        entry.domain,
        entry.tool,
        entry.capability,
        entry.decision,
        entry.remembered ? 1 : 0,
        entry.irreversible ?? null,
        entry.target ?? null,
        entry.reason,
      );
    return { ...entry, ts, seq: Number(info.lastInsertRowid) };
  }

  list(filter?: LedgerFilter): LedgerEntry[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter?.agent) {
      clauses.push("agent = ?");
      params.push(filter.agent);
    }
    if (filter?.space) {
      clauses.push("space = ?");
      params.push(filter.space);
    }
    if (filter?.domain) {
      clauses.push("domain = ?");
      params.push(filter.domain);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT seq, ts, agent, space, domain, tool, capability, decision, remembered, irreversible, target, reason FROM ledger ${where} ORDER BY seq`)
      .all(...params) as (Omit<LedgerEntry, "remembered"> & { remembered: number })[];
    return rows.map((r) => ({ ...r, remembered: !!r.remembered })) as LedgerEntry[];
  }

  hasGrant(key: GrantKey): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM grants WHERE agent=? AND capability=? AND domain=? AND space=?")
      .get(key.agent, key.capability, key.domain, key.space);
    return !!row;
  }
  grant(key: GrantKey): void {
    this.db
      .prepare("INSERT OR IGNORE INTO grants (agent, capability, domain, space) VALUES (?,?,?,?)")
      .run(key.agent, key.capability, key.domain, key.space);
  }
  revoke(key: GrantKey): void {
    this.db
      .prepare("DELETE FROM grants WHERE agent=? AND capability=? AND domain=? AND space=?")
      .run(key.agent, key.capability, key.domain, key.space);
  }
  grants(): GrantKey[] {
    return this.db.prepare("SELECT agent, capability, domain, space FROM grants").all() as never;
  }

  close(): void {
    this.db.close();
  }
}
