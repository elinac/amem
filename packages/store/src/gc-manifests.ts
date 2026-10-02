import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { paths } from "@amem/core";

/**
 * Remove aged recoverable artifacts under manifests (reports, orphan tx, old pack json).
 * Does not touch epochs/ or audit/ (audit is append-only evidence).
 */
export function gcManifests(home: string, opts: { maxAgeDays?: number } = {}): { removed: number } {
  const maxAgeDays = opts.maxAgeDays ?? 14;
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const root = paths(home).manifests;
  if (!existsSync(root)) return { removed: 0 };
  let removed = 0;

  const sweepDir = (dir: string, filter: (name: string) => boolean) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!filter(name)) continue;
      const p = join(dir, name);
      try {
        const st = statSync(p);
        if (!st.isFile()) continue;
        if (st.mtimeMs < cutoff) {
          rmSync(p, { force: true });
          removed += 1;
        }
      } catch {
        /* ignore */
      }
    }
  };

  sweepDir(join(root, "reports"), () => true);
  sweepDir(join(root, "transactions"), (n) => n.endsWith(".json"));
  // top-level pack snapshots cp_*.json
  sweepDir(root, (n) => n.startsWith("cp_") && n.endsWith(".json"));
  return { removed };
}
