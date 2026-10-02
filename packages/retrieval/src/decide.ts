import type { MemoryRecord } from "@amem/core";

export type RecallMode = "shadow" | "assist" | "enforce";

export type RecallDecisionKind = "use" | "verify" | "ignore";

export type RecallHit = { memory: MemoryRecord; score: number };

export type RecallDecision = {
  memory: MemoryRecord;
  score: number;
  decision: RecallDecisionKind;
  reason: string;
};

const VERIFY_SCORE_MIN = 0.25;
const USE_SCORE_MIN = 0.35;

/**
 * Pure gate: retrieval hits → inject decisions. Does not mutate records or scores.
 * Spec: only `active` without pending `conflicts_with` may be use/verify.
 */
export function decideRecall(
  hits: RecallHit[],
  mode: RecallMode = "assist",
): RecallDecision[] {
  return hits.map((h) => {
    const m = h.memory;
    if (m.status === "conflict") {
      return { ...h, decision: "ignore" as const, reason: "status_conflict" };
    }
    if (m.status !== "active") {
      return { ...h, decision: "ignore" as const, reason: `status_${m.status}` };
    }
    if ((m.conflicts_with ?? []).length > 0) {
      return { ...h, decision: "ignore" as const, reason: "pending_conflicts_with" };
    }
    if (m.stats.harmful >= 2) {
      return { ...h, decision: "ignore" as const, reason: "harmful_gate" };
    }
    if (h.score < VERIFY_SCORE_MIN) {
      return { ...h, decision: "ignore" as const, reason: "score_low" };
    }
    if (h.score < USE_SCORE_MIN || m.trust === "T3") {
      if (mode === "enforce") {
        return { ...h, decision: "ignore" as const, reason: "enforce_skips_verify" };
      }
      return { ...h, decision: "verify" as const, reason: "needs_verify" };
    }
    return { ...h, decision: "use" as const, reason: "eligible" };
  });
}

/** Hits that may enter a Context Pack under the given mode. */
export function injectableDecisions(
  decisions: RecallDecision[],
  mode: RecallMode,
): RecallDecision[] {
  if (mode === "shadow") return [];
  if (mode === "enforce") return decisions.filter((d) => d.decision === "use");
  return decisions.filter((d) => d.decision === "use" || d.decision === "verify");
}
