#!/usr/bin/env node
/**
 * Recall eval harness (design §14 skeleton).
 * Seeds golden memories and reports Recall@K for keyword queries.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore, IndexStore } from "../packages/store/dist/index.js";
import { extractSituation, recall } from "../packages/retrieval/dist/index.js";

const cases = [
  { query: "port already in use", relevant: ["mem_port"] },
  { query: "database migration ordering", relevant: ["mem_migrate"] },
  { query: "vite HMR websocket", relevant: ["mem_hmr"] },
  { query: "pnpm workspace protocol", relevant: ["mem_pnpm"] },
  { query: "typescript path aliases", relevant: ["mem_tspaths"] },
  { query: "sqlite busy timeout", relevant: ["mem_sqlite"] },
  { query: "csrf double submit cookie", relevant: ["mem_csrf"] },
  { query: "react useEffect cleanup", relevant: ["mem_effect"] },
  { query: "docker port publish", relevant: ["mem_docker"] },
  { query: "git rebase conflict markers", relevant: ["mem_rebase"] },
  { query: "oauth refresh token rotation", relevant: ["mem_oauth"] },
  { query: "zod schema refine", relevant: ["mem_zod"] },
];

const fixtures = [
  { id: "mem_port", title: "port already in use", applies_when: "dev server fails because port is occupied", content: "Find the process holding the port." },
  { id: "mem_migrate", title: "database migration ordering", applies_when: "schema changes need ordered migrations", content: "Apply migrations in dependency order." },
  { id: "mem_hmr", title: "vite HMR websocket", applies_when: "hot reload fails behind proxy", content: "Forward the HMR websocket path." },
  { id: "mem_pnpm", title: "pnpm workspace protocol", applies_when: "linking local packages", content: "Use workspace:* in package.json." },
  { id: "mem_tspaths", title: "typescript path aliases", applies_when: "imports use @/ aliases", content: "Keep tsconfig paths and bundler resolve in sync." },
  { id: "mem_sqlite", title: "sqlite busy timeout", applies_when: "concurrent writers lock the db", content: "Set PRAGMA busy_timeout and prefer WAL." },
  { id: "mem_csrf", title: "csrf double submit cookie", applies_when: "browser mutating admin RPC", content: "Require matching CSRF header with session cookie." },
  { id: "mem_effect", title: "react useEffect cleanup", applies_when: "subscriptions leak on unmount", content: "Return a cleanup function from useEffect." },
  { id: "mem_docker", title: "docker port publish", applies_when: "container not reachable from host", content: "Publish with -p host:container." },
  { id: "mem_rebase", title: "git rebase conflict markers", applies_when: "rebase stops on conflicts", content: "Resolve markers then git rebase --continue." },
  { id: "mem_oauth", title: "oauth refresh token rotation", applies_when: "refresh returns invalid_grant", content: "Store the new refresh token after each rotate." },
  { id: "mem_zod", title: "zod schema refine", applies_when: "cross-field validation needed", content: "Use .refine on the object schema." },
  { id: "mem_noise", title: "unrelated cache tip", applies_when: "cdn cache stale", content: "Purge the edge cache." },
];

const home = mkdtempSync(join(tmpdir(), "amem-eval-"));
try {
  const store = new MemoryStore(home);
  for (const f of fixtures) {
    store.write(
      {
        id: f.id,
        kind: "failure",
        title: f.title,
        content: f.content,
        applies_when: f.applies_when,
        scope: { level: "domain", tags: { user: "eval" } },
        trust: "T2",
        status: "active",
        evidence: { episodes: ["e"], count: 1, distinct_instances: 1, distinct_domains: 1 },
        stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
        validity: { depends_on: [], valid_from: "2026-01-01" },
        created_by: "eval",
        updated_at: new Date().toISOString(),
      },
      "human",
    );
  }
  const idx = new IndexStore(home);
  idx.rebuild(store);
  idx.close();

  let hits = 0;
  let total = 0;
  for (const c of cases) {
    const sit = extractSituation({ query: c.query, userId: "eval" });
    const got = recall(home, sit, 8).map((h) => h.memory.id);
    const hit = c.relevant.every((id) => got.includes(id));
    total += 1;
    if (hit) hits += 1;
    console.log(`${hit ? "PASS" : "FAIL"} query=${JSON.stringify(c.query)} got=${got.join(",")}`);
  }
  const rate = hits / total;
  console.log(`Recall@8 cases=${total} hit=${hits} rate=${rate.toFixed(2)}`);
  if (rate < 0.7) process.exit(1);
} finally {
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* windows sqlite unlock */
  }
}
