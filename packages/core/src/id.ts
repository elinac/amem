import { createHash, randomBytes } from "node:crypto";

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
