# DSH Panel Config Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH amem 面板增加「配置」Tab，通过 `GET/PUT /amem-api/config` 以表单编辑常用 `amem.toml` 字段，写盘采用磁盘基线 overlay，且不抹掉未在表单中编辑的 embedding / privacy。

**Architecture:** `@amem/core` 提供 TOML 字符串转义、可编辑 patch 校验与 privacy 段保留写盘；`adapter-dsh` 的 `createAdmin` 暴露 `getConfig`/`putConfig` 并挂路由；`amem-dsh-ui` 增加非 list 的配置表单 Tab（完整 config state round-trip）。

**Tech Stack:** TypeScript、Vitest、React `createElement`（amem-dsh-ui）、现有 `/amem-api` + `checkAuth`。

**Spec:** `docs/superpowers/specs/2026-09-27-dsh-panel-config-design.md`（O3/O4 **跳过**；O5 本轮不做）

## Global Constraints

- 写盘基线必须是 `loadConfig(home)`（磁盘），**禁止**用 `defaultConfig()` 作合并基线。
- PUT **忽略** body 中的 `embedding` / `privacy`；始终保留磁盘 base 的这两段。
- privacy 写盘：从原 `amem.toml` **原样保留 `[privacy]` 段**拼回（因 `parseSimpleToml` 不读数组）。
- 校验规则：整数 `Number.isFinite && Number.isInteger && >= 0`；`global_min_lift` 有限且 `>= 0`；**无数值上界**（O3 跳过）；`external` 不强制 URL（O4 跳过）。
- `api_key_env`：只存环境变量名；启发式拒绝像密钥的值（`sk-` 前缀或过长 token 形）。
- 鉴权沿用现有 `checkAuth`；成功响应解包为 `data`。
- `config` **不是** list tab：`isListTab` 不变，切 Tab 不请求 `/proposals`。
- Tab 顺序：`记忆 | 能力 | 提案 | 运维 | 配置 | 说明`。
- locale：新文案 `zh`/`en` 成对；更新 `help.tabsBody`。
- 用户未要求时不要自动 `git commit`；计划中的 Commit 步骤仅在用户明确要求提交时执行。

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/config.ts` | `escapeTomlString`；`configToToml` 用转义；`validateEditableConfigPatch`；`extractEditableConfigPatch`；`mergeConfigOverlay`；`preservePrivacyTomlSection`；`writeConfigAtomic`（或等价拆分） |
| `packages/core/src/config.test.ts` | core 配置校验 / TOML 转义 / privacy 保留 / overlay 单测（新建） |
| `packages/adapter-dsh/src/admin.ts` | `getConfig` / `putConfig` |
| `packages/adapter-dsh/src/admin-config.test.ts` | admin 配置方法单测（新建） |
| `packages/adapter-dsh/src/plugin.ts` | `GET/PUT /amem-api/config` |
| `packages/amem-dsh-ui/client/locales.ts` | `tab.config` + config.* + 更新 `help.tabsBody` |
| `packages/amem-dsh-ui/client/panel.tsx` | 配置 Tab UI + state |
| `README.md` | 六 Tab + 配置一句 |

---

### Task 1: Core — escapeTomlString + configToToml + validate/merge/privacy

**Files:**
- Create: `packages/core/src/config.test.ts`
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/src/config.test.ts`

**Interfaces:**
- Produces (all exported from `@amem/core` via existing `export * from "./config.js"`):
  - `escapeTomlString(s: string): string` — escapes `\`, `"`, `\n`, `\r` for double-quoted TOML
  - `configToToml(cfg: AmemConfig): string` — uses `escapeTomlString` on all string fields; privacy arrays still emitted as `[]` in the template portion (privacy real content handled by preserve helper)
  - `EditableConfigPatch` type — only §3.2 fields nested like AmemConfig subsets
  - `extractEditableConfigPatch(input: unknown): EditableConfigPatch | { error: string; message: string }` — pulls editable fields; missing keys omitted (not defaulted)
  - `validateEditableConfigPatch(patch: EditableConfigPatch): { ok: true } | { ok: false; error: string; message: string }`
  - `mergeConfigOverlay(base: AmemConfig, patch: EditableConfigPatch): AmemConfig` — deep-merge only present patch keys; never touch embedding/privacy from patch
  - `preservePrivacyTomlSection(diskToml: string, generatedToml: string): string` — if disk has `[privacy]`… until next `[` or EOF, replace generated `[privacy]`… with disk slice; else leave generated
  - `writeAmemConfigFile(home: string, cfg: AmemConfig, diskTomlForPrivacy?: string): void` — `configToToml` → preserve privacy → write tmp + rename to `paths(home).config`

- [ ] **Step 1: Write failing tests**

```ts
// packages/core/src/config.test.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configToToml,
  defaultConfig,
  escapeTomlString,
  extractEditableConfigPatch,
  loadConfig,
  mergeConfigOverlay,
  preservePrivacyTomlSection,
  validateEditableConfigPatch,
  writeAmemConfigFile,
} from "./config.js";

describe("escapeTomlString", () => {
  it("escapes quotes and backslashes", () => {
    expect(escapeTomlString('a"b\\c')).toBe('a\\"b\\\\c');
  });
});

describe("configToToml escape", () => {
  it("escapes user_id in output", () => {
    const cfg = defaultConfig();
    cfg.identity.user_id = 'x"y';
    expect(configToToml(cfg)).toContain('user_id = "x\\"y"');
  });
});

describe("validate + merge overlay", () => {
  it("rejects bad mode", () => {
    const r = validateEditableConfigPatch({
      llm: { mode: "nope" as "stub" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty user_id", () => {
    const r = validateEditableConfigPatch({ identity: { user_id: "  " } });
    expect(r.ok).toBe(false);
  });

  it("rejects api_key_env that looks like a secret", () => {
    const r = validateEditableConfigPatch({
      llm: { api_key_env: "sk-abcdefghijklmnopqrstuvwxyz012345" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects string injection chars", () => {
    const r = validateEditableConfigPatch({
      identity: { user_id: 'evil"inject' },
    });
    expect(r.ok).toBe(false);
  });

  it("merge keeps embedding from base", () => {
    const base = defaultConfig();
    base.embedding.enabled = true;
    base.embedding.model = "keep-me";
    const out = mergeConfigOverlay(base, {
      llm: { mode: "host", base_url: "", model: "", api_key_env: "AMEM_LLM_KEY" },
    });
    expect(out.embedding.model).toBe("keep-me");
    expect(out.llm.mode).toBe("host");
  });

  it("extract ignores embedding/privacy in body", () => {
    const patch = extractEditableConfigPatch({
      identity: { user_id: "u1" },
      llm: { mode: "stub", base_url: "", model: "m", api_key_env: "AMEM_LLM_KEY" },
      recall: { budget_tokens: 1, l0_items: 2, l1_items: 3 },
      promotion: {
        instance_to_domain_min_instances: 1,
        domain_to_global_min_domains: 1,
        domain_to_global_min_instances: 1,
        global_min_lift: 0.2,
      },
      budget: {
        consolidate: {
          max_llm_calls: 1,
          max_tokens: 2,
          max_proposals: 3,
          max_minutes: 4,
        },
      },
      embedding: { enabled: true, base_url: "x", model: "y", dim: 9 },
      privacy: { redact_patterns: ["SECRET"], exclude_workspaces: ["/tmp"] },
    });
    expect("error" in patch).toBe(false);
    if ("error" in patch) return;
    expect((patch as { embedding?: unknown }).embedding).toBeUndefined();
    expect((patch as { privacy?: unknown }).privacy).toBeUndefined();
  });
});

describe("preservePrivacyTomlSection", () => {
  it("keeps disk privacy block", () => {
    const disk = `# amem
[identity]
user_id = "a"

[privacy]
redact_patterns = ["foo"]
exclude_workspaces = ["/bar"]
`;
    const generated = configToToml(defaultConfig());
    const out = preservePrivacyTomlSection(disk, generated);
    expect(out).toContain('redact_patterns = ["foo"]');
    expect(out).toContain('exclude_workspaces = ["/bar"]');
  });
});

describe("writeAmemConfigFile round-trip privacy", () => {
  let home: string;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("preserves privacy text after save", () => {
    home = mkdtempSync(join(tmpdir(), "amem-cfg-"));
    mkdirSync(home, { recursive: true });
    const initial = configToToml(defaultConfig()).replace(
      `[privacy]
redact_patterns = []
exclude_workspaces = []
`,
      `[privacy]
redact_patterns = ["TOKEN"]
exclude_workspaces = ["/ws"]
`,
    );
    writeFileSync(join(home, "amem.toml"), initial);
    const cfg = loadConfig(home);
    cfg.llm.mode = "host";
    writeAmemConfigFile(home, cfg, initial);
    const text = readFileSync(join(home, "amem.toml"), "utf8");
    expect(text).toContain('redact_patterns = ["TOKEN"]');
    expect(text).toContain('mode = "host"');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd packages/core && pnpm test -- src/config.test.ts`  
Expected: FAIL（`escapeTomlString` / `validateEditableConfigPatch` 等未定义）

- [ ] **Step 3: Implement in `packages/core/src/config.ts`**

在文件末尾（或 `configToToml` 附近）加入：

```ts
import { writeFileSync, renameSync, readFileSync, existsSync } from "node:fs";
// note: readFileSync/existsSync already imported; add writeFileSync, renameSync

export function escapeTomlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

// Update configToToml to wrap every string interpolation with escapeTomlString(...)
// e.g. user_id = "${escapeTomlString(cfg.identity.user_id)}"

const DANGEROUS_CHARS = /["\\\n\r]/;

export type EditableConfigPatch = {
  identity?: { user_id?: string };
  llm?: {
    mode?: AmemConfig["llm"]["mode"];
    base_url?: string;
    model?: string;
    api_key_env?: string;
  };
  recall?: Partial<AmemConfig["recall"]>;
  promotion?: Partial<AmemConfig["promotion"]>;
  budget?: { consolidate?: Partial<AmemConfig["budget"]["consolidate"]> };
};

function looksLikeSecret(name: string): boolean {
  const t = name.trim();
  if (/^sk-[A-Za-z0-9_-]{16,}$/.test(t)) return true;
  if (t.length >= 40 && /^[A-Za-z0-9+/=_-]+$/.test(t)) return true;
  return false;
}

function rejectDangerous(label: string, s: string, allowEmpty: boolean): string | null {
  const t = s.trim();
  if (!allowEmpty && !t) return `${label} required`;
  if (DANGEROUS_CHARS.test(t)) return `${label} contains illegal characters`;
  return null;
}

export function extractEditableConfigPatch(
  input: unknown,
): EditableConfigPatch | { error: string; message: string } {
  if (input == null || typeof input !== "object") {
    return { error: "bad_request", message: "config object required" };
  }
  const root = input as Record<string, unknown>;
  const src = (root.config != null && typeof root.config === "object"
    ? root.config
    : input) as Record<string, unknown>;
  const patch: EditableConfigPatch = {};
  // Only copy known editable keys if present; never copy embedding/privacy
  // identity, llm, recall, promotion, budget.consolidate — mirror AmemConfig shapes
  // Return patch (may be partial)
  return patch;
}

export function validateEditableConfigPatch(
  patch: EditableConfigPatch,
): { ok: true } | { ok: false; error: string; message: string } {
  // Apply rules from spec §4.2 for every present field
  // llm.mode ∈ stub|external|host
  // integers: Number.isFinite && Number.isInteger && >= 0
  // global_min_lift: Number.isFinite && >= 0
  // api_key_env: non-empty + not looksLikeSecret
  return { ok: true };
}

export function mergeConfigOverlay(base: AmemConfig, patch: EditableConfigPatch): AmemConfig {
  const out: AmemConfig = structuredClone(base);
  if (patch.identity?.user_id != null) out.identity.user_id = patch.identity.user_id.trim();
  if (patch.llm) {
    if (patch.llm.mode != null) out.llm.mode = patch.llm.mode;
    if (patch.llm.base_url != null) out.llm.base_url = patch.llm.base_url.trim();
    if (patch.llm.model != null) out.llm.model = patch.llm.model.trim();
    if (patch.llm.api_key_env != null) out.llm.api_key_env = patch.llm.api_key_env.trim();
  }
  if (patch.recall) Object.assign(out.recall, patch.recall);
  if (patch.promotion) Object.assign(out.promotion, patch.promotion);
  if (patch.budget?.consolidate) Object.assign(out.budget.consolidate, patch.budget.consolidate);
  // never assign embedding or privacy from patch
  return out;
}

export function preservePrivacyTomlSection(diskToml: string, generatedToml: string): string {
  const diskMatch = diskToml.match(/^\[privacy\]\s*\n(?:.*\n)*?(?=^\[|\Z)/m);
  if (!diskMatch) return generatedToml;
  return generatedToml.replace(/^\[privacy\]\s*\n(?:.*\n)*?(?=^\[|\Z)/m, diskMatch[0]!);
}

export function writeAmemConfigFile(
  home: string,
  cfg: AmemConfig,
  diskTomlForPrivacy?: string,
): void {
  const configPath = paths(home).config;
  const disk =
    diskTomlForPrivacy ??
    (existsSync(configPath) ? readFileSync(configPath, "utf8") : "");
  let text = configToToml(cfg);
  text = preservePrivacyTomlSection(disk, text);
  const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, configPath);
}
```

实现时把 `extractEditableConfigPatch` / `validateEditableConfigPatch` 写完整（无 TODO）；`configToToml` 全部字符串字段走 `escapeTomlString`。

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd packages/core && pnpm test -- src/config.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求时）

```bash
git add packages/core/src/config.ts packages/core/src/config.test.ts
git commit -m "feat(core): safe TOML config overlay and privacy preserve"
```

---

### Task 2: Admin getConfig / putConfig + tests

**Files:**
- Create: `packages/adapter-dsh/src/admin-config.test.ts`
- Modify: `packages/adapter-dsh/src/admin.ts`
- Test: `packages/adapter-dsh/src/admin-config.test.ts`

**Interfaces:**
- Consumes: `loadConfig`, `paths`, `extractEditableConfigPatch`, `validateEditableConfigPatch`, `mergeConfigOverlay`, `writeAmemConfigFile`, `readFileSync`/`existsSync` from fs + `@amem/core`
- Produces on `createAdmin(home)`:
  - `getConfig(): AdminResult` → `{ path, config }`
  - `putConfig(body: unknown): AdminResult` → `{ path, saved: true }` or 400/500

- [ ] **Step 1: Write failing tests**

```ts
// packages/adapter-dsh/src/admin-config.test.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const h = setup((t) =>
      t.replace("enabled = false", "enabled = true").replace('model = ""', 'model = "emb-keep"', 1),
    );
    // ensure embedding.model line under [embedding] is set — adjust replace carefully in real test:
    // better: parse, mutate file via defaultConfig + write
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
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd packages/adapter-dsh && pnpm test -- src/admin-config.test.ts`  
Expected: FAIL（`getConfig` / `putConfig` 不存在）

- [ ] **Step 3: Implement admin methods**

在 `packages/adapter-dsh/src/admin.ts` 的 `createAdmin` 返回对象中增加（并补 import）：

```ts
import { readFileSync, existsSync } from "node:fs";
import {
  // existing...
  extractEditableConfigPatch,
  validateEditableConfigPatch,
  mergeConfigOverlay,
  writeAmemConfigFile,
} from "@amem/core";

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
    // Force privacy + embedding from base (defense in depth)
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
```

非法 JSON 由路由层 `JSON.parse` 的 try/catch 变 500 或在路由里单独 catch 成 400——见 Task 3。

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd packages/adapter-dsh && pnpm test -- src/admin-config.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**（仅当用户要求时）

```bash
git add packages/adapter-dsh/src/admin.ts packages/adapter-dsh/src/admin-config.test.ts
git commit -m "feat(adapter-dsh): getConfig/putConfig with disk overlay"
```

---

### Task 3: Routes GET/PUT `/amem-api/config`

**Files:**
- Modify: `packages/adapter-dsh/src/plugin.ts`（在 `/compile` 路由之后、`404` 之前）

**Interfaces:**
- Consumes: `admin.getConfig()`, `admin.putConfig(body)`
- Produces: HTTP handlers same style as `/doctor`

- [ ] **Step 1: Add routes**

```ts
if (method === "GET" && path === "/config") {
  const r = admin.getConfig();
  sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
  return;
}

if (method === "PUT" && path === "/config") {
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req)) || "{}");
  } catch {
    sendJson(res, 400, { error: "bad_request", message: "invalid JSON" });
    return;
  }
  const r = admin.putConfig(body);
  sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
  return;
}
```

- [ ] **Step 2: Typecheck / build adapter**

Run: `cd packages/adapter-dsh && pnpm build`  
Expected: exit 0

- [ ] **Step 3: Commit**（仅当用户要求时）

```bash
git add packages/adapter-dsh/src/plugin.ts
git commit -m "feat(adapter-dsh): expose GET/PUT /amem-api/config"
```

---

### Task 4: Locales + panel Config Tab + README

**Files:**
- Modify: `packages/amem-dsh-ui/client/locales.ts`
- Modify: `packages/amem-dsh-ui/client/panel.tsx`
- Modify: `README.md`（DSH Web 五 Tab → 六 Tab）
- Test: 手动 / `pnpm --filter @amem/amem-dsh-ui build`（或仓库现有 client build 脚本）

**Interfaces:**
- Consumes: `GET /amem-api/config` → `{ path, config }`；`PUT /amem-api/config` body `{ config }`
- Produces: Tab `"config"`；`isListTab` **不含** config

- [ ] **Step 1: Update locales**

在 `zh` 增加（并对 `en` 成对补齐）：

```ts
"tab.config": "配置",
"config.reload": "重新加载",
"config.save": "保存",
"config.confirmSave": "确认写入 amem.toml？未在表单中展示的段（embedding/privacy）将保留磁盘原值。",
"config.saved": "已保存：{path}",
"config.section.identity": "身份",
"config.section.llm": "LLM",
"config.section.recall": "召回",
"config.section.promotion": "晋升",
"config.section.budget": "整合预算",
"config.field.user_id": "user_id",
"config.field.mode": "mode",
"config.field.base_url": "base_url",
"config.field.model": "model",
"config.field.api_key_env": "api_key_env",
"config.field.budget_tokens": "budget_tokens",
"config.field.l0_items": "l0_items",
"config.field.l1_items": "l1_items",
"config.field.instance_to_domain_min_instances": "instance_to_domain_min_instances",
"config.field.domain_to_global_min_domains": "domain_to_global_min_domains",
"config.field.domain_to_global_min_instances": "domain_to_global_min_instances",
"config.field.global_min_lift": "global_min_lift",
"config.field.max_llm_calls": "max_llm_calls",
"config.field.max_tokens": "max_tokens",
"config.field.max_proposals": "max_proposals",
"config.field.max_minutes": "max_minutes",
"config.hintSecrets": "密钥只通过环境变量注入；此处只填变量名（api_key_env），不要粘贴真实 Key。",
"config.hintReload": "保存后新请求会重新读盘；若长期 worker 已缓存配置，可能需重启 dsh web。",
"config.hintPrivacy": "privacy / embedding 请用手改 amem.toml；面板保存不会覆盖磁盘上的这些段。",
```

更新 `help.tabsBody` zh：

```text
记忆：浏览/召回/遗忘。能力：已入库 Skill 列表。提案：候选与应用。运维：doctor/flush/索引/整合/编译。配置：常用 amem.toml。说明：本页。
```

en `help.tabsBody`：

```text
Memories: browse/recall/forget. Skills: library list. Proposals: candidates and apply. Ops: doctor/flush/index/consolidate/compile. Config: common amem.toml. Guide: this page.
```

en `tab.config`: `"Config"`；其余 `config.*` 用对应英文短句。

- [ ] **Step 2: Panel — types and state**

```ts
type Tab = "memories" | "skills" | "proposals" | "ops" | "config" | "help";
// isListTab 不变（不含 config）

type AmemConfigState = {
  identity: { user_id: string };
  llm: { base_url: string; model: string; api_key_env: string; mode: string };
  embedding: { enabled: boolean; base_url: string; model: string; dim: number };
  recall: { budget_tokens: number; l0_items: number; l1_items: number };
  promotion: {
    instance_to_domain_min_instances: number;
    domain_to_global_min_domains: number;
    domain_to_global_min_instances: number;
    global_min_lift: number;
  };
  budget: {
    consolidate: {
      max_llm_calls: number;
      max_tokens: number;
      max_proposals: number;
      max_minutes: number;
    };
  };
  privacy: { redact_patterns: string[]; exclude_workspaces: string[] };
};

const [configBusy, setConfigBusy] = useState(false);
const [configPath, setConfigPath] = useState<string | null>(null);
const [config, setConfig] = useState<AmemConfigState | null>(null);
const [configMsg, setConfigMsg] = useState<string | null>(null);
```

Tab 按钮顺序插入 `config`（在 ops 与 help 之间）。

- [ ] **Step 3: loadConfig / saveConfig**

```ts
const loadConfigTab = async () => {
  setConfigBusy(true);
  setError(null);
  setConfigMsg(null);
  try {
    const data = (await api("/config")) as { path?: string; config?: AmemConfigState };
    setConfigPath(data.path ?? null);
    setConfig(data.config ?? null);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setConfigBusy(false);
  }
};

useEffect(() => {
  if (tab !== "config") return;
  void loadConfigTab();
}, [tab]);

const saveConfig = async () => {
  if (!config) return;
  if (!confirm(format(t, "config.confirmSave"))) return;
  setConfigBusy(true);
  setError(null);
  setConfigMsg(null);
  try {
    const data = (await api("/config", {
      method: "PUT",
      body: JSON.stringify({ config }),
    })) as { path?: string; saved?: boolean };
    setConfigMsg(format(t, "config.saved", { path: data.path ?? configPath ?? "" }));
    await loadConfigTab();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setConfigBusy(false);
  }
};
```

注意：`useEffect` 依赖勿引入 eslint 死循环；`loadConfigTab` 可用 inline 或 `useCallback` 空依赖 + 仅 `[tab]`。

- [ ] **Step 4: Config form UI**

当 `tab === "config"` 时渲染：

- 提示三段：`config.hintSecrets` / `config.hintPrivacy` / `config.hintReload`
- 分区标题 + 字段（text / select / number），通过 `setConfig` 不可变更新嵌套字段
- `mode` select：`stub` | `external` | `host`
- 按钮：重新加载、保存；`disabled={configBusy}`
- 成功信息：`configMsg`；路径只读展示 `configPath`

参考运维 Tab 的简洁 `createElement` 风格，**不要**引入新 UI 库。

- [ ] **Step 5: README**

将：

```text
记忆 / 能力 / 提案 / 运维 / 说明
```

改为：

```text
记忆 / 能力 / 提案 / 运维 / 配置 / 说明
```

并加一句：配置 Tab 可编辑常用 `amem.toml`（不含真实 API Key；privacy/embedding 保留磁盘值）。

- [ ] **Step 6: Build UI client**

Run: 仓库内现有 amem-dsh-ui 构建命令（例如 `pnpm --filter @amem/amem-dsh-ui build` 或 `node packages/amem-dsh-ui/scripts/build-client.mjs`）  
Expected: exit 0

- [ ] **Step 7: Manual smoke**

1. `dsh web` 打开面板 → 切「配置」→ 网络无 `/proposals`
2. 改 `mode` 保存 → 磁盘 `amem.toml` 更新
3. 手改 `[privacy]` 非空 → 再面板保存 → privacy 仍非空
4. 说明页文案含「配置」

- [ ] **Step 8: Commit**（仅当用户要求时）

```bash
git add packages/amem-dsh-ui/client/locales.ts packages/amem-dsh-ui/client/panel.tsx README.md
git commit -m "feat(amem-dsh-ui): config tab for amem.toml form edit"
```

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| GET/PUT `/amem-api/config` | 2–3 |
| 磁盘 overlay；忽略 body embedding/privacy | 1–2 |
| escapeTomlString + configToToml | 1 |
| privacy 段保留 + 验收测试 | 1–2 |
| 校验 §4.2（无上界、无 external URL 强制） | 1 |
| 原子写盘 tmp+rename | 1 |
| Tab 顺序 + 非 list | 4 |
| locales + help.tabsBody | 4 |
| README 六 Tab | 4 |
| 非法 JSON → 400 | 3 |
| O3/O4 跳过 | Global Constraints |
| O5 不做 | Global Constraints |

## Placeholder / consistency self-check

- 无 TBD；函数名统一：`extractEditableConfigPatch` / `validateEditableConfigPatch` / `mergeConfigOverlay` / `preservePrivacyTomlSection` / `writeAmemConfigFile` / `getConfig` / `putConfig`。
- PUT body：`{ config }` 优先，兼容顶层 AmemConfig（`extractEditableConfigPatch`）。
