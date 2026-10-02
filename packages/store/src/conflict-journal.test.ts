import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryRecord } from "@amem/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  MemoryStore,
  clearCrashHooks,
  epochKeyHash,
  listBlockedMemoryIds,
  readEpoch,
  recoverJournals,
  resolveConflict,
  setCrashHooks,
  writeEpoch,
} from "./index.js";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "amem-cj-"));
}

function base(id: string, peer?: string): MemoryRecord {
  return {
    id,
    kind: "procedure",
    title: "t",
    content: "c",
    applies_when: "w",
    scope: { level: "instance", tags: { user: "u" } },
    trust: "T3",
    status: "conflict",
    evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    created_by: "t",
    updated_at: "2026-01-01T00:00:00.000Z",
    conflicts_with: peer ? [peer] : [],
  };
}

afterEach(() => clearCrashHooks());

describe("conflict journal", () => {
  it("keep_left reaches indexed with no leftover journal", () => {
    const home = tmpHome();
    const store = new MemoryStore(home);
    store.write(base("mem_a", "mem_b"), "human");
    store.write(base("mem_b", "mem_a"), "human");
    const r = resolveConflict(
      home,
      {
        leftId: "mem_a",
        rightId: "mem_b",
        action: "keep_left",
        leftUpdatedAt: "2026-01-01T00:00:00.000Z",
        rightUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
      { kind: "cli", os_user: "tester" },
    );
    expect(r.left.status).toBe("active");
    expect(r.right.status).toBe("superseded");
    const txDir = join(home, "manifests", "transactions");
    expect(existsSync(txDir) ? readdirSync(txDir).filter((f) => f.endsWith(".json")) : []).toEqual(
      [],
    );
    const audit = readFileSync(join(home, "manifests", "audit", "conflict-resolve.jsonl"), "utf8");
    expect(audit).toContain('"os_user":"tester"');
    expect(audit).not.toContain("Bearer");
    expect(audit).not.toContain("csrf");
  });

  it("version mismatch throws ConflictError.code", () => {
    const home = tmpHome();
    const store = new MemoryStore(home);
    store.write(base("mem_a", "mem_b"), "human");
    store.write(base("mem_b", "mem_a"), "human");
    try {
      resolveConflict(home, {
        leftId: "mem_a",
        rightId: "mem_b",
        action: "keep_left",
        leftUpdatedAt: "wrong",
        rightUpdatedAt: "2026-01-01T00:00:00.000Z",
      });
      expect.fail("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictError);
      expect((e as ConflictError).code).toBe("conflict_version_mismatch");
    }
  });

  it("crash after left write: recover completes or keeps journal; no unilateral target without journal", () => {
    const home = tmpHome();
    const store = new MemoryStore(home);
    store.write(base("mem_a", "mem_b"), "human");
    store.write(base("mem_b", "mem_a"), "human");
    setCrashHooks({
      afterConflictLeftWrite: () => {
        throw new Error("crash after left");
      },
    });
    expect(() =>
      resolveConflict(home, {
        leftId: "mem_a",
        rightId: "mem_b",
        action: "keep_left",
        leftUpdatedAt: "2026-01-01T00:00:00.000Z",
        rightUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/crash after left/);

    const txDir = join(home, "manifests", "transactions");
    const journals = readdirSync(txDir).filter((f) => f.endsWith(".json"));
    expect(journals.length).toBe(1);
    const blocked = listBlockedMemoryIds(home);
    expect(blocked.has("mem_a")).toBe(true);
    expect(blocked.has("mem_b")).toBe(true);

    clearCrashHooks();
    const rec = recoverJournals(home);
    expect(rec.recovered.length + rec.manual.length).toBeGreaterThan(0);
    const a = store.readById("mem_a");
    const b = store.readById("mem_b");
    // After recover: either both at target (active/superseded) or journal still present
    const leftJournals = existsSync(txDir)
      ? readdirSync(txDir).filter((f) => f.endsWith(".json"))
      : [];
    if (leftJournals.length === 0) {
      expect(a?.status).toBe("active");
      expect(b?.status).toBe("superseded");
    } else {
      expect(listBlockedMemoryIds(home).size).toBeGreaterThan(0);
    }
  });

  it("resolve revokes committed epochs that reference the pair", () => {
    const home = tmpHome();
    const store = new MemoryStore(home);
    store.write(base("mem_a", "mem_b"), "human");
    store.write(base("mem_b", "mem_a"), "human");
    const key = epochKeyHash("u1", "s1", "e1");
    writeEpoch(home, {
      key,
      userId: "u1",
      sessionId: "s1",
      epochId: "e1",
      state: "committed",
      pack_id: "cp_x",
      items: [{ ref: "mem_a" }],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    resolveConflict(home, {
      leftId: "mem_a",
      rightId: "mem_b",
      action: "keep_left",
      leftUpdatedAt: "2026-01-01T00:00:00.000Z",
      rightUpdatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(readEpoch(home, key)?.state).toBe("revoked");
  });
});
