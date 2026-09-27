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

