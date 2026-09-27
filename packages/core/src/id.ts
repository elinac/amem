import { createHash, randomBytes } from "node:crypto";

/** Safe for use as a single path segment (no traversal / separators). */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** ULID-like sortable id: time prefix + random */
export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = randomBytes(8).toString("hex");
  return `${prefix}_${t}${r}`;
}

export function shortHash(input: string, len = 12): string {
  return createHash("sha256").update(input).digest("hex").slice(0, len);
}

export function instanceIdFromWorkspace(roots: string[], gitRemote?: string): string {
  return shortHash(gitRemote || roots[0] || "unknown");
}

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}

/**
 * Allowlist session/file ids for filesystem paths. Unsafe input maps to a
 * deterministic `sid_<hash>` so callers never interpolate `..` or separators.
 */
export function sanitizeId(id: string, fallbackPrefix = "sid"): string {
  const s = String(id ?? "").trim();
  if (SAFE_ID.test(s)) return s;
  return `${fallbackPrefix}_${shortHash(s || "empty")}`;
}
