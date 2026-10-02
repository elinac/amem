import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type MemoryKind,
  type MemoryStatus,
  type ScopeLevel,
  type Trust,
  configToToml,
  defaultConfig,
} from "@amem/core";
import { MemoryStore } from "@amem/store";
import { afterEach, describe, expect, it } from "vitest";
import { type ListMemoriesInput, createAdmin } from "./admin.js";

describe("admin list", () => {
  let home: string;

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function setupHome(): string {
    home = mkdtempSync(join(tmpdir(), "amem-admin-list-"));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig()));
    return home;
  }

  function seedMemories(store: MemoryStore): void {
    const base = {
      content: "content",
      evidence: { episodes: [] as string[], count: 0, distinct_instances: 1, distinct_domains: 1 },
      stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
      validity: { depends_on: [] as string[], valid_from: "2026-01-01" },
      created_by: "test",
    };

    store.write(
      {
        ...base,
        id: "m-active-fact",
        kind: "fact",
        title: "alpha fact",
        applies_when: "always",
        scope: { level: "instance", tags: {} },
        trust: "T2",
        status: "active",
        updated_at: "2026-01-04T00:00:00Z",
      },
      "human",
    );
    store.write(
      {
        ...base,
        id: "m-candidate-case",
        kind: "case",
        title: "beta case",
        applies_when: "never",
        scope: { level: "domain", tags: {} },
        trust: "T3",
        status: "candidate",
        updated_at: "2026-01-03T00:00:00Z",
      },
      "human",
    );
    store.write(
      {
        ...base,
        id: "m-active-strategy",
        kind: "strategy",
        title: "gamma strategy",
        applies_when: "searching",
        scope: { level: "global", tags: {} },
        trust: "T1",
        status: "active",
        updated_at: "2026-01-02T00:00:00Z",
      },
      "human",
    );
    store.write(
      {
        ...base,
        id: "m-conflict-fact",
        kind: "fact",
        title: "delta conflict",
        applies_when: "always",
        scope: { level: "instance", tags: {} },
        trust: "T2",
        status: "conflict",
        updated_at: "2026-01-01T00:00:00Z",
      },
      "human",
    );
  }

  it("filters, sorts and paginates memories on one snapshot", () => {
    const h = setupHome();
    seedMemories(new MemoryStore(h));

    const r = createAdmin(h).listMemories({ page: 1, pageSize: 20, kind: "fact" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const data = r.data as {
      total: number;
      page: number;
      pageSize: number;
      items: { id: string; kind: string; updated_at: string }[];
    };
    expect(data.total).toBe(2);
    expect(data.items.length).toBe(2);
    expect(data.items[0]!.id).toBe("m-active-fact");
    expect(data.items[1]!.id).toBe("m-conflict-fact");

    const p2 = createAdmin(h).listMemories({ page: 2, pageSize: 20, kind: "fact" });
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    const d2 = p2.data as typeof data;
    expect(d2.total).toBe(2);
    expect(d2.items.length).toBe(0);
  });

  it("computes each facet excluding its own selected dimension", () => {
    const h = setupHome();
    seedMemories(new MemoryStore(h));

    const r = createAdmin(h).listMemories({ page: 1, pageSize: 20, kind: "fact" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const data = r.data as {
      facets: {
        kind: Record<string, number>;
        level: Record<string, number>;
        trust: Record<string, number>;
        status: Record<string, number>;
      };
    };

    // kind facet counts all memories (kind filter not applied to itself)
    expect(data.facets.kind.fact).toBe(2);
    expect(data.facets.kind.case).toBe(1);
    expect(data.facets.kind.strategy).toBe(1);
    // other facets respect the kind filter
    expect(data.facets.level.instance).toBe(2);
    expect(data.facets.level.domain).toBe(0);
    expect(data.facets.trust.T2).toBe(2);
    expect(data.facets.status.active).toBe(1);
    expect(data.facets.status.conflict).toBe(1);
  });

  it("returns page one when total is zero", () => {
    const h = setupHome();

    const r = createAdmin(h).listMemories({ page: 5, pageSize: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const data = r.data as { total: number; page: number; items: unknown[] };
    expect(data.total).toBe(0);
    expect(data.page).toBe(1);
    expect(data.items).toEqual([]);
  });

  it("rejects invalid enums, page and pageSize", () => {
    const h = setupHome();

    const invalidCases: ListMemoriesInput[] = [
      { page: 0, pageSize: 20 },
      { page: -1, pageSize: 20 },
      { page: 1.5, pageSize: 20 },
      { page: 1, pageSize: 30 as 20 | 50 | 100 },
      { page: 1, pageSize: 20, kind: "not-a-kind" as MemoryKind },
      { page: 1, pageSize: 20, level: "universe" as ScopeLevel },
      { page: 1, pageSize: 20, trust: "T0" as Trust },
      { page: 1, pageSize: 20, status: "deleted" as MemoryStatus },
    ];

    for (const input of invalidCases) {
      const r = createAdmin(h).listMemories(input);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.status).toBe(400);
    }
  });

  it("never returns more than a 200-char preview", () => {
    const h = setupHome();
    const store = new MemoryStore(h);
    const longContent = "a".repeat(500);
    store.write(
      {
        id: "m-long",
        kind: "fact",
        title: "long",
        content: longContent,
        applies_when: "always",
        scope: { level: "instance", tags: {} },
        trust: "T2",
        status: "active",
        evidence: {
          episodes: [] as string[],
          count: 0,
          distinct_instances: 1,
          distinct_domains: 1,
        },
        stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
        validity: { depends_on: [] as string[], valid_from: "2026-01-01" },
        created_by: "test",
        updated_at: "2026-01-01T00:00:00Z",
      },
      "human",
    );

    const r = createAdmin(h).listMemories({ page: 1, pageSize: 20 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { items: { content: string }[] };
    expect(data.items[0]!.content.length).toBeLessThanOrEqual(200);
  });

  it("keeps legacy number overload behavior", () => {
    const h = setupHome();
    seedMemories(new MemoryStore(h));

    const r = createAdmin(h).listMemories(2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { total: number; items: unknown[] };
    expect(data.total).toBe(4);
    expect(data.items.length).toBe(2);
  });

  it("searches title, applies_when and content", () => {
    const h = setupHome();
    seedMemories(new MemoryStore(h));

    const r = createAdmin(h).listMemories({ page: 1, pageSize: 20, q: "gamma" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { total: number; items: { id: string }[] };
    expect(data.total).toBe(1);
    expect(data.items[0]!.id).toBe("m-active-strategy");

    const r2 = createAdmin(h).listMemories({ page: 1, pageSize: 20, q: "never" });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const d2 = r2.data as typeof data;
    expect(d2.total).toBe(1);
    expect(d2.items[0]!.id).toBe("m-candidate-case");
  });
});
