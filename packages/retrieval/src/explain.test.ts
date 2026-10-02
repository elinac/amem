import type { MemoryRecord, Situation } from "@amem/core";
import { describe, expect, it } from "vitest";
import { decideRecall } from "./decide.js";
import { explainScore, scoreMemory } from "./pack.js";

function mem(
  partial: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "status" | "trust">,
): MemoryRecord {
  return {
    kind: "procedure",
    title: partial.id,
    content: "body",
    applies_when: "when",
    scope: { level: "domain", tags: { user: "u", domains: ["vite"] } },
    evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0.2 },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    created_by: "t",
    updated_at: "2026-01-01T00:00:00.000Z",
    conflicts_with: [],
    ...partial,
  };
}

const sit: Situation = {
  query: "port",
  user_id: "u",
  domains: ["vite"],
  tools: [],
  task_type: "debug",
};

describe("explainScore", () => {
  it("parts sum to score and match scoreMemory", () => {
    const m = mem({ id: "m1", status: "active", trust: "T2" });
    const explained = explainScore(m, sit, -2);
    expect(explained.score).toBe(scoreMemory(m, sit, -2));
    const { parts } = explained;
    const sum = parts.rel + parts.tag + parts.trust + parts.lift + parts.levelAdj;
    expect(sum).toBeCloseTo(explained.score, 10);
    expect(parts.rel).toBeGreaterThan(0);
    expect(parts.trust).toBeCloseTo(0.07, 5);
  });

  it("hard exclusions return -999 with zeroed parts", () => {
    const expired = mem({ id: "e", status: "expired", trust: "T2" });
    const x = explainScore(expired, sit, -1);
    expect(x.score).toBe(-999);
    expect(x.parts).toEqual({ rel: 0, tag: 0, trust: 0, lift: 0, levelAdj: 0 });
  });
});

describe("decideRecall reasons", () => {
  it("keeps stable reason strings and forwards parts", () => {
    const m = mem({ id: "c", status: "conflict", trust: "T2" });
    const parts = explainScore(m, sit, null).parts;
    const d = decideRecall([{ memory: m, score: 0.9, parts }], "assist");
    expect(d[0]?.reason).toBe("status_conflict");
    expect(d[0]?.decision).toBe("ignore");
    expect(d[0]?.parts).toEqual(parts);
  });
});
