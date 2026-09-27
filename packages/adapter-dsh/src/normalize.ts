import {
  type CanonicalEvent,
  instanceIdFromWorkspace,
  normalizeWorkspaceRoot,
  redactDeep,
} from "@amem/core";

export type DshSessionMeta = {
  session_id: string;
  workspace_roots?: string[];
  user_id: string;
  host_version?: string;
};

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (b && typeof b === "object" && (b as { type?: string }).type === "text") {
      const t = (b as { text?: unknown }).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.join("\n");
}

function base(
  meta: DshSessionMeta,
  data: Record<string, unknown>,
  time?: number,
): Omit<CanonicalEvent, "type" | "payload"> {
  const roots = (meta.workspace_roots ?? []).map((r) => normalizeWorkspaceRoot(r));
  return {
    v: 1,
    ts: typeof time === "number" ? new Date(time).toISOString() : new Date().toISOString(),
    host: "dsh",
    host_version: meta.host_version,
    session_id: meta.session_id,
    turn_id: data.turn != null ? String(data.turn) : undefined,
    workspace: roots.length
      ? { roots, instance_id: instanceIdFromWorkspace(roots) }
      : undefined,
    user_id: meta.user_id,
  };
}

export function normalizeDshLifecycle(
  kind: "session_start" | "session_end",
  meta: DshSessionMeta,
): CanonicalEvent[] {
  return [{ ...base(meta, {}), type: kind, payload: {} }];
}

export function normalizeDshSessionEvent(
  event: unknown,
  meta: DshSessionMeta,
): CanonicalEvent[] {
  if (!event || typeof event !== "object") return [];
  const ev = redactDeep(event) as {
    type?: unknown;
    time?: unknown;
    data?: unknown;
  };
  const type = typeof ev.type === "string" ? ev.type : "";
  const data =
    ev.data && typeof ev.data === "object"
      ? (ev.data as Record<string, unknown>)
      : {};
  const time = typeof ev.time === "number" ? ev.time : undefined;
  const b = base(meta, data, time);

  if (type === "user/message") {
    const msg = data.message as { content?: unknown; source?: { kind?: string } } | undefined;
    const src = (data.source ?? msg?.source) as { kind?: string } | undefined;
    if (src?.kind !== "user") return [];
    const content = data.content ?? msg?.content;
    return [{ ...b, type: "user_prompt", payload: { prompt: textFromContent(content) } }];
  }
  if (type === "assistant/message") {
    const msg = data.message as { content?: unknown } | undefined;
    const text = textFromContent(msg?.content).slice(0, 500);
    return [{ ...b, type: "agent_response", payload: { text } }];
  }
  if (type === "tool/call") {
    return [
      {
        ...b,
        type: "tool_call",
        payload: {
          tool_name: data.name,
          tool_input: data.arguments,
          call_id: data.callId,
        },
      },
    ];
  }
  if (type === "tool/result") {
    const msg = data.message as {
      content?: unknown;
      toolCallId?: unknown;
      isError?: unknown;
      source?: { callId?: unknown };
    } | undefined;
    return [
      {
        ...b,
        type: "tool_result",
        payload: {
          call_id: msg?.toolCallId ?? msg?.source?.callId,
          output: textFromContent(msg?.content).slice(0, 4000),
          is_error: Boolean(msg?.isError ?? data.error),
        },
      },
    ];
  }
  if (type === "turn/end") {
    return [];
  }
  return [];
}
