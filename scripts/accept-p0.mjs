#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let failed = 0;

function pass(name) {
  console.log(`PASS ${name}`);
}
function fail(name, e) {
  failed += 1;
  console.error(`FAIL ${name}:`, e instanceof Error ? e.message : e);
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: root,
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  }
  return r;
}

// 1) unit tests
try {
  sh(pnpm, ["-r", "run", "test"]);
  pass("unit tests");
} catch (e) {
  fail("unit tests", e);
}

// 2) hook latency
try {
  const hook = join(root, "packages/adapter-cursor/hooks/amem-hook.mjs");
  const start = Date.now();
  const r = spawnSync(
    process.execPath,
    [hook, "postToolUse"],
    {
      input: JSON.stringify({
        conversation_id: "bench",
        tool_name: "Shell",
        tool_output: JSON.stringify({ output: "ok", exitCode: 0 }),
      }),
      encoding: "utf8",
    },
  );
  const ms = Date.now() - start;
  if (r.status !== 0) throw new Error(r.stderr || "hook failed");
  if (ms >= 2000) throw new Error(`hook took ${ms}ms`);
  pass(`hook latency ${ms}ms <2000ms`);
} catch (e) {
  fail("hook latency", e);
}

// 3) redact
try {
  const mod = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
  const out = mod.redactDeep({
    api_key: "secret",
    note: "sk-abcdefghijklmnopqrstuvwxyz",
    user_email: "a@b.com",
  });
  const s = JSON.stringify(out);
  if (s.includes("sk-abc") || s.includes("a@b.com") || s.includes("secret")) {
    throw new Error(`leak: ${s}`);
  }
  if (!mod.containsSecrets("sk-abcdefghijklmnopqrstuvwxyz")) {
    throw new Error("containsSecrets false negative");
  }
  pass("redact zero-leak");
} catch (e) {
  fail("redact zero-leak", e);
}

// 4) adapter fixture
try {
  const mod = await import(
    pathToFileURL(join(root, "packages/adapter-cursor/dist/index.js")).href
  );
  const events = mod.normalizeCursorHook(
    "postToolUse",
    {
      conversation_id: "c1",
      tool_name: "Shell",
      tool_use_id: "t1",
      tool_output: JSON.stringify({ output: "Error: Port 3000 is already in use", exitCode: 1 }),
      workspace_roots: ["/d:/dev/workspaces/QCoder/NoteZ"],
      user_email: "x@y.com",
    },
    "u",
  );
  if (events.length !== 2) throw new Error(`expected 2 events, got ${events.length}`);
  if (JSON.stringify(events).includes("x@y.com")) throw new Error("email leaked");
  const root0 = events[0].workspace.roots[0];
  if (typeof root0 !== "string" || root0.toLowerCase().startsWith("/d:") || !/NoteZ/i.test(root0)) {
    throw new Error(`path not normalized: ${root0}`);
  }
  if (mod.normalizeCursorHook("afterShellExecution", { command: "x" }, "u").length !== 0) {
    throw new Error("afterShellExecution should be skipped");
  }
  pass("adapter cursor fixtures");
} catch (e) {
  fail("adapter cursor fixtures", e);
}

// 5) e2e extract + recall
try {
  const home = mkdtempSync(join(tmpdir(), "amem-accept-"));
  const env = { ...process.env, AMEM_HOME: home };
  const bin = join(root, "packages/cli/dist/bin.js");
  if (!existsSync(bin)) throw new Error("cli dist missing — run pnpm build");
  sh(process.execPath, [bin, "init"], { env });
  const sid = "accept-sess";
  mkdirSync(join(home, "spool"), { recursive: true });
  mkdirSync(join(home, "queue"), { recursive: true });
  writeFileSync(
    join(home, "spool", `${sid}.jsonl`),
    `${JSON.stringify({
      v: 1,
      ts: new Date().toISOString(),
      host: "cursor",
      session_id: sid,
      user_id: "accept",
      type: "tool_result",
      payload: { output: "Error: Port 3000 is already in use" },
    })}\n`,
  );
  writeFileSync(
    join(home, "queue", `flush-${sid}.json`),
    JSON.stringify({ type: "flush", sessionId: sid }),
  );
  sh(process.execPath, [bin, "worker"], { env });
  const out = sh(process.execPath, [bin, "recall", "port"], { env });
  let hits;
  try {
    hits = JSON.parse(out.stdout || "[]");
  } catch (e) {
    throw new Error(`recall stdout not JSON: ${out.stdout}`);
  }
  if (!Array.isArray(hits) || hits.length < 1) {
    throw new Error(`expected recall hits, got ${out.stdout}`);
  }
  rmSync(home, { recursive: true, force: true });
  pass("e2e init extract recall");
} catch (e) {
  fail("e2e init extract recall", e);
}

// 6) evidence hallucination gate
try {
  const mod = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
  const ok = mod.evidenceQuotesValid([{ quote: "Port 3000" }], "Error: Port 3000 is already in use");
  const bad = mod.evidenceQuotesValid([{ quote: "fabricated" }], "Error: Port 3000 is already in use");
  if (!ok || bad) throw new Error("evidence gate broken");
  pass("evidence hallucination gate");
} catch (e) {
  fail("evidence hallucination gate", e);
}

console.log(failed ? `\n${failed} P0 checks failed` : "\nall P0 checks passed");
process.exit(failed ? 1 : 0);
