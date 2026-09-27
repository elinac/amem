import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, newId, type MemoryRecord } from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { buildContextPack, extractSituation, recall } from "./index.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) {
    try {
      rmSync(h, { recursive: true, force: true });
    } catch {
      /* windows may delay sqlite unlock */
    }
  }
});

describe("retrieval", () => {
  it("recalls by fts and packs", () => {
    const home = mkdtempSync(join(tmpdir(), "amem-"));
    homes.push(home);
    const store = new MemoryStore(home);
    const rec: MemoryRecord = {
      id: newId("mem"),
      kind: "failure",
      title: "port already in use",
      content: "Find the process holding the port.",
      applies_when: "dev server fails because port is occupied",
      scope: { level: "domain", tags: { user: "u", domains: ["vite"] } },
      trust: "T2",
      status: "active",
      evidence: { episodes: ["e"], count: 1, distinct_instances: 2, distinct_domains: 1 },
      stats: { recalled: 0, adopted: 0, helpful: 1, harmful: 0, lift: 0.2 },
      validity: { depends_on: [], valid_from: "2026-01-01" },
      created_by: "t",
      updated_at: new Date().toISOString(),
    };
    store.write(rec);
    const idx = new IndexStore(home);
    idx.rebuild(store);
    idx.close();
    const sit = extractSituation({ query: "port occupied vite", userId: "u" });
    const hits = recall(home, sit, 5);
    expect(hits.some((h) => h.memory.id === rec.id)).toBe(true);
    const pack = buildContextPack({
      home,
      cfg: defaultConfig("u"),
      situation: sit,
      sessionId: "s",
    });
    expect(pack.items.length).toBeGreaterThan(0);
  });

  it("detects domains from package.json", () => {
    const root = mkdtempSync(join(tmpdir(), "ws-"));
    homes.push(root);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { vite: "1", react: "1" } }),
    );
    const s = extractSituation({ query: "fix build", userId: "u", workspaceRoot: root });
    expect(s.domains).toContain("vite");
    expect(s.domains).toContain("react");
  });
});
