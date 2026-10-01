import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, newId, paths, type CanonicalEvent } from "@amem/core";
import { EpisodeStore, MemoryStore } from "@amem/store";
import { consolidate, extractSession, promoteLevel, reconcile, shouldPromoteToDomain } from "./index.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

describe("extractSession", () => {
  it("writes memory from stub llm with valid evidence", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-"));
    homes.push(home);
    const ep = new EpisodeStore(home);
    const sid = "s-extract";
    const events: CanonicalEvent[] = [
      {
        v: 1,
        ts: new Date().toISOString(),
        host: "cursor",
        session_id: sid,
        user_id: "u",
        type: "tool_result",
        payload: { output: "Error: Port 3000 is already in use" },
      },
    ];
    for (const e of events) ep.appendSpool(sid, e);
    const cfg = defaultConfig("u");
    cfg.llm.mode = "stub";
    const r = await extractSession(home, sid, cfg);
    expect(r.written.length).toBeGreaterThan(0);
  });

  it("skips candidates with bad evidence via reconcile unit", () => {
    const r = reconcile(
      {
        kind: "fact",
        title: "same",
        content: "hello world this is long enough content",
        applies_when: "when testing reconcile",
        evidence: [{ event: 0, quote: "x" }],
      },
      [
        {
          id: newId("mem"),
          kind: "fact",
          title: "same",
          content: "completely different long content here",
          applies_when: "when testing reconcile",
          scope: { level: "instance", tags: {} },
          trust: "T3",
          status: "active",
          evidence: { episodes: [], count: 1, distinct_instances: 1, distinct_domains: 1 },
          stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
          validity: { depends_on: [], valid_from: "2026-01-01" },
          created_by: "t",
          updated_at: new Date().toISOString(),
        },
      ],
    );
    expect(r.action).toBe("CONFLICT");
  });
});

describe("promotion gates", () => {
  it("requires distinct instances and helpful", () => {
    const cfg = defaultConfig();
    const base = {
      id: "m",
      kind: "procedure" as const,
      title: "t",
      content: "c",
      applies_when: "a",
      scope: { level: "instance" as const, tags: {} },
      trust: "T3" as const,
      status: "active" as const,
      evidence: { episodes: [], count: 1, distinct_instances: 3, distinct_domains: 1 },
      stats: { recalled: 0, adopted: 0, helpful: 2, harmful: 0, lift: 0 },
      validity: { depends_on: [], valid_from: "2026-01-01" },
      created_by: "t",
      updated_at: new Date().toISOString(),
    };
    expect(shouldPromoteToDomain(base, cfg)).toBe(true);
    expect(shouldPromoteToDomain({ ...base, stats: { ...base.stats, helpful: 1 } }, cfg)).toBe(
      false,
    );
  });

  it("promoteLevel raises T3 to T2 and preserves T1/T2", () => {
    const base = {
      id: "m",
      kind: "procedure" as const,
      title: "t",
      content: "c",
      applies_when: "a",
      scope: { level: "instance" as const, tags: {} },
      trust: "T3" as const,
      status: "active" as const,
      evidence: { episodes: [], count: 1, distinct_instances: 3, distinct_domains: 1 },
      stats: { recalled: 0, adopted: 0, helpful: 2, harmful: 0, lift: 0 },
      validity: { depends_on: [], valid_from: "2026-01-01" },
      created_by: "t",
      updated_at: new Date().toISOString(),
    };
    expect(promoteLevel(base, "domain").trust).toBe("T2");
    expect(promoteLevel(base, "domain").scope.level).toBe("domain");
    expect(promoteLevel({ ...base, trust: "T2" }, "domain").trust).toBe("T2");
    expect(promoteLevel({ ...base, trust: "T1" }, "domain").trust).toBe("T1");
  });
});

describe("consolidate", () => {
  it("emits a proposal in the same pass after promoting an eligible procedure", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-consol-"));
    homes.push(home);
    const store = new MemoryStore(home);
    store.write(
      {
        id: "mem_inst",
        kind: "procedure",
        title: "fix port conflicts",
        content: "1. find process\n2. kill or change port\n3. restart",
        applies_when: "dev server port in use",
        scope: { level: "instance", tags: { user: "u", instances: ["a", "b", "c"] } },
        trust: "T3",
        status: "active",
        evidence: {
          episodes: ["e1", "e2", "e3"],
          count: 3,
          distinct_instances: 3,
          distinct_domains: 1,
        },
        stats: { recalled: 4, adopted: 2, helpful: 2, harmful: 0, lift: 0.1 },
        validity: { depends_on: [], valid_from: "2026-01-01" },
        created_by: "t",
        updated_at: new Date().toISOString(),
      },
      "pipeline",
    );
    const r = await consolidate(home, defaultConfig());
    expect(r.promoted).toContain("mem_inst");
    expect(r.proposals).toContain("mem_inst");
    expect(existsSync(join(paths(home).capabilities, ".proposals", "mem_inst", "SKILL.md"))).toBe(
      true,
    );
  });

  it("writes proposals for already-domain procedures without requiring a second run", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-consol-dom-"));
    homes.push(home);
    const store = new MemoryStore(home);
    store.write(
      {
        id: "mem_dom",
        kind: "procedure",
        title: "domain skill",
        content: "steps",
        applies_when: "when needed",
        scope: { level: "domain", tags: {} },
        trust: "T2",
        status: "active",
        evidence: {
          episodes: ["e1", "e2", "e3"],
          count: 3,
          distinct_instances: 3,
          distinct_domains: 1,
        },
        stats: { recalled: 12, adopted: 8, helpful: 5, harmful: 0, lift: 0.2 },
        validity: { depends_on: [], valid_from: "2026-01-01" },
        created_by: "t",
        updated_at: new Date().toISOString(),
      },
      "pipeline",
    );
    const r = await consolidate(home, defaultConfig());
    expect(r.proposals).toContain("mem_dom");
    expect(existsSync(join(paths(home).capabilities, ".proposals", "mem_dom", "proposal.md"))).toBe(
      true,
    );
  });

  it("falls back to template when refine_proposals is on but LLM is stub", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-consol-refine-"));
    homes.push(home);
    const store = new MemoryStore(home);
    store.write(
      {
        id: "mem_ref",
        kind: "procedure",
        title: "refine me",
        content: "original body",
        applies_when: "when refining",
        scope: { level: "domain", tags: {} },
        trust: "T2",
        status: "active",
        evidence: {
          episodes: ["e1", "e2", "e3"],
          count: 3,
          distinct_instances: 3,
          distinct_domains: 1,
        },
        stats: { recalled: 12, adopted: 8, helpful: 5, harmful: 0, lift: 0.2 },
        validity: { depends_on: [], valid_from: "2026-01-01" },
        created_by: "t",
        updated_at: new Date().toISOString(),
      },
      "pipeline",
    );
    const cfg = defaultConfig();
    cfg.budget.consolidate.refine_proposals = true;
    cfg.llm.mode = "stub";
    const r = await consolidate(home, cfg);
    expect(r.proposals).toContain("mem_ref");
    const { readFileSync } = await import("node:fs");
    const body = readFileSync(
      join(paths(home).capabilities, ".proposals", "mem_ref", "SKILL.md"),
      "utf8",
    );
    expect(body).toContain("original body");
  });

  it("emits template proposal after promotion consumes the last LLM budget slot", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-consol-budget-"));
    homes.push(home);
    const store = new MemoryStore(home);
    store.write(
      {
        id: "mem_budget",
        kind: "procedure",
        title: "budget edge",
        content: "body budget",
        applies_when: "a",
        scope: { level: "instance", tags: { instances: ["a", "b", "c"] } },
        trust: "T3",
        status: "active",
        evidence: {
          episodes: ["e1", "e2", "e3"],
          count: 3,
          distinct_instances: 3,
          distinct_domains: 1,
        },
        stats: { recalled: 4, adopted: 2, helpful: 2, harmful: 0, lift: 0.1 },
        validity: { depends_on: [], valid_from: "2026-01-01" },
        created_by: "t",
        updated_at: new Date().toISOString(),
      },
      "pipeline",
    );
    const cfg = defaultConfig();
    cfg.budget.consolidate.refine_proposals = true;
    cfg.budget.consolidate.max_llm_calls = 1;
    cfg.llm.mode = "stub";
    const r = await consolidate(home, cfg);
    expect(r.promoted).toContain("mem_budget");
    expect(r.proposals).toContain("mem_budget");
    const { readFileSync } = await import("node:fs");
    expect(
      readFileSync(join(paths(home).capabilities, ".proposals", "mem_budget", "SKILL.md"), "utf8"),
    ).toContain("body budget");
  });
});
