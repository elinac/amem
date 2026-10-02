import type { CanonicalEvent, MemoryRecord } from "@amem/core";
import { describe, expect, it } from "vitest";
import {
  MIN_CANDIDATE_EVIDENCE_LENGTH,
  externalEventLines,
  externalEvidenceFor,
  verifiedCandidateEvidence,
} from "./verify.js";

const HINT = "SetNamedSecurityInfoW failed (Win32 5): grantWrite";

function ev(partial: Partial<CanonicalEvent> & Pick<CanonicalEvent, "type">): CanonicalEvent {
  return {
    v: 1,
    ts: "2026-10-01T00:00:00.000Z",
    host: "dsh",
    session_id: "s1",
    user_id: "u",
    payload: {},
    ...partial,
  };
}

describe("externalEventLines", () => {
  it("keeps external signals with their original index and drops agent-authored events", () => {
    const lines = externalEventLines([
      ev({ type: "session_start" }),
      ev({ type: "tool_call", payload: { tool_input: { evidence_hint: HINT } } }),
      ev({ type: "tool_result", payload: { output: `failed: ${HINT}` } }),
      ev({ type: "agent_response", payload: { text: HINT } }),
      ev({ type: "user_prompt", payload: { prompt: `again ${HINT}` } }),
    ]);
    expect(lines.map((l) => l.index)).toEqual([2, 4]);
    expect(lines.map((l) => l.type)).toEqual(["tool_result", "user_prompt"]);
  });
});

describe("externalEvidenceFor", () => {
  const external = [
    { index: 2, type: "tool_result", line: JSON.stringify({ payload: { output: `x ${HINT} y` } }) },
  ];

  it(`ignores needles shorter than ${MIN_CANDIDATE_EVIDENCE_LENGTH} characters`, () => {
    expect(externalEvidenceFor(["Win32 5"], external)).toBeUndefined();
  });

  it("returns the original event index and the matched quote", () => {
    expect(externalEvidenceFor([HINT], external)).toEqual({ event: 2, quote: HINT });
  });

  it("prefers the longest matching needle", () => {
    const long = `${HINT} (more specific)`;
    const wide = [{ index: 0, type: "tool_result", line: `prefix ${long} suffix` }];
    expect(externalEvidenceFor([HINT, long], wide)).toEqual({ event: 0, quote: long });
  });

  it("records the JSON-escaped form when the hint spans characters the episode escapes", () => {
    const needle = "grantWrite(D:\\dev\\workspaces\\amem)";
    const lines = [
      {
        index: 7,
        type: "tool_result",
        line: JSON.stringify({ payload: { output: `failed ${needle}` } }),
      },
    ];
    const hit = externalEvidenceFor([needle], lines)!;
    expect(hit.event).toBe(7);
    expect(hit.quote).not.toBe(needle);
    // The recorded quote stays verbatim in the stored Episode line (I3).
    expect(lines[0]!.line.includes(hit.quote)).toBe(true);
  });

  it("returns undefined when nothing matches", () => {
    expect(externalEvidenceFor(["never appears in any external event"], external)).toBeUndefined();
  });
});

describe("verifiedCandidateEvidence", () => {
  const meta = { episode_id: "ep_1", instance_id: "inst_1" } as never;
  const external = [{ index: 3, type: "tool_result", line: `boom ${HINT}` }];
  const note = (over: Partial<MemoryRecord> = {}): MemoryRecord =>
    ({
      id: "mem_note",
      status: "candidate",
      evidence: { episodes: [], quotes: [{ ep: "agent-note", text: HINT }], count: 0 },
      ...over,
    }) as MemoryRecord;

  it("grounds a candidate in an external signal", () => {
    expect(verifiedCandidateEvidence(note(), meta, external)).toEqual({ event: 3, quote: HINT });
  });

  it("ignores records that are not candidates", () => {
    expect(verifiedCandidateEvidence(note({ status: "active" }), meta, external)).toBeUndefined();
  });

  it("ignores an episode that is already recorded as evidence", () => {
    const withEpisode = note({
      evidence: { episodes: ["ep_1"], quotes: [{ ep: "agent-note", text: HINT }], count: 1 },
    } as Partial<MemoryRecord>);
    expect(verifiedCandidateEvidence(withEpisode, meta, external)).toBeUndefined();
  });

  it("tolerates a record without quotes", () => {
    const noQuotes = note({ evidence: { episodes: [], count: 0 } } as Partial<MemoryRecord>);
    expect(verifiedCandidateEvidence(noQuotes, meta, external)).toBeUndefined();
  });
});
