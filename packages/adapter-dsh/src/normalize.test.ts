import { describe, expect, it } from "vitest";
import { normalizeDshLifecycle, normalizeDshSessionEvent } from "./normalize.js";

const meta = { session_id: "s1", user_id: "u", workspace_roots: ["D:/proj"] };

describe("normalizeDshSessionEvent", () => {
  it("maps user/message with kind=user", () => {
    const ev = normalizeDshSessionEvent(
      {
        type: "user/message",
        time: 1_700_000_000_000,
        data: {
          source: { kind: "user" },
          content: [{ type: "text", text: "hello" }],
          turn: 1,
        },
      },
      meta,
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]!.host).toBe("dsh");
    expect(ev[0]!.type).toBe("user_prompt");
    expect(ev[0]!.payload.prompt).toBe("hello");
  });

  it("skips inject-style user/message", () => {
    const ev = normalizeDshSessionEvent(
      {
        type: "user/message",
        data: {
          message: {
            source: { kind: "system-prompt" },
            content: [{ type: "text", text: "injected" }],
          },
        },
      },
      meta,
    );
    expect(ev).toEqual([]);
  });

  it("maps tool/call and tool/result", () => {
    const call = normalizeDshSessionEvent(
      {
        type: "tool/call",
        data: { name: "bash", arguments: "{}", callId: "c1", turn: 2 },
      },
      meta,
    );
    expect(call[0]!.type).toBe("tool_call");
    const result = normalizeDshSessionEvent(
      {
        type: "tool/result",
        data: {
          message: {
            toolCallId: "c1",
            content: [{ type: "text", text: "ok" }],
            isError: false,
          },
        },
      },
      meta,
    );
    expect(result[0]!.type).toBe("tool_result");
    expect(result[0]!.payload.output).toBe("ok");
  });

  it("truncates assistant text to 500", () => {
    const long = "x".repeat(600);
    const ev = normalizeDshSessionEvent(
      {
        type: "assistant/message",
        data: { message: { content: [{ type: "text", text: long }] } },
      },
      meta,
    );
    expect(String(ev[0]!.payload.text).length).toBe(500);
  });
});

describe("normalizeDshLifecycle", () => {
  it("emits session_start/end", () => {
    expect(normalizeDshLifecycle("session_start", meta)[0]!.type).toBe("session_start");
    expect(normalizeDshLifecycle("session_end", meta)[0]!.type).toBe("session_end");
  });
});
