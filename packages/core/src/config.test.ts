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
  parseSimpleToml,
  preservePrivacyTomlSection,
  resolveLlmApiKey,
  validateEditableConfigPatch,
  writeAmemConfigFile,
} from "./config.js";

describe("DSH admin config TOML", () => {
  it("round-trips DSH admin security settings", () => {
    const cfg = defaultConfig("u");
    cfg.dsh.admin.allowed_origins = ["http://127.0.0.1:3000"];
    cfg.dsh.admin.session_ttl_minutes = 480;
    cfg.dsh.admin.auth_failure_limit = 8;
    expect(parseSimpleToml(configToToml(cfg)).dsh.admin).toEqual(cfg.dsh.admin);
  });
});

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

  it("accepts api_key that looks like a secret", () => {
    const r = validateEditableConfigPatch({
      llm: { api_key: "sk-abcdefghijklmnopqrstuvwxyz012345" },
    });
    expect(r.ok).toBe(true);
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
      llm: { mode: "host", base_url: "", model: "", api_key: "sk-test", api_key_env: "AMEM_LLM_KEY" },
    });
    expect(out.embedding.model).toBe("keep-me");
    expect(out.llm.mode).toBe("host");
    expect(out.llm.api_key).toBe("sk-test");
  });

  it("extract ignores embedding/privacy in body", () => {
    const patch = extractEditableConfigPatch({
      identity: { user_id: "u1" },
      llm: { mode: "stub", base_url: "", model: "m", api_key: "sk-x", api_key_env: "AMEM_LLM_KEY" },
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
    expect(patch.llm?.api_key).toBe("sk-x");
  });
});

describe("resolveLlmApiKey", () => {
  it("prefers inline api_key over env", () => {
    const cfg = defaultConfig();
    cfg.llm.api_key = "sk-inline";
    process.env.AMEM_LLM_KEY = "sk-env";
    expect(resolveLlmApiKey(cfg)).toBe("sk-inline");
    delete process.env.AMEM_LLM_KEY;
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

  it("keeps disk privacy block when last line has no trailing newline", () => {
    const disk = `# amem
[identity]
user_id = "a"

[privacy]
redact_patterns = ["foo"]
exclude_workspaces = ["/bar"]`;
    const generated = configToToml(defaultConfig());
    const out = preservePrivacyTomlSection(disk, generated);
    expect(out).toContain('redact_patterns = ["foo"]');
    expect(out).toContain('exclude_workspaces = ["/bar"]');
    expect(out).not.toMatch(/redact_patterns = \[\]\s*\n/);
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

  it("preserves privacy when disk block ends without trailing newline", () => {
    home = mkdtempSync(join(tmpdir(), "amem-cfg-"));
    mkdirSync(home, { recursive: true });
    const initial =
      configToToml(defaultConfig()).replace(
        `[privacy]
redact_patterns = []
exclude_workspaces = []
`,
        `[privacy]
redact_patterns = ["TOKEN"]
exclude_workspaces = ["/ws"]
`,
      ).replace(/\n$/, "");
    writeFileSync(join(home, "amem.toml"), initial);
    const cfg = loadConfig(home);
    cfg.llm.mode = "host";
    writeAmemConfigFile(home, cfg, initial);
    const text = readFileSync(join(home, "amem.toml"), "utf8");
    expect(text).toContain('redact_patterns = ["TOKEN"]');
    expect(text).toContain('exclude_workspaces = ["/ws"]');
    expect(text).toContain('mode = "host"');
  });
});
