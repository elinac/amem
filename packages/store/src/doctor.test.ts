import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configToToml, defaultConfig, newId, paths, type MemoryRecord } from "@amem/core";
import { MemoryStore } from "./memory.js";
import { IndexStore } from "./index-store.js";
import { listFailedJobs, purgeFailedJobs, runDoctor } from "./doctor.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) {
    try {
      rmSync(h, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("doctor", () => {
  it("reports failed queue and index drift with actions", () => {
    const home = mkdtempSync(join(tmpdir(), "amem-doc-"));
    homes.push(home);
    writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig("u")));
    const store = new MemoryStore(home);
    const rec: MemoryRecord = {
      id: newId("mem"),
      kind: "failure",
      title: "port",
      content: "port occupied",
      applies_when: "dev",
      scope: { level: "domain", tags: { user: "u" } },
      trust: "T3",
      status: "active",
      evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
      stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
      validity: { depends_on: [], valid_from: "2026-01-01" },
      created_by: "t",
      updated_at: new Date().toISOString(),
    };
    store.write(rec);
    // Drop index file so rows=0 while memory files remain → drift
    const idxPath = paths(home).index;
    if (existsSync(idxPath)) rmSync(idxPath, { force: true });
    const failedDir = join(paths(home).queue, "failed");
    mkdirSync(failedDir, { recursive: true });
    writeFileSync(join(failedDir, "flush-bad-1.json"), "{}");

    const report = runDoctor(home);
    expect(report.checks.some((c) => c.id === "queue_failed" && c.value === 1)).toBe(true);
    expect(report.checks.some((c) => c.id === "index_drift" && c.value === true)).toBe(true);
    expect(report.actions.some((a) => a.id === "rebuild_index")).toBe(true);
    expect(report.actions.some((a) => a.id === "inspect_failed")).toBe(true);
    expect(listFailedJobs(home)).toHaveLength(1);

    const idx = new IndexStore(home);
    idx.rebuild(store);
    idx.close();
    const after = runDoctor(home);
    expect(after.checks.find((c) => c.id === "index_drift")?.value).toBe(false);

    const purged = purgeFailedJobs(home);
    expect(purged.purged).toEqual(["flush-bad-1.json"]);
    expect(listFailedJobs(home)).toHaveLength(0);
  });
});
