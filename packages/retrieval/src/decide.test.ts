import type { MemoryRecord } from "@amem/core";
import { describe, expect, it } from "vitest";
import { decideRecall, injectableDecisions } from "./decide.js";

function mem(
  partial: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "status" | "trust">,
): MemoryRecord {
  return {
    kind: "procedure",
    title: partial.id,
    content: "body",
    applies_when: "when",
    scope: { level: "instance", tags: { user: "u" } },
    evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    created_by: "t",
    updated_at: "2026-01-01T00:00:00.000Z",
    conflicts_with: [],
    ...partial,
  };
}

describe("decideRecall", () => {
  it("ignores conflict status and pending conflicts_with", () => {
    const hits = [
      { memory: mem({ id: "a", status: "conflict", trust: "T2" }), score: 0.9 },
      {
        memory: mem({
          id: "b",
          status: "active",
          trust: "T2",
          conflicts_with: ["a"],
        }),
        score: 0.9,
      },
      { memory: mem({ id: "c", status: "active", trust: "T2" }), score: 0.9 },
    ];
    const d = decideRecall(hits, "assist");
    expect(d.find((x) => x.memory.id === "a")?.decision).toBe("ignore");
    expect(d.find((x) => x.memory.id === "b")?.decision).toBe("ignore");
    expect(d.find((x) => x.memory.id === "c")?.decision).toBe("use");
  });

  it("shadow injects nothing; enforce drops verify", () => {
    const hits = [
      { memory: mem({ id: "t3", status: "active", trust: "T3" }), score: 0.9 },
      { memory: mem({ id: "t2", status: "active", trust: "T2" }), score: 0.9 },
    ];
    expect(injectableDecisions(decideRecall(hits, "shadow"), "shadow")).toEqual([]);
    const en = injectableDecisions(decideRecall(hits, "enforce"), "enforce");
    expect(en.map((x) => x.memory.id)).toEqual(["t2"]);
  });

  it("blocks journal_pending ids even when active", () => {
    const hits = [{ memory: mem({ id: "j1", status: "active", trust: "T2" }), score: 0.9 }];
    const d = decideRecall(hits, "assist", { blockedIds: new Set(["j1"]) });
    expect(d[0]?.decision).toBe("ignore");
    expect(d[0]?.reason).toBe("journal_pending");
  });
});
