import { describe, expect, it } from "vitest";
import { normalizeClaudeHook } from "./index.js";

describe("normalizeClaudeHook", () => {
  it("maps PostToolUse", () => {
    const ev = normalizeClaudeHook(
      "PostToolUse",
      { session_id: "s", tool_name: "Bash", tool_response: "ok", cwd: "/tmp" },
      "u",
    );
    expect(ev).toHaveLength(2);
    expect(ev[0]!.host).toBe("claude-code");
  });
});
