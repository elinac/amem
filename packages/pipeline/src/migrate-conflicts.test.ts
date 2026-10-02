import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryRecord } from "@amem/core";
import { MemoryStore } from "@amem/store";
import { describe, expect, it } from "vitest";
import { migrateConflicts, readMigrateReport } from "./migrate-conflicts.js";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "amem-mig-"));
}

function mem(id: string, content: string, status: MemoryRecord["status"] = "active"): MemoryRecord {
  return {
    id,
    kind: "procedure",
    title: "t",
    content,
    applies_when: "w",
    scope: { level: "instance", tags: { user: "u" } },
    trust: "T3",
    status,
    evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    created_by: "t",
    updated_at: "2026-01-01T00:00:00.000Z",
    conflicts_with: [],
  };
}

describe("migrateConflicts", () => {
  it("links body markers via journal", () => {
    const home = tmpHome();
    const store = new MemoryStore(home);
    store.write(mem("mem_a", "body\n⚠ conflicts with mem_b\n"), "human");
    store.write(mem("mem_b", "other"), "human");
    const r = migrateConflicts(home, { dryRun: false, actor: { kind: "cli", os_user: "u" } });
    expect(r.linked).toBe(1);
    expect(store.readById("mem_a")?.status).toBe("conflict");
    expect(store.readById("mem_b")?.status).toBe("conflict");
    expect(store.readById("mem_a")?.conflicts_with).toContain("mem_b");
  });

  it("missing peer only reports", () => {
    const home = tmpHome();
    const store = new MemoryStore(home);
    store.write(mem("mem_a", "⚠ conflicts with mem_missing"), "human");
    const before = store.readById("mem_a")!;
    const r = migrateConflicts(home, { dryRun: false });
    expect(r.reports).toBe(1);
    expect(store.readById("mem_a")?.status).toBe(before.status);
    expect(readMigrateReport(home)).toContain("missing_peer");
  });

  it("dry-run does not mutate", () => {
    const home = tmpHome();
    const store = new MemoryStore(home);
    store.write(mem("mem_a", "⚠ conflicts with mem_b"), "human");
    store.write(mem("mem_b", "x"), "human");
    migrateConflicts(home, { dryRun: true });
    expect(store.readById("mem_a")?.status).toBe("active");
    expect(existsSync(join(home, "manifests", "reports", "conflict-migrate.jsonl"))).toBe(true);
  });
});
