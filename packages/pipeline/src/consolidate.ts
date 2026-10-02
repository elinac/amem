import type { AmemConfig, MemoryRecord, ScopeLevel, Trust } from "@amem/core";
import { canPromoteKind, isProposalEligible, proposalGateInputFromMemory } from "@amem/core";
import { createLlmClient } from "@amem/llm";
import {
  IndexStore,
  MemoryStore,
  ProposalStore,
  embedAllMemories,
  setEmbedProvider,
} from "@amem/store";

export function shouldPromoteToDomain(m: MemoryRecord, cfg: AmemConfig): boolean {
  if (!canPromoteKind(m.kind)) return false;
  if (m.scope.level !== "instance") return false;
  if (m.stats.harmful > 0) return false;
  return (
    m.evidence.distinct_instances >= cfg.promotion.instance_to_domain_min_instances &&
    m.stats.helpful >= 2
  );
}

export function shouldPromoteToGlobal(m: MemoryRecord, cfg: AmemConfig): boolean {
  if (!canPromoteKind(m.kind)) return false;
  if (m.scope.level !== "domain") return false;
  return (
    m.evidence.distinct_domains >= cfg.promotion.domain_to_global_min_domains &&
    m.evidence.distinct_instances >= cfg.promotion.domain_to_global_min_instances &&
    m.stats.lift > cfg.promotion.global_min_lift &&
    m.stats.recalled >= 10
  );
}

export function demote(m: MemoryRecord): MemoryRecord {
  const nextLevel: ScopeLevel =
    m.scope.level === "global" ? "domain" : m.scope.level === "domain" ? "instance" : "instance";
  const nextTrust: Trust = m.trust === "T2" ? "T3" : m.trust;
  let status = m.status;
  if (m.stats.harmful >= 2 || m.stats.lift < -0.1) {
    if (m.scope.level === "instance") status = "frozen";
  }
  return {
    ...m,
    scope: { ...m.scope, level: nextLevel },
    trust: nextTrust === "T1" ? "T2" : nextTrust,
    status,
    updated_at: new Date().toISOString(),
  };
}

export function promoteLevel(m: MemoryRecord, level: ScopeLevel): MemoryRecord {
  const trust: Trust = m.trust === "T3" ? "T2" : m.trust;
  return {
    ...m,
    scope: { ...m.scope, level },
    trust,
    updated_at: new Date().toISOString(),
  };
}

function templateSkillMarkdown(m: MemoryRecord): string {
  return `---\nname: ${m.id}\ndescription: ${m.title}\n---\n\n${m.content}\n`;
}

export function shouldExpire(
  m: MemoryRecord,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (m.status === "expired" || m.status === "frozen" || m.status === "superseded") return false;
  const reviewBy = m.validity.review_by;
  if (!reviewBy) return false;
  return reviewBy < today;
}

export async function consolidate(
  home: string,
  cfg: AmemConfig,
): Promise<{
  promoted: string[];
  demoted: string[];
  proposals: string[];
  expired: string[];
  cascaded: string[];
}> {
  const started = Date.now();
  const store = new MemoryStore(home);
  const all = store.listAll();
  const promoted: string[] = [];
  const demoted: string[] = [];
  const proposals: string[] = [];
  const expired: string[] = [];
  const cascaded: string[] = [];
  let calls = 0;
  const today = new Date().toISOString().slice(0, 10);
  /** Parents expired/superseded this round — children get review_by=today once. */
  const tightenedParents = new Set<string>();
  const markedChildren = new Set<string>();

  for (const m of all) {
    if ((Date.now() - started) / 60000 > cfg.budget.consolidate.max_minutes) break;
    if (calls >= cfg.budget.consolidate.max_llm_calls) break;

    if (shouldExpire(m, today)) {
      store.upsert({ ...m, status: "expired", updated_at: new Date().toISOString() }, "pipeline");
      expired.push(m.id);
      tightenedParents.add(m.id);
      continue;
    }

    if (m.stats.harmful >= 2 || (m.stats.lift < -0.1 && m.stats.recalled >= 5)) {
      const d = demote(m);
      store.upsert(d, "pipeline");
      demoted.push(m.id);
      if (d.status === "superseded" || d.status === "frozen") tightenedParents.add(m.id);
      calls += 1;
      continue;
    }

    let current = m;
    if (shouldPromoteToDomain(m, cfg)) {
      current = promoteLevel(m, "domain");
      store.upsert(current, "pipeline");
      promoted.push(m.id);
      calls += 1;
    } else if (shouldPromoteToGlobal(m, cfg)) {
      current = promoteLevel(m, "global");
      store.upsert(current, "pipeline");
      promoted.push(m.id);
      calls += 1;
    }

    if (
      isProposalEligible(proposalGateInputFromMemory(current)) &&
      proposals.length < cfg.budget.consolidate.max_proposals
    ) {
      let skillBody = templateSkillMarkdown(current);
      if (cfg.budget.consolidate.refine_proposals) {
        if (calls >= cfg.budget.consolidate.max_llm_calls) {
          // budget exhausted: still emit template proposal
        } else {
          calls += 1;
          const refined = await createLlmClient(cfg).refineProposalSkill({
            id: current.id,
            title: current.title,
            content: current.content,
          });
          if (refined) skillBody = refined;
        }
      }
      new ProposalStore(home).writeDraft({
        id: current.id,
        skillMd: skillBody,
        proposalMd: `# Proposal from ${current.id}\n\nstatus: pending review\n`,
      });
      proposals.push(current.id);
    }
  }

  // Also treat already-superseded/expired parents as cascade sources (one layer).
  for (const m of store.listAll()) {
    if (m.status === "expired" || m.status === "superseded") {
      tightenedParents.add(m.id);
    }
  }

  // Cascade: children depending on tightened parents → review_by = today (pending, not expired today).
  for (const child of store.listAll()) {
    if (markedChildren.has(child.id)) continue;
    if (child.status === "expired" || child.status === "frozen" || child.status === "superseded") {
      continue;
    }
    const deps = child.validity.depends_on ?? [];
    if (!deps.some((d) => tightenedParents.has(d))) continue;
    const next = {
      ...child,
      validity: { ...child.validity, review_by: today },
      updated_at: new Date().toISOString(),
    };
    store.upsert(next, "pipeline");
    markedChildren.add(child.id);
    cascaded.push(child.id);
  }

  const idx = new IndexStore(home);
  idx.rebuild(store);
  idx.close();
  if (cfg.embedding.enabled) {
    const client = createLlmClient(cfg);
    if (client.embedTexts) {
      setEmbedProvider((texts) => client.embedTexts!(texts));
      await embedAllMemories(home, store.listAll());
    }
  }
  return { promoted, demoted, proposals, expired, cascaded };
}
