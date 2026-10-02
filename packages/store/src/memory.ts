import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  MemoryFrontmatterSchema,
  type MemoryRecord,
  assertWritableMemory,
  atomicWriteText,
  memoryPath,
  paths,
} from "@amem/core";
import matter from "gray-matter";
import { crashHooks } from "./crash-hooks.js";
import { scheduleEmbed } from "./embed-provider.js";
import { serializeMemoryRecord } from "./serialize.js";
import { dropMemoryIndex, syncMemoryIndex } from "./sync.js";

export class MemoryStore {
  constructor(private readonly home: string) {}

  pathFor(m: Pick<MemoryRecord, "id" | "kind" | "scope">): string {
    return memoryPath(this.home, m.scope.level, m.kind, m.id);
  }

  write(record: MemoryRecord, source: "pipeline" | "human" | "agent-note" = "pipeline"): string {
    assertWritableMemory(record, source);
    const p = this.persist(record);
    syncMemoryIndex(this.home, record, p);
    scheduleEmbed(this.home, record);
    return p;
  }

  /**
   * Usage counter only: bypasses writer invariants (content/trust are unchanged)
   * and keeps `updated_at`. Returns how many distinct memories were bumped.
   */
  recordRecalled(ids: Iterable<string>): number {
    const wanted = new Set(ids);
    if (wanted.size === 0) return 0;
    let n = 0;
    for (const m of this.listAll()) {
      if (!wanted.has(m.id)) continue;
      m.stats.recalled += 1;
      const p = this.persist(m);
      syncMemoryIndex(this.home, m, p);
      n += 1;
    }
    return n;
  }

  /**
   * Write Markdown only (no index sync). For conflict journal coordinators
   * that must reach markdown_committed before indexing.
   */
  persistMarkdownOnly(
    record: MemoryRecord,
    source: "pipeline" | "human" | "agent-note" = "human",
  ): string {
    assertWritableMemory(record, source);
    return this.persist(record);
  }

  private persist(record: MemoryRecord): string {
    const p = this.pathFor(record);
    mkdirSync(dirname(p), { recursive: true });
    atomicWriteText(p, serializeMemoryRecord(record));
    return p;
  }

  read(filePath: string): MemoryRecord {
    const raw = readFileSync(filePath, "utf8");
    const { data, content } = matter(raw);
    const fm = MemoryFrontmatterSchema.parse(data);
    return { ...fm, content: content.trim() };
  }

  readById(id: string): MemoryRecord | null {
    const all = this.listAll();
    return all.find((m) => m.id === id) ?? null;
  }

  listAll(): MemoryRecord[] {
    const root = paths(this.home).memories;
    if (!existsSync(root)) return [];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const name of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, name.name);
        if (name.isDirectory()) walk(p);
        else if (name.name.endsWith(".md")) files.push(p);
      }
    };
    walk(root);
    return files.map((f) => this.read(f));
  }

  forget(id: string): boolean {
    const all = this.listAll();
    const hit = all.find((m) => m.id === id);
    if (!hit) return false;
    rmSync(this.pathFor(hit), { force: true });
    crashHooks().afterForgetRm?.({ id });
    dropMemoryIndex(this.home, id);
    return true;
  }

  /**
   * Write record; if the same id already exists at a different path
   * (e.g. level promotion), write the new path first then remove the old path.
   */
  upsert(record: MemoryRecord, source: "pipeline" | "human" | "agent-note" = "pipeline"): string {
    const oldPaths = this.listAll()
      .filter((m) => m.id === record.id)
      .map((m) => this.pathFor(m));
    const newPath = this.write(record, source);
    crashHooks().afterUpsertWrite?.({ id: record.id, newPath, oldPaths });
    for (const old of oldPaths) {
      if (old !== newPath && existsSync(old)) {
        rmSync(old, { force: true });
      }
    }
    return newPath;
  }
}
