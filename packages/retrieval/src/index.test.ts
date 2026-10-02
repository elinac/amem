import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, newId, type MemoryRecord } from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { buildContextPack, extractSituation, recall } from "./index.js";

const homes: string[] = [];

function mem(o: {
  title: string;
  applies_when: string;
  domains?: string[];
  trust?: MemoryRecord["trust"];
  lift?: number;
}): MemoryRecord {
  return {
    id: newId("mem"),
    kind: "failure",
    title: o.title,
    content: `${o.title}. ${o.applies_when}.`,
    applies_when: o.applies_when,
    scope: { level: "domain", tags: { user: "u", domains: o.domains ?? [] } },
    trust: o.trust ?? "T3",
    status: "active",
    evidence: { episodes: ["e"], count: 1, distinct_instances: 2, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: o.lift ?? 0 },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    created_by: "t",
    updated_at: new Date().toISOString(),
  };
}
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

  it("does not let unrelated memories outrank or join text hits", () => {
    const home = mkdtempSync(join(tmpdir(), "amem-"));
    homes.push(home);
    const store = new MemoryStore(home);
    const hit = mem({ title: "port already in use", applies_when: "dev server port occupied" });
    const unrelated = mem({
      title: "database migration ordering",
      applies_when: "schema changes need ordered migrations",
      trust: "T2",
      lift: 0.5,
    });
    store.write(hit);
    store.write(unrelated);
    const sit = extractSituation({ query: "port", userId: "u" });
    const hits = recall(home, sit, 5);
    expect(hits.map((h) => h.memory.id)).toEqual([hit.id]);
  });

  it("ranks text hits above tag-only matches", () => {
    const home = mkdtempSync(join(tmpdir(), "amem-"));
    homes.push(home);
    const store = new MemoryStore(home);
    const hit = mem({ title: "port already in use", applies_when: "dev server port occupied" });
    const tagOnly = mem({
      title: "bundle size budget",
      applies_when: "chunk too large warning",
      domains: ["vite"],
      trust: "T2",
      lift: 1,
    });
    store.write(hit);
    store.write(tagOnly);
    const sit = extractSituation({ query: "port", userId: "u" });
    sit.domains = ["vite"];
    const hits = recall(home, sit, 5);
    expect(hits[0]?.memory.id).toBe(hit.id);
  });

  it("counts recalled once per packed memory only when tracking", () => {
    const home = mkdtempSync(join(tmpdir(), "amem-"));
    homes.push(home);
    const store = new MemoryStore(home);
    const rec = mem({ title: "port already in use", applies_when: "dev server port occupied" });
    store.write(rec);
    const sit = extractSituation({ query: "port", userId: "u" });
    const cfg = defaultConfig("u");
    buildContextPack({ home, cfg, situation: sit, sessionId: "preview" });
    expect(store.readById(rec.id)?.stats.recalled).toBe(0);
    const pack = buildContextPack({ home, cfg, situation: sit, sessionId: "s", trackStats: true });
    expect(pack.items.some((i) => i.ref === `${rec.id}#l1`)).toBe(true);
    expect(store.readById(rec.id)?.stats.recalled).toBe(1);
  });

  it("does not inject conflict memories into context packs", () => {
    const home = mkdtempSync(join(tmpdir(), "amem-"));
    homes.push(home);
    const store = new MemoryStore(home);
    const conflicted = mem({
      title: "port already in use",
      applies_when: "dev server port occupied",
      trust: "T2",
    });
    conflicted.status = "conflict";
    store.write(conflicted);
    const sit = extractSituation({ query: "port", userId: "u" });
    expect(recall(home, sit, 5).some((h) => h.memory.id === conflicted.id)).toBe(true);
    const pack = buildContextPack({
      home,
      cfg: defaultConfig("u"),
      situation: sit,
      sessionId: "s",
    });
    expect(pack.items.some((i) => i.ref.startsWith(conflicted.id))).toBe(false);
    expect(pack.dropped.some((d) => d.ref === conflicted.id)).toBe(true);
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
