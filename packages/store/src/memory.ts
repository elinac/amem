import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import matter from "gray-matter";
import {
  type MemoryRecord,
  MemoryFrontmatterSchema,
  assertWritableMemory,
  memoryPath,
  paths,
} from "@amem/core";

export class MemoryStore {
  constructor(private readonly home: string) {}

  pathFor(m: Pick<MemoryRecord, "id" | "kind" | "scope">): string {
    return memoryPath(this.home, m.scope.level, m.kind, m.id);
  }

  write(
    record: MemoryRecord,
    source: "pipeline" | "human" | "agent-note" = "pipeline",
  ): string {
    assertWritableMemory(record, source);
    const fm = MemoryFrontmatterSchema.parse({
      id: record.id,
      kind: record.kind,
      title: record.title,
      applies_when: record.applies_when,
      not_applies_when: record.not_applies_when,
      scope: record.scope,
      trust: record.trust,
      status: record.status,
      evidence: record.evidence,
      stats: record.stats,
      validity: record.validity,
      supersedes: record.supersedes ?? null,
      created_by: record.created_by,
      updated_at: record.updated_at,
    });
    const p = this.pathFor(record);
    mkdirSync(dirname(p), { recursive: true });
    const data = JSON.parse(JSON.stringify(fm)) as Record<string, unknown>;
    const body = matter.stringify(record.content.trim() + "\n", data);
    writeFileSync(p, body);
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
    return true;
  }
}
