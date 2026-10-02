import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { paths } from "@amem/core";
import { INDEX_SCHEMA_VERSION, IndexStore } from "./index-store.js";
import { MemoryStore } from "./memory.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export type DoctorCheck = {
  id: string;
  value: unknown;
  status: DoctorStatus;
};

export type DoctorAction = {
  id: string;
  command: string;
  reason: string;
};

export type FailedJobInfo = {
  name: string;
  mtime: string;
};

export type DoctorReport = {
  home: string;
  status: DoctorStatus;
  checks: DoctorCheck[];
  /** Legacy tuple form for older consumers. */
  checks_legacy: Array<[string, unknown]>;
  actions: DoctorAction[];
  failed_recent: FailedJobInfo[];
};

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith("."));
}

export function listFailedJobs(home: string, limit = 10): FailedJobInfo[] {
  const failedDir = join(paths(home).queue, "failed");
  const names = listJsonFiles(failedDir);
  const rows = names.map((name) => {
    const st = statSync(join(failedDir, name));
    return { name, mtime: st.mtime.toISOString(), ms: st.mtimeMs };
  });
  rows.sort((a, b) => b.ms - a.ms);
  return rows.slice(0, limit).map(({ name, mtime }) => ({ name, mtime }));
}

export function countPendingJobs(home: string): number {
  return listJsonFiles(paths(home).queue).length;
}

export function countFailedJobs(home: string): number {
  return listJsonFiles(join(paths(home).queue, "failed")).length;
}

/** Delete dead-letter job files only (no re-queue / retry semantics). */
export function purgeFailedJobs(home: string, names?: string[]): { purged: string[] } {
  const failedDir = join(paths(home).queue, "failed");
  if (!existsSync(failedDir)) return { purged: [] };
  const targets = names?.length ? names : listJsonFiles(failedDir);
  const purged: string[] = [];
  for (const name of targets) {
    if (
      !name.endsWith(".json") ||
      name.includes("/") ||
      name.includes("\\") ||
      name.startsWith(".")
    ) {
      continue;
    }
    const p = join(failedDir, name);
    if (!existsSync(p)) continue;
    rmSync(p, { force: true });
    purged.push(name);
  }
  return { purged };
}

function worst(a: DoctorStatus, b: DoctorStatus): DoctorStatus {
  const rank = { ok: 0, warn: 1, fail: 2 };
  return rank[a] >= rank[b] ? a : b;
}

export function runDoctor(home: string): DoctorReport {
  const p = paths(home);
  const store = new MemoryStore(home);
  const memoryFiles = store.listAll().length;
  const idx = new IndexStore(home);
  let indexSchemaVersion = 0;
  let indexMemoryRows = 0;
  try {
    indexSchemaVersion = idx.schemaVersion();
    indexMemoryRows = idx.countMemories();
  } finally {
    idx.close();
  }

  const queuePending = countPendingJobs(home);
  const queueFailed = countFailedJobs(home);
  const failedRecent = listFailedJobs(home, 5);
  const schemaOk = indexSchemaVersion === INDEX_SCHEMA_VERSION;
  const drift = indexMemoryRows !== memoryFiles;

  const checks: DoctorCheck[] = [
    { id: "home", value: existsSync(home), status: existsSync(home) ? "ok" : "fail" },
    {
      id: "config",
      value: existsSync(p.config),
      status: existsSync(p.config) ? "ok" : "fail",
    },
    { id: "node", value: process.versions.node, status: "ok" },
    {
      id: "spool_raw_files",
      value: existsSync(p.spoolRaw) ? readdirSync(p.spoolRaw).length : 0,
      status: "ok",
    },
    {
      id: "queue_pending",
      value: queuePending,
      status: queuePending > 20 ? "warn" : "ok",
    },
    {
      id: "queue_failed",
      value: queueFailed,
      status: queueFailed > 0 ? "warn" : "ok",
    },
    {
      id: "index_schema_version",
      value: indexSchemaVersion,
      status: schemaOk ? "ok" : "fail",
    },
    {
      id: "index_schema_expected",
      value: INDEX_SCHEMA_VERSION,
      status: "ok",
    },
    {
      id: "index_schema_ok",
      value: schemaOk,
      status: schemaOk ? "ok" : "fail",
    },
    {
      id: "index_memory_rows",
      value: indexMemoryRows,
      status: drift ? "warn" : "ok",
    },
    {
      id: "memory_files",
      value: memoryFiles,
      status: drift ? "warn" : "ok",
    },
    {
      id: "index_drift",
      value: drift,
      status: drift ? "warn" : "ok",
    },
  ];

  const actions: DoctorAction[] = [];
  if (!schemaOk || drift) {
    actions.push({
      id: "rebuild_index",
      command: "amem rebuild-index",
      reason: schemaOk
        ? "index row count differs from memory files"
        : "index schema version mismatch",
    });
  }
  if (queueFailed > 0) {
    actions.push({
      id: "inspect_failed",
      command: "amem failed list",
      reason: `${queueFailed} dead-letter job(s) in queue/failed`,
    });
  }
  if (queuePending > 0) {
    actions.push({
      id: "flush_queue",
      command: "amem flush",
      reason: `${queuePending} pending job(s) in queue`,
    });
  }

  let status: DoctorStatus = "ok";
  for (const c of checks) status = worst(status, c.status);

  return {
    home,
    status,
    checks,
    checks_legacy: checks.map((c) => [c.id, c.value]),
    actions,
    failed_recent: failedRecent,
  };
}
