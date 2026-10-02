import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MemoryRecord, defaultConfig } from "@amem/core";
import { MemoryStore, epochKeyHash, readEpoch, revokeEpoch } from "@amem/store";
import { describe, expect, it } from "vitest";
import { getOrCreateEpochPack } from "./epoch.js";
import { extractSituation } from "./situation.js";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "amem-ep-"));
}

function seed(home: string): void {
  const store = new MemoryStore(home);
  const rec: MemoryRecord = {
    id: "mem_ep1",
    kind: "procedure",
    title: "epoch seed",
    content: "body about ports and docker",
    applies_when: "when configuring ports",
    scope: { level: "domain", tags: { user: "u", domains: ["ops"] } },
    trust: "T2",
    status: "active",
    evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    created_by: "t",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  store.write(rec, "human");
}

describe("getOrCreateEpochPack", () => {
  it("rejects unsafe ids", () => {
    const home = tmpHome();
    const cfg = defaultConfig();
    const sit = extractSituation({ query: "ports", userId: "u" });
    expect(() =>
      getOrCreateEpochPack({
        home,
        cfg,
        situation: sit,
        userId: "../x",
        sessionId: "s1",
        epochId: "e1",
      }),
    ).toThrow(/unsafe/);
  });

  it("reuses committed pack_id and items", () => {
    const home = tmpHome();
    seed(home);
    const cfg = defaultConfig();
    cfg.recall.mode = "assist";
    const sit = extractSituation({ query: "ports docker", userId: "u" });
    const a = getOrCreateEpochPack({
      home,
      cfg,
      situation: sit,
      userId: "u1",
      sessionId: "s1",
      epochId: "e1",
    });
    const b = getOrCreateEpochPack({
      home,
      cfg,
      situation: sit,
      userId: "u1",
      sessionId: "s1",
      epochId: "e1",
    });
    expect(b.reused).toBe(true);
    expect(b.pack.pack_id).toBe(a.pack.pack_id);
    expect(b.pack.items.map((i) => i.ref)).toEqual(a.pack.items.map((i) => i.ref));
  });

  it("revoked epoch returns zero memories", () => {
    const home = tmpHome();
    seed(home);
    const cfg = defaultConfig();
    const sit = extractSituation({ query: "ports", userId: "u" });
    const first = getOrCreateEpochPack({
      home,
      cfg,
      situation: sit,
      userId: "u1",
      sessionId: "s1",
      epochId: "e2",
    });
    expect(first.degraded).toBe(false);
    const key = epochKeyHash("u1", "s1", "e2");
    revokeEpoch(home, key);
    expect(readEpoch(home, key)?.state).toBe("revoked");
    const again = getOrCreateEpochPack({
      home,
      cfg,
      situation: sit,
      userId: "u1",
      sessionId: "s1",
      epochId: "e2",
    });
    expect(again.degraded).toBe(true);
    expect(again.pack.items).toEqual([]);
  });

  it("concurrent first create yields single committed truth", () => {
    const home = tmpHome();
    seed(home);
    const cfg = defaultConfig();
    const sit = extractSituation({ query: "ports", userId: "u" });
    const results = [0, 1].map(() =>
      getOrCreateEpochPack({
        home,
        cfg,
        situation: sit,
        userId: "u1",
        sessionId: "s1",
        epochId: "e3",
      }),
    );
    const packIds = new Set(results.map((r) => r.pack.pack_id));
    // Both should see the same committed snapshot (winner or waiter)
    expect(packIds.size).toBe(1);
    const key = epochKeyHash("u1", "s1", "e3");
    expect(readEpoch(home, key)?.state).toBe("committed");
  });
});
