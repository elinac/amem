import type { AmemConfig, MemoryRecord, ScopeLevel, Trust } from "@amem/core";
import {
  canPromoteKind,
  isProposalEligible,
  paths,
  proposalGateInputFromMemory,
} from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { tryRefineProposalSkill } from "@amem/llm";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

export async function consolidate(
  home: string,
  cfg: AmemConfig,
): Promise<{
  promoted: string[];
  demoted: string[];
  proposals: string[];
}> {
  const started = Date.now();
  const store = new MemoryStore(home);
  const all = store.listAll();
  const promoted: string[] = [];
  const demoted: string[] = [];
  const proposals: string[] = [];
  let calls = 0;

  for (const m of all) {
    if ((Date.now() - started) / 60000 > cfg.budget.consolidate.max_minutes) break;
    if (calls >= cfg.budget.consolidate.max_llm_calls) break;

    if (m.stats.harmful >= 2 || (m.stats.lift < -0.1 && m.stats.recalled >= 5)) {
      const d = demote(m);
      store.forget(m.id);
      store.write(d, "pipeline");
      demoted.push(m.id);
      calls += 1;
      continue;
    }

    let current = m;
    if (shouldPromoteToDomain(m, cfg)) {
      current = promoteLevel(m, "domain");
      store.forget(m.id);
      store.write(current, "pipeline");
      promoted.push(m.id);
      calls += 1;
    } else if (shouldPromoteToGlobal(m, cfg)) {
      current = promoteLevel(m, "global");
      store.forget(m.id);
      store.write(current, "pipeline");
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
          const refined = await tryRefineProposalSkill(cfg, {
            id: current.id,
            title: current.title,
            content: current.content,
          });
          if (refined) skillBody = refined;
        }
      }
      const dir = join(paths(home).capabilities, ".proposals", current.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), skillBody);
      writeFileSync(
        join(dir, "proposal.md"),
        `# Proposal from ${current.id}\n\nstatus: pending review\n`,
      );
      proposals.push(current.id);
    }
  }

  const idx = new IndexStore(home);
  idx.rebuild(store);
  idx.close();
  return { promoted, demoted, proposals };
}
