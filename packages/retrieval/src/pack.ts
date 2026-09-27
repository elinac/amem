import {
  type AmemConfig,
  type ContextPack,
  type HostId,
  type MemoryRecord,
  type Situation,
  contextLayerPriority,
  newId,
  scopePriority,
} from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "@amem/core";

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function scoreMemory(m: MemoryRecord, situation: Situation, ftsRank: number): number {
  const sim = 1 / (1 + Math.max(0, ftsRank + 5)); // bm25 often negative
  let tag = 0;
  const domains = new Set(m.scope.tags.domains ?? []);
  for (const d of situation.domains) if (domains.has(d)) tag += 0.05;
  const tools = new Set(m.scope.tags.tools ?? []);
  for (const t of situation.tools) if (tools.has(t)) tag += 0.05;
  if (m.scope.tags.task_type && m.scope.tags.task_type === situation.task_type) tag += 0.05;
  const trustW = m.trust === "T1" ? 1 : m.trust === "T2" ? 0.7 : 0.4;
  let levelAdj = 0;
  if (m.scope.level === "instance") {
    levelAdj =
      situation.instance_id && m.scope.tags.instances?.includes(situation.instance_id)
        ? 0.1
        : -0.2;
  }
  if (m.kind === "preference" && m.scope.tags.user !== situation.user_id) return -999;
  if (m.status === "frozen" || m.status === "expired" || m.status === "superseded") return -999;
  return (
    0.4 * sim +
    0.2 * Math.min(1, Math.abs(ftsRank) / 10) +
    0.15 * Math.min(1, tag) +
    0.1 * trustW +
    0.1 * Math.max(-1, Math.min(1, m.stats.lift)) +
    0.05 * 0.5 +
    levelAdj
  );
}

export function recall(
  home: string,
  situation: Situation,
  k = 8,
): { memory: MemoryRecord; score: number }[] {
  const store = new MemoryStore(home);
  const idx = new IndexStore(home);
  try {
    idx.rebuild(store);
  } catch {
    /* empty */
  }
  const hits = idx.searchFts(situation.query, 50);
  idx.close();
  const byId = new Map(store.listAll().map((m) => [m.id, m]));
  const scored: { memory: MemoryRecord; score: number }[] = [];
  for (const h of hits) {
    const m = byId.get(h.id);
    if (!m) continue;
    if (m.status !== "active" && m.status !== "conflict") continue;
    const score = scoreMemory(m, situation, h.rank);
    if (score <= -100) continue;
    scored.push({ memory: m, score });
  }
  // also include tag overlaps not in fts
  for (const m of byId.values()) {
    if (scored.some((s) => s.memory.id === m.id)) continue;
    if (m.status !== "active" && m.status !== "conflict") continue;
    const score = scoreMemory(m, situation, 10);
    if (score > 0.15) scored.push({ memory: m, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return scopePriority(b.memory.scope.level) - scopePriority(a.memory.scope.level);
  });
  return scored.slice(0, k);
}

export function buildContextPack(opts: {
  home: string;
  cfg: AmemConfig;
  situation: Situation;
  sessionId: string;
  host?: HostId;
  /** When provided, skip a second FTS rebuild/recall. */
  hits?: { memory: MemoryRecord; score: number }[];
}): ContextPack {
  const hits = opts.hits ?? recall(opts.home, opts.situation, opts.cfg.recall.l0_items);
  const budget = opts.cfg.recall.budget_tokens;
  const items: ContextPack["items"] = [];
  const dropped: ContextPack["dropped"] = [];
  let used = 0;
  let l1 = 0;
  for (const h of hits) {
    const l0 = `${h.memory.title} — ${h.memory.applies_when}`;
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
  writeFileSync(join(dir, `${pack.pack_id}.json`), JSON.stringify(pack, null, 2));
  return pack;
}
