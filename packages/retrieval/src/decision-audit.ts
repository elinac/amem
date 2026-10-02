import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { paths } from "@amem/core";

/** Append gate decision audit lines (W3). */
export function appendDecisionAudit(
  home: string,
  row: {
    decision_id: string;
    pack_id: string;
    memory_id: string;
    decision: string;
    reason: string;
    mode: string;
    score: number;
  },
): void {
  const p = join(paths(home).manifests, "audit", "recall-decisions.jsonl");
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
}

export function readDecisionAudit(home: string): string {
  const p = join(paths(home).manifests, "audit", "recall-decisions.jsonl");
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}
