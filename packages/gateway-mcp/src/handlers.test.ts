import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryRecord } from "@amem/core";
import { MemoryStore } from "@amem/store";
import { afterEach, describe, expect, it } from "vitest";
import { createToolHandlers } from "./handlers.js";

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

function seed(home: string): MemoryRecord {
  const rec: MemoryRecord = {
    id: "mem_port",
    kind: "failure",
    title: "port already in use",
    content: "Find the process holding the port.",
    applies_when: "dev server fails because port is occupied",
    scope: { level: "domain", tags: { user: "u" } },
    trust: "T2",
    status: "active",
    evidence: { episodes: ["e"], count: 1, distinct_instances: 2, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    created_by: "t",
    updated_at: new Date().toISOString(),
  };
  new MemoryStore(home).write(rec);
  return rec;
}

describe("gateway-mcp handlers", () => {
  it("memory_recall and context_pack count recalled; helpful feedback counts adopted", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-mcp-"));
    homes.push(home);
    const rec = seed(home);
    const h = createToolHandlers(home);

    await h.memory_recall({ query: "port" });
    await h.context_pack({ query: "port occupied" });
    await h.memory_feedback({ id: rec.id, verdict: "helpful" });
    await h.memory_feedback({ id: rec.id, verdict: "harmful" });

    const stats = new MemoryStore(home).readById(rec.id)?.stats;
    expect(stats?.recalled).toBe(2);
    expect(stats?.adopted).toBe(1);
    expect(stats?.helpful).toBe(1);
    expect(stats?.harmful).toBe(1);
  });

  it("memory_recall includes decision reason and score parts", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-mcp-"));
    homes.push(home);
    seed(home);
    const h = createToolHandlers(home);
    const r = await h.memory_recall({ query: "port" });
    const body = JSON.parse(r.content[0]!.text) as {
      l0: Array<{ decision: string; reason: string; parts?: { rel: number } }>;
      dropped: unknown[];
    };
    expect(body.l0.length).toBeGreaterThan(0);
    expect(body.l0[0]!.decision).toBeTruthy();
    expect(body.l0[0]!.reason).toBeTruthy();
    expect(body.l0[0]!.parts?.rel).toBeTypeOf("number");
    expect(Array.isArray(body.dropped)).toBe(true);
  });

  it("rejects invalid tool args", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-mcp-"));
    homes.push(home);
    const h = createToolHandlers(home);
    await expect(
      h.memory_note({ kind: "nope", title: "t", content: "c", applies_when: "a" }),
    ).rejects.toThrow();
    await expect(h.memory_feedback({ id: "x", verdict: "maybe" })).rejects.toThrow();
  });

  it("context_pack budget does not mutate loaded config", async () => {
    const home = mkdtempSync(join(tmpdir(), "amem-mcp-"));
    homes.push(home);
    seed(home);
    const h = createToolHandlers(home);
    await h.context_pack({ query: "port", budget: 50 });
    const { loadConfig } = await import("@amem/core");
    expect(loadConfig(home).recall.budget_tokens).toBe(1800);
  });
});
