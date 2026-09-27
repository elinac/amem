import { homedir } from "node:os";
import { join } from "node:path";

export function amemHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.AMEM_HOME ?? join(homedir(), ".amem");
}

export function paths(home = amemHome()) {
  return {
    home,
    config: join(home, "amem.toml"),
    spool: join(home, "spool"),
    spoolRaw: join(home, "spool", "raw"),
    episodes: join(home, "episodes"),
    memories: join(home, "memories"),
    manifests: join(home, "manifests"),
    queue: join(home, "queue"),
    logs: join(home, "logs"),
    index: join(home, "index.sqlite"),
    capabilities: join(home, "capabilities"),
  } as const;
}

export function memoryPath(
  home: string,
  level: string,
  kind: string,
  id: string,
): string {
  return join(home, "memories", level, kind, `${id}.md`);
}
