import { describe, expect, it } from "vitest";
import {
  isProposalEligible,
  proposalGateGaps,
  proposalGateInputFromListRow,
  rollupProposalGateGaps,
} from "./proposal-gates.js";

describe("proposalGateGaps", () => {
  const eligible = {
    kind: "procedure" as const,
    trust: "T2" as const,
    scope: { level: "domain" as const },
    evidence: { distinct_instances: 3 },
  };

  it("returns no gaps for an eligible procedure", () => {
    expect(proposalGateGaps(eligible)).toEqual([]);
    expect(isProposalEligible(eligible)).toBe(true);
  });

  it("lists each missing gate", () => {
    expect(
      proposalGateGaps({
        kind: "fact",
        trust: "T3",
        scope: { level: "instance" },
        evidence: { distinct_instances: 1 },
      }),
    ).toEqual(["kind", "level", "trust", "instances"]);
  });

  it("rolls up gaps across memories", () => {
    const rollup = rollupProposalGateGaps([
      eligible,
      {
        kind: "fact",
        trust: "T2",
        scope: { level: "domain" },
        evidence: { distinct_instances: 3 },
      },
      {
        kind: "procedure",
        trust: "T3",
        scope: { level: "domain" },
        evidence: { distinct_instances: 3 },
      },
    ]);
    expect(rollup.kind).toBe(1);
    expect(rollup.trust).toBe(1);
    expect(rollup.level).toBeUndefined();
  });

  it("adapts list rows", () => {
    expect(
      proposalGateGaps(
        proposalGateInputFromListRow({
          kind: "procedure",
          level: "global",
          trust: "T1",
          distinct_instances: 5,
        }),
      ),
    ).toEqual([]);
  });
});
