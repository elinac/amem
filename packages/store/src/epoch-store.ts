import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteJson, isSafeId, paths } from "@amem/core";

export type EpochState = "open" | "committed" | "revoked";

export type EpochItem = {
  ref: string;
  layer?: string;
  level?: string;
  score?: number;
  tokens?: number;
  decision?: string;
  decision_id?: string;
};

export type EpochRecord = {
  key: string;
  userId: string;
  sessionId: string;
  epochId: string;
  state: EpochState;
  pack_id?: string;
  items: EpochItem[];
  safety?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function epochsDir(home: string): string {
  return join(paths(home).manifests, "epochs");
}

export function epochKeyHash(userId: string, sessionId: string, epochId: string): string {
  return createHash("sha256").update(`${userId}\0${sessionId}\0${epochId}`).digest("hex");
}

export function epochPath(home: string, keyHash: string): string {
  return join(epochsDir(home), `${keyHash}.json`);
}

export function assertEpochIds(userId: string, sessionId: string, epochId: string): void {
  for (const [name, v] of [
    ["userId", userId],
    ["sessionId", sessionId],
    ["epochId", epochId],
  ] as const) {
    if (!isSafeId(v)) throw new Error(`unsafe_${name}`);
  }
}

export function readEpoch(home: string, keyHash: string): EpochRecord | null {
  const p = epochPath(home, keyHash);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as EpochRecord;
  } catch {
    return null;
  }
}

export function writeEpoch(home: string, record: EpochRecord): void {
  mkdirSync(epochsDir(home), { recursive: true });
  atomicWriteJson(epochPath(home, record.key), record);
}

/** CAS: only transition if current state matches `from`. */
export function casEpochState(
  home: string,
  keyHash: string,
  from: EpochState,
  to: EpochState,
  patch: Partial<EpochRecord> = {},
): EpochRecord | null {
  const cur = readEpoch(home, keyHash);
  if (!cur || cur.state !== from) return null;
  if (from === "revoked" || (cur.state === "revoked" && to === "committed")) return null;
  if (to === "committed" && cur.state === "revoked") return null;
  const next: EpochRecord = {
    ...cur,
    ...patch,
    state: to,
    updated_at: new Date().toISOString(),
  };
  // refuse revoked → committed
  if (cur.state === "revoked" && to !== "revoked") return null;
  writeEpoch(home, next);
  return next;
}

export function revokeEpoch(home: string, keyHash: string): EpochRecord | null {
  const cur = readEpoch(home, keyHash);
  if (!cur) return null;
  if (cur.state === "revoked") return cur;
  const next: EpochRecord = {
    ...cur,
    state: "revoked",
    updated_at: new Date().toISOString(),
  };
  writeEpoch(home, next);
  return next;
}

/**
 * Scan committed epochs whose items[].ref hit any of memoryIds; mark revoked.
 * Returns affected epoch key hashes (may be empty when nothing references).
 */
export function revokeEpochsReferencing(home: string, memoryIds: string[]): string[] {
  const wanted = new Set(memoryIds);
  const dir = epochsDir(home);
  if (!existsSync(dir)) return [];
  const affected: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const keyHash = f.replace(/\.json$/, "");
    const ep = readEpoch(home, keyHash);
    if (!ep || ep.state !== "committed") continue;
    const hit = (ep.items ?? []).some((it) => {
      const ref = it.ref.split("#")[0]!;
      return wanted.has(ref);
    });
    if (!hit) continue;
    revokeEpoch(home, keyHash);
    affected.push(keyHash);
  }
  return affected;
}

/**
 * Create open epoch file exclusively (mkdir-style via rename of temp).
 * Returns null if key already exists.
 */
export function tryCreateOpenEpoch(
  home: string,
  userId: string,
  sessionId: string,
  epochId: string,
): EpochRecord | null {
  assertEpochIds(userId, sessionId, epochId);
  const key = epochKeyHash(userId, sessionId, epochId);
  mkdirSync(epochsDir(home), { recursive: true });
  const p = epochPath(home, key);
  if (existsSync(p)) return null;
  const now = new Date().toISOString();
  const record: EpochRecord = {
    key,
    userId,
    sessionId,
    epochId,
    state: "open",
    items: [],
    created_at: now,
    updated_at: now,
  };
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(record, null, 2));
  try {
    renameSync(tmp, p);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return null;
  }
  return record;
}
