import { defaultConfig } from "@amem/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleClient, normalizeCandidates } from "./index.js";

const blob = `${[
  JSON.stringify({
    v: 1,
    ts: "2026-01-01T00:00:00.000Z",
    host: "dsh",
    type: "user_prompt",
    session_id: "s1",
    payload: { text: "start the dev server" },
  }),
  JSON.stringify({
    v: 1,
    ts: "2026-01-01T00:00:05.000Z",
    host: "dsh",
    type: "tool_result",
    session_id: "s1",
    payload: { output: 'Error: Port 3000 is already in use. He said "use another port"' },
  }),
].join("\n")}\n`;

function candidate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "failure",
    title: "port already in use",
    content: "Find the process holding the port before switching config.",
    applies_when: "dev server fails to start on a fixed port",
    evidence: [{ event: 1, quote: "Error: Port 3000 is already in use" }],
    ...over,
  };
}

describe("normalizeCandidates", () => {
  it("maps out-of-enum kinds onto the fixed enum", () => {
    const kinds = [
      ["constraint", "constraint_hint"],
      ["project_fact", "fact"],
      ["environment", "fact"],
      ["known_issue", "failure"],
      ["workflow", "procedure"],
      ["acceptance_criteria", "criterion"],
      ["banana", "fact"],
    ] as const;
    for (const [raw, expected] of kinds) {
      const out = normalizeCandidates({ candidates: [candidate({ kind: raw })] }, blob);
      expect(out[0]?.kind).toBe(expected);
    }
  });

  it("never falls back to procedure so drift cannot reach the L3 gate", () => {
    const out = normalizeCandidates({ candidates: [candidate({ kind: "mystery" })] }, blob);
    expect(out[0]?.kind).not.toBe("procedure");
  });

  it("resolves a label-style evidence event to the numeric line index", () => {
    const out = normalizeCandidates(
      {
        candidates: [
          candidate({
            evidence: [{ event: "tool_result: command failed", quote: "Error: Port 3000" }],
          }),
        ],
      },
      blob,
    );
    expect(out[0]?.evidence[0]).toEqual({ event: 1, quote: "Error: Port 3000" });
  });

  it("accepts a numeric-string event and matches quotes with escaped quotes", () => {
    const out = normalizeCandidates(
      {
        candidates: [
          candidate({
            evidence: [{ event: "1", quote: 'He said "use another port"' }],
          }),
        ],
      },
      blob,
    );
    expect(out[0]?.evidence[0]?.event).toBe(1);
  });

  it("drops ungrounded evidence and then the candidate itself (I3)", () => {
    const out = normalizeCandidates(
      { candidates: [candidate({ evidence: [{ event: 3, quote: "text that never happened" }] })] },
      blob,
    );
    expect(out).toEqual([]);
  });

  it("drops candidates missing an applies_when or evidence", () => {
    const out = normalizeCandidates(
      {
        candidates: [
          candidate({ applies_when: "   " }),
          candidate({ evidence: [] }),
          candidate({ evidence: [{ event: 1 }] }),
        ],
      },
      blob,
    );
    expect(out).toEqual([]);
  });

  it("truncates over-long fields instead of rejecting the candidate", () => {
    const out = normalizeCandidates(
      { candidates: [candidate({ title: "t".repeat(200), content: "c".repeat(3000) })] },
      blob,
    );
    expect(out[0]?.title).toHaveLength(80);
    expect(out[0]?.content).toHaveLength(1200);
  });

  it("caps output at the schema limit of 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => candidate({ title: `t${i}` }));
    expect(normalizeCandidates({ candidates: many }, blob)).toHaveLength(8);
  });

  it("tolerates a bare array and unusable input", () => {
    expect(normalizeCandidates([candidate()], blob)).toHaveLength(1);
    expect(normalizeCandidates("nope", blob)).toEqual([]);
    expect(normalizeCandidates(null, blob)).toEqual([]);
  });
});

describe("OpenAiCompatibleClient.extractCandidates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function cfgWithKey() {
    const cfg = defaultConfig();
    cfg.llm.mode = "external";
    cfg.llm.api_key = "test-key";
    cfg.llm.base_url = "https://llm.example";
    return cfg;
  }

  function stubContent(content: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
      })),
    );
  }

  it("normalizes drifting model output instead of throwing", async () => {
    stubContent(
      JSON.stringify({
        candidates: [
          {
            kind: "constraint",
            title: "amem workspace root is write-protected",
            content: "Shell calls fail before running; prefer read/grep/glob.",
            applies_when: "probing the amem workspace via shell",
            evidence: [{ event: "tool_result: shell call failed", quote: "Error: Port 3000" }],
          },
        ],
      }),
    );
    const out = await new OpenAiCompatibleClient(cfgWithKey()).extractCandidates({
      summary: "s",
      episodeBlob: blob,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("constraint_hint");
    expect(out[0]?.evidence[0]?.event).toBe(1);
  });

  it("parses fenced JSON", async () => {
    stubContent(`\`\`\`json\n${JSON.stringify({ candidates: [candidate()] })}\n\`\`\``);
    const out = await new OpenAiCompatibleClient(cfgWithKey()).extractCandidates({
      summary: "s",
      episodeBlob: blob,
    });
    expect(out).toHaveLength(1);
  });

  it("returns no candidates (and does not throw) on unparseable content", async () => {
    stubContent("I could not produce JSON today.");
    await expect(
      new OpenAiCompatibleClient(cfgWithKey()).extractCandidates({
        summary: "s",
        episodeBlob: blob,
      }),
    ).resolves.toEqual([]);
  });
});
