import {
  type CanonicalEvent,
  instanceIdFromWorkspace,
  normalizeWorkspaceRoot,
  redactDeep,
} from "@amem/core";

type Raw = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function rootsOf(raw: Raw): string[] {
  const roots = raw.workspace_roots;
  if (!Array.isArray(roots)) return [];
  return roots.map((r) => normalizeWorkspaceRoot(String(r)));
}

function base(raw: Raw, userId: string): Omit<CanonicalEvent, "type" | "payload"> {
  const roots = rootsOf(raw);
  const session = str(raw.conversation_id) ?? str(raw.session_id) ?? "unknown";
  return {
    v: 1,
    ts: new Date().toISOString(),
    host: "cursor",
    host_version: str(raw.cursor_version),
    session_id: session,
    turn_id: str(raw.generation_id),
    workspace: roots.length
      ? { roots, instance_id: instanceIdFromWorkspace(roots) }
      : undefined,
    user_id: userId,
    model: str(raw.model),
  };
}

function parseToolOutput(raw: unknown): { text: string; exitCode?: number } {
  if (typeof raw !== "string") return { text: String(raw ?? "") };
  try {
    const j = JSON.parse(raw) as { output?: string; exitCode?: number };
    return { text: j.output ?? raw, exitCode: j.exitCode };
  } catch {
    return { text: raw };
  }
}

/**
 * Normalize Cursor hook stdin JSON into canonical events.
 * afterShellExecution is ignored as a primary event (no exitCode / tool_use_id) — §11.2.1
 */
export function normalizeCursorHook(
  eventName: string,
  rawInput: unknown,
  userId: string,
): CanonicalEvent[] {
  const raw = (typeof rawInput === "object" && rawInput ? rawInput : {}) as Raw;
  const scrubbed = redactDeep(raw) as Raw;
  // drop email
  delete scrubbed.user_email;

  const b = base(scrubbed, userId);

  switch (eventName) {
    case "sessionStart":
      return [{ ...b, type: "session_start", payload: { transcript_path: scrubbed.transcript_path } }];
    case "sessionEnd":
      return [{ ...b, type: "session_end", payload: { transcript_path: scrubbed.transcript_path } }];
    case "beforeSubmitPrompt":
      return [
        {
          ...b,
          type: "user_prompt",
          payload: { prompt: scrubbed.prompt ?? scrubbed.content },
        },
      ];
    case "afterAgentResponse":
      return [
        {
          ...b,
          type: "agent_response",
          payload: {
            text: typeof scrubbed.text === "string" ? scrubbed.text.slice(0, 500) : scrubbed,
          },
        },
      ];
    case "postToolUse":
    case "postToolUseFailure": {
      const out = parseToolOutput(scrubbed.tool_output);
      const toolName = str(scrubbed.tool_name) ?? "unknown";
      const toolInput = scrubbed.tool_input ?? {};
      const events: CanonicalEvent[] = [
        {
          ...b,
          type: "tool_call",
          payload: {
            tool_name: toolName,
            tool_use_id: scrubbed.tool_use_id,
            tool_input: toolInput,
          },
        },
        {
          ...b,
          type: "tool_result",
          payload: {
            tool_name: toolName,
            tool_use_id: scrubbed.tool_use_id,
            ok: eventName === "postToolUse",
            output: out.text.slice(0, 4000),
            exitCode: out.exitCode,
            duration: scrubbed.duration,
          },
        },
      ];
      return events;
    }
    case "afterFileEdit":
      return [
        {
          ...b,
          type: "file_edit",
          payload: {
            path: scrubbed.file_path ?? scrubbed.path,
            // content intentionally omitted
          },
        },
      ];
    case "preCompact":
      return [{ ...b, type: "compact", payload: {} }];
    case "afterShellExecution":
      // redundant with postToolUse for Shell — skip
      return [];
    case "stop":
      return [];
    default:
      return [];
  }
}

export function hookRespond(eventName: string): string {
  if (eventName === "beforeSubmitPrompt") return JSON.stringify({ continue: true });
  return "{}";
}
