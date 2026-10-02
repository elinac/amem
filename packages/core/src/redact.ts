const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|authorization|cookie|email)/i;
const SECRET_VALUE =
  /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|(?<!\d)\d{17}[\dXx](?!\d)|https?:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\S+)/g;
const PHONE = /(?<!\d)(?:1[3-9]\d{9}|\+?\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4})(?!\d)/g;

const MAX_STRING = 4000;

export type RedactOptions = {
  /** Extra regex sources from `privacy.redact_patterns` in amem.toml. */
  patterns?: string[];
};

function applyCustomPatterns(text: string, patterns: string[]): string {
  let out = text;
  for (const raw of patterns) {
    const src = String(raw ?? "").trim();
    if (!src) continue;
    try {
      out = out.replace(new RegExp(src, "gi"), "[redacted]");
    } catch {
      /* invalid user regex: skip rather than crash ingest */
    }
  }
  return out;
}

export function redactString(value: string, key = "", opts: RedactOptions = {}): string {
  if (SECRET_KEY.test(key)) return "[redacted]";
  let masked = value.replace(SECRET_VALUE, "[redacted]").replace(PHONE, "[redacted]");
  masked = applyCustomPatterns(masked, opts.patterns ?? []);
  if (masked.length > MAX_STRING) {
    masked = `${masked.slice(0, MAX_STRING / 2)}…[truncated ${masked.length - MAX_STRING} chars]…${masked.slice(-MAX_STRING / 2)}`;
  }
  return masked;
}

export function redactDeep(value: unknown, key = "", opts: RedactOptions = {}): unknown {
  if (typeof value === "string") return redactString(value, key, opts);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, key, opts));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        redactDeep(v, k, opts),
      ]),
    );
  }
  return value;
}

export function containsSecrets(text: string, opts: RedactOptions = {}): boolean {
  SECRET_VALUE.lastIndex = 0;
  if (SECRET_VALUE.test(text)) return true;
  for (const raw of opts.patterns ?? []) {
    const src = String(raw ?? "").trim();
    if (!src) continue;
    try {
      if (new RegExp(src, "i").test(text)) return true;
    } catch {
      /* skip */
    }
  }
  return false;
}

/**
 * True when `workspaceRoot` matches any configured exclude path
 * (exact or nested under an exclude entry).
 */
export function isExcludedWorkspace(
  workspaceRoot: string | undefined | null,
  exclude: string[],
): boolean {
  if (!workspaceRoot || !exclude.length) return false;
  const norm = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const root = norm(workspaceRoot);
  for (const ex of exclude) {
    const e = norm(String(ex ?? ""));
    if (!e) continue;
    if (root === e || root.startsWith(`${e}/`)) return true;
  }
  return false;
}
