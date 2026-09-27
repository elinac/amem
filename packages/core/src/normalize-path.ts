/** Normalize Cursor-style `/d:/dev/...` or `/c:/...` to Windows path. */
export function normalizeWorkspaceRoot(root: string): string {
  const m = root.match(/^\/([a-zA-Z]):(\/.*)?$/);
  if (m) {
    const drive = m[1]!.toUpperCase();
    const rest = (m[2] ?? "").replace(/\//g, "\\");
    return `${drive}:${rest || "\\"}`;
  }
  if (root.startsWith("/") && /^\/[a-zA-Z]\//.test(root) === false) {
    // unix
    return root;
  }
  return root.replace(/\//g, "\\");
}
