import type { MemoryRecord } from "@amem/core";

export type RecallMode = "shadow" | "assist" | "enforce";

export type RecallDecisionKind = "use" | "verify" | "ignore";

/** Additive score breakdown (weights unchanged from scoreMemory). */
export type ScoreParts = {
  rel: number;
  tag: number;
  trust: number;
  lift: number;
  levelAdj: number;
};

export type RecallHit = {
  memory: MemoryRecord;
  score: number;
  /** Present when hit came from explainScore / recall. */
  parts?: ScoreParts;
};

export type RecallDecision = {
  memory: MemoryRecord;
  score: number;
  decision: RecallDecisionKind;
  reason: string;
  parts?: ScoreParts;
};

const VERIFY_SCORE_MIN = 0.25;
const USE_SCORE_MIN = 0.35;

/**
 * Pure gate: retrieval hits → inject decisions. Does not mutate records or scores.
 * Spec: only `active` without pending `conflicts_with` may be use/verify.
 * I11: ids in blockedIds (open conflict journals) → ignore / journal_pending.
 */
export function decideRecall(
  hits: RecallHit[],
  mode: RecallMode = "assist",
  opts?: { blockedIds?: ReadonlySet<string> },
): RecallDecision[] {
  const blocked = opts?.blockedIds;
  return hits.map((h) => {
    const m = h.memory;
    const base = {
      memory: m,
      score: h.score,
      ...(h.parts ? { parts: h.parts } : {}),
    };
    if (blocked?.has(m.id)) {
      return { ...base, decision: "ignore" as const, reason: "journal_pending" };
    }
    if (m.status === "conflict") {
      return { ...base, decision: "ignore" as const, reason: "status_conflict" };
    }
    if (m.status !== "active") {
      return { ...base, decision: "ignore" as const, reason: `status_${m.status}` };
    }
    if ((m.conflicts_with ?? []).length > 0) {
      return { ...base, decision: "ignore" as const, reason: "pending_conflicts_with" };
    }
    if (m.stats.harmful >= 2) {
      return { ...base, decision: "ignore" as const, reason: "harmful_gate" };
    }
    if (h.score < VERIFY_SCORE_MIN) {
      return { ...base, decision: "ignore" as const, reason: "score_low" };
    }
    if (h.score < USE_SCORE_MIN || m.trust === "T3") {
      if (mode === "enforce") {
        return { ...base, decision: "ignore" as const, reason: "enforce_skips_verify" };
      }
      return { ...base, decision: "verify" as const, reason: "needs_verify" };
    }
    return { ...base, decision: "use" as const, reason: "eligible" };
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
