import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { paths } from "@amem/core";
import { type ConflictActor, MemoryStore, migrateLinkConflict } from "@amem/store";

/** Legacy body marker: ⚠ conflicts with <id> */
const BODY_MARKER = /⚠\s*conflicts\s+with\s+([A-Za-z0-9._-]+)/i;

export type MigrateConflictsReport = {
  scanned: number;
  linked: number;
  skipped: number;
  reports: number;
  dryRun: boolean;
};

function reportPath(home: string): string {
  return join(paths(home).manifests, "reports", "conflict-migrate.jsonl");
}

function appendReport(home: string, row: Record<string, unknown>): void {
  const p = reportPath(home);
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
}

function parseMarker(content: string): string | null {
  const m = content.match(BODY_MARKER);
  return m?.[1] ?? null;
}

/**
 * Migrate legacy body conflict markers into structured conflicts_with via journal.
 * Unparseable / missing peer: report only — do not mutate status.
 */
export function migrateConflicts(
  home: string,
  opts: { dryRun?: boolean; actor?: ConflictActor } = {},
): MigrateConflictsReport {
  const dryRun = opts.dryRun === true;
  const actor: ConflictActor = opts.actor ?? { kind: "cli" };
  const store = new MemoryStore(home);
  const all = store.listAll();
  const byId = new Map(all.map((m) => [m.id, m]));
  let linked = 0;
  let skipped = 0;
  let reports = 0;
  const seenPairs = new Set<string>();

  for (const m of all) {
    const peerId = parseMarker(m.content);
    if (!peerId) continue;
    const pairKey = [m.id, peerId].sort().join("|");
    if (seenPairs.has(pairKey)) {
      skipped += 1;
      continue;
    }
    seenPairs.add(pairKey);

    const peer = byId.get(peerId);
    if (!peer) {
      appendReport(home, {
        kind: "missing_peer",
        memoryId: m.id,
        peerId,
        dryRun,
      });
      reports += 1;
      continue;
    }

    const already =
      (m.conflicts_with ?? []).includes(peerId) &&
      (peer.conflicts_with ?? []).includes(m.id) &&
      m.status === "conflict" &&
      peer.status === "conflict";
    if (already) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      appendReport(home, {
        kind: "would_link",
        leftId: m.id,
        rightId: peer.id,
        dryRun: true,
      });
      reports += 1;
      linked += 1;
      continue;
    }

    try {
      migrateLinkConflict(home, m, peer, actor);
      linked += 1;
      // refresh map
      const left = store.readById(m.id);
      const right = store.readById(peer.id);
      if (left) byId.set(left.id, left);
      if (right) byId.set(right.id, right);
    } catch (e) {
      appendReport(home, {
        kind: "link_failed",
        leftId: m.id,
        rightId: peer.id,
        error: e instanceof Error ? e.message : String(e),
        dryRun: false,
      });
      reports += 1;
    }
  }

  return {
    scanned: all.length,
    linked,
    skipped,
    reports,
    dryRun,
  };
}

export function readMigrateReport(home: string): string {
  const p = reportPath(home);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}
