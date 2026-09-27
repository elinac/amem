import { describe, expect, it } from "vitest";
import {
  CanonicalEventSchema,
  ExtractCandidatesSchema,
  assertWritableMemory,
  canPromoteKind,
  containsSecrets,
  evidenceQuotesValid,
  isSafeId,
  normalizeWorkspaceRoot,
  redactDeep,
  redactString,
  sanitizeId,
} from "./index.js";

describe("normalizeWorkspaceRoot", () => {
  it("converts Cursor /d:/ paths", () => {
    expect(normalizeWorkspaceRoot("/d:/dev/workspaces/QCoder/NoteZ")).toBe(
      "D:\\dev\\workspaces\\QCoder\\NoteZ",
    );
  });
});

describe("sanitizeId", () => {
  it("keeps allowlisted ids", () => {
    expect(sanitizeId("sess-1.2_ok")).toBe("sess-1.2_ok");
    expect(isSafeId("sess-1.2_ok")).toBe(true);
  });

  it("maps path traversal to a safe hash token", () => {
    const out = sanitizeId("../../../../tmp/evil");
    expect(isSafeId(out)).toBe(true);
    expect(out.startsWith("sid_")).toBe(true);
    expect(out).not.toContain("..");
    expect(out).not.toContain("/");
    expect(out).not.toContain("\\");
  });
});

describe("redact", () => {
  it("masks secrets and emails", () => {
    const out = redactDeep({
      api_key: "abc",
      note: "sk-abcdefghijklmnopqrstuvwxyz",
      user_email: "a@b.com",
    }) as Record<string, string>;
    expect(out.api_key).toBe("[redacted]");
    expect(out.note).toBe("[redacted]");
    expect(out.user_email).toBe("[redacted]");
    expect(containsSecrets("sk-abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(redactString("hello")).toBe("hello");
  });
});

describe("schemas", () => {
  it("accepts canonical event", () => {
    const e = CanonicalEventSchema.parse({
      v: 1,
      ts: new Date().toISOString(),
      host: "cursor",
      session_id: "s1",
      user_id: "u",
      type: "tool_call",
      payload: {},
    });
    expect(e.session_id).toBe("s1");
  });

  it("rejects extract without evidence", () => {
    const r = ExtractCandidatesSchema.safeParse({
      candidates: [
        {
          kind: "fact",
          title: "t",
          content: "c",
          applies_when: "a",
          evidence: [],
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("invariants", () => {
  it("blocks T1 from pipeline", () => {
    expect(() =>
      assertWritableMemory(
        {
          kind: "fact",
          trust: "T1",
          status: "active",
          scope: { level: "instance", tags: {} },
        },
        "pipeline",
      ),
    ).toThrow(/I2/);
  });

  it("blocks preference promotion", () => {
    expect(canPromoteKind("preference")).toBe(false);
    expect(() =>
      assertWritableMemory(
        {
          kind: "preference",
          trust: "T3",
          status: "active",
          scope: { level: "global", tags: {} },
        },
        "pipeline",
      ),
    ).toThrow(/I5/);
  });

  it("validates evidence quotes", () => {
    expect(evidenceQuotesValid([{ quote: "Port 3000" }], "Error: Port 3000 is already in use")).toBe(
      true,
    );
    expect(evidenceQuotesValid([{ quote: "missing" }], "Error: Port 3000")).toBe(false);
  });
});
