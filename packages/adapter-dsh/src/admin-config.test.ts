import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configToToml, defaultConfig, loadConfig } from "@amem/core";
import { afterEach, describe, expect, it } from "vitest";
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
    const h = setup();
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

  it("reports api_key_source without exposing the key", () => {
    const h = setup();
    const cfg = loadConfig(h);
    cfg.llm.api_key_env = "AMEM_TEST_UNSET_KEY";
    writeFileSync(join(h, "amem.toml"), configToToml(cfg));
    // biome-ignore lint/performance/noDelete: must unset env key (assigning undefined stringifies)
    delete process.env.AMEM_TEST_UNSET_KEY;

    const first = createAdmin(h).getConfig();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const none = first.data as {
      config: { llm: { api_key?: string; has_api_key: boolean; api_key_source: string } };
    };
    expect(none.config.llm.api_key).toBeUndefined();
    expect(none.config.llm.has_api_key).toBe(false);
    expect(none.config.llm.api_key_source).toBe("none");

    cfg.llm.api_key = "sk-inline-secret";
    writeFileSync(join(h, "amem.toml"), configToToml(cfg));
    const second = createAdmin(h).getConfig();
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const inline = second.data as {
      config: { llm: { api_key?: string; has_api_key: boolean; api_key_source: string } };
    };
    expect(inline.config.llm.api_key).toBeUndefined();
    expect(inline.config.llm.has_api_key).toBe(true);
    expect(inline.config.llm.api_key_source).toBe("inline");
  });

  it("putConfig keeps hand-written comments in amem.toml", () => {
    const h = setup((t) =>
      t
        .replace("# amem config", "# amem config\n# keep me")
        .replace('model = "openai/gpt-4.1-mini"', 'model = "openai/gpt-4.1-mini" # note'),
    );
    const cfg = loadConfig(h);
    const r = createAdmin(h).putConfig({
      config: { ...cfg, llm: { ...cfg.llm, mode: "external" } },
    });
    expect(r.ok).toBe(true);
    const text = readFileSync(join(h, "amem.toml"), "utf8");
    expect(text).toContain("# keep me");
    expect(text).toContain("# note");
    expect(text).toContain('mode = "external"');
  });
});
