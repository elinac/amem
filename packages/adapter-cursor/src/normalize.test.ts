import { describe, expect, it } from "vitest";
import { normalizeCursorHook } from "./normalize.js";

describe("normalizeCursorHook", () => {
  it("maps postToolUse Shell with exitCode", () => {
    const events = normalizeCursorHook(
      "postToolUse",
      {
        conversation_id: "c1",
        generation_id: "g1",
        tool_name: "Shell",
        tool_use_id: "t1",
        tool_input: { command: "echo hi" },
        tool_output: JSON.stringify({ output: "hi\n", exitCode: 0 }),
        workspace_roots: ["/d:/dev/workspaces/QCoder/NoteZ"],
        user_email: "x@y.com",
        model: "claude-opus-5-5",
      },
      "u",
    );
    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe("tool_call");
    expect(events[1]!.type).toBe("tool_result");
    expect(events[1]!.payload.exitCode).toBe(0);
    expect(events[0]!.workspace?.roots[0]).toMatch(/^D:\\/);
    expect(JSON.stringify(events)).not.toContain("x@y.com");
  });

  it("skips afterShellExecution", () => {
    expect(normalizeCursorHook("afterShellExecution", { command: "x" }, "u")).toEqual([]);
  });
});
