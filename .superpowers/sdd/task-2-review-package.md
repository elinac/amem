# Task 2 Review Package\n\nCommits: none\n\n### packages/adapter-dsh/src/admin.ts\n\n`	s\nimport { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  amemHome as defaultAmemHome,
  extractEditableConfigPatch,
  loadConfig,
  mergeConfigOverlay,
  newId,
  paths,
  validateEditableConfigPatch,
  writeAmemConfigFile,
  type MemoryRecord,
} from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { buildContextPack, extractSituation, recall } from "@amem/retrieval";
import {
  compileCapabilities,
  listProposalsData,
  listSkillsData,
  materializeProposal,
} from "@amem/compiler";
import { consolidate, enqueueFlush, processQueue } from "@amem/pipeline";

export type AdminResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; message: string; status: number };

export function createAdmin(home = defaultAmemHome()) {
  const cfg = () => loadConfig(home);

  return {
    listMemories(limit = 50): AdminResult {
      const all = new MemoryStore(home).listAll();
      all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return {
        ok: true,
        data: {
          total: all.length,
          items: all.slice(0, limit).map((m) => ({
            id: m.id,
            kind: m.kind,
            level: m.scope.level,
            trust: m.trust,
            status: m.status,
            title: m.title,
            helpful: m.stats.helpful,
            harmful: m.stats.harmful,
            updated_at: m.updated_at,
          })),
        },
      };
    },

    getMemory(id: string): AdminResult {
      const m = new MemoryStore(home).readById(id);
      if (!m) return { ok: false, error: "not_found", message: `memory ${id}`, status: 404 };
      return { ok: true, data: m };
    },

    recall(query: string, k?: number): AdminResult {
      const c = cfg();
      const sit = extractSituation({ query, userId: c.identity.user_id });
      const hits = recall(home, sit, k ?? c.recall.l0_items);
      const pack = buildContextPack({
        home,
        cfg: c,
        situation: sit,
        sessionId: "admin",
      });
      return {
        ok: true,
        data: {
          pack_id: pack.pack_id,
          hits: hits.map((h) => ({
            id: h.memory.id,
            title: h.memory.title,
            score: h.score,
            status: h.memory.status,
            content: h.memory.content.slice(0, 300),
          })),
        },
      };
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
      idx.rebuild(store);
      idx.close();
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
      const p = paths(home);
      const checks: Array<[string, unknown]> = [
        ["home", existsSync(home)],
        ["config", existsSync(p.config)],
        ["node", process.versions.node],
        ["spool_raw_files", existsSync(p.spoolRaw) ? readdirSync(p.spoolRaw).length : 0],
      ];
      return { ok: true, data: { home, checks } };
    },

    async flush(sessionId?: string | null): Promise<AdminResult> {
      const sid =
        sessionId == null || !String(sessionId).trim() ? "manual" : String(sessionId).trim();
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(sid)) {
        return { ok: false, error: "bad_request", message: "invalid sessionId", status: 400 };
      }
      const file = enqueueFlush(home, sid);
      const n = await processQueue(home);
      return { ok: true, data: { queued: file, processed: n } };
    },

    rebuildIndex(): AdminResult {
      const idx = new IndexStore(home);
      const n = idx.rebuild(new MemoryStore(home));
      idx.close();
      return { ok: true, data: { indexed: n } };
    },

    consolidate(dryRun = false): AdminResult {
      const c = cfg();
      if (dryRun) return { ok: true, data: { dryRun: true, promotion: c.promotion } };
      const r = consolidate(home, c);
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
      const configPath = paths(home).config;
      return {
        ok: true,
        data: { path: configPath, config: loadConfig(home) },
      };
    },

    putConfig(body: unknown): AdminResult {
      try {
        const extracted = extractEditableConfigPatch(body);
        if ("error" in extracted) {
          return { ok: false, error: extracted.error, message: extracted.message, status: 400 };
        }
        const validated = validateEditableConfigPatch(extracted);
        if (!validated.ok) {
          return {
            ok: false,
            error: validated.error,
            message: validated.message,
            status: 400,
          };
        }
        const base = loadConfig(home);
        const merged = mergeConfigOverlay(base, extracted);
        merged.embedding = base.embedding;
        merged.privacy = base.privacy;
        const configPath = paths(home).config;
        const disk = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
        writeAmemConfigFile(home, merged, disk);
        return { ok: true, data: { path: configPath, saved: true } };
      } catch (e) {
        return {
          ok: false,
          error: "internal",
          message: e instanceof Error ? e.message : String(e),
          status: 500,
        };
      }
    },
  };
}

export type AmemAdmin = ReturnType<typeof createAdmin>;
\n`\n\n### packages/adapter-dsh/src/admin-config.test.ts\n\n`	s\nimport { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configToToml, defaultConfig, loadConfig } from "@amem/core";
import { createAdmin } from "./admin.js";

describe("admin config", () => {
  let home: string;
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function setup(extra?: (toml: string) => string): string {
    home = mkdtempSync(join(tmpdir(), "amem-admin-cfg-"));
    mkdirSync(home, { recursive: true });
    let toml = configToToml(defaultConfig());
    if (extra) toml = extra(toml);
    writeFileSync(join(home, "amem.toml"), toml);
    return home;
  }

  it("getConfig returns path and config", () => {
    const h = setup();
    const r = createAdmin(h).getConfig();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { path: string; config: { llm: { mode: string } } };
    expect(data.path).toContain("amem.toml");
    expect(data.config.llm.mode).toBe("stub");
  });

  it("putConfig changes mode and keeps embedding", () => {
    const h = setup();
    const cfg = defaultConfig();
    cfg.embedding.enabled = true;
    cfg.embedding.model = "emb-keep";
    writeFileSync(join(h, "amem.toml"), configToToml(cfg));

    const before = loadConfig(h);
    expect(before.embedding.model).toBe("emb-keep");

    const body = {
      config: {
        ...before,
        llm: { ...before.llm, mode: "host" as const },
      },
    };
    const r = createAdmin(h).putConfig(body);
    expect(r.ok).toBe(true);
    const after = loadConfig(h);
    expect(after.llm.mode).toBe("host");
    expect(after.embedding.model).toBe("emb-keep");
  });

  it("putConfig rejects bad mode with 400", () => {
    const h = setup();
    const r = createAdmin(h).putConfig({
      config: { ...loadConfig(h), llm: { ...loadConfig(h).llm, mode: "nope" } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it("putConfig preserves privacy section text", () => {
    const h = setup((t) =>
      t.replace(
        `[privacy]
redact_patterns = []
exclude_workspaces = []
`,
        `[privacy]
redact_patterns = ["KEEP"]
exclude_workspaces = ["/x"]
`,
      ),
    );
    const cfg = loadConfig(h);
    const r = createAdmin(h).putConfig({
      config: { ...cfg, llm: { ...cfg.llm, mode: "external" } },
    });
    expect(r.ok).toBe(true);
    const text = readFileSync(join(h, "amem.toml"), "utf8");
    expect(text).toContain('redact_patterns = ["KEEP"]');
  });

  it("putConfig accepts top-level AmemConfig without wrapper", () => {
    const h = setup();
    const cfg = loadConfig(h);
    const r = createAdmin(h).putConfig({
      ...cfg,
      llm: { ...cfg.llm, mode: "host" },
    });
    expect(r.ok).toBe(true);
    expect(loadConfig(h).llm.mode).toBe("host");
  });
});
\n`\n