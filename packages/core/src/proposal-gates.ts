import type { MemoryKind, MemoryRecord, ScopeLevel, Trust } from "./types.js";

/** Minimum distinct_instances required to emit a Proposal (matches consolidate). */
export const PROPOSAL_MIN_DISTINCT_INSTANCES = 3;

export type ProposalGateId = "kind" | "level" | "trust" | "instances";

/** Fields needed to evaluate Proposal eligibility without a full MemoryRecord. */
export type ProposalGateInput = {
  kind: MemoryKind;
  trust: Trust;
  scope: { level: ScopeLevel };
  evidence: { distinct_instances: number };
};

export function proposalGateGaps(m: ProposalGateInput): ProposalGateId[] {
  const gaps: ProposalGateId[] = [];
  if (m.kind !== "procedure") gaps.push("kind");
  if (m.scope.level !== "domain" && m.scope.level !== "global") gaps.push("level");
  if (m.trust !== "T1" && m.trust !== "T2") gaps.push("trust");
  if (m.evidence.distinct_instances < PROPOSAL_MIN_DISTINCT_INSTANCES) gaps.push("instances");
  return gaps;
}

export function isProposalEligible(m: ProposalGateInput): boolean {
  return proposalGateGaps(m).length === 0;
}

export function rollupProposalGateGaps(
  items: ProposalGateInput[],
): Partial<Record<ProposalGateId, number>> {
  const rollup: Partial<Record<ProposalGateId, number>> = {};
  for (const item of items) {
    for (const g of proposalGateGaps(item)) {
      rollup[g] = (rollup[g] ?? 0) + 1;
    }
  }
  return rollup;
}

/** Adapt a list-row shaped object (level at top level) into ProposalGateInput. */
export function proposalGateInputFromListRow(row: {
  kind: MemoryKind;
  level: ScopeLevel;
  trust: Trust;
  distinct_instances: number;
}): ProposalGateInput {
  return {
    kind: row.kind,
    trust: row.trust,
    scope: { level: row.level },
    evidence: { distinct_instances: row.distinct_instances },
  };
}

export function proposalGateInputFromMemory(m: MemoryRecord): ProposalGateInput {
  return {
    kind: m.kind,
    trust: m.trust,
    scope: { level: m.scope.level },
    evidence: { distinct_instances: m.evidence.distinct_instances },
  };
}
