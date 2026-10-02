import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryRecord } from "@amem/core";
import { paths } from "@amem/core";
import type { MemoryStore } from "./memory.js";

/** Bump when table layout or FTS/vec contract changes; ensure() rebuilds on mismatch. */
export const INDEX_SCHEMA_VERSION = 1;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export type EnsureResult = {
  rebuilt: boolean;
  schemaVersion: number;
  indexed?: number;
};

export class IndexStore {
  private db: DatabaseSync;

  constructor(private readonly home: string) {
    const p = paths(home).index;
    mkdirSync(dirname(p), { recursive: true });
    this.db = new DatabaseSync(p);
    this.db.exec(`PRAGMA journal_mode=WAL;`);
    this.db.exec(`PRAGMA busy_timeout=5000;`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mem (
        id TEXT PRIMARY KEY,
        kind TEXT,
        level TEXT,
        status TEXT,
        trust TEXT,
        title TEXT,
        applies_when TEXT,
        body TEXT,
        path TEXT,
        user TEXT,
        review_by TEXT
      );
      CREATE TABLE IF NOT EXISTS mem_tag (
        id TEXT,
        key TEXT,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS mem_stat (
        id TEXT PRIMARY KEY,
        recalled INT,
        adopted INT,
        helpful INT,
        harmful INT,
        lift REAL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS mem_fts USING fts5(
        id UNINDEXED, title, applies_when, body
      );
      CREATE TABLE IF NOT EXISTS mem_vec (
        id TEXT PRIMARY KEY,
        dim INT,
        vector TEXT
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  schemaVersion(): number {
    const row = this.db.prepare(`PRAGMA user_version`).get() as { user_version: number };
    return row?.user_version ?? 0;
  }

  private setSchemaVersion(version: number): void {
    this.db.exec(`PRAGMA user_version = ${version}`);
  }

  /** Test helper: simulate an older on-disk schema version. */
  forceSchemaVersion(version: number): void {
    this.setSchemaVersion(version);
  }

  isEmpty(): boolean {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM mem`).get() as { n: number };
    return (row?.n ?? 0) === 0;
  }

  rebuild(store: MemoryStore): number {
    this.db.exec("DELETE FROM mem_tag; DELETE FROM mem_stat; DELETE FROM mem; DELETE FROM mem_vec;");
    try {
      this.db.exec("DELETE FROM mem_fts;");
    } catch {
      this.db.exec(`DROP TABLE IF EXISTS mem_fts;`);
      this.db.exec(
        `CREATE VIRTUAL TABLE mem_fts USING fts5(id UNINDEXED, title, applies_when, body)`,
      );
    }
    const rows = store.listAll();
    for (const m of rows) {
      this.upsertMemory(m, store.pathFor(m));
    }
    this.setSchemaVersion(INDEX_SCHEMA_VERSION);
    return rows.length;
  }

  /**
   * Rebuild when schema version mismatches, or when the index is empty but
   * Markdown memories exist.
   */
  ensure(store: MemoryStore): EnsureResult {
    const ver = this.schemaVersion();
    const empty = this.isEmpty();
    const memoryCount = store.listAll().length;
    const versionOk = ver === INDEX_SCHEMA_VERSION;
    const needsFill = empty && memoryCount > 0;
    if (versionOk && !needsFill) {
      return { rebuilt: false, schemaVersion: ver };
    }
    const indexed = this.rebuild(store);
    return { rebuilt: true, schemaVersion: INDEX_SCHEMA_VERSION, indexed };
  }

  searchFts(query: string, limit = 20): { id: string; rank: number }[] {
    const q = query
      .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replace(/"/g, "")}"`)
      .join(" OR ");
    if (!q) return [];
    try {
      const stmt = this.db.prepare(
        `SELECT id as id, bm25(mem_fts) as rank
         FROM mem_fts
         WHERE mem_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      );
      return stmt.all(q, limit) as { id: string; rank: number }[];
    } catch {
      const stmt = this.db.prepare(
        `SELECT id, 0 as rank FROM mem
         WHERE title LIKE ? ESCAPE '\\' OR applies_when LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
         LIMIT ?`,
      );
      const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      return stmt.all(like, like, like, limit) as { id: string; rank: number }[];
    }
  }

  removeMemory(id: string): void {
    this.db.prepare(`DELETE FROM mem_tag WHERE id = ?`).run(id);
    this.db.prepare(`DELETE FROM mem_stat WHERE id = ?`).run(id);
    this.db.prepare(`DELETE FROM mem WHERE id = ?`).run(id);
    try {
      this.db.prepare(`DELETE FROM mem_fts WHERE id = ?`).run(id);
    } catch {
      /* next ensure/rebuild repairs */
    }
    try {
      this.db.prepare(`DELETE FROM mem_vec WHERE id = ?`).run(id);
    } catch {
      /* optional on pre-migration dbs */
    }
  }

  upsertMemory(m: MemoryRecord, filePath: string): void {
    this.removeMemory(m.id);
    this.db
      .prepare(
        `INSERT INTO mem(id,kind,level,status,trust,title,applies_when,body,path,user,review_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        m.id,
        m.kind,
        m.scope.level,
        m.status,
        m.trust,
        m.title,
        m.applies_when,
        m.content,
        filePath,
        m.scope.tags.user ?? null,
        m.validity.review_by ?? null,
      );
    this.db
      .prepare(`INSERT INTO mem_fts(id, title, applies_when, body) VALUES (?, ?, ?, ?)`)
      .run(m.id, m.title, m.applies_when, m.content);
    const tagIns = this.db.prepare(`INSERT INTO mem_tag(id,key,value) VALUES (?,?,?)`);
    for (const d of m.scope.tags.domains ?? []) tagIns.run(m.id, "domain", d);
    for (const t of m.scope.tags.tools ?? []) tagIns.run(m.id, "tool", t);
    if (m.scope.tags.task_type) tagIns.run(m.id, "task_type", m.scope.tags.task_type);
    for (const i of m.scope.tags.instances ?? []) tagIns.run(m.id, "instance", i);
    this.db
      .prepare(
        `INSERT INTO mem_stat(id,recalled,adopted,helpful,harmful,lift) VALUES (?,?,?,?,?,?)`,
      )
      .run(
        m.id,
        m.stats.recalled,
        m.stats.adopted,
        m.stats.helpful,
        m.stats.harmful,
        m.stats.lift,
      );
  }

  /** Persist an embedding vector (JSON float array). No-op when empty. */
  upsertEmbedding(id: string, vector: number[]): void {
    if (!vector.length) return;
    this.db.prepare(`DELETE FROM mem_vec WHERE id = ?`).run(id);
    this.db
      .prepare(`INSERT INTO mem_vec(id, dim, vector) VALUES (?,?,?)`)
      .run(id, vector.length, JSON.stringify(vector));
  }

  searchVec(query: number[], limit = 20): { id: string; score: number }[] {
    if (!query.length) return [];
    try {
      const rows = this.db.prepare(`SELECT id, vector FROM mem_vec`).all() as {
        id: string;
        vector: string;
      }[];
      const scored: { id: string; score: number }[] = [];
      for (const row of rows) {
        let v: number[];
        try {
          v = JSON.parse(row.vector) as number[];
        } catch {
          continue;
        }
        if (v.length !== query.length) continue;
        const score = cosine(query, v);
        if (score > 0) scored.push({ id: row.id, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit);
    } catch {
      return [];
    }
  }

  destroyFile(): void {
    this.close();
    const p = paths(this.home).index;
    if (existsSync(p)) unlinkSync(p);
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${p}${suffix}`;
      if (existsSync(side)) unlinkSync(side);
    }
  }
}
