import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  type CanonicalEvent,
  instanceIdFromWorkspace,
  normalizeWorkspaceRoot,
  redactDeep,
} from "@amem/core";

/**
 * Best-effort import of Cursor agent-transcripts JSONL.
 * Structure varies; we map known roles into canonical events.
 */
export async function* ingestCursorTranscripts(
  transcriptDir: string,
  userId: string,
  workspaceRoots: string[] = [],
): AsyncGenerator<CanonicalEvent> {
  if (!existsSync(transcriptDir)) return;
  const files = readdirSync(transcriptDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(transcriptDir, f))
    .filter((f) => statSync(f).isFile());

  const roots = workspaceRoots.map(normalizeWorkspaceRoot);
  const instance_id = roots.length ? instanceIdFromWorkspace(roots) : undefined;

  for (const file of files) {
    const sessionId = file.replace(/\\/g, "/").split("/").pop()!.replace(/\.jsonl$/, "");
    const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const scrubbed = redactDeep(obj) as Record<string, unknown>;
      const role = String(scrubbed.role ?? scrubbed.type ?? "");
      const ts = String(scrubbed.timestamp ?? new Date().toISOString());
      const base = {
        v: 1 as const,
        ts,
        host: "cursor" as const,
        session_id: sessionId,
        user_id: userId,
        workspace: instance_id ? { roots, instance_id } : undefined,
      };
      if (role === "user" || scrubbed.role === "user") {
        yield {
          ...base,
          type: "user_prompt",
          payload: { content: scrubbed.message ?? scrubbed.content ?? scrubbed },
        };
      } else if (role === "assistant" || scrubbed.role === "assistant") {
        const text = JSON.stringify(scrubbed.message ?? scrubbed.content ?? "").slice(0, 500);
        yield { ...base, type: "agent_response", payload: { text } };
      }
    }
  }
}
