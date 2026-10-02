import type { MemoryRecord } from "@amem/core";
import { MemoryStore } from "./memory.js";

export type ConflictPair = {
  left: MemoryRecord;
  right: MemoryRecord;
};

export type ResolveConflictAction = "keep_left" | "keep_right" | "keep_both";

function linked(a: MemoryRecord, b: MemoryRecord): boolean {
  return (a.conflicts_with ?? []).includes(b.id) || (b.conflicts_with ?? []).includes(a.id);
}

/** Current structured conflict pairs (each undirected edge once). */
export function listConflicts(home: string): ConflictPair[] {
  const all = new MemoryStore(home).listAll().filter((m) => m.status === "conflict");
  const byId = new Map(all.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const out: ConflictPair[] = [];
  for (const m of all) {
    for (const otherId of m.conflicts_with ?? []) {
      const key = [m.id, otherId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const other = byId.get(otherId) ?? new MemoryStore(home).readById(otherId);
      if (!other) continue;
      if (other.status !== "conflict" && !(other.conflicts_with ?? []).includes(m.id)) continue;
      const [left, right] = m.id < other.id ? [m, other] : [other, m];
      out.push({ left, right });
    }
  }
  out.sort((a, b) => b.left.updated_at.localeCompare(a.left.updated_at));
  return out;
}

function clearLink(m: MemoryRecord, otherId: string): MemoryRecord {
  return {
    ...m,
    conflicts_with: (m.conflicts_with ?? []).filter((id) => id !== otherId),
  };
}

/**
 * Resolve a conflict pair. Optimistic concurrency via updated_at.
 * keep_both: audit-only semantics — leaves both as conflict (injection still blocked).
 */
export function resolveConflict(
  home: string,
  input: {
    leftId: string;
    rightId: string;
    action: ResolveConflictAction;
    leftUpdatedAt: string;
    rightUpdatedAt: string;
  },
): { left: MemoryRecord; right: MemoryRecord } {
  const store = new MemoryStore(home);
  const left = store.readById(input.leftId);
  const right = store.readById(input.rightId);
  if (!left || !right) throw new Error("not_found");
  if (left.updated_at !== input.leftUpdatedAt || right.updated_at !== input.rightUpdatedAt) {
    throw new Error("conflict_version_mismatch");
  }
  if (!linked(left, right)) throw new Error("not_a_conflict_pair");

  const now = new Date().toISOString();

  if (input.action === "keep_both") {
    // Explicit human acknowledgment; do not clear edges.
    const l = { ...left, updated_at: now };
    const r = { ...right, updated_at: now };
    store.write(l, "human");
    store.write(r, "human");
    return { left: l, right: r };
  }

  const keepLeft = input.action === "keep_left";
  let winner = clearLink(keepLeft ? left : right, keepLeft ? right.id : left.id);
  let loser = clearLink(keepLeft ? right : left, keepLeft ? left.id : right.id);
  loser = {
    ...loser,
    status: "superseded",
    supersedes: winner.id,
    updated_at: now,
  };
  winner = {
    ...winner,
    status: (winner.conflicts_with ?? []).length === 0 ? "active" : "conflict",
    updated_at: now,
  };
  store.write(winner, "human");
  store.write(loser, "human");
  return keepLeft ? { left: winner, right: loser } : { left: loser, right: winner };
}
