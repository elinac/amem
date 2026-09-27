import {
  type AmemConfig,
  type MemoryCandidate,
  type MemoryRecord,
  evidenceQuotesValid,
  newId,
} from "@amem/core";
import { EpisodeStore, IndexStore, MemoryStore } from "@amem/store";
import { createLlmClient } from "@amem/llm";

export type ReconcileAction = "ADD" | "UPDATE" | "NOOP" | "CONFLICT";

export function reconcile(
  candidate: MemoryCandidate,
  existing: MemoryRecord[],
): { action: ReconcileAction; target?: MemoryRecord } {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const cTitle = norm(candidate.title);
  const cApplies = norm(candidate.applies_when);
  for (const m of existing) {
    if (m.kind !== candidate.kind) continue;
    const same =
      norm(m.title) === cTitle ||
      (norm(m.applies_when) === cApplies && cApplies.length > 10);
    if (!same) continue;
    // conflict if content disagrees strongly
    if (
      m.content.length > 20 &&
      candidate.content.length > 20 &&
      !norm(m.content).includes(norm(candidate.content).slice(0, 40)) &&
      !norm(candidate.content).includes(norm(m.content).slice(0, 40))
    ) {
      return { action: "CONFLICT", target: m };
    }
    return { action: "UPDATE", target: m };
  }
  if (existing.some((m) => norm(m.title) === cTitle)) return { action: "NOOP" };
  return { action: "ADD" };
}

export function generalize(c: MemoryCandidate): MemoryCandidate {
  const content = c.content
    .replace(/[A-Za-z]:\\[^\s]+/g, "<path>")
    .replace(/\/[a-zA-Z]:\/[^\s]+/g, "<path>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>");
  return { ...c, content };
}

export async function extractSession(
  home: string,
  sessionId: string,
  cfg: AmemConfig,
): Promise<{ written: string[]; skipped: number }> {
  const episodes = new EpisodeStore(home);
  const memories = new MemoryStore(home);
  const llm = createLlmClient(cfg);
  const meta = episodes.seal(sessionId, { transcript_source: "hook" });
  const blob = episodes.episodeBlob(meta);
  const events = episodes.readEvents(meta);
  const summary = `host=${meta.host} events=${events.length} outcome=${meta.outcome.label}`;
  let candidates = await llm.extractCandidates({ summary, episodeBlob: blob });
  candidates = candidates.map(generalize);

  const existing = memories.listAll();
  const written: string[] = [];
  let skipped = 0;

  for (const c of candidates) {
    if (!evidenceQuotesValid(c.evidence, blob)) {
      skipped += 1;
      continue;
    }
    const decision = reconcile(c, existing);
    if (decision.action === "NOOP") {
      skipped += 1;
      continue;
    }
    if (decision.action === "UPDATE" && decision.target) {
      decision.target.evidence.episodes = [
        ...new Set([...decision.target.evidence.episodes, meta.episode_id]),
      ];
      decision.target.evidence.count += 1;
      decision.target.updated_at = new Date().toISOString();
      memories.write(decision.target, "pipeline");
      written.push(decision.target.id);
      continue;
    }
    const id = newId("mem");
    const status = decision.action === "CONFLICT" ? "conflict" : "active";
    const rec: MemoryRecord = {
      id,
      kind: c.kind,
      title: c.title,
      content: c.content,
      applies_when: c.applies_when,
      not_applies_when: c.not_applies_when,
      scope: {
        level: "instance",
        tags: {
          user: cfg.identity.user_id,
          domains: c.domains,
          tools: c.tools,
          task_type: c.task_type,
          instances: meta.instance_id ? [meta.instance_id] : [],
        },
      },
      trust: "T3",
      status,
      evidence: {
        episodes: [meta.episode_id],
        quotes: c.evidence.map((e) => ({
          ep: meta.episode_id,
          event: e.event,
          text: e.quote,
        })),
        count: 1,
        distinct_instances: 1,
        distinct_domains: new Set(c.domains ?? []).size || 1,
      },
      stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
      validity: {
        depends_on: [],
        valid_from: new Date().toISOString().slice(0, 10),
      },
      supersedes: null,
      created_by: `pipeline-extract@0.1.0`,
      updated_at: new Date().toISOString(),
    };
    if (decision.action === "CONFLICT" && decision.target) {
      rec.supersedes = null;
      // cross-link in content
      rec.content += `\n\n⚠ conflicts with ${decision.target.id}`;
    }
    memories.write(rec, "pipeline");
    existing.push(rec);
    written.push(id);
  }

  const idx = new IndexStore(home);
  idx.rebuild(memories);
  idx.close();
  return { written, skipped };
}
