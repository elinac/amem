import { readFileSync, existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { amemHome, paths } from "./paths.js";

export interface AmemConfig {
  identity: { user_id: string };
  llm: {
    base_url: string;
    model: string;
    /** Inline API key written in amem.toml (preferred when non-empty). */
    api_key: string;
    /** Fallback: read key from this environment variable name. */
    api_key_env: string;
    mode: "external" | "host" | "stub";
  };
  embedding: {
    enabled: boolean;
    base_url: string;
    model: string;
    dim: number;
  };
  recall: {
    budget_tokens: number;
    l0_items: number;
    l1_items: number;
  };
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
        /** When true, attempt LLM refinement of Proposal SKILL.md (default false). */
        refine_proposals: boolean;
      };
    };
  privacy: {
    redact_patterns: string[];
    exclude_workspaces: string[];
  };
  dsh: {
    admin: {
      allowed_origins: string[];
      session_ttl_minutes: number;
      auth_failure_limit: number;
      auth_enabled: boolean;
    };
    auto_inject: boolean;
  };
}

export function defaultConfig(userId = "local"): AmemConfig {
  return {
    identity: { user_id: userId },
    llm: {
      base_url: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1-mini",
      api_key: "",
      api_key_env: "AMEM_LLM_KEY",
      mode: "stub",
    },
    embedding: { enabled: false, base_url: "", model: "", dim: 1024 },
    recall: { budget_tokens: 1800, l0_items: 8, l1_items: 3 },
    promotion: {
      instance_to_domain_min_instances: 3,
      domain_to_global_min_domains: 2,
      domain_to_global_min_instances: 5,
      global_min_lift: 0.1,
    },
    budget: {
      consolidate: {
        max_llm_calls: 200,
        max_tokens: 300000,
        max_proposals: 5,
        max_minutes: 20,
        refine_proposals: false,
      },
    },
    privacy: { redact_patterns: [], exclude_workspaces: [] },
    dsh: {
      admin: {
        allowed_origins: ["http://127.0.0.1", "http://localhost"],
        session_ttl_minutes: 480,
        auth_failure_limit: 8,
        auth_enabled: false,
      },
      auto_inject: false,
    },
  };
}

const DEFAULT_DSH_ADMIN = defaultConfig().dsh.admin;

export function unescapeTomlString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length) {
      const n = s[i + 1]!;
      if (n === "n") {
        out += "\n";
        i++;
      } else if (n === "r") {
        out += "\r";
        i++;
      } else if (n === "t") {
        out += "\t";
        i++;
      } else if (n === '"' || n === "\\") {
        out += n;
        i++;
      } else {
        out += c;
      }
    } else {
      out += c;
    }
  }
  return out;
}

export function parseTomlStringArray(raw: string): string[] {
  const t = raw.trim();
  if (t === "[]") return [];
  if (!t.startsWith("[") || !t.endsWith("]")) return [];
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  const out: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && (inner[i] === " " || inner[i] === ",")) i++;
    if (i >= inner.length) break;
    if (inner[i] !== '"') break;
    i++;
    let escaped = "";
    while (i < inner.length) {
      const c = inner[i]!;
      if (c === "\\") {
        escaped += c;
        i++;
        if (i < inner.length) {
          escaped += inner[i]!;
          i++;
        }
      } else if (c === '"') {
        i++;
        break;
      } else {
        escaped += c;
        i++;
      }
    }
    out.push(unescapeTomlString(escaped));
  }
  return out;
}

function formatTomlStringArray(arr: string[]): string {
  if (arr.length === 0) return "[]";
  return `[${arr.map((s) => `"${escapeTomlString(s)}"`).join(", ")}]`;
}

export function isValidAllowedOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    if (u.pathname !== "/" || u.search || u.hash) return false;
    return origin === `${u.protocol}//${u.host}`;
  } catch {
    return false;
  }
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function sanitizeDshConfig(dsh: AmemConfig["dsh"]): void {
  dsh.admin.session_ttl_minutes = clampInt(
    dsh.admin.session_ttl_minutes,
    1,
    1440,
    DEFAULT_DSH_ADMIN.session_ttl_minutes,
  );
  dsh.admin.auth_failure_limit = clampInt(
    dsh.admin.auth_failure_limit,
    1,
    100,
    DEFAULT_DSH_ADMIN.auth_failure_limit,
  );
  const rawOrigins = dsh.admin.allowed_origins;
  const candidates = Array.isArray(rawOrigins) ? rawOrigins : [];
  const origins = candidates.filter(
    (o): o is string => typeof o === "string" && isValidAllowedOrigin(o),
  );
  dsh.admin.allowed_origins =
    origins.length > 0 ? origins : [...DEFAULT_DSH_ADMIN.allowed_origins];
}

/** Minimal TOML subset reader for our known keys (no full TOML parser dependency). */
export function parseSimpleToml(text: string): AmemConfig {
  const cfg = defaultConfig();
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    // Strip trailing comments (quote-aware) so `key = "v" # note` reads as `v`.
    const line = splitTomlTrailingComment(raw).code.trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1]!;
      continue;
    }
    const kv = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1]!;
    const rawVal = kv[2]!.trim();
    let val: string | number | boolean | string[] = rawVal;
    if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      val = parseTomlStringArray(rawVal);
    } else if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
      val = unescapeTomlString(rawVal.slice(1, -1));
    } else if (rawVal === "true" || rawVal === "false") val = rawVal === "true";
    else if (/^-?\d+(\.\d+)?$/.test(rawVal)) val = Number(rawVal);

    assign(cfg, section, key, val);
  }
  sanitizeDshConfig(cfg.dsh);
  return cfg;
}

function assign(cfg: AmemConfig, section: string, key: string, val: unknown): void {
  const set = (obj: Record<string, unknown>, k: string) => {
    if (k in obj) obj[k] = val;
  };
  if (section === "identity") set(cfg.identity as unknown as Record<string, unknown>, key);
  else if (section === "llm") set(cfg.llm as unknown as Record<string, unknown>, key);
  else if (section === "embedding") set(cfg.embedding as unknown as Record<string, unknown>, key);
  else if (section === "recall") set(cfg.recall as unknown as Record<string, unknown>, key);
  else if (section === "promotion") set(cfg.promotion as unknown as Record<string, unknown>, key);
  else if (section === "budget.consolidate")
    set(cfg.budget.consolidate as unknown as Record<string, unknown>, key);
  else if (section === "privacy") {
    if (key === "redact_patterns" || key === "exclude_workspaces") return;
    set(cfg.privacy as unknown as Record<string, unknown>, key);
  } else if (section === "dsh") {
    set(cfg.dsh as unknown as Record<string, unknown>, key);
  } else if (section === "dsh.admin") {
    set(cfg.dsh.admin as unknown as Record<string, unknown>, key);
  }
}

export function loadConfig(home = amemHome()): AmemConfig {
  const p = paths(home).config;
  if (!existsSync(p)) return defaultConfig();
  return parseSimpleToml(readFileSync(p, "utf8"));
}

export function escapeTomlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

export function configToToml(cfg: AmemConfig): string {
  return `# amem config
[identity]
user_id = "${escapeTomlString(cfg.identity.user_id)}"

[llm]
base_url = "${escapeTomlString(cfg.llm.base_url)}"
model = "${escapeTomlString(cfg.llm.model)}"
api_key = "${escapeTomlString(cfg.llm.api_key)}"
api_key_env = "${escapeTomlString(cfg.llm.api_key_env)}"
mode = "${escapeTomlString(cfg.llm.mode)}"

[embedding]
enabled = ${cfg.embedding.enabled}
base_url = "${escapeTomlString(cfg.embedding.base_url)}"
model = "${escapeTomlString(cfg.embedding.model)}"
dim = ${cfg.embedding.dim}

[recall]
budget_tokens = ${cfg.recall.budget_tokens}
l0_items = ${cfg.recall.l0_items}
l1_items = ${cfg.recall.l1_items}

[promotion]
instance_to_domain_min_instances = ${cfg.promotion.instance_to_domain_min_instances}
domain_to_global_min_domains = ${cfg.promotion.domain_to_global_min_domains}
domain_to_global_min_instances = ${cfg.promotion.domain_to_global_min_instances}
global_min_lift = ${cfg.promotion.global_min_lift}

[budget.consolidate]
max_llm_calls = ${cfg.budget.consolidate.max_llm_calls}
max_tokens = ${cfg.budget.consolidate.max_tokens}
max_proposals = ${cfg.budget.consolidate.max_proposals}
max_minutes = ${cfg.budget.consolidate.max_minutes}
refine_proposals = ${cfg.budget.consolidate.refine_proposals}

[privacy]
redact_patterns = []
exclude_workspaces = []

[dsh]
auto_inject = ${cfg.dsh.auto_inject}

[dsh.admin]
allowed_origins = ${formatTomlStringArray(cfg.dsh.admin.allowed_origins)}
session_ttl_minutes = ${cfg.dsh.admin.session_ttl_minutes}
auth_failure_limit = ${cfg.dsh.admin.auth_failure_limit}
auth_enabled = ${cfg.dsh.admin.auth_enabled}
`;
}

const DANGEROUS_CHARS = /["\\\n\r]/;
const LLM_MODES = ["stub", "external", "host"] as const;
const PRIVACY_SECTION_RE = /^\[privacy\]\s*\n(?:.*(?:\n|$))*?(?=^\[|$)/m;

export type EditableConfigPatch = {
  identity?: { user_id?: string };
  llm?: {
    mode?: AmemConfig["llm"]["mode"];
    base_url?: string;
    model?: string;
    api_key?: string;
    api_key_env?: string;
  };
  recall?: Partial<AmemConfig["recall"]>;
  promotion?: Partial<AmemConfig["promotion"]>;
  budget?: { consolidate?: Partial<AmemConfig["budget"]["consolidate"]> };
};

/** Prefer inline `llm.api_key`; else `process.env[llm.api_key_env]`. */
export function resolveLlmApiKey(cfg: AmemConfig): string | undefined {
  const inline = cfg.llm.api_key?.trim();
  if (inline) return inline;
  const envName = cfg.llm.api_key_env?.trim();
  if (!envName) return undefined;
  const fromEnv = process.env[envName];
  return fromEnv?.trim() ? fromEnv : undefined;
}

/**
 * Which source `resolveLlmApiKey` would use right now, for UI display.
 * Never exposes the key itself, only where it comes from.
 */
export function llmApiKeySource(cfg: AmemConfig): "inline" | "env" | "none" {
  if (cfg.llm.api_key?.trim()) return "inline";
  const envName = cfg.llm.api_key_env?.trim();
  if (envName && process.env[envName]?.trim()) return "env";
  return "none";
}

const SK_PREFIX_RE = /^sk-/i;
const TOKEN_SHAPE_RE = /^[A-Za-z0-9_\-+/=]+$/;
const CONVENTIONAL_ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Heuristic for `llm.api_key_env`: an environment variable name never looks like a
 * pasted secret. Conventional UPPER_SNAKE names stay accepted even when long.
 */
export function looksLikeSecretValue(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (SK_PREFIX_RE.test(t)) return true;
  if (t.length < 40 || !TOKEN_SHAPE_RE.test(t)) return false;
  return !CONVENTIONAL_ENV_NAME_RE.test(t);
}

function rejectDangerous(label: string, s: string, allowEmpty: boolean): string | null {
  const t = s.trim();
  if (!allowEmpty && !t) return `${label} required`;
  if (DANGEROUS_CHARS.test(t)) return `${label} contains illegal characters`;
  return null;
}

function badField(message: string): { error: string; message: string } {
  return { error: "bad_request", message };
}

function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> | { error: string; message: string } {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return badField(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function copyStringField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): string | { error: string; message: string } | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "string") return badField(`${label} must be a string`);
  return v;
}

function copyIntField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): number | { error: string; message: string } | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "number") return badField(`${label} must be a number`);
  return v;
}

function copyFloatField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): number | { error: string; message: string } | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "number") return badField(`${label} must be a number`);
  return v;
}

function copyBoolField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): boolean | { error: string; message: string } | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "boolean") return badField(`${label} must be a boolean`);
  return v;
}

export function extractEditableConfigPatch(
  input: unknown,
): EditableConfigPatch | { error: string; message: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { error: "bad_request", message: "config object required" };
  }
  const root = input as Record<string, unknown>;
  const srcRaw =
    root.config != null && typeof root.config === "object" && !Array.isArray(root.config)
      ? root.config
      : input;
  if (typeof srcRaw !== "object" || srcRaw == null || Array.isArray(srcRaw)) {
    return { error: "bad_request", message: "config object required" };
  }
  const src = srcRaw as Record<string, unknown>;
  const patch: EditableConfigPatch = {};

  if ("identity" in src) {
    const identity = requireObject(src.identity, "identity");
    if ("error" in identity) return identity;
    const userId = copyStringField(identity, "user_id", "identity.user_id");
    if (userId != null && typeof userId === "object" && "error" in userId) return userId;
    if (userId !== undefined) {
      patch.identity = { user_id: userId as string };
    }
  }

  if ("llm" in src) {
    const llm = requireObject(src.llm, "llm");
    if ("error" in llm) return llm;
    const part: NonNullable<EditableConfigPatch["llm"]> = {};
    const mode = copyStringField(llm, "mode", "llm.mode");
    if (mode != null && typeof mode === "object" && "error" in mode) return mode;
    if (mode !== undefined) part.mode = mode as AmemConfig["llm"]["mode"];
    for (const [key, label] of [
      ["base_url", "llm.base_url"],
      ["model", "llm.model"],
      ["api_key", "llm.api_key"],
      ["api_key_env", "llm.api_key_env"],
    ] as const) {
      const v = copyStringField(llm, key, label);
      if (v != null && typeof v === "object" && "error" in v) return v;
      if (v !== undefined) part[key] = v as string;
    }
    if (Object.keys(part).length > 0) patch.llm = part;
  }

  if ("recall" in src) {
    const recall = requireObject(src.recall, "recall");
    if ("error" in recall) return recall;
    const part: Partial<AmemConfig["recall"]> = {};
    for (const [key, label] of [
      ["budget_tokens", "recall.budget_tokens"],
      ["l0_items", "recall.l0_items"],
      ["l1_items", "recall.l1_items"],
    ] as const) {
      const v = copyIntField(recall, key, label);
      if (v != null && typeof v === "object" && "error" in v) return v;
      if (v !== undefined) part[key] = v as number;
    }
    if (Object.keys(part).length > 0) patch.recall = part;
  }

  if ("promotion" in src) {
    const promotion = requireObject(src.promotion, "promotion");
    if ("error" in promotion) return promotion;
    const part: Partial<AmemConfig["promotion"]> = {};
    for (const [key, label] of [
      ["instance_to_domain_min_instances", "promotion.instance_to_domain_min_instances"],
      ["domain_to_global_min_domains", "promotion.domain_to_global_min_domains"],
      ["domain_to_global_min_instances", "promotion.domain_to_global_min_instances"],
    ] as const) {
      const v = copyIntField(promotion, key, label);
      if (v != null && typeof v === "object" && "error" in v) return v;
      if (v !== undefined) part[key] = v as number;
    }
    const lift = copyFloatField(promotion, "global_min_lift", "promotion.global_min_lift");
    if (lift != null && typeof lift === "object" && "error" in lift) return lift;
    if (lift !== undefined) part.global_min_lift = lift as number;
    if (Object.keys(part).length > 0) patch.promotion = part;
  }

  if ("budget" in src) {
    const budget = requireObject(src.budget, "budget");
    if ("error" in budget) return budget;
    if ("consolidate" in budget) {
      const consolidate = requireObject(budget.consolidate, "budget.consolidate");
      if ("error" in consolidate) return consolidate;
      const part: Partial<AmemConfig["budget"]["consolidate"]> = {};
      for (const [key, label] of [
        ["max_llm_calls", "budget.consolidate.max_llm_calls"],
        ["max_tokens", "budget.consolidate.max_tokens"],
        ["max_proposals", "budget.consolidate.max_proposals"],
        ["max_minutes", "budget.consolidate.max_minutes"],
      ] as const) {
        const v = copyIntField(consolidate, key, label);
        if (v != null && typeof v === "object" && "error" in v) return v;
        if (v !== undefined) part[key] = v as number;
      }
      const refine = copyBoolField(
        consolidate,
        "refine_proposals",
        "budget.consolidate.refine_proposals",
      );
      if (refine != null && typeof refine === "object" && "error" in refine) return refine;
      if (refine !== undefined) part.refine_proposals = refine;
      if (Object.keys(part).length > 0) patch.budget = { consolidate: part };
    }
  }

  return patch;
}

function validateInt(label: string, n: number): string | null {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return `${label} must be a non-negative integer`;
  }
  return null;
}

function validateNonNegFloat(label: string, n: number): string | null {
  if (!Number.isFinite(n) || n < 0) return `${label} must be a non-negative number`;
  return null;
}

function validationFail(message: string): { ok: false; error: string; message: string } {
  return { ok: false, error: "bad_request", message };
}

export function validateEditableConfigPatch(
  patch: EditableConfigPatch,
): { ok: true } | { ok: false; error: string; message: string } {
  if (patch.identity?.user_id != null) {
    const err = rejectDangerous("user_id", patch.identity.user_id, false);
    if (err) return validationFail(err);
  }

  if (patch.llm) {
    if (patch.llm.mode != null && !LLM_MODES.includes(patch.llm.mode)) {
      return validationFail("llm.mode invalid");
    }
    if (patch.llm.base_url != null) {
      const err = rejectDangerous("base_url", patch.llm.base_url, true);
      if (err) return validationFail(err);
    }
    if (patch.llm.model != null) {
      const err = rejectDangerous("model", patch.llm.model, true);
      if (err) return validationFail(err);
    }
    if (patch.llm.api_key != null) {
      const err = rejectDangerous("api_key", patch.llm.api_key, true);
      if (err) return validationFail(err);
    }
    if (patch.llm.api_key_env != null) {
      const err = rejectDangerous("api_key_env", patch.llm.api_key_env, true);
      if (err) return validationFail(err);
      if (looksLikeSecretValue(patch.llm.api_key_env)) {
        return validationFail(
          "api_key_env must be an environment variable name, not a secret value",
        );
      }
    }
  }

  if (patch.recall) {
    for (const [key, label] of [
      ["budget_tokens", "recall.budget_tokens"],
      ["l0_items", "recall.l0_items"],
      ["l1_items", "recall.l1_items"],
    ] as const) {
      const v = patch.recall[key];
      if (v != null) {
        const err = validateInt(label, v);
        if (err) return validationFail(err);
      }
    }
  }

  if (patch.promotion) {
    for (const [key, label] of [
      ["instance_to_domain_min_instances", "promotion.instance_to_domain_min_instances"],
      ["domain_to_global_min_domains", "promotion.domain_to_global_min_domains"],
      ["domain_to_global_min_instances", "promotion.domain_to_global_min_instances"],
    ] as const) {
      const v = patch.promotion[key];
      if (v != null) {
        const err = validateInt(label, v);
        if (err) return validationFail(err);
      }
    }
    if (patch.promotion.global_min_lift != null) {
      const err = validateNonNegFloat(
        "promotion.global_min_lift",
        patch.promotion.global_min_lift,
      );
      if (err) return validationFail(err);
    }
  }

  if (patch.budget?.consolidate) {
    for (const [key, label] of [
      ["max_llm_calls", "budget.consolidate.max_llm_calls"],
      ["max_tokens", "budget.consolidate.max_tokens"],
      ["max_proposals", "budget.consolidate.max_proposals"],
      ["max_minutes", "budget.consolidate.max_minutes"],
    ] as const) {
      const v = patch.budget.consolidate[key];
      if (v != null) {
        const err = validateInt(label, v);
        if (err) return validationFail(err);
      }
    }
  }

  return { ok: true };
}

export function mergeConfigOverlay(base: AmemConfig, patch: EditableConfigPatch): AmemConfig {
  const out: AmemConfig = structuredClone(base);
  if (patch.identity?.user_id != null) out.identity.user_id = patch.identity.user_id.trim();
  if (patch.llm) {
    if (patch.llm.mode != null) out.llm.mode = patch.llm.mode;
    if (patch.llm.base_url != null) out.llm.base_url = patch.llm.base_url.trim();
    if (patch.llm.model != null) out.llm.model = patch.llm.model.trim();
    if (patch.llm.api_key != null) out.llm.api_key = patch.llm.api_key.trim();
    if (patch.llm.api_key_env != null) out.llm.api_key_env = patch.llm.api_key_env.trim();
  }
  if (patch.recall) Object.assign(out.recall, patch.recall);
  if (patch.promotion) Object.assign(out.promotion, patch.promotion);
  if (patch.budget?.consolidate) Object.assign(out.budget.consolidate, patch.budget.consolidate);
  return out;
}

/**
 * Splice the disk `[privacy]` block into a freshly generated document. Only used by the
 * full-regeneration path (`configToToml`); in-place saves go through `updateTomlText`,
 * which leaves `[privacy]` untouched by construction.
 */
export function preservePrivacyTomlSection(diskToml: string, generatedToml: string): string {
  const diskMatch = diskToml.match(PRIVACY_SECTION_RE);
  if (!diskMatch) return generatedToml;
  return generatedToml.replace(PRIVACY_SECTION_RE, diskMatch[0]!);
}

type TomlScalar = string | number | boolean | string[];

function formatTomlScalar(value: TomlScalar): string {
  if (typeof value === "string") return `"${escapeTomlString(value)}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return formatTomlStringArray(value);
  return String(value);
}

/**
 * Every section/key `configToToml` owns, except `[privacy]` (whose arrays the minimal
 * reader cannot parse, so the panel must never rewrite it).
 */
function managedTomlEntries(cfg: AmemConfig): Record<string, Record<string, TomlScalar>> {
  return {
    identity: { user_id: cfg.identity.user_id },
    llm: {
      base_url: cfg.llm.base_url,
      model: cfg.llm.model,
      api_key: cfg.llm.api_key,
      api_key_env: cfg.llm.api_key_env,
      mode: cfg.llm.mode,
    },
    embedding: {
      enabled: cfg.embedding.enabled,
      base_url: cfg.embedding.base_url,
      model: cfg.embedding.model,
      dim: cfg.embedding.dim,
    },
    recall: {
      budget_tokens: cfg.recall.budget_tokens,
      l0_items: cfg.recall.l0_items,
      l1_items: cfg.recall.l1_items,
    },
    promotion: {
      instance_to_domain_min_instances: cfg.promotion.instance_to_domain_min_instances,
      domain_to_global_min_domains: cfg.promotion.domain_to_global_min_domains,
      domain_to_global_min_instances: cfg.promotion.domain_to_global_min_instances,
      global_min_lift: cfg.promotion.global_min_lift,
    },
    "budget.consolidate": {
      max_llm_calls: cfg.budget.consolidate.max_llm_calls,
      max_tokens: cfg.budget.consolidate.max_tokens,
      max_proposals: cfg.budget.consolidate.max_proposals,
      max_minutes: cfg.budget.consolidate.max_minutes,
      refine_proposals: cfg.budget.consolidate.refine_proposals,
    },
    dsh: { auto_inject: cfg.dsh.auto_inject },
    "dsh.admin": {
      allowed_origins: cfg.dsh.admin.allowed_origins,
      session_ttl_minutes: cfg.dsh.admin.session_ttl_minutes,
      auth_failure_limit: cfg.dsh.admin.auth_failure_limit,
      auth_enabled: cfg.dsh.admin.auth_enabled,
    },
  };
}

function scanTomlSectionKeys(lines: string[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    const header = trimmed.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1]!;
      continue;
    }
    const kv = trimmed.match(/^([A-Za-z0-9_]+)\s*=/);
    if (!kv) continue;
    let keys = found.get(section);
    if (!keys) {
      keys = new Set<string>();
      found.set(section, keys);
    }
    keys.add(kv[1]!);
  }
  return found;
}

function splitTomlTrailingComment(line: string): { code: string; comment: string } {
  let inString = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "#") return { code: line.slice(0, i), comment: line.slice(i) };
  }
  return { code: line, comment: "" };
}

/**
 * Update only the managed keys of `diskToml`, leaving comments, unknown keys, formatting
 * and unmanaged sections (`[privacy]`) intact. Missing managed keys are filled in right
 * after their section header; wholly missing sections are appended at the end.
 */
export function updateTomlText(diskToml: string, cfg: AmemConfig): string {
  if (!diskToml.trim()) return configToToml(cfg);
  const entries = managedTomlEntries(cfg);
  const eol = diskToml.includes("\r\n") ? "\r\n" : "\n";
  const rawLines = diskToml.split(/\r?\n/);
  const endsWithEol = rawLines.length > 1 && rawLines[rawLines.length - 1] === "";
  const lines = endsWithEol ? rawLines.slice(0, -1) : rawLines.slice();
  const present = scanTomlSectionKeys(lines);
  const inserted = new Set<string>();
  const out: string[] = [];
  let section = "";
  for (const line of lines) {
    const trimmed = line.trim();
    const header = trimmed.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1]!;
      out.push(line);
      const managed = entries[section];
      if (!managed) continue;
      const have = present.get(section);
      for (const [key, value] of Object.entries(managed)) {
        const token = `${section}\u0000${key}`;
        if (have?.has(key) || inserted.has(token)) continue;
        inserted.add(token);
        out.push(`${key} = ${formatTomlScalar(value)}`);
      }
      continue;
    }
    const kv = trimmed.match(/^([A-Za-z0-9_]+)\s*=/);
    const managed = entries[section];
    if (!kv || !managed || !(kv[1]! in managed)) {
      out.push(line);
      continue;
    }
    const key = kv[1]!;
    const indent = line.slice(0, line.length - line.trimStart().length);
    const { comment } = splitTomlTrailingComment(line);
    const suffix = comment ? ` ${comment}` : "";
    out.push(`${indent}${key} = ${formatTomlScalar(managed[key]!)}${suffix}`);
  }
  const tail: string[] = [];
  for (const [sectionName, managed] of Object.entries(entries)) {
    if (present.has(sectionName)) continue;
    if (tail.length > 0) tail.push("");
    tail.push(`[${sectionName}]`);
    for (const [key, value] of Object.entries(managed)) {
      tail.push(`${key} = ${formatTomlScalar(value)}`);
    }
  }
  if (tail.length > 0) {
    if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
    out.push(...tail);
    return `${out.join(eol)}${eol}`;
  }
  const text = out.join(eol);
  return endsWithEol ? `${text}${eol}` : text;
}

export function writeAmemConfigFile(home: string, cfg: AmemConfig, diskToml?: string): void {
  const configPath = paths(home).config;
  const disk = diskToml ?? (existsSync(configPath) ? readFileSync(configPath, "utf8") : "");
  const text = updateTomlText(disk, cfg);
  const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, configPath);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore cleanup errors */
    }
    throw e;
  }
}
