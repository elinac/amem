import {
  MEMORY_KINDS,
  MEMORY_PAGE_SIZES,
  MEMORY_STATUSES,
  SCOPE_LEVELS,
  TRUSTS,
  type MemoryKind,
  type MemoryPageSize,
  type MemoryRecord,
  type MemoryStatus,
  type ScopeLevel,
  type Trust,
  amemHome as defaultAmemHome,
  applyEditableConfigPatch,
  getSafeConfigView,
  isSafeId,
  loadConfig,
  newId,
} from "@amem/core";
import { IndexStore, MemoryStore, runDoctor, listFailedJobs, purgeFailedJobs, listConflicts, resolveConflict, type ResolveConflictAction } from "@amem/store";
import { buildContextPack, decideRecall, extractSituation, recall } from "@amem/retrieval";
import {
  compileCapabilities,
  listProposalsData,
  listSkillsData,
  materializeProposal,
} from "@amem/compiler";
import { consolidate as runConsolidate, enqueueFlush, processQueue } from "@amem/pipeline";
import type { DshAdminScope } from "./auth-store.js";

export type AdminResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; message: string; status: number };

export type ListMemoriesInput = {
  page: number;
  pageSize: MemoryPageSize;
  q?: string;
  kind?: MemoryKind;
  level?: ScopeLevel;
  trust?: Trust;
  status?: MemoryStatus;
};

type MemoryListItem = {
  id: string;
  kind: MemoryKind;
  level: ScopeLevel;
  trust: Trust;
  status: MemoryStatus;
  title: string;
  applies_when: string;
  content: string;
  helpful: number;
  harmful: number;
  distinct_instances: number;
  updated_at: string;
};

const MAX_PREVIEW_CHARS = 200;

function isMemoryKind(v: unknown): v is MemoryKind {
  return typeof v === "string" && (MEMORY_KINDS as readonly string[]).includes(v);
}
function isScopeLevel(v: unknown): v is ScopeLevel {
  return typeof v === "string" && (SCOPE_LEVELS as readonly string[]).includes(v);
}
function isTrust(v: unknown): v is Trust {
  return typeof v === "string" && (TRUSTS as readonly string[]).includes(v);
}
function isMemoryStatus(v: unknown): v is MemoryStatus {
  return typeof v === "string" && (MEMORY_STATUSES as readonly string[]).includes(v);
}

function matchesQuery(m: MemoryRecord, q?: string): boolean {
  if (!q || q.trim() === "") return true;
  const needle = q.trim().toLowerCase();
  const hay =
    `${m.title}\n${m.applies_when}\n${m.content}`.toLowerCase();
  return hay.includes(needle);
}

function memoryToListItem(m: MemoryRecord): MemoryListItem {
  return {
    id: m.id,
    kind: m.kind,
    level: m.scope.level,
    trust: m.trust,
    status: m.status,
    title: m.title,
    applies_when: m.applies_when,
    content: m.content.slice(0, MAX_PREVIEW_CHARS),
    helpful: m.stats.helpful,
    harmful: m.stats.harmful,
    distinct_instances: m.evidence.distinct_instances,
    updated_at: m.updated_at,
  };
}

export function createAdmin(home = defaultAmemHome()) {
  const cfg = () => loadConfig(home);

  function listMemories(limit?: number): AdminResult;
  function listMemories(input?: ListMemoriesInput): AdminResult;
  function listMemories(input?: number | ListMemoriesInput): AdminResult {
    // Legacy number overload: keep old behavior for plugin.ts and CLI callers.
    if (typeof input === "number") {
        const all = new MemoryStore(home).listAll();
        all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return {
          ok: true,
          data: {
            total: all.length,
            items: all.slice(0, input).map(memoryToListItem),
          },
        };
      }

      const opts: ListMemoriesInput =
        typeof input === "number" ? { page: 1, pageSize: 20 } : input ?? { page: 1, pageSize: 20 };

      if (typeof opts.page !== "undefined" && (typeof opts.page !== "number" || !Number.isFinite(opts.page) || opts.page < 1 || Math.floor(opts.page) !== opts.page)) {
        return { ok: false, error: "bad_request", message: "page must be a positive integer", status: 400 };
      }
      if (typeof opts.pageSize !== "undefined" && !(MEMORY_PAGE_SIZES as readonly number[]).includes(opts.pageSize)) {
        return { ok: false, error: "bad_request", message: "pageSize must be 20, 50 or 100", status: 400 };
      }
      if (opts.kind != null && !isMemoryKind(opts.kind)) {
        return { ok: false, error: "bad_request", message: "invalid kind", status: 400 };
      }
      if (opts.level != null && !isScopeLevel(opts.level)) {
        return { ok: false, error: "bad_request", message: "invalid level", status: 400 };
      }
      if (opts.trust != null && !isTrust(opts.trust)) {
        return { ok: false, error: "bad_request", message: "invalid trust", status: 400 };
      }
      if (opts.status != null && !isMemoryStatus(opts.status)) {
        return { ok: false, error: "bad_request", message: "invalid status", status: 400 };
      }

      const pageSize: MemoryPageSize = opts.pageSize ?? 20;
      const page = opts.page ?? 1;

      const all = new MemoryStore(home).listAll();
      all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

      const filtered = all.filter((m) => {
        if (!matchesQuery(m, opts.q)) return false;
        if (opts.kind != null && m.kind !== opts.kind) return false;
        if (opts.level != null && m.scope.level !== opts.level) return false;
        if (opts.trust != null && m.trust !== opts.trust) return false;
        if (opts.status != null && m.status !== opts.status) return false;
        return true;
      });

      function countFacet<K extends string>(key: keyof ListMemoriesInput, values: readonly K[], getValue: (m: MemoryRecord) => K): Record<K, number> {
        const counts = {} as Record<K, number>;
        for (const v of values) counts[v] = 0;
        for (const m of all) {
          if (!matchesQuery(m, opts.q)) continue;
          if (opts.kind != null && key !== "kind" && m.kind !== opts.kind) continue;
          if (opts.level != null && key !== "level" && m.scope.level !== opts.level) continue;
          if (opts.trust != null && key !== "trust" && m.trust !== opts.trust) continue;
          if (opts.status != null && key !== "status" && m.status !== opts.status) continue;
          const v = getValue(m);
          counts[v] = (counts[v] ?? 0) + 1;
        }
        return counts;
      }

      const total = filtered.length;
      const effectivePage = total === 0 ? 1 : page;
      const start = (effectivePage - 1) * pageSize;
      const pageItems = start >= total && total > 0 ? [] : filtered.slice(start, start + pageSize).map(memoryToListItem);

      return {
        ok: true,
        data: {
          items: pageItems,
          total,
          page: effectivePage,
          pageSize,
          facets: {
            kind: countFacet("kind", MEMORY_KINDS, (m) => m.kind),
            level: countFacet("level", SCOPE_LEVELS, (m) => m.scope.level),
            trust: countFacet("trust", TRUSTS, (m) => m.trust),
            status: countFacet("status", MEMORY_STATUSES, (m) => m.status),
          },
        },
      };
    }

  return {
    listMemories,

    getMemory(id: string): AdminResult {
      const m = new MemoryStore(home).readById(id);
      if (!m) return { ok: false, error: "not_found", message: `memory ${id}`, status: 404 };
      return { ok: true, data: m };
    },

    recall(query: string, k?: number): AdminResult {
      const c = cfg();
      const sit = extractSituation({ query, userId: c.identity.user_id });
      const hits = recall(home, sit, k ?? c.recall.l0_items);
      const mode = c.recall.mode ?? "assist";
      const decisions = decideRecall(hits, mode);
      const pack = buildContextPack({
        home,
        cfg: c,
        situation: sit,
        sessionId: "admin",
        hits,
      });
      return {
        ok: true,
        data: {
          pack_id: pack.pack_id,
          mode,
          hits: decisions.map((d) => ({
            id: d.memory.id,
            title: d.memory.title,
            score: d.score,
            status: d.memory.status,
            decision: d.decision,
            reason: d.reason,
            parts: d.parts,
            content: d.memory.content.slice(0, 300),
          })),
          dropped: pack.dropped,
        },
      };
    },

    listConflicts(): AdminResult {
      const pairs = listConflicts(home).map((p) => ({
        left: {
          id: p.left.id,
          title: p.left.title,
          status: p.left.status,
          updated_at: p.left.updated_at,
        },
        right: {
          id: p.right.id,
          title: p.right.title,
          status: p.right.status,
          updated_at: p.right.updated_at,
        },
      }));
      return { ok: true, data: { conflicts: pairs } };
    },

    resolveConflict(input: {
      leftId: string;
      rightId: string;
      action: ResolveConflictAction;
      leftUpdatedAt: string;
      rightUpdatedAt: string;
    }): AdminResult {
      try {
        const result = resolveConflict(home, input);
        return {
          ok: true,
          data: {
            left: { id: result.left.id, status: result.left.status },
            right: { id: result.right.id, status: result.right.status },
          },
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status =
          msg === "not_found"
            ? 404
            : msg === "conflict_version_mismatch" || msg === "not_a_conflict_pair"
              ? 409
              : 400;
        return { ok: false, error: msg, message: msg, status };
      }
    },

    note(args: {
      kind: MemoryRecord["kind"];
      title: string;
      content: string;
      applies_when: string;
      evidence_hint?: string;
    }): AdminResult {
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
            ? [{ ep: "admin-note", text: args.evidence_hint }]
            : [],
          count: 0,
          distinct_instances: 1,
          distinct_domains: 1,
        },
        stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
        validity: {
          depends_on: [],
          valid_from: new Date().toISOString().slice(0, 10),
        },
        created_by: "admin-ui",
        updated_at: new Date().toISOString(),
      };
      store.write(rec, "human");
      const idx = new IndexStore(home);
      try {
        idx.rebuild(store);
      } finally {
        idx.close();
      }
      return { ok: true, data: { id, status: rec.status } };
    },

    forget(id: string): AdminResult {
      const ok = new MemoryStore(home).forget(id);
      if (!ok) return { ok: false, error: "not_found", message: `memory ${id}`, status: 404 };
      return { ok: true, data: { forgotten: id } };
    },

    listSkills(): AdminResult {
      return { ok: true, data: { items: listSkillsData(home) } };
    },

    listProposals(): AdminResult {
      return { ok: true, data: { items: listProposalsData(home) } };
    },

    applyProposal(id: string, skillName: string): AdminResult {
      try {
        const dest = materializeProposal(home, id, skillName);
        return { ok: true, data: { dest } };
      } catch (e) {
        return {
          ok: false,
          error: "apply_failed",
          message: e instanceof Error ? e.message : String(e),
          status: 400,
        };
      }
    },

    doctor(): AdminResult {
      return { ok: true, data: runDoctor(home) };
    },

    listFailed(limit?: number): AdminResult {
      const items = listFailedJobs(home, limit ?? 20);
      return { ok: true, data: { items, total: items.length } };
    },

    purgeFailed(names?: string[]): AdminResult {
      return { ok: true, data: purgeFailedJobs(home, names) };
    },

    async flush(sessionId?: string | null): Promise<AdminResult> {
      const sid =
        sessionId == null || !String(sessionId).trim() ? "manual" : String(sessionId).trim();
      if (!isSafeId(sid)) {
        return { ok: false, error: "bad_request", message: "invalid sessionId", status: 400 };
      }
      const file = enqueueFlush(home, sid);
      const n = await processQueue(home);
      return { ok: true, data: { queued: file, processed: n } };
    },

    rebuildIndex(): AdminResult {
      const idx = new IndexStore(home);
      try {
        const n = idx.rebuild(new MemoryStore(home));
        return { ok: true, data: { indexed: n } };
      } finally {
        idx.close();
      }
    },

    async consolidate(dryRun = false): Promise<AdminResult> {
      const c = cfg();
      if (dryRun) return { ok: true, data: { dryRun: true, promotion: c.promotion } };
      const r = await runConsolidate(home, c);
      return { ok: true, data: r };
    },

    compile(target?: string): AdminResult {
      const t = target == null || target === "" ? "dsh" : target;
      if (t !== "dsh") {
        return {
          ok: false,
          error: "bad_request",
          message: "compile target must be dsh",
          status: 400,
        };
      }
      try {
        const r = compileCapabilities(home, "dsh");
        return { ok: true, data: r };
      } catch (e) {
        return {
          ok: false,
          error: "compile_failed",
          message: e instanceof Error ? e.message : String(e),
          status: 400,
        };
      }
    },

    getConfig(): AdminResult {
      const view = getSafeConfigView(home);
      return { ok: true, data: view.data };
    },

    putConfig(body: unknown): AdminResult {
      const result = applyEditableConfigPatch(home, body);
      if (!result.ok) {
        const status = result.error === "internal" ? 500 : 400;
        return { ok: false, error: result.error, message: result.message, status };
      }
      return { ok: true, data: result.data };
    },
  };
}

export type AmemAdmin = ReturnType<typeof createAdmin>;
