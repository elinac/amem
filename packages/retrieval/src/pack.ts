import {
  type AmemConfig,
  type ContextPack,
  type HostId,
  type MemoryRecord,
  type Situation,
  atomicWriteJson,
  contextLayerPriority,
  newId,
  paths,
  scopePriority,
} from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { decideRecall, injectableDecisions, type ScoreParts } from "./decide.js";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function tagOverlap(m: MemoryRecord, situation: Situation): number {
  let tag = 0;
  const domains = new Set(m.scope.tags.domains ?? []);
  for (const d of situation.domains) if (domains.has(d)) tag += 0.05;
  const tools = new Set(m.scope.tags.tools ?? []);
  for (const t of situation.tools) if (tools.has(t)) tag += 0.05;
  if (m.scope.tags.task_type && m.scope.tags.task_type === situation.task_type) tag += 0.05;
  return tag;
}

/**
 * Text relevance in [0, 1]. `ftsRank` is SQLite bm25 (more negative = better;
 * 0 for the LIKE fallback); `null` means the memory was not a text hit.
 * Any text hit scores ≥ 0.5 so it stays above tag-only matches.
 */
function textRelevance(ftsRank: number | null): number {
  if (ftsRank === null) return 0;
  const strength = Math.max(0, -ftsRank);
  return 0.5 + 0.5 * (strength / (1 + strength));
}

/** Additive score breakdown (weights unchanged from scoreMemory). */
export type { ScoreParts };

export type ScoredHit = {
  memory: MemoryRecord;
  score: number;
  parts: ScoreParts;
};

/**
 * Explain lexical score without changing weights.
 * Hard exclusions return score -999 with zeroed parts.
 */
export function explainScore(
  m: MemoryRecord,
  situation: Situation,
  ftsRank: number | null,
): ScoredHit {
  const zero: ScoreParts = { rel: 0, tag: 0, trust: 0, lift: 0, levelAdj: 0 };
  if (m.kind === "preference" && m.scope.tags.user !== situation.user_id) {
    return { memory: m, score: -999, parts: zero };
  }
  if (m.status === "frozen" || m.status === "expired" || m.status === "superseded") {
    return { memory: m, score: -999, parts: zero };
  }
  const rel = textRelevance(ftsRank);
  const tagRaw = tagOverlap(m, situation);
  const trustW = m.trust === "T1" ? 1 : m.trust === "T2" ? 0.7 : 0.4;
  let levelAdj = 0;
  if (m.scope.level === "instance") {
    levelAdj =
      situation.instance_id && m.scope.tags.instances?.includes(situation.instance_id)
        ? 0.1
        : -0.2;
  }
  const parts: ScoreParts = {
    rel: 0.6 * rel,
    tag: 0.15 * Math.min(1, tagRaw),
    trust: 0.1 * trustW,
    lift: 0.1 * Math.max(-1, Math.min(1, m.stats.lift)),
    levelAdj,
  };
  const score = parts.rel + parts.tag + parts.trust + parts.lift + parts.levelAdj;
  return { memory: m, score, parts };
}

export function scoreMemory(
  m: MemoryRecord,
  situation: Situation,
  ftsRank: number | null,
): number {
  return explainScore(m, situation, ftsRank).score;
}

export type RecallChannels = "fts" | "tags" | "fts+tags";

export function recall(
  home: string,
  situation: Situation,
  k = 8,
  opts?: { channels?: RecallChannels },
): ScoredHit[] {
  const channels = opts?.channels ?? "fts+tags";
  const useFts = channels === "fts" || channels === "fts+tags";
  const useTags = channels === "tags" || channels === "fts+tags";
  const store = new MemoryStore(home);
  const idx = new IndexStore(home);
  try {
    idx.ensure(store);
  } catch {
    /* degraded: search may return empty until next rebuild */
  }
  const byId = new Map(store.listAll().map((m) => [m.id, m]));
  const scored: ScoredHit[] = [];
  if (useFts) {
    const hits = idx.searchFts(situation.query, 50);
    for (const h of hits) {
      const m = byId.get(h.id);
      if (!m) continue;
      if (m.status !== "active" && m.status !== "conflict") continue;
      const explained = explainScore(m, situation, h.rank);
      if (explained.score <= -100) continue;
      scored.push(explained);
    }
  }
  idx.close();
  if (useTags) {
    for (const m of byId.values()) {
      if (scored.some((s) => s.memory.id === m.id)) continue;
      if (m.status !== "active" && m.status !== "conflict") continue;
      if (tagOverlap(m, situation) === 0) continue;
      const explained = explainScore(m, situation, null);
      if (explained.score > 0.15) scored.push(explained);
    }
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return scopePriority(b.memory.scope.level) - scopePriority(a.memory.scope.level);
  });
  return scored.slice(0, k);
}

/**
 * FTS recall plus optional embedding RRF when `cfg.embedding.enabled` and
 * vectors exist. Falls back to lexical-only on any embed failure.
 */
export async function recallAsync(
  home: string,
  situation: Situation,
  cfg: AmemConfig,
  k = 8,
): Promise<{ memory: MemoryRecord; score: number }[]> {
  const lexical = recall(home, situation, Math.max(k, 20));
  if (!cfg.embedding.enabled) return lexical.slice(0, k);

  try {
    const { createLlmClient } = await import("@amem/llm");
    const client = createLlmClient(cfg);
    const vectors = (await client.embedTexts?.([situation.query])) ?? null;
    const q = vectors?.[0];
    if (!q?.length) return lexical.slice(0, k);

    const store = new MemoryStore(home);
    const idx = new IndexStore(home);
    idx.ensure(store);
    const vecHits = idx.searchVec(q, 50);
    idx.close();

    const byId = new Map(store.listAll().map((m) => [m.id, m]));
    const rrf = new Map<string, number>();
    lexical.forEach((h, i) => {
      rrf.set(h.memory.id, (rrf.get(h.memory.id) ?? 0) + 1 / (60 + i));
    });
    vecHits.forEach((h, i) => {
      rrf.set(h.id, (rrf.get(h.id) ?? 0) + 1 / (60 + i));
    });

    const merged = [...rrf.entries()]
      .map(([id, score]) => {
        const memory = byId.get(id);
        if (!memory) return null;
        if (memory.status !== "active" && memory.status !== "conflict") return null;
        const s = scoreMemory(memory, situation, null);
        if (s <= -100) return null;
        return { memory, score: score + Math.max(0, s) * 0.01 };
      })
      .filter((x): x is { memory: MemoryRecord; score: number } => !!x)
      .sort((a, b) => b.score - a.score);
    return merged.slice(0, k);
  } catch {
    return lexical.slice(0, k);
  }
}

export function buildContextPack(opts: {
  home: string;
  cfg: AmemConfig;
  situation: Situation;
  sessionId: string;
  host?: HostId;
  /** When provided, skip a second FTS rebuild/recall. */
  hits?: { memory: MemoryRecord; score: number }[];
  /**
   * Count packed memories in `stats.recalled`. Only for packs actually injected
   * into an agent session; previews and debug commands must leave it off.
   */
  trackStats?: boolean;
}): ContextPack {
  const hits = opts.hits ?? recall(opts.home, opts.situation, opts.cfg.recall.l0_items);
  const mode = opts.cfg.recall.mode ?? "assist";
  const decisions = decideRecall(hits, mode);
  const inject = injectableDecisions(decisions, mode);
  const budget = opts.cfg.recall.budget_tokens;
  const items: ContextPack["items"] = [];
  const dropped: ContextPack["dropped"] = [];
  for (const d of decisions) {
    if (d.decision === "ignore" || (mode === "enforce" && d.decision === "verify") || mode === "shadow") {
      if (!inject.some((i) => i.memory.id === d.memory.id)) {
        dropped.push({ ref: d.memory.id, reason: d.reason });
      }
    }
  }
  let used = 0;
  let l1 = 0;
  for (const h of inject) {
    const prefix = h.decision === "verify" ? "[verify] " : "";
    const l0 = `${prefix}${h.memory.title} — ${h.memory.applies_when}`;
    const t0 = estimateTokens(l0);
    if (used + t0 > budget) {
      dropped.push({ ref: h.memory.id, reason: "budget" });
      continue;
    }
    items.push({
      layer: h.memory.kind === "preference" ? "preference" : "memory",
      ref: h.memory.id,
      level: h.memory.scope.level,
      score: h.score,
      tokens: t0,
    });
    used += t0;
    if (l1 < opts.cfg.recall.l1_items) {
      const body = h.memory.content.slice(0, 300);
      const t1 = estimateTokens(body);
      if (used + t1 <= budget) {
        items.push({
          layer: "memory",
          ref: `${h.memory.id}#l1`,
          level: h.memory.scope.level,
          score: h.score,
          tokens: t1,
        });
        used += t1;
        l1 += 1;
      }
    }
  }
  items.sort((a, b) => contextLayerPriority(a.layer) - contextLayerPriority(b.layer));
  const pack: ContextPack = {
    pack_id: newId("cp"),
    session_id: opts.sessionId,
    host: opts.host ?? "cursor",
    situation: opts.situation,
    budget_tokens: budget,
    items,
    dropped,
    created_at: new Date().toISOString(),
  };
  const dir = paths(opts.home).manifests;
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, `${pack.pack_id}.json`), pack);
  if (opts.trackStats) {
    const packed = new Set(items.map((i) => i.ref.replace(/#l1$/, "")));
    new MemoryStore(opts.home).recordRecalled(packed);
  }
  return pack;
}
