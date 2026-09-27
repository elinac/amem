import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Situation } from "@amem/core";

export function extractSituation(opts: {
  query: string;
  userId: string;
  instanceId?: string;
  workspaceRoot?: string;
}): Situation {
  const domains: string[] = [];
  const tools: string[] = [];
  const root = opts.workspaceRoot;
  if (root) {
    const pkg = join(root, "package.json");
    if (existsSync(pkg)) {
      domains.push("node");
      try {
        const j = JSON.parse(readFileSync(pkg, "utf8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...j.dependencies, ...j.devDependencies };
        if (deps.vite) {
          domains.push("vite");
          tools.push("vite");
        }
        if (deps["@tauri-apps/cli"] || deps["@tauri-apps/api"]) {
          domains.push("tauri");
          tools.push("tauri");
        }
        if (deps.react) domains.push("react");
        if (deps.vitest) tools.push("vitest");
      } catch {
        /* ignore */
      }
    }
    if (existsSync(join(root, "Cargo.toml"))) {
      domains.push("rust");
      tools.push("cargo");
    }
  }
  const q = opts.query.toLowerCase();
  let task_type: string | undefined;
  if (/debug|error|fail|port/.test(q)) task_type = "debug";
  else if (/test|spec/.test(q)) task_type = "test";
  else if (/implement|add|build|feat/.test(q)) task_type = "implement";

  return {
    query: opts.query,
    task_type,
    domains: [...new Set(domains)],
    tools: [...new Set(tools)],
    instance_id: opts.instanceId,
    user_id: opts.userId,
  };
}
