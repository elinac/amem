import {
  amemHome,
  loadConfig,
  newId,
  type MemoryRecord,
} from "@amem/core";
import { MemoryStore, IndexStore } from "@amem/store";
import { buildContextPack, extractSituation, recall } from "@amem/retrieval";
import { enqueueFlush } from "@amem/pipeline";

export type ToolResult = { content: { type: "text"; text: string }[] };

function text(obj: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

export function createToolHandlers(home = amemHome()) {
  const cfg = () => loadConfig(home);
  return {
    async memory_recall(args: {
      query: string;
      task_type?: string;
      k?: number;
      session_id?: string;
      workspace_root?: string;
    }) {
      const c = cfg();
      const sit = extractSituation({
        query: args.query,
        userId: c.identity.user_id,
        workspaceRoot: args.workspace_root,
      });
      if (args.task_type) sit.task_type = args.task_type;
      const pack = buildContextPack({
        home,
        cfg: c,
        situation: sit,
        sessionId: args.session_id ?? "mcp",
      });
      const hits = recall(home, sit, args.k ?? c.recall.l0_items);
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
    async memory_get(args: { id: string }) {
      const m = new MemoryStore(home).readById(args.id);
      if (!m) return text({ error: "not_found" });
      return text(m);
    },
    async memory_note(args: {
      kind: MemoryRecord["kind"];
      title: string;
      content: string;
      applies_when: string;
      evidence_hint?: string;
    }) {
      const c = cfg();
      const store = new MemoryStore(home);
      const id = newId("mem");
      const rec: MemoryRecord = {
        id,
        kind: args.kind,
        title: args.title,
        content: args.content,
        applies_when: args.applies_when,
        scope: { level: "instance", tags: { user: c.identity.user_id } },
        trust: "T3",
        status: "candidate",
        evidence: {
          episodes: [],
          quotes: args.evidence_hint
            ? [{ ep: "agent-note", text: args.evidence_hint }]
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
      // agent-note without episode evidence stays candidate until flush validates
      store.write(rec, "agent-note");
      const idx = new IndexStore(home);
      idx.rebuild(store);
      idx.close();
      return text({ id, status: rec.status });
    },
    async memory_feedback(args: {
      id: string;
      verdict: "helpful" | "harmful";
      reason?: string;
    }) {
      const store = new MemoryStore(home);
      const m = store.readById(args.id);
      if (!m) return text({ error: "not_found" });
      if (args.verdict === "helpful") m.stats.helpful += 1;
      else m.stats.harmful += 1;
      const total = m.stats.helpful + m.stats.harmful;
      m.stats.lift =
        total >= 5 ? (m.stats.helpful - m.stats.harmful) / total : m.stats.lift;
      m.updated_at = new Date().toISOString();
      store.write(m, "human");
      return text({ ok: true, stats: m.stats });
    },
    async memory_flush(args: { session_id?: string }) {
      const sid = args.session_id ?? "manual";
      const file = enqueueFlush(home, sid);
      return text({ queued: file });
    },
    async context_pack(args: { query: string; budget?: number; session_id?: string }) {
      const c = cfg();
      if (args.budget) c.recall.budget_tokens = args.budget;
      const sit = extractSituation({ query: args.query, userId: c.identity.user_id });
      return text(
        buildContextPack({
          home,
          cfg: c,
          situation: sit,
          sessionId: args.session_id ?? "mcp",
        }),
      );
    },
  };
}
