# Task 1 Diff Review Package

Base: 2146953
Head: 8a1e1a4

## Commits
8a1e1a4 feat(core): add DSH admin security config

## Stat
packages/core/src/config.test.ts |  11 +++
packages/core/src/config.ts      | 150 +++++++++++++++++++++++++++++++++++++--
packages/core/src/index.test.ts  |  20 +++++-
packages/core/src/paths.ts       |   3 +
4 files changed, 178 insertions(+), 6 deletions(-)

## Full Diff
diff --git a/packages/core/src/config.test.ts b/packages/core/src/config.test.ts
index beb242f..44d02de 100644
--- a/packages/core/src/config.test.ts
+++ b/packages/core/src/config.test.ts
@@ -10,12 +10,23 @@ import {
   extractEditableConfigPatch,
   loadConfig,
   mergeConfigOverlay,
+  parseSimpleToml,
   preservePrivacyTomlSection,
   resolveLlmApiKey,
   validateEditableConfigPatch,
   writeAmemConfigFile,
 } from "./config.js";
 
+describe("DSH admin config TOML", () => {
+  it("round-trips DSH admin security settings", () => {
+    const cfg = defaultConfig("u");
+    cfg.dsh.admin.allowed_origins = ["http://127.0.0.1:3000"];
+    cfg.dsh.admin.session_ttl_minutes = 480;
+    cfg.dsh.admin.auth_failure_limit = 8;
+    expect(parseSimpleToml(configToToml(cfg)).dsh.admin).toEqual(cfg.dsh.admin);
+  });
+});
+
 describe("escapeTomlString", () => {
   it("escapes quotes and backslashes", () => {
     expect(escapeTomlString('a"b\\c')).toBe('a\\"b\\\\c');
diff --git a/packages/core/src/config.ts b/packages/core/src/config.ts
index ef0cb4e..bb5dfe9 100644
--- a/packages/core/src/config.ts
+++ b/packages/core/src/config.ts
@@ -41,6 +41,14 @@ export interface AmemConfig {
     redact_patterns: string[];
     exclude_workspaces: string[];
   };
+  dsh: {
+    admin: {
+      allowed_origins: string[];
+      session_ttl_minutes: number;
+      auth_failure_limit: number;
+    };
+    auto_inject: boolean;
+  };
 }
 
 export function defaultConfig(userId = "local"): AmemConfig {
@@ -70,9 +78,125 @@ export function defaultConfig(userId = "local"): AmemConfig {
       },
     },
     privacy: { redact_patterns: [], exclude_workspaces: [] },
+    dsh: {
+      admin: {
+        allowed_origins: ["http://127.0.0.1", "http://localhost"],
+        session_ttl_minutes: 480,
+        auth_failure_limit: 8,
+      },
+      auto_inject: false,
+    },
   };
 }
 
+const DEFAULT_DSH_ADMIN = defaultConfig().dsh.admin;
+
+export function unescapeTomlString(s: string): string {
+  let out = "";
+  for (let i = 0; i < s.length; i++) {
+    const c = s[i]!;
+    if (c === "\\" && i + 1 < s.length) {
+      const n = s[i + 1]!;
+      if (n === "n") {
+        out += "\n";
+        i++;
+      } else if (n === "r") {
+        out += "\r";
+        i++;
+      } else if (n === "t") {
+        out += "\t";
+        i++;
+      } else if (n === '"' || n === "\\") {
+        out += n;
+        i++;
+      } else {
+        out += c;
+      }
+    } else {
+      out += c;
+    }
+  }
+  return out;
+}
+
+export function parseTomlStringArray(raw: string): string[] {
+  const t = raw.trim();
+  if (t === "[]") return [];
+  if (!t.startsWith("[") || !t.endsWith("]")) return [];
+  const inner = t.slice(1, -1).trim();
+  if (!inner) return [];
+  const out: string[] = [];
+  let i = 0;
+  while (i < inner.length) {
+    while (i < inner.length && (inner[i] === " " || inner[i] === ",")) i++;
+    if (i >= inner.length) break;
+    if (inner[i] !== '"') break;
+    i++;
+    let escaped = "";
+    while (i < inner.length) {
+      const c = inner[i]!;
+      if (c === "\\") {
+        escaped += c;
+        i++;
+        if (i < inner.length) {
+          escaped += inner[i]!;
+          i++;
+        }
+      } else if (c === '"') {
+        i++;
+        break;
+      } else {
+        escaped += c;
+        i++;
+      }
+    }
+    out.push(unescapeTomlString(escaped));
+  }
+  return out;
+}
+
+function formatTomlStringArray(arr: string[]): string {
+  if (arr.length === 0) return "[]";
+  return `[${arr.map((s) => `"${escapeTomlString(s)}"`).join(", ")}]`;
+}
+
+export function isValidAllowedOrigin(origin: string): boolean {
+  try {
+    const u = new URL(origin);
+    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
+    if (u.username || u.password) return false;
+    if (u.pathname !== "/" || u.search || u.hash) return false;
+    return origin === `${u.protocol}//${u.host}`;
+  } catch {
+    return false;
+  }
+}
+
+function clampInt(n: number, min: number, max: number, fallback: number): number {
+  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
+  if (n < min) return min;
+  if (n > max) return max;
+  return n;
+}
+
+function sanitizeDshConfig(dsh: AmemConfig["dsh"]): void {
+  dsh.admin.session_ttl_minutes = clampInt(
+    dsh.admin.session_ttl_minutes,
+    1,
+    1440,
+    DEFAULT_DSH_ADMIN.session_ttl_minutes,
+  );
+  dsh.admin.auth_failure_limit = clampInt(
+    dsh.admin.auth_failure_limit,
+    1,
+    100,
+    DEFAULT_DSH_ADMIN.auth_failure_limit,
+  );
+  const origins = dsh.admin.allowed_origins.filter(isValidAllowedOrigin);
+  dsh.admin.allowed_origins =
+    origins.length > 0 ? origins : [...DEFAULT_DSH_ADMIN.allowed_origins];
+}
+
 /** Minimal TOML subset reader for our known keys (no full TOML parser dependency). */
 export function parseSimpleToml(text: string): AmemConfig {
   const cfg = defaultConfig();
@@ -88,14 +212,18 @@ export function parseSimpleToml(text: string): AmemConfig {
     const kv = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
     if (!kv) continue;
     const key = kv[1]!;
-    let val: string | number | boolean = kv[2]!.trim();
-    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
-    else if (val === "true" || val === "false") val = val === "true";
-    else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
-    else if (val === "[]") val = "" as unknown as string;
+    const rawVal = kv[2]!.trim();
+    let val: string | number | boolean | string[] = rawVal;
+    if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
+      val = parseTomlStringArray(rawVal);
+    } else if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
+      val = unescapeTomlString(rawVal.slice(1, -1));
+    } else if (rawVal === "true" || rawVal === "false") val = rawVal === "true";
+    else if (/^-?\d+(\.\d+)?$/.test(rawVal)) val = Number(rawVal);
 
     assign(cfg, section, key, val);
   }
+  sanitizeDshConfig(cfg.dsh);
   return cfg;
 }
 
@@ -113,6 +241,10 @@ function assign(cfg: AmemConfig, section: string, key: string, val: unknown): vo
   else if (section === "privacy") {
     if (key === "redact_patterns" || key === "exclude_workspaces") return;
     set(cfg.privacy as unknown as Record<string, unknown>, key);
+  } else if (section === "dsh") {
+    set(cfg.dsh as unknown as Record<string, unknown>, key);
+  } else if (section === "dsh.admin") {
+    set(cfg.dsh.admin as unknown as Record<string, unknown>, key);
   }
 }
 
@@ -168,6 +300,14 @@ max_minutes = ${cfg.budget.consolidate.max_minutes}
 [privacy]
 redact_patterns = []
 exclude_workspaces = []
+
+[dsh]
+auto_inject = ${cfg.dsh.auto_inject}
+
+[dsh.admin]
+allowed_origins = ${formatTomlStringArray(cfg.dsh.admin.allowed_origins)}
+session_ttl_minutes = ${cfg.dsh.admin.session_ttl_minutes}
+auth_failure_limit = ${cfg.dsh.admin.auth_failure_limit}
 `;
 }
 
diff --git a/packages/core/src/index.test.ts b/packages/core/src/index.test.ts
index 3a58526..8174fa6 100644
--- a/packages/core/src/index.test.ts
+++ b/packages/core/src/index.test.ts
@@ -1,4 +1,7 @@
-import { describe, expect, it } from "vitest";
+import { mkdtempSync, rmSync } from "node:fs";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+import { afterEach, describe, expect, it } from "vitest";
 import {
   CanonicalEventSchema,
   ExtractCandidatesSchema,
@@ -8,11 +11,26 @@ import {
   evidenceQuotesValid,
   isSafeId,
   normalizeWorkspaceRoot,
+  paths,
   redactDeep,
   redactString,
   sanitizeId,
 } from "./index.js";
 
+describe("paths", () => {
+  let home: string;
+  afterEach(() => {
+    if (home) rmSync(home, { recursive: true, force: true });
+  });
+
+  it("includes DSH auth and audit paths", () => {
+    home = mkdtempSync(join(tmpdir(), "amem-paths-"));
+    expect(paths(home).auth).toBe(join(home, "auth"));
+    expect(paths(home).dshTokens).toBe(join(home, "auth", "dsh-tokens.json"));
+    expect(paths(home).dshRpcAudit).toBe(join(home, "logs", "dsh-rpc-audit.jsonl"));
+  });
+});
+
 describe("normalizeWorkspaceRoot", () => {
   it("converts Cursor /d:/ paths", () => {
     expect(normalizeWorkspaceRoot("/d:/dev/workspaces/QCoder/NoteZ")).toBe(
diff --git a/packages/core/src/paths.ts b/packages/core/src/paths.ts
index ef82991..f6824e7 100644
--- a/packages/core/src/paths.ts
+++ b/packages/core/src/paths.ts
@@ -16,6 +16,9 @@ export function paths(home = amemHome()) {
     manifests: join(home, "manifests"),
     queue: join(home, "queue"),
     logs: join(home, "logs"),
+    auth: join(home, "auth"),
+    dshTokens: join(home, "auth", "dsh-tokens.json"),
+    dshRpcAudit: join(home, "logs", "dsh-rpc-audit.jsonl"),
     index: join(home, "index.sqlite"),
     capabilities: join(home, "capabilities"),
   } as const;
