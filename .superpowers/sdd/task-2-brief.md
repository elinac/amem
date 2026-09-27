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

