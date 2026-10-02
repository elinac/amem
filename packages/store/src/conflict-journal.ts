import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type MemoryRecord, atomicWriteJson, atomicWriteText, paths } from "@amem/core";
import { type ResolveConflictAction, computeResolveTargets } from "./conflict.js";
import { crashHooks } from "./crash-hooks.js";
import { revokeEpochsReferencing } from "./epoch-store.js";
import { MemoryStore } from "./memory.js";
import { serializeMemoryRecord } from "./serialize.js";
import { syncMemoryIndex } from "./sync.js";

export type ConflictActor = {
  kind: "cli" | "dsh";
  /** Public token id only — never secret/CSRF/cookie (ADR-0004). */
  token_id?: string;
  os_user?: string;
};

export type ConflictErrorCode = "not_found" | "conflict_version_mismatch" | "not_a_conflict_pair";

export class ConflictError extends Error {
  readonly code: ConflictErrorCode;
  constructor(code: ConflictErrorCode) {
    super(code);
    this.code = code;
    this.name = "ConflictError";
  }
}

type JournalPhase = "prepared" | "markdown_committed" | "indexed" | "awaiting_manual";

export type ConflictJournal = {
  txId: string;
  action: ResolveConflictAction | "migrate_link";
  leftId: string;
  rightId: string;
  leftPath: string;
  rightPath: string;
  leftPreimageHash: string;
  rightPreimageHash: string;
  leftTargetHash: string;
  rightTargetHash: string;
  leftTargetBytes: string;
  rightTargetBytes: string;
  phase: JournalPhase;
  affectedEpochKeys: string[];
  auditWritten: boolean;
  actor: ConflictActor;
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function txDir(home: string): string {
  return join(paths(home).manifests, "transactions");
}

function auditPath(home: string): string {
  return join(paths(home).manifests, "audit", "conflict-resolve.jsonl");
}

function journalPath(home: string, txId: string): string {
  return join(txDir(home), `${txId}.json`);
}

function lockDir(home: string): string {
  return join(paths(home).manifests, ".amem-tx-lock");
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withTxLock<T>(home: string, fn: () => T): T {
  const dir = lockDir(home);
  mkdirSync(paths(home).manifests, { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(dir);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      if (Date.now() - started > 10_000) throw new Error("tx_lock_timeout");
      sleepMs(20);
    }
  }
  try {
    return fn();
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

function readJournal(home: string, txId: string): ConflictJournal | null {
  const p = journalPath(home, txId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as ConflictJournal;
}

function writeJournal(home: string, j: ConflictJournal): void {
  mkdirSync(txDir(home), { recursive: true });
  atomicWriteJson(journalPath(home, j.txId), j);
}

function listJournalFiles(home: string): string[] {
  const dir = txDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"));
}

/** Memory ids blocked from injection while a journal is not indexed. */
export function listBlockedMemoryIds(home: string): Set<string> {
  const out = new Set<string>();
  for (const f of listJournalFiles(home)) {
    try {
      const j = JSON.parse(readFileSync(join(txDir(home), f), "utf8")) as ConflictJournal;
      if (j.phase === "indexed") continue;
      out.add(j.leftId);
      out.add(j.rightId);
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

function appendAudit(
  home: string,
  j: ConflictJournal,
  result: { left: string; right: string },
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    txId: j.txId,
    actor: {
      kind: j.actor.kind,
      ...(j.actor.token_id ? { token_id: j.actor.token_id } : {}),
      ...(j.actor.os_user ? { os_user: j.actor.os_user } : {}),
    },
    leftId: j.leftId,
    rightId: j.rightId,
    action: j.action,
    result_statuses: result,
  });
  const p = auditPath(home);
  mkdirSync(dirname(p), { recursive: true });
  if (existsSync(p)) {
    const prev = readFileSync(p, "utf8");
    if (prev.includes(`"txId":"${j.txId}"`)) return;
  }
  appendFileSync(p, `${line}\n`);
}

function fileHash(path: string): string | null {
  if (!existsSync(path)) return null;
  return sha256(readFileSync(path, "utf8"));
}

function writeIfPreimageOrMissing(
  path: string,
  preimageHash: string,
  targetHash: string,
  targetBytes: string,
): void {
  const cur = fileHash(path);
  if (cur === targetHash) return;
  if (cur === null || cur === preimageHash) {
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteText(path, targetBytes);
    return;
  }
  throw new Error("journal_preimage_mismatch");
}

function applyTargets(home: string, j: ConflictJournal): void {
  writeIfPreimageOrMissing(j.leftPath, j.leftPreimageHash, j.leftTargetHash, j.leftTargetBytes);
  crashHooks().afterConflictLeftWrite?.({ txId: j.txId, leftId: j.leftId });
  writeIfPreimageOrMissing(j.rightPath, j.rightPreimageHash, j.rightTargetHash, j.rightTargetBytes);
}

function indexTargets(home: string, j: ConflictJournal): void {
  const store = new MemoryStore(home);
  const left = store.read(j.leftPath);
  const right = store.read(j.rightPath);
  syncMemoryIndex(home, left, j.leftPath);
  syncMemoryIndex(home, right, j.rightPath);
}

function advanceJournal(home: string, j: ConflictJournal): void {
  if (j.phase === "awaiting_manual") return;

  if (j.phase === "prepared") {
    try {
      applyTargets(home, j);
      j.phase = "markdown_committed";
      writeJournal(home, j);
    } catch (e) {
      if (e instanceof Error && e.message === "journal_preimage_mismatch") {
        j.phase = "awaiting_manual";
        writeJournal(home, j);
        return;
      }
      throw e;
    }
  }

  if (j.phase === "markdown_committed") {
    indexTargets(home, j);
    if (!j.auditWritten) {
      const store = new MemoryStore(home);
      appendAudit(home, j, {
        left: store.read(j.leftPath).status,
        right: store.read(j.rightPath).status,
      });
      j.auditWritten = true;
      writeJournal(home, j);
    }
    j.affectedEpochKeys = revokeEpochsReferencing(home, [j.leftId, j.rightId]);
    writeJournal(home, j);
    j.phase = "indexed";
    writeJournal(home, j);
    rmSync(journalPath(home, j.txId), { force: true });
  }
}

/** Recover leftover journals at startup / before resolve. */
export function recoverJournals(home: string): { recovered: string[]; manual: string[] } {
  return withTxLock(home, () => {
    const recovered: string[] = [];
    const manual: string[] = [];
    for (const f of listJournalFiles(home)) {
      const txId = f.replace(/\.json$/, "");
      const j = readJournal(home, txId);
      if (!j) continue;
      if (j.phase === "awaiting_manual") {
        manual.push(txId);
        continue;
      }
      if (j.phase === "indexed") {
        rmSync(journalPath(home, txId), { force: true });
        recovered.push(txId);
        continue;
      }
      try {
        advanceJournal(home, j);
        const after = readJournal(home, txId);
        if (after?.phase === "awaiting_manual") manual.push(txId);
        else recovered.push(txId);
      } catch (e) {
        if (e instanceof Error && e.message === "journal_preimage_mismatch") {
          j.phase = "awaiting_manual";
          writeJournal(home, j);
          manual.push(txId);
        } else {
          throw e;
        }
      }
    }
    return { recovered, manual };
  });
}

function newTxId(): string {
  return `tx_${randomBytes(8).toString("hex")}`;
}

/**
 * Dual-file mutation via journal (I4). Used by conflict resolve and migrate_link.
 */
export function commitPairedMutation(
  home: string,
  input: {
    action: ResolveConflictAction | "migrate_link";
    left: MemoryRecord;
    right: MemoryRecord;
    leftTarget: MemoryRecord;
    rightTarget: MemoryRecord;
  },
  actor: ConflictActor,
): { left: MemoryRecord; right: MemoryRecord } {
  return withTxLock(home, () => {
    const store = new MemoryStore(home);
    const leftPath = store.pathFor(input.left);
    const rightPath = store.pathFor(input.right);
    const leftPre = readFileSync(leftPath, "utf8");
    const rightPre = readFileSync(rightPath, "utf8");
    const leftTargetBytes = serializeMemoryRecord(input.leftTarget);
    const rightTargetBytes = serializeMemoryRecord(input.rightTarget);
    const leftTargetPath = store.pathFor(input.leftTarget);
    const rightTargetPath = store.pathFor(input.rightTarget);
    if (leftTargetPath !== leftPath || rightTargetPath !== rightPath) {
      throw new Error("path_change_unsupported");
    }

    const j: ConflictJournal = {
      txId: newTxId(),
      action: input.action,
      leftId: input.left.id,
      rightId: input.right.id,
      leftPath,
      rightPath,
      leftPreimageHash: sha256(leftPre),
      rightPreimageHash: sha256(rightPre),
      leftTargetHash: sha256(leftTargetBytes),
      rightTargetHash: sha256(rightTargetBytes),
      leftTargetBytes,
      rightTargetBytes,
      phase: "prepared",
      affectedEpochKeys: [],
      auditWritten: false,
      actor,
    };
    writeJournal(home, j);
    advanceJournal(home, j);
    if (j.phase === "awaiting_manual") {
      throw new Error("journal_awaiting_manual");
    }
    return { left: input.leftTarget, right: input.rightTarget };
  });
}

export function resolveConflict(
  home: string,
  input: {
    leftId: string;
    rightId: string;
    action: ResolveConflictAction;
    leftUpdatedAt: string;
    rightUpdatedAt: string;
  },
  actor: ConflictActor = { kind: "cli" },
): { left: MemoryRecord; right: MemoryRecord } {
  return resolveConflictTransactional(home, input, actor);
}

export function resolveConflictTransactional(
  home: string,
  input: {
    leftId: string;
    rightId: string;
    action: ResolveConflictAction;
    leftUpdatedAt: string;
    rightUpdatedAt: string;
  },
  actor: ConflictActor,
): { left: MemoryRecord; right: MemoryRecord } {
  recoverJournals(home);
  const store = new MemoryStore(home);
  const left = store.readById(input.leftId);
  const right = store.readById(input.rightId);
  if (!left || !right) throw new ConflictError("not_found");
  if (left.updated_at !== input.leftUpdatedAt || right.updated_at !== input.rightUpdatedAt) {
    throw new ConflictError("conflict_version_mismatch");
  }
  let targets: { left: MemoryRecord; right: MemoryRecord };
  try {
    targets = computeResolveTargets(left, right, input.action);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "not_a_conflict_pair") throw new ConflictError("not_a_conflict_pair");
    throw e;
  }
  return commitPairedMutation(
    home,
    {
      action: input.action,
      left,
      right,
      leftTarget: targets.left,
      rightTarget: targets.right,
    },
    actor,
  );
}

/** Link two memories as conflict via journal (migration). */
export function migrateLinkConflict(
  home: string,
  left: MemoryRecord,
  right: MemoryRecord,
  actor: ConflictActor,
): { left: MemoryRecord; right: MemoryRecord } {
  const now = new Date().toISOString();
  const leftLinks = new Set([...(left.conflicts_with ?? []), right.id]);
  const rightLinks = new Set([...(right.conflicts_with ?? []), left.id]);
  const leftTarget: MemoryRecord = {
    ...left,
    status: "conflict",
    conflicts_with: [...leftLinks],
    updated_at: now,
  };
  const rightTarget: MemoryRecord = {
    ...right,
    status: "conflict",
    conflicts_with: [...rightLinks],
    updated_at: now,
  };
  return commitPairedMutation(
    home,
    {
      action: "migrate_link",
      left,
      right,
      leftTarget,
      rightTarget,
    },
    actor,
  );
}
