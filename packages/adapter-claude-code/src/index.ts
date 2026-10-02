import {
  type CanonicalEvent,
  instanceIdFromWorkspace,
  normalizeWorkspaceRoot,
  redactDeep,
} from "@amem/core";

/**
 * Claude Code hook event names differ; we accept SessionStart/PostToolUse/Stop style
 * and map to canonical events. Field names marked flexible.
 */
export function normalizeClaudeHook(
  eventName: string,
  rawInput: unknown,
  userId: string,
  redactPatterns: string[] = [],
): CanonicalEvent[] {
  const raw = redactDeep(
    typeof rawInput === "object" && rawInput ? rawInput : {},
    "",
    { patterns: redactPatterns },
  ) as Record<string, unknown>;
  const name = eventName.replace(/^claude:/, "");
  const session =
    String(raw.session_id ?? raw.sessionId ?? raw.conversation_id ?? "unknown");
  const roots = Array.isArray(raw.cwd)
    ? (raw.cwd as string[]).map(String)
    : raw.cwd
      ? [normalizeWorkspaceRoot(String(raw.cwd))]
      : [];
  const base = {
    v: 1 as const,
    ts: new Date().toISOString(),
    host: "claude-code" as const,
    session_id: session,
    user_id: userId,
    workspace: roots.length
      ? { roots, instance_id: instanceIdFromWorkspace(roots) }
      : undefined,
  };

  const lower = name.toLowerCase();
  if (lower === "sessionstart" || lower === "session_start") {
    return [{ ...base, type: "session_start", payload: raw }];
  }
  if (lower === "sessionend" || lower === "stop" || lower === "session_end") {
    return [{ ...base, type: "session_end", payload: raw }];
  }
  if (lower === "posttooluse" || lower === "post_tool_use") {
    return [
      {
        ...base,
        type: "tool_call",
        payload: { tool_name: raw.tool_name ?? raw.toolName, tool_input: raw.tool_input },
      },
      {
        ...base,
        type: "tool_result",
        payload: {
          tool_name: raw.tool_name ?? raw.toolName,
          output: String(raw.tool_response ?? raw.output ?? "").slice(0, 4000),
        },
      },
    ];
  }
  return [];
}
