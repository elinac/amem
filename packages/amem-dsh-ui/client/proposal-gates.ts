import {
  isProposalEligible,
  proposalGateGaps,
  proposalGateInputFromListRow,
  rollupProposalGateGaps,
  type ProposalGateId,
} from "@amem/core/proposal-gates";

export type { ProposalGateId };
export {
  isProposalEligible,
  proposalGateGaps,
  proposalGateInputFromListRow,
  rollupProposalGateGaps,
};

export function formatGateGaps(
  gaps: ProposalGateId[],
  labels: Record<ProposalGateId, string>,
): string {
  if (gaps.length === 0) return "";
  return gaps.map((g) => labels[g]).join(" · ");
}

export function dominantGateRollup(
  rollup: Partial<Record<ProposalGateId, number>>,
): Array<{ gate: ProposalGateId; count: number }> {
  return (Object.entries(rollup) as Array<[ProposalGateId, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([gate, count]) => ({ gate, count }));
}
