#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  amemHome,
  configToToml,
  defaultConfig,
  loadConfig,
  paths,
} from "@amem/core";
import { EpisodeStore, IndexStore, MemoryStore, ProposalStore, listConflicts, resolveConflict, INDEX_SCHEMA_VERSION } from "@amem/store";
import {
  consolidate,
  extractSession,
  enqueueFlush,
  processQueue,
} from "@amem/pipeline";
import { buildContextPack, decideRecall, extractSituation, recall } from "@amem/retrieval";
import { ingestCursorTranscripts } from "@amem/adapter-cursor";
import { compileCapabilities, materializeProposal } from "@amem/compiler";
import { DshTokenStore, type DshAdminScope } from "@amem/adapter-dsh";
import { runList, type ListKind } from "./list.js";
import { defaultExportName, runExport } from "./export.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function help(): void {
  console.log(`amem — cross-session agent memory

Usage:
  amem init
  amem doctor
  amem flush [--session <id>]
  amem worker
  amem recall "<query>"
  amem pack "<query>"
  amem list [memories|skills|proposals|all] [--limit N]
  amem export --skills <name|all> [--out path.zip|dir] [--memories] [--proposals]
  amem consolidate [--dry-run]
  amem review --list | --apply <proposalId> <skillName>
  amem compile --target cursor|claude-code|dsh [--out <dir>]
  amem ingest-transcript --host cursor [--dir <path>]
  amem install --host cursor|dsh
  amem auth issue --target dsh --scopes ... [--ttl 8h]   # only when dsh.admin.auth_enabled=true
  amem auth list
  amem auth revoke <token-id>
  amem rebuild-index
  amem forget <id>
  amem conflict list
  amem conflict resolve <leftId> <rightId> keep_left|keep_right|keep_both
  amem embed-backfill
`);
}

export function parseDurationMs(input: string): number {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d+)([mhd])$/i);
  if (!match) {
    throw new Error("duration must be <number>m|h|d");
  }
  const value = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("duration must be a positive integer");
  }
  const ms =
    unit === "m" ? value * 60_000 : unit === "h" ? value * 3_600_000 : value * 86_400_000;
  const maxMs = 365 * 86_400_000;
  if (ms > maxMs) {
    throw new Error("duration cannot exceed 365 days");
  }
  return ms;
}

export function runAuthIssue(
  home: string,
  target: string,
  scopesRaw: string,
  ttlRaw: string,
): { token: string; record: { id: string; scopes: DshAdminScope[]; createdAt: string; expiresAt: string } } {
  if (target !== "dsh") {
    throw new Error("issue only supports --target dsh");
  }
  const scopes = scopesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as DshAdminScope[];
  const ttlMs = parseDurationMs(ttlRaw);
  return new DshTokenStore(home).issue(scopes, ttlMs);
}

export function runAuthList(home: string): { id: string; scopes: DshAdminScope[]; createdAt: string; expiresAt: string; lastUsedAt?: string; revokedAt?: string }[] {
  return new DshTokenStore(home).list();
}

export function runAuthRevoke(home: string, id: string): boolean {
  return new DshTokenStore(home).revoke(id);
}

function resolveRepoFile(...parts: string[]): string | undefined {
  const candidates = [
    join(process.cwd(), ...parts),
    join(__dirname, "..", "..", "..", ...parts),
    join(__dirname, "..", "..", ...parts),
  ];
  return candidates.find((c) => existsSync(c));
}

function installDsh(home: string): void {
  const serverJs = resolveRepoFile("packages", "gateway-mcp", "dist", "server.js");
  const adapterPkg = resolveRepoFile("packages", "adapter-dsh", "package.json");
  const uiPkg = resolveRepoFile("packages", "amem-dsh-ui", "package.json");
  const adapterEntry = resolveRepoFile("packages", "adapter-dsh", "dist", "index.js");
  const cliBin = resolveRepoFile("packages", "cli", "dist", "bin.js");
  if (!serverJs || !adapterPkg || !uiPkg || !adapterEntry) {
    throw new Error(
      "DSH install requires built packages (gateway-mcp, adapter-dsh, amem-dsh-ui); run pnpm build from repo root",
    );
  }
  const adapterRoot = dirname(adapterPkg);
  const uiRoot = dirname(uiPkg);
  const nodePath = process.execPath.replace(/\\/g, "/");
  const serverPath = serverJs.replace(/\\/g, "/");
  const homePath = home.replace(/\\/g, "/");
  const cliPath = (cliBin ?? "").replace(/\\/g, "/");
  const userId = process.env.USERNAME ?? process.env.USER ?? "local";

  const adapterFileUrl = pathToFileURL(adapterEntry).href;
  const uiHostJs = join(uiRoot, "dist", "host.js");
  if (!existsSync(uiHostJs)) {
    throw new Error("amem-dsh-ui dist/host.js missing; run pnpm build");
  }
  const uiFileUrl = pathToFileURL(uiHostJs).href;

  const hostDir = join(home, "hosts", "dsh");
  mkdirSync(hostDir, { recursive: true });

  // Thin wrapper so Cordis config is baked in (no Schemastery Config export required).
  const wrapperPath = join(hostDir, "amem-host.mjs");
  writeFileSync(
    wrapperPath,
    `import { pathToFileURL } from "node:url";
const mod = await import(${JSON.stringify(adapterFileUrl)});
export const name = "amem-dsh-host";
// Cordis Loader only sees THIS module — re-export inject so apply waits for services.
export const inject = mod.inject ?? ["webServer"];
export function apply(ctx) {
  mod.apply(ctx, {
    amemHome: ${JSON.stringify(homePath)},
    userId: ${JSON.stringify(userId)},
    cliPath: ${JSON.stringify(cliPath)},
  });
}
`,
  );
  const wrapperUrl = pathToFileURL(wrapperPath).href;

  const overlay = `# generated by amem install --host dsh
- insert:
    - id: memory-amem
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: amem
        transport: stdio
        command: ${JSON.stringify(nodePath)}
        args: [${JSON.stringify(serverPath)}]
        env:
          AMEM_HOME: ${JSON.stringify(homePath)}
        cwd: !!js process.cwd()
    - id: amem-host
      name: ${JSON.stringify(wrapperUrl)}
    - id: amem-ui
      name: ${JSON.stringify(uiFileUrl)}
`;

  const overlayPath = join(hostDir, "amem.cordis.yml");
  writeFileSync(overlayPath, overlay);

  const skillSrc =
    resolveRepoFile("packages", "adapter-dsh", "skill", "SKILL.md") ??
    join(adapterRoot, "skill", "SKILL.md");
  const skillDest = join(homedir(), ".dsh", "skills", "amem", "SKILL.md");
  let skillOut: string | null = null;
  if (existsSync(skillSrc)) {
    mkdirSync(dirname(skillDest), { recursive: true });
    copyFileSync(skillSrc, skillDest);
    skillOut = skillDest;
  }

  // Only touch ~/.dsh/cordis.patch.yml when installing into the default home.
  // Custom/temp AMEM_HOME must not pollute the global DSH profile (use --patch instead).
  const dshPatch = join(homedir(), ".dsh", "cordis.patch.yml");
  const defaultHome = join(homedir(), ".amem");
  const isDefaultHome =
    resolve(home).replace(/\\/g, "/").toLowerCase() ===
    resolve(defaultHome).replace(/\\/g, "/").toLowerCase();
  let patchMerged = false;
  if (isDefaultHome) {
    mkdirSync(dirname(dshPatch), { recursive: true });
    writeFileSync(dshPatch, overlay);
    patchMerged = true;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        host: "dsh",
        overlay: overlayPath,
        skill: skillOut,
        patchMerged,
        patchFile: patchMerged ? dshPatch : null,
        adapter: adapterFileUrl,
        hostWrapper: wrapperUrl,
        ui: uiFileUrl,
        startHint: patchMerged ? "dsh web" : `dsh web --patch "${overlayPath}"`,
        authHint: loadConfig(home).dsh.admin.auth_enabled
          ? "amem auth issue --target dsh --scopes memory:read,skill:read,proposal:read"
          : "auth disabled by default; set [dsh.admin].auth_enabled = true to require tokens",
      },
      null,
      2,
    ),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const home = amemHome();

  if (!cmd || cmd === "-h" || cmd === "--help") {
    help();
    return;
  }

  if (cmd === "init") {
    const p = paths(home);
    for (const d of [
      p.spool,
      p.spoolRaw,
      p.episodes,
      p.memories,
      p.manifests,
      p.queue,
      p.logs,
      p.auth,
      p.capabilities,
      join(p.capabilities, "skills"),
      new ProposalStore(home).proposalsRoot(),
    ]) {
      mkdirSync(d, { recursive: true });
    }
    if (!existsSync(p.config)) {
      const cfg = defaultConfig(process.env.USERNAME ?? process.env.USER ?? "local");
      cfg.llm.mode = process.env.AMEM_LLM_KEY ? "external" : "stub";
      writeFileSync(p.config, configToToml(cfg));
    }
    console.log(`initialized ${home}`);
    return;
  }

  if (cmd === "doctor") {
    const p = paths(home);
    const idx = new IndexStore(home);
    let indexSchemaVersion = 0;
    try {
      indexSchemaVersion = idx.schemaVersion();
    } finally {
      idx.close();
    }
    const checks = [
      ["home", existsSync(home)],
      ["config", existsSync(p.config)],
      ["node", process.versions.node],
      ["spool_raw_files", existsSync(p.spoolRaw) ? readdirSync(p.spoolRaw).length : 0],
      ["index_schema_version", indexSchemaVersion],
      ["index_schema_expected", INDEX_SCHEMA_VERSION],
      ["index_schema_ok", indexSchemaVersion === INDEX_SCHEMA_VERSION],
    ];
    console.log(JSON.stringify({ home, checks }, null, 2));
    return;
  }

  if (cmd === "flush") {
    const sidIdx = argv.indexOf("--session");
    const sid = sidIdx >= 0 ? argv[sidIdx + 1] : "manual";
    const file = enqueueFlush(home, sid!);
    const n = await processQueue(home);
    console.log(JSON.stringify({ queued: file, processed: n }));
    return;
  }

  if (cmd === "worker") {
    const n = await processQueue(home);
    console.log(JSON.stringify({ processed: n }));
    return;
  }

  if (cmd === "recall") {
    const q = argv[1];
    if (!q) throw new Error("query required");
    const cfg = loadConfig(home);
    const sit = extractSituation({ query: q, userId: cfg.identity.user_id });
    const hits = recall(home, sit, 8);
    const mode = cfg.recall.mode ?? "assist";
    const decisions = decideRecall(hits, mode);
    console.log(
      JSON.stringify(
        decisions.map((d) => ({
          id: d.memory.id,
          title: d.memory.title,
          score: d.score,
          level: d.memory.scope.level,
          decision: d.decision,
          reason: d.reason,
          parts: d.parts,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "consolidate") {
    const dry = argv.includes("--dry-run");
    const cfg = loadConfig(home);
    if (dry) {
      console.log(JSON.stringify({ dryRun: true, promotion: cfg.promotion }));
      return;
    }
    const r = await consolidate(home, cfg);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === "review") {
    if (argv[1] === "--list") {
      const list = new ProposalStore(home).list().map((p) => p.id);
      console.log(JSON.stringify({ proposals: list }, null, 2));
      return;
    }
    if (argv[1] === "--apply") {
      const id = argv[2];
      const name = argv[3];
      if (!id || !name) throw new Error("usage: amem review --apply <proposalId> <skillName>");
      const dest = materializeProposal(home, id, name);
      console.log(JSON.stringify({ materialized: dest }));
      return;
    }
    throw new Error("usage: amem review --list | --apply ...");
  }

  if (cmd === "compile") {
    const tIdx = argv.indexOf("--target");
    const target = (tIdx >= 0 ? (argv[tIdx + 1] ?? "cursor") : "cursor") as
      | "cursor"
      | "claude-code"
      | "dsh";
    if (target !== "cursor" && target !== "claude-code" && target !== "dsh") {
      throw new Error("compile --target must be cursor|claude-code|dsh");
    }
    const oIdx = argv.indexOf("--out");
    const out = oIdx >= 0 ? argv[oIdx + 1] : undefined;
    const r = compileCapabilities(home, target, out);
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === "ingest-transcript") {
    const hostIdx = argv.indexOf("--host");
    const host = hostIdx >= 0 ? (argv[hostIdx + 1] ?? "cursor") : "cursor";
    const dIdx = argv.indexOf("--dir");
    let dir = dIdx >= 0 ? argv[dIdx + 1] : undefined;
    if (!dir && host === "cursor") {
      // default: first project transcripts under ~/.cursor/projects
      const root = join(homedir(), ".cursor", "projects");
      dir = root;
    }
    if (!dir) throw new Error("--dir required");
    const cfg = loadConfig(home);
    const ep = new EpisodeStore(home);
    let count = 0;
    const walk = (d: string) => {
      if (!existsSync(d)) return [] as string[];
      const out: string[] = [];
      for (const name of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, name.name);
        if (name.isDirectory()) {
          if (name.name === "agent-transcripts") out.push(p);
          else out.push(...walk(p));
        }
      }
      return out;
    };
    const dirs = dir.endsWith("agent-transcripts") ? [dir] : walk(dir);
    for (const td of dirs) {
      const sessionBuckets = new Map<string, boolean>();
      for await (const ev of ingestCursorTranscripts(td, cfg.identity.user_id)) {
        ep.appendSpool(ev.session_id, ev);
        sessionBuckets.set(ev.session_id, true);
        count += 1;
      }
      for (const sid of sessionBuckets.keys()) {
        try {
          await extractSession(home, sid, cfg);
        } catch {
          /* empty spool race */
        }
      }
    }
    console.log(JSON.stringify({ events: count, dirs: dirs.length }));
    return;
  }

  if (cmd === "install") {
    const hostIdx = argv.indexOf("--host");
    const host = hostIdx >= 0 ? (argv[hostIdx + 1] ?? "cursor") : "cursor";
    if (host === "dsh") {
      installDsh(home);
      return;
    }
    if (host !== "cursor") {
      console.log(JSON.stringify({ ok: false, message: `install for ${host} is stub — copy MCP config manually` }));
      return;
    }
    const hookSrc = join(__dirname, "../../adapter-cursor/hooks/amem-hook.mjs");
    const hookDest = join(homedir(), ".cursor", "hooks", "amem-hook.mjs");
    mkdirSync(dirname(hookDest), { recursive: true });
    // prefer packaged hook next to source during dev
    const candidates = [
      join(home, "..", "dev", "workspaces", "amem", "packages", "adapter-cursor", "hooks", "amem-hook.mjs"),
      join(process.cwd(), "packages", "adapter-cursor", "hooks", "amem-hook.mjs"),
      hookSrc,
    ];
    const found = candidates.find((c) => existsSync(c));
    if (!found) throw new Error("amem-hook.mjs not found; run from repo root");
    copyFileSync(found, hookDest);

    const skillSrc = join(process.cwd(), "packages", "adapter-cursor", "skill", "SKILL.md");
    const skillDest = join(homedir(), ".cursor", "skills", "amem", "SKILL.md");
    if (existsSync(skillSrc)) {
      mkdirSync(dirname(skillDest), { recursive: true });
      copyFileSync(skillSrc, skillDest);
    }

    const mcpPath = join(homedir(), ".cursor", "mcp.json");
    let mcp: { mcpServers?: Record<string, unknown> } = {};
    if (existsSync(mcpPath)) {
      try {
        mcp = JSON.parse(readFileSync(mcpPath, "utf8")) as typeof mcp;
      } catch {
        mcp = {};
      }
    }
    mcp.mcpServers ??= {};
    const serverJs = join(process.cwd(), "packages", "gateway-mcp", "dist", "server.js");
    mcp.mcpServers.amem = {
      command: process.execPath,
      args: [serverJs],
      env: { AMEM_HOME: home },
    };
    writeFileSync(mcpPath, JSON.stringify(mcp, null, 2));

    // Merge production hook into ~/.cursor/hooks.json (preserve gsd-managed; replace amem-probe)
    const hooksPath = join(homedir(), ".cursor", "hooks.json");
    const nodeExe = process.execPath.replace(/\\/g, "/");
    const hookCmd = (ev: string) =>
      `"${nodeExe}" "${hookDest.replace(/\\/g, "/")}" ${ev}`;
    const amemEvents = [
      "sessionStart",
      "postToolUse",
      "sessionEnd",
      "beforeSubmitPrompt",
      "postToolUseFailure",
      "afterShellExecution",
      "afterFileEdit",
      "afterAgentResponse",
      "preCompact",
      "stop",
    ] as const;
    let hooksDoc: { version?: number; hooks?: Record<string, Array<Record<string, unknown>>> } =
      { version: 1, hooks: {} };
    if (existsSync(hooksPath)) {
      try {
        hooksDoc = JSON.parse(readFileSync(hooksPath, "utf8")) as typeof hooksDoc;
      } catch {
        hooksDoc = { version: 1, hooks: {} };
      }
    }
    hooksDoc.version ??= 1;
    hooksDoc.hooks ??= {};
    for (const ev of amemEvents) {
      const list = [...(hooksDoc.hooks[ev] ?? [])].filter((h) => {
        const c = String(h.command ?? "");
        return !c.includes("amem-probe.mjs") && !c.includes("amem-hook.mjs");
      });
      list.push({ type: "command", command: hookCmd(ev), timeout: 5 });
      hooksDoc.hooks[ev] = list;
    }
    writeFileSync(hooksPath, JSON.stringify(hooksDoc, null, 2) + "\n");

    console.log(
      JSON.stringify(
        {
          hook: hookDest,
          hooksJson: hooksPath,
          skill: existsSync(skillDest) ? skillDest : null,
          mcp: mcpPath,
          ok: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (cmd === "auth") {
    const sub = argv[1];
    if (sub === "issue") {
      const targetIdx = argv.indexOf("--target");
      const scopesIdx = argv.indexOf("--scopes");
      const ttlIdx = argv.indexOf("--ttl");
      const target = targetIdx >= 0 ? argv[targetIdx + 1] : undefined;
      const scopesRaw = scopesIdx >= 0 ? argv[scopesIdx + 1] : undefined;
      const ttlRaw = ttlIdx >= 0 && argv[ttlIdx + 1] ? argv[ttlIdx + 1]! : "8h";
      if (!target || !scopesRaw) {
        throw new Error("usage: amem auth issue --target dsh --scopes ... [--ttl 8h]");
      }
      const { token, record } = runAuthIssue(home, target, scopesRaw, ttlRaw);
      console.log(JSON.stringify({ ok: true, token, record }, null, 2));
      return;
    }
    if (sub === "list") {
      const tokens = runAuthList(home);
      console.log(JSON.stringify({ ok: true, tokens }, null, 2));
      return;
    }
    if (sub === "revoke") {
      const id = argv[2];
      if (!id) throw new Error("usage: amem auth revoke <token-id>");
      const ok = runAuthRevoke(home, id);
      if (!ok) throw new Error(`token not found: ${id}`);
      console.log(JSON.stringify({ ok: true, revoked: id }, null, 2));
      return;
    }
    throw new Error("usage: amem auth issue|list|revoke ...");
  }

  if (cmd === "list") {
    const kindArg = argv[1] && !argv[1].startsWith("-") ? argv[1] : "all";
    const allowed: ListKind[] = ["memories", "skills", "proposals", "all"];
    if (!allowed.includes(kindArg as ListKind)) {
      throw new Error(`usage: amem list [${allowed.join("|")}] [--limit N]`);
    }
    const limIdx = argv.indexOf("--limit");
    const limit = limIdx >= 0 ? Number(argv[limIdx + 1]) : 50;
    runList(home, kindArg as ListKind, Number.isFinite(limit) ? limit : 50);
    return;
  }

  if (cmd === "export") {
    const sIdx = argv.indexOf("--skills");
    if (sIdx < 0 || !argv[sIdx + 1]) {
      throw new Error(
        "usage: amem export --skills <name|all> [--out path.zip|dir] [--memories] [--proposals]",
      );
    }
    const skills = argv[sIdx + 1]!;
    const oIdx = argv.indexOf("--out");
    const out =
      oIdx >= 0 && argv[oIdx + 1]
        ? argv[oIdx + 1]!
        : join(process.cwd(), defaultExportName(skills));
    const result = runExport(home, {
      skills,
      out,
      memories: argv.includes("--memories"),
      proposals: argv.includes("--proposals"),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (cmd === "rebuild-index") {
    const n = new IndexStore(home).rebuild(new MemoryStore(home));
    console.log(JSON.stringify({ indexed: n }));
    return;
  }

  if (cmd === "forget") {
    const id = argv[1];
    if (!id) throw new Error("id required");
    const ok = new MemoryStore(home).forget(id);
    new IndexStore(home).rebuild(new MemoryStore(home));
    console.log(JSON.stringify({ forgot: ok }));
    return;
  }

  if (cmd === "conflict") {
    const sub = argv[1];
    if (sub === "list") {
      const pairs = listConflicts(home).map((p) => ({
        left: { id: p.left.id, title: p.left.title, updated_at: p.left.updated_at },
        right: { id: p.right.id, title: p.right.title, updated_at: p.right.updated_at },
      }));
      console.log(JSON.stringify({ conflicts: pairs }, null, 2));
      return;
    }
    if (sub === "resolve") {
      const leftId = argv[2];
      const rightId = argv[3];
      const action = argv[4] as "keep_left" | "keep_right" | "keep_both";
      if (!leftId || !rightId || !action) {
        throw new Error(
          "usage: amem conflict resolve <leftId> <rightId> keep_left|keep_right|keep_both",
        );
      }
      if (action !== "keep_left" && action !== "keep_right" && action !== "keep_both") {
        throw new Error("action must be keep_left|keep_right|keep_both");
      }
      const store = new MemoryStore(home);
      const left = store.readById(leftId);
      const right = store.readById(rightId);
      if (!left || !right) throw new Error("not_found");
      const result = resolveConflict(home, {
        leftId,
        rightId,
        action,
        leftUpdatedAt: left.updated_at,
        rightUpdatedAt: right.updated_at,
      });
      console.log(
        JSON.stringify(
          {
            left: { id: result.left.id, status: result.left.status },
            right: { id: result.right.id, status: result.right.status },
          },
          null,
          2,
        ),
      );
      return;
    }
    throw new Error("usage: amem conflict list | resolve ...");
  }

  if (cmd === "embed-backfill") {
    const cfg = loadConfig(home);
    if (!cfg.embedding.enabled) {
      throw new Error("set [embedding] enabled = true in amem.toml first");
    }
    const { createLlmClient } = await import("@amem/llm");
    const client = createLlmClient(cfg);
    if (!client.embedTexts) throw new Error("llm client cannot embed");
    const store = new MemoryStore(home);
    const idx = new IndexStore(home);
    let n = 0;
    for (const m of store.listAll()) {
      const text = `${m.title}\n${m.applies_when}\n${m.content.slice(0, 800)}`;
      const vecs = await client.embedTexts([text]);
      if (vecs?.[0]?.length) {
        idx.upsertEmbedding(m.id, vecs[0]);
        n += 1;
      }
    }
    idx.close();
    console.log(JSON.stringify({ embedded: n }));
    return;
  }

  // keep context_pack available for debugging
  if (cmd === "pack") {
    const q = argv[1] ?? "";
    const cfg = loadConfig(home);
    const sit = extractSituation({ query: q, userId: cfg.identity.user_id });
    console.log(JSON.stringify(buildContextPack({ home, cfg, situation: sit, sessionId: "cli" }), null, 2));
    return;
  }

  help();
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
