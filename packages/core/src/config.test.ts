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
  llmApiKeySource,
  loadConfig,
  looksLikeSecretValue,
  mergeConfigOverlay,
  parseSimpleToml,
  preservePrivacyTomlSection,
  resolveLlmApiKey,
  updateTomlText,
  validateEditableConfigPatch,
  writeAmemConfigFile,
} from "./config.js";

describe("DSH admin config TOML", () => {
  it("defaults panel auth off and round-trips an explicit opt-in", () => {
    const cfg = defaultConfig("u");
    expect(cfg.dsh.admin.auth_enabled).toBe(false);
    cfg.dsh.admin.auth_enabled = true;
    expect(parseSimpleToml(configToToml(cfg)).dsh.admin.auth_enabled).toBe(true);
  });

  it("defaults refine_proposals off and round-trips when enabled", () => {
    const cfg = defaultConfig("u");
    expect(cfg.budget.consolidate.refine_proposals).toBe(false);
    cfg.budget.consolidate.refine_proposals = true;
    expect(parseSimpleToml(configToToml(cfg)).budget.consolidate.refine_proposals).toBe(true);
  });

  it("extracts refine_proposals via editable patch", () => {
    const patch = extractEditableConfigPatch({
      config: { budget: { consolidate: { refine_proposals: true } } },
    });
    expect("error" in patch).toBe(false);
    if ("error" in patch) return;
    expect(patch.budget?.consolidate?.refine_proposals).toBe(true);
    expect(validateEditableConfigPatch(patch).ok).toBe(true);
    const merged = mergeConfigOverlay(defaultConfig(), patch);
    expect(merged.budget.consolidate.refine_proposals).toBe(true);
  });

  it("round-trips DSH admin security settings", () => {
    const cfg = defaultConfig("u");
    cfg.dsh.admin.allowed_origins = ["http://127.0.0.1:3000"];
    cfg.dsh.admin.session_ttl_minutes = 480;
    cfg.dsh.admin.auth_failure_limit = 8;
    expect(parseSimpleToml(configToToml(cfg)).dsh.admin).toEqual(cfg.dsh.admin);
  });

  it("falls back when allowed_origins is a scalar", () => {
    const parsed = parseSimpleToml(`
[dsh.admin]
allowed_origins = "http://127.0.0.1:3000"
session_ttl_minutes = 30
auth_failure_limit = 3
`);
    expect(parsed.dsh.admin.allowed_origins).toEqual([
      "http://127.0.0.1",
      "http://localhost",
    ]);
    expect(parsed.dsh.admin.session_ttl_minutes).toBe(30);
    expect(parsed.dsh.admin.auth_failure_limit).toBe(3);
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

  it("rejects api_key_env that looks like a secret", () => {
    const r = validateEditableConfigPatch({
      llm: { api_key_env: "sk-abcdefghijklmnopqrstuvwxyz012345" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("environment variable name");
  });

  it("accepts conventional env var names, including long ones", () => {
    for (const name of ["AMEM_LLM_KEY", "OPENAI_API_KEY_FOR_TEAM_SHARED_ACCOUNT", ""]) {
      expect(validateEditableConfigPatch({ llm: { api_key_env: name } }).ok).toBe(true);
    }
  });

  it("flags mixed-case token shapes as secret-like", () => {
    expect(looksLikeSecretValue("AMEM_LLM_KEY")).toBe(false);
    expect(looksLikeSecretValue("sk-proj-abcdefghijklmnop")).toBe(true);
    expect(looksLikeSecretValue("AbCdEf0123456789AbCdEf0123456789AbCdEf01")).toBe(true);
    expect(looksLikeSecretValue("")).toBe(false);
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

describe("llmApiKeySource", () => {
  afterEach(() => {
    delete process.env.AMEM_LLM_KEY;
    delete process.env.AMEM_TEST_ABSENT_KEY;
  });

  it("reports inline when a key is written in amem.toml", () => {
    const cfg = defaultConfig();
    cfg.llm.api_key = "sk-inline";
    process.env.AMEM_LLM_KEY = "sk-env";
    expect(llmApiKeySource(cfg)).toBe("inline");
  });

  it("reports env when only the environment variable is set", () => {
    const cfg = defaultConfig();
    cfg.llm.api_key_env = "AMEM_TEST_ABSENT_KEY";
    expect(llmApiKeySource(cfg)).toBe("none");
    process.env.AMEM_TEST_ABSENT_KEY = "sk-from-env";
    expect(llmApiKeySource(cfg)).toBe("env");
  });

  it("reports none when neither source is available", () => {
    expect(llmApiKeySource(defaultConfig())).toBe("none");
  });
});

describe("updateTomlText", () => {
  it("keeps comments and unknown keys while updating managed values", () => {
    const disk = `# my own note about amem
[llm]
mode = "stub" # keep this comment
some_future_key = 1

[privacy]
redact_patterns = ["KEEP"]
exclude_workspaces = []
`;
    const cfg = defaultConfig();
    cfg.llm.mode = "external";
    const out = updateTomlText(disk, cfg);
    expect(out).toContain("# my own note about amem");
    expect(out).toContain('mode = "external" # keep this comment');
    expect(out).toContain("some_future_key = 1");
    expect(out).toContain('redact_patterns = ["KEEP"]');
  });

  it("fills missing keys into an existing section without duplicating its header", () => {
    const out = updateTomlText(`[llm]\nmodel = "stale"\n`, defaultConfig());
    expect(out.match(/^\[llm\]$/gm)).toHaveLength(1);
    // Managed keys always take the new config value; the section header stays single.
    expect(out).toContain('model = "openai/gpt-4.1-mini"');
    expect(out).not.toContain('"stale"');
    expect(out).toContain('base_url = "https://openrouter.ai/api/v1"');
    expect(out).toContain('api_key_env = "AMEM_LLM_KEY"');
    expect(out).toContain("[recall]");
  });

  it("generates a full document when the disk file is empty", () => {
    expect(updateTomlText("", defaultConfig())).toBe(configToToml(defaultConfig()));
  });

  it("preserves CRLF line endings", () => {
    const cfg = defaultConfig();
    cfg.llm.mode = "external";
    const out = updateTomlText(`[llm]\r\nmode = "stub"\r\n`, cfg);
    expect(out).toContain('mode = "external"');
    expect(out).toContain("[recall]");
    expect(out).not.toMatch(/[^\r]\n/);
  });
});

describe("parseSimpleToml comments", () => {
  it("ignores inline comments outside quotes but keeps # inside values", () => {
    const parsed = parseSimpleToml(
      `[llm]
model = "openai/gpt-4.1-mini" # my note
base_url = "http://gateway.local/#frag"
mode = "external" # trailing
[recall]
budget_tokens = 900 # tokens
`,
    );
    expect(parsed.llm.model).toBe("openai/gpt-4.1-mini");
    expect(parsed.llm.base_url).toBe("http://gateway.local/#frag");
    expect(parsed.llm.mode).toBe("external");
    expect(parsed.recall.budget_tokens).toBe(900);
  });

  it("reads a section header that carries a trailing comment", () => {
    const parsed = parseSimpleToml(`[llm] # connectivity\nmode = "host"\n`);
    expect(parsed.llm.mode).toBe("host");
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

  it("preserves hand-written comments and unknown keys after save", () => {
    home = mkdtempSync(join(tmpdir(), "amem-cfg-"));
    mkdirSync(home, { recursive: true });
    const initial = configToToml(defaultConfig())
      .replace("# amem config", "# amem config\n# 本机说明：base_url 指向公司网关")
      .replace(
        'base_url = "https://openrouter.ai/api/v1"',
        'base_url = "https://openrouter.ai/api/v1" # 备注\ncustom_note_key = "keep"',
      );
    writeFileSync(join(home, "amem.toml"), initial);
    const cfg = loadConfig(home);
    cfg.budget.consolidate.refine_proposals = true;
    cfg.llm.model = "openai/gpt-4.1";
    writeAmemConfigFile(home, cfg);
    const text = readFileSync(join(home, "amem.toml"), "utf8");
    expect(text).toContain("# 本机说明：base_url 指向公司网关");
    expect(text).toContain("# 备注");
    expect(text).toContain('custom_note_key = "keep"');
    expect(text).toContain('model = "openai/gpt-4.1"');
    expect(text).toContain("refine_proposals = true");
  });
});

describe("config-document deep save", () => {
  let home: string;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("applyEditableConfigPatch preserves privacy, comments, and empty key", async () => {
    const { applyEditableConfigPatch, getSafeConfigView } = await import("./config-document.js");
    home = mkdtempSync(join(tmpdir(), "amem-cfg-doc-"));
    mkdirSync(home, { recursive: true });
    const disk = `# keep header
${configToToml(defaultConfig())}`.replace(
      /\[privacy\]\r?\nredact_patterns = \[\]\r?\nexclude_workspaces = \[\]\r?\n/,
      `[privacy]
redact_patterns = ["SECRET"]
exclude_workspaces = ["/tmp"]
`,
    );
    writeFileSync(join(home, "amem.toml"), disk);
    expect(disk).toContain('redact_patterns = ["SECRET"]');

    const cfg = loadConfig(home);
    cfg.llm.api_key = "keep-me";
    writeAmemConfigFile(home, cfg);

    const view = getSafeConfigView(home);
    expect(view.data.config.llm).not.toHaveProperty("api_key");
    expect(view.data.config.llm.has_api_key).toBe(true);

    const saved = applyEditableConfigPatch(home, {
      config: {
        llm: { mode: "external", model: "m1", base_url: view.data.config.llm.base_url },
      },
    });
    expect(saved.ok).toBe(true);
    const after = loadConfig(home);
    expect(after.llm.mode).toBe("external");
    expect(after.llm.api_key).toBe("keep-me");
    const text = readFileSync(join(home, "amem.toml"), "utf8");
    expect(text).toContain("# keep header");
    expect(text).toContain('redact_patterns = ["SECRET"]');
  });

  it("applyEditableConfigPatch rejects invalid mode", async () => {
    const { applyEditableConfigPatch } = await import("./config-document.js");
    home = mkdtempSync(join(tmpdir(), "amem-cfg-doc-bad-"));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig()));
    const r = applyEditableConfigPatch(home, {
      config: { ...loadConfig(home), llm: { ...loadConfig(home).llm, mode: "nope" } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toBe("internal");
  });
});

describe("config_version contract", () => {
  it("defaults missing version to CONFIG_VERSION and writes [meta]", () => {
    const cfg = parseSimpleToml(`[identity]\nuser_id = "u"\n`);
    expect(cfg.config_version).toBe(1);
    expect(configToToml(defaultConfig())).toContain("[meta]");
    expect(configToToml(defaultConfig())).toContain("config_version = 1");
  });

  it("rejects config_version newer than supported", () => {
    expect(() =>
      parseSimpleToml(`[meta]\nconfig_version = 99\n\n[identity]\nuser_id = "u"\n`),
    ).toThrow(/newer than supported/);
  });

  it("updateTomlText inserts [meta] config_version when missing", () => {
    const disk = `[identity]\nuser_id = "u"\n`;
    const next = updateTomlText(disk, defaultConfig("u"));
    expect(next).toMatch(/\[meta\][\s\S]*config_version = 1/);
    expect(next).toContain('user_id = "u"');
  });
});
