#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const bin = join(root, "packages/cli/dist/bin.js");

function pass(n) { console.log(`PASS ${n}`); }
function fail(n, e) { failed++; console.error(`FAIL ${n}:`, e instanceof Error ? e.message : e); }
function sh(args, env) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r;
}

try {
  const { extractSituation } = await import(pathToFileURL(join(root, "packages/retrieval/dist/index.js")).href);
  const ws = mkdtempSync(join(tmpdir(), "ws-"));
  writeFileSync(join(ws, "package.json"), JSON.stringify({ dependencies: { vite: "1", "@tauri-apps/cli": "1" } }));
  const s = extractSituation({ query: "fix port", userId: "u", workspaceRoot: ws });
  if (!s.domains.includes("vite") || !s.domains.includes("tauri")) throw new Error(JSON.stringify(s));
  rmSync(ws, { recursive: true, force: true });
  pass("situation domains from package.json");
} catch (e) { fail("situation", e); }

try {
  const { generalize, reconcile } = await import(pathToFileURL(join(root, "packages/pipeline/dist/index.js")).href);
  const g = generalize({
    kind: "fact",
    title: "t",
    content: "see D:\\\\dev\\\\workspaces\\\\foo\\\\bar and id 4cfa6150-adc9-4967-9a79-3b9cecc1f0e6",
    applies_when: "a",
    evidence: [{ event: 0, quote: "x" }],
  });
  if (g.content.includes("D:\\\\dev") || /4cfa6150/.test(g.content)) throw new Error(g.content);
  pass("generalize de-entity");
} catch (e) { fail("generalize", e); }

try {
  const home = mkdtempSync(join(tmpdir(), "amem-p1-"));
  const env = { AMEM_HOME: home };
  sh(["init"], env);
  // conflict recall presentation via two memories
  const { MemoryStore, IndexStore } = await import(pathToFileURL(join(root, "packages/store/dist/index.js")).href);
  const { recall, extractSituation } = await import(pathToFileURL(join(root, "packages/retrieval/dist/index.js")).href);
  const store = new MemoryStore(home);
  const base = {
    kind: "fact",
    content: "version A says use jar backend",
    applies_when: "choosing plantuml backend",
    scope: { level: "domain", tags: { user: "u", domains: ["plantuml"] } },
    trust: "T3",
    evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
    stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    created_by: "t",
    updated_at: new Date().toISOString(),
  };
  store.write({ ...base, id: "mem_a", title: "backend jar", status: "conflict" }, "pipeline");
  store.write({
    ...base,
    id: "mem_b",
    title: "backend rust",
    content: "version B says use rust backend",
    status: "conflict",
  }, "pipeline");
  const idx = new IndexStore(home);
  idx.rebuild(store);
  const hits = recall(home, extractSituation({ query: "plantuml backend", userId: "u" }), 10);
  idx.close();
  if (!hits.some((h) => h.memory.status === "conflict")) throw new Error("conflict not recalled");
  try { rmSync(home, { recursive: true, force: true }); } catch { /* sqlite unlock lag on windows */ }
  pass("conflict memories recallable");
} catch (e) { fail("conflict", e); }

try {
  const { normalizeClaudeHook } = await import(pathToFileURL(join(root, "packages/adapter-claude-code/dist/index.js")).href);
  const ev = normalizeClaudeHook("SessionStart", { session_id: "s", cwd: "/tmp" }, "u");
  if (ev[0]?.host !== "claude-code") throw new Error("bad host");
  pass("claude-code adapter");
} catch (e) { fail("claude-code adapter", e); }

console.log(failed ? `\n${failed} P1 checks failed` : "\nall P1 checks passed");
process.exit(failed ? 1 : 0);
