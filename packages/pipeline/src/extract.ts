import {
  type AmemConfig,
  type EpisodeMeta,
  type MemoryCandidate,
  type MemoryRecord,
  evidenceQuotesValid,
  newId,
} from "@amem/core";
import { createLlmClient } from "@amem/llm";
import { EpisodeStore, IndexStore, MemoryStore } from "@amem/store";
import { externalEventLines, verifiedCandidateEvidence } from "./verify.js";

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
      norm(m.title) === cTitle || (norm(m.applies_when) === cApplies && cApplies.length > 10);
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
  const sameTitle = existing.find((m) => norm(m.title) === cTitle);
  if (sameTitle) return { action: "NOOP", target: sameTitle };
  return { action: "ADD" };
}

export function generalize(c: MemoryCandidate): MemoryCandidate {
  const content = c.content
    .replace(/[A-Za-z]:\\[^\s]+/g, "<path>")
    .replace(/\/[a-zA-Z]:\/[^\s]+/g, "<path>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<id>");
  return { ...c, content };
}

/** Merge newly validated evidence into an existing record (spec §7.4). */
function addEvidence(
  target: MemoryRecord,
  meta: EpisodeMeta,
  quotes: { event: number; quote: string }[],
): void {
  target.evidence.episodes = [...new Set([...target.evidence.episodes, meta.episode_id])];
  const seen = new Set(
    (target.evidence.quotes ?? []).map((q) => `${q.ep}|${q.event ?? ""}|${q.text}`),
  );
  const merged = target.evidence.quotes ?? [];
  for (const q of quotes) {
    const key = `${meta.episode_id}|${q.event}|${q.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ep: meta.episode_id, event: q.event, text: q.quote });
  }
  target.evidence.quotes = merged;
  target.evidence.count += 1;
  const instances = new Set(target.scope.tags.instances ?? []);
  if (meta.instance_id) instances.add(meta.instance_id);
  if (instances.size) target.scope.tags.instances = [...instances];
  target.evidence.distinct_instances = Math.max(
    1,
    target.scope.tags.instances?.length ?? target.evidence.distinct_instances,
  );
  target.updated_at = new Date().toISOString();
}

/**
 * A candidate that just gained real Episode evidence has passed the Pipeline evidence
 * validation the design requires of agent notes, so it becomes recallable. Status only:
 * trust and level are untouched (I2).
 */
function promoteIfValidated(target: MemoryRecord, meta: EpisodeMeta): boolean {
  if (target.status !== "candidate") return false;
  if (!target.evidence.episodes.includes(meta.episode_id)) return false;
  target.status = "active";
  return true;
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
    if (decision.target && (decision.action === "UPDATE" || decision.action === "NOOP")) {
      addEvidence(decision.target, meta, c.evidence);
      promoteIfValidated(decision.target, meta);
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
      created_by: "pipeline-extract@0.1.0",
      updated_at: new Date().toISOString(),
    };
    if (decision.action === "CONFLICT" && decision.target) {
      rec.supersedes = null;
      rec.conflicts_with = [decision.target.id];
      rec.content += `\n\n⚠ conflicts with ${decision.target.id}`;
      const peer = decision.target;
      const peerLinks = new Set(peer.conflicts_with ?? []);
      peerLinks.add(id);
      peer.conflicts_with = [...peerLinks];
      peer.status = "conflict";
      if (!peer.content.includes(`conflicts with ${id}`)) {
        peer.content += `\n\n⚠ conflicts with ${id}`;
      }
      peer.updated_at = new Date().toISOString();
      memories.write(peer, "pipeline");
    }
    memories.write(rec, "pipeline");
    existing.push(rec);
    written.push(id);
  }

  // Agent notes (memory_note) are stored as `candidate` because they carry no Episode
  // evidence, and recall only injects active/conflict memories. Promote the ones whose
  // evidence is grounded in this sealed Episode - counting only external signals.
  const external = externalEventLines(events);
  for (const m of memories.listAll()) {
    const evidence = verifiedCandidateEvidence(m, meta, external);
    if (!evidence) continue;
    addEvidence(m, meta, [evidence]);
    promoteIfValidated(m, meta);
    memories.write(m, "pipeline");
    written.push(m.id);
  }

  const idx = new IndexStore(home);
  idx.rebuild(memories);
  idx.close();
  return { written, skipped };
}
