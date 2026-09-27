import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { MemoryRecord } from "@amem/core";
import { paths } from "@amem/core";
import { MemoryStore } from "./memory.js";

export class IndexStore {
  private db: DatabaseSync;

  constructor(private readonly home: string) {
    const p = paths(home).index;
    mkdirSync(dirname(p), { recursive: true });
    this.db = new DatabaseSync(p);
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
    `);
  }

  close(): void {
    this.db.close();
  }

  rebuild(store = new MemoryStore(this.home)): number {
    this.db.exec("DELETE FROM mem_tag; DELETE FROM mem_stat; DELETE FROM mem;");
    try {
      this.db.exec("DELETE FROM mem_fts;");
    } catch {
      /* ignore */
    }
    const rows = store.listAll();
    const insert = this.db.prepare(
      `INSERT INTO mem(id,kind,level,status,trust,title,applies_when,body,path,user,review_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const tagIns = this.db.prepare(`INSERT INTO mem_tag(id,key,value) VALUES (?,?,?)`);
    const statIns = this.db.prepare(
      `INSERT INTO mem_stat(id,recalled,adopted,helpful,harmful,lift) VALUES (?,?,?,?,?,?)`,
    );
    const ftsIns = this.db.prepare(
      `INSERT INTO mem_fts(id, title, applies_when, body) VALUES (?, ?, ?, ?)`,
    );
    for (const m of rows) {
      insert.run(
        m.id,
        m.kind,
        m.scope.level,
        m.status,
        m.trust,
        m.title,
        m.applies_when,
        m.content,
        store.pathFor(m),
        m.scope.tags.user ?? null,
        m.validity.review_by ?? null,
      );
      ftsIns.run(m.id, m.title, m.applies_when, m.content);
      for (const d of m.scope.tags.domains ?? []) tagIns.run(m.id, "domain", d);
      for (const t of m.scope.tags.tools ?? []) tagIns.run(m.id, "tool", t);
      if (m.scope.tags.task_type) tagIns.run(m.id, "task_type", m.scope.tags.task_type);
      for (const i of m.scope.tags.instances ?? []) tagIns.run(m.id, "instance", i);
      statIns.run(
        m.id,
        m.stats.recalled,
        m.stats.adopted,
        m.stats.helpful,
        m.stats.harmful,
        m.stats.lift,
      );
    }
    return rows.length;
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
         WHERE title LIKE ? OR applies_when LIKE ? OR body LIKE ?
         LIMIT ?`,
      );
      const like = `%${query}%`;
      return stmt.all(like, like, like, limit) as { id: string; rank: number }[];
    }
  }

  upsertMemory(m: MemoryRecord, filePath: string): void {
    this.db.prepare(`DELETE FROM mem_tag WHERE id = ?`).run(m.id);
    this.db.prepare(`DELETE FROM mem WHERE id = ?`).run(m.id);
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
    // simplistic: full rebuild of fts for small corpora is ok in tests
  }

  destroyFile(): void {
    this.close();
    const p = paths(this.home).index;
    if (existsSync(p)) unlinkSync(p);
  }
}
