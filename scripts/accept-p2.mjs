#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, "packages/cli/dist/bin.js");
let failed = 0;
function pass(n) { console.log(`PASS ${n}`); }
function fail(n, e) { failed++; console.error(`FAIL ${n}:`, e instanceof Error ? e.message : e); }
function sh(args, env) {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r;
}

try {
  const { shouldPromoteToDomain, consolidate } = await import(
    pathToFileURL(join(root, "packages/pipeline/dist/index.js")).href
  );
  const { defaultConfig } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
  const cfg = defaultConfig();
  const ok = shouldPromoteToDomain(
    {
      id: "m",
      kind: "procedure",
      title: "t",
      content: "c",
      applies_when: "a",
      scope: { level: "instance", tags: {} },
      trust: "T3",
      status: "active",
      evidence: { episodes: [], count: 3, distinct_instances: 3, distinct_domains: 1 },
      stats: { recalled: 0, adopted: 0, helpful: 2, harmful: 0, lift: 0 },
      validity: { depends_on: [], valid_from: "2026-01-01" },
      created_by: "t",
      updated_at: new Date().toISOString(),
    },
    cfg,
  );
  if (!ok) throw new Error("promotion gate");
  pass("promotion gate boundaries");
} catch (e) { fail("promotion", e); }

try {
  const home = mkdtempSync(join(tmpdir(), "amem-p2-"));
  try {
    const env = { AMEM_HOME: home };
    sh(["init"], env);
    const { MemoryStore } = await import(pathToFileURL(join(root, "packages/store/dist/index.js")).href);
    const store = new MemoryStore(home);
    store.write(
      {
        id: "mem_proc",
        kind: "procedure",
        title: "fix port conflicts",
        content: "1. find process\n2. kill or change port\n3. restart",
        applies_when: "dev server port in use",
        scope: { level: "domain", tags: { user: "u", instances: ["a", "b", "c"] } },
        trust: "T2",
        status: "active",
        evidence: {
          episodes: ["e1", "e2", "e3"],
          count: 3,
          distinct_instances: 3,
          distinct_domains: 1,
        },
        stats: { recalled: 12, adopted: 8, helpful: 5, harmful: 0, lift: 0.2 },
        validity: { depends_on: [], valid_from: "2026-01-01" },
        created_by: "t",
        updated_at: new Date().toISOString(),
      },
      "pipeline",
    );
    const out = sh(["consolidate"], env);
    let r;
    try {
      r = JSON.parse(out.stdout);
    } catch {
      throw new Error(`consolidate stdout not JSON: ${out.stdout}`);
    }
    if (!r.proposals?.includes("mem_proc")) throw new Error(`no proposal: ${out.stdout}`);
    sh(["review", "--apply", "mem_proc", "fix-port"], env);
    const skillOut = join(home, "compiled-skills");
    mkdirSync(skillOut, { recursive: true });
    const compiled = sh(["compile", "--target", "cursor", "--out", skillOut], env);
    let cj;
    try {
      cj = JSON.parse(compiled.stdout);
    } catch {
      throw new Error(`compile stdout not JSON: ${compiled.stdout}`);
    }
    if (!cj.written?.length) throw new Error("compile wrote nothing");
    if (!existsSync(join(skillOut, "fix-port", "SKILL.md"))) throw new Error("skill missing");
    pass("procedure → proposal → apply → compile");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
} catch (e) { fail("capability pipeline", e); }

try {
  const home = mkdtempSync(join(tmpdir(), "amem-p2-promote-"));
  try {
    const env = { AMEM_HOME: home };
    sh(["init"], env);
    const { MemoryStore } = await import(pathToFileURL(join(root, "packages/store/dist/index.js")).href);
    const store = new MemoryStore(home);
    store.write(
      {
        id: "mem_inst",
        kind: "procedure",
        title: "fix port from instance",
        content: "1. find process\n2. kill or change port\n3. restart",
        applies_when: "dev server port in use",
        scope: { level: "instance", tags: { user: "u", instances: ["a", "b", "c"] } },
        trust: "T3",
        status: "active",
        evidence: {
          episodes: ["e1", "e2", "e3"],
          count: 3,
          distinct_instances: 3,
          distinct_domains: 1,
        },
        stats: { recalled: 4, adopted: 2, helpful: 2, harmful: 0, lift: 0.1 },
        validity: { depends_on: [], valid_from: "2026-01-01" },
        created_by: "t",
        updated_at: new Date().toISOString(),
      },
      "pipeline",
    );
    const out = sh(["consolidate"], env);
    let r;
    try {
      r = JSON.parse(out.stdout);
    } catch {
      throw new Error(`consolidate stdout not JSON: ${out.stdout}`);
    }
    if (!r.promoted?.includes("mem_inst")) throw new Error(`not promoted: ${out.stdout}`);
    if (!r.proposals?.includes("mem_inst")) throw new Error(`no same-pass proposal: ${out.stdout}`);
    sh(["review", "--apply", "mem_inst", "fix-port-inst"], env);
    const skillOut = join(home, "compiled-skills-inst");
    mkdirSync(skillOut, { recursive: true });
    const compiled = sh(["compile", "--target", "cursor", "--out", skillOut], env);
    let cj;
    try {
      cj = JSON.parse(compiled.stdout);
    } catch {
      throw new Error(`compile stdout not JSON: ${compiled.stdout}`);
    }
    if (!cj.written?.length) throw new Error("compile wrote nothing");
    if (!existsSync(join(skillOut, "fix-port-inst", "SKILL.md"))) throw new Error("skill missing");
    pass("instance → promote → proposal → apply → compile");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
} catch (e) { fail("promote-then-propose", e); }

try {
  const { assertWritableMemory } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
  let threw = false;
  try {
    assertWritableMemory(
      { kind: "fact", trust: "T1", status: "active", scope: { level: "instance", tags: {} } },
      "pipeline",
    );
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("I2 not enforced");
  pass("invariant I2 automatic T1 blocked");
} catch (e) { fail("invariants", e); }

console.log(failed ? `\n${failed} P2 checks failed` : "\nall P2 checks passed");
process.exit(failed ? 1 : 0);
