import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, newId, type CanonicalEvent } from "@amem/core";
import { EpisodeStore } from "@amem/store";
import { extractSession, promoteLevel, reconcile, shouldPromoteToDomain } from "./index.js";

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
