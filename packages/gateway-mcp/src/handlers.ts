import { z } from "zod";
import {
  amemHome,
  loadConfig,
  newId,
  MemoryKindSchema,
  type MemoryRecord,
} from "@amem/core";
import { MemoryStore } from "@amem/store";
import { buildContextPack, extractSituation, recall, recallAsync } from "@amem/retrieval";
import { enqueueFlush } from "@amem/pipeline";

export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function text(obj: unknown, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

const RecallArgs = z.object({
  query: z.string().min(1),
  task_type: z.string().optional(),
  k: z.number().int().positive().max(50).optional(),
  session_id: z.string().optional(),
  workspace_root: z.string().optional(),
});

const GetArgs = z.object({ id: z.string().min(1) });

const NoteArgs = z.object({
  kind: MemoryKindSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  applies_when: z.string().min(1),
  evidence_hint: z.string().optional(),
});

const FeedbackArgs = z.object({
  id: z.string().min(1),
  verdict: z.enum(["helpful", "harmful"]),
  reason: z.string().optional(),
});

const FlushArgs = z.object({
  session_id: z.string().optional(),
});

const PackArgs = z.object({
  query: z.string().min(1),
  budget: z.number().int().positive().max(100_000).optional(),
  session_id: z.string().optional(),
});

export function createToolHandlers(home = amemHome()) {
  const cfg = () => loadConfig(home);
  return {
    async memory_recall(args: unknown) {
      const parsed = RecallArgs.parse(args);
      const c = cfg();
      const sit = extractSituation({
        query: parsed.query,
        userId: c.identity.user_id,
        workspaceRoot: parsed.workspace_root,
      });
      if (parsed.task_type) sit.task_type = parsed.task_type;
      const hits = c.embedding.enabled
        ? await recallAsync(home, sit, c, parsed.k ?? c.recall.l0_items)
        : recall(home, sit, parsed.k ?? c.recall.l0_items);
      const pack = buildContextPack({
        home,
        cfg: c,
        situation: sit,
        sessionId: parsed.session_id ?? "mcp",
        hits,
        trackStats: true,
      });
      return text({
        pack_id: pack.pack_id,
        l0: hits.map((h) => ({
          id: h.memory.id,
          title: h.memory.title,
          applies_when: h.memory.applies_when,
          score: h.score,
          status: h.memory.status,
        })),
        l1: hits.slice(0, c.recall.l1_items).map((h) => ({
          id: h.memory.id,
          content: h.memory.content.slice(0, 300),
        })),
      });
    },
    async memory_get(args: unknown) {
      const { id } = GetArgs.parse(args);
      const m = new MemoryStore(home).readById(id);
      if (!m) return text({ error: "not_found" }, true);
      return text(m);
    },
    async memory_note(args: unknown) {
      const parsed = NoteArgs.parse(args);
      const c = cfg();
      const store = new MemoryStore(home);
      const id = newId("mem");
      const rec: MemoryRecord = {
        id,
        kind: parsed.kind,
        title: parsed.title,
        content: parsed.content,
        applies_when: parsed.applies_when,
        scope: { level: "instance", tags: { user: c.identity.user_id } },
        trust: "T3",
        status: "candidate",
        evidence: {
          episodes: [],
          quotes: parsed.evidence_hint
            ? [{ ep: "agent-note", text: parsed.evidence_hint }]
            : [],
          count: 0,
          distinct_instances: 1,
          distinct_domains: 1,
        },
        stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
        validity: { depends_on: [], valid_from: new Date().toISOString().slice(0, 10) },
        created_by: "agent-note",
        updated_at: new Date().toISOString(),
      };
      store.write(rec, "agent-note");
      return text({ id, status: rec.status });
    },
    async memory_feedback(args: unknown) {
      const parsed = FeedbackArgs.parse(args);
      const store = new MemoryStore(home);
      const m = store.readById(parsed.id);
      if (!m) return text({ error: "not_found" }, true);
      if (parsed.verdict === "helpful") {
        m.stats.helpful += 1;
        m.stats.adopted += 1;
      } else m.stats.harmful += 1;
      const total = m.stats.helpful + m.stats.harmful;
      m.stats.lift =
        total >= 5 ? (m.stats.helpful - m.stats.harmful) / total : m.stats.lift;
      m.updated_at = new Date().toISOString();
      store.write(m, "human");
      return text({ ok: true, stats: m.stats });
    },
    async memory_flush(args: unknown) {
      const parsed = FlushArgs.parse(args ?? {});
      const sid = parsed.session_id ?? "manual";
      const file = enqueueFlush(home, sid);
      return text({ queued: file });
    },
    async context_pack(args: unknown) {
      const parsed = PackArgs.parse(args);
      const c = cfg();
      const cfgLocal = {
        ...c,
        recall: {
          ...c.recall,
          ...(parsed.budget ? { budget_tokens: parsed.budget } : {}),
        },
      };
      const sit = extractSituation({
        query: parsed.query,
        userId: c.identity.user_id,
      });
      return text(
        buildContextPack({
          home,
          cfg: cfgLocal,
          situation: sit,
          sessionId: parsed.session_id ?? "mcp",
          trackStats: true,
        }),
      );
    },
  };
}
