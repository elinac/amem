import type { AmemConfig, MemoryRecord, ScopeLevel, Trust } from "@amem/core";
import { canPromoteKind } from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "@amem/core";

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

export function consolidate(home: string, cfg: AmemConfig): {
  promoted: string[];
  demoted: string[];
  proposals: string[];
} {
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
      // rewrite: forget old path if level changed
      store.forget(m.id);
      store.write(d, "pipeline");
      demoted.push(m.id);
      calls += 1;
      continue;
    }
    if (shouldPromoteToDomain(m, cfg)) {
      store.forget(m.id);
      store.write(promoteLevel(m, "domain"), "pipeline");
      promoted.push(m.id);
      calls += 1;
    } else if (shouldPromoteToGlobal(m, cfg)) {
      store.forget(m.id);
      store.write(promoteLevel(m, "global"), "pipeline");
      promoted.push(m.id);
      calls += 1;
    }

    if (
      m.kind === "procedure" &&
      (m.scope.level === "domain" || m.scope.level === "global") &&
      (m.trust === "T2" || m.trust === "T1") &&
      m.evidence.distinct_instances >= 3 &&
      proposals.length < cfg.budget.consolidate.max_proposals
    ) {
      const dir = join(paths(home).capabilities, ".proposals", m.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "SKILL.md"),
        `---\nname: ${m.id}\ndescription: ${m.title}\n---\n\n${m.content}\n`,
      );
      writeFileSync(
        join(dir, "proposal.md"),
        `# Proposal from ${m.id}\n\nstatus: pending review\n`,
      );
      proposals.push(m.id);
    }
  }

  const idx = new IndexStore(home);
  idx.rebuild(store);
  idx.close();
  return { promoted, demoted, proposals };
}