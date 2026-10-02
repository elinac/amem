#!/usr/bin/env node
/**
 * Offline recall effectiveness eval (Phase 2).
 * Loads fixtures/eval corpus + judgments; reports P@K and injection metrics.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { defaultConfig } from "../packages/core/dist/index.js";
import { MemoryStore, IndexStore } from "../packages/store/dist/index.js";
import {
  extractSituation,
  recall,
  buildContextPack,
  decideRecall,
  injectableDecisions,
} from "../packages/retrieval/dist/index.js";
import {
  DEFAULT_GATES,
  budgetUtilization,
  conflictExposureRate,
  evaluateGates,
  harmfulInjectionRate,
  macroAverage,
  precisionAtK,
  recallAtK,
} from "./lib/eval-metrics.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const K = DEFAULT_GATES.k;

function loadJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function parseArgs(argv) {
  const out = { channel: "fts+tags", writeLatest: true, outPath: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--channel") out.channel = argv[++i] ?? out.channel;
    else if (a === "--out") out.outPath = argv[++i] ?? null;
    else if (a === "--no-write") out.writeLatest = false;
  }
  return out;
}

function toRecord(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    content: row.content,
    applies_when: row.applies_when,
    not_applies_when: row.not_applies_when,
    scope: row.scope,
    trust: row.trust,
    status: row.status,
    evidence: {
      episodes: ["eval"],
      count: 1,
      distinct_instances: 1,
      distinct_domains: 1,
    },
    stats: {
      recalled: 0,
      adopted: 0,
      helpful: 0,
      harmful: row.stats?.harmful ?? 0,
      lift: row.stats?.lift ?? 0,
    },
    validity: { depends_on: [], valid_from: "2026-01-01" },
    conflicts_with: row.conflicts_with ?? [],
    created_by: "eval",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

function situationFor(judgment) {
  const s = judgment.situation ?? {};
  const sit = extractSituation({
    query: judgment.query,
    userId: s.userId ?? "eval",
    instanceId: s.instance_id,
  });
  if (Array.isArray(s.domains) && s.domains.length) {
    sit.domains = [...new Set([...sit.domains, ...s.domains])];
  }
  if (Array.isArray(s.tools) && s.tools.length) {
    sit.tools = [...new Set([...sit.tools, ...s.tools])];
  }
  if (s.task_type) sit.task_type = s.task_type;
  return sit;
}

function runEval(opts = {}) {
  const channel = opts.channel ?? "fts+tags";
  const check = spawnSync(process.execPath, [join(root, "scripts/check-eval-corpus.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  if (check.status !== 0) {
    process.stderr.write(check.stdout || "");
    process.stderr.write(check.stderr || "");
    throw new Error("eval corpus check failed");
  }

  const memories = loadJsonl(join(root, "fixtures/eval/corpus/v0/memories.jsonl"));
  const judgments = loadJsonl(join(root, "fixtures/eval/judgments/v0.jsonl"));
  const memoryById = new Map(memories.map((m) => [m.id, m]));

  const home = mkdtempSync(join(tmpdir(), "amem-eval-"));
  try {
    const store = new MemoryStore(home);
    for (const row of memories) store.write(toRecord(row), "human");
    const idx = new IndexStore(home);
    idx.rebuild(store);
    idx.close();

    const cfg = defaultConfig("eval");
    cfg.recall.mode = "assist";
    cfg.recall.l0_items = K;

    const pAtK = [];
    const rAtK = [];
    const harmRates = [];
    const conflictRates = [];
    const budgetRates = [];
    let budgetDrops = 0;
    const perCase = [];

    for (const j of judgments) {
      const sit = situationFor(j);
      const hits = recall(home, sit, K);
      const retrieved = hits.map((h) => h.memory.id);
      const decisions = decideRecall(hits, "assist");
      const injectable = injectableDecisions(decisions, "assist").map((d) => d.memory.id);

      if (j.budget_tokens) cfg.recall.budget_tokens = j.budget_tokens;
      else cfg.recall.budget_tokens = defaultConfig("eval").recall.budget_tokens;

      const pack = buildContextPack({
        home,
        cfg,
        situation: sit,
        sessionId: `eval-${j.id}`,
        hits,
      });
      const used = pack.items.reduce((s, it) => s + (it.tokens ?? 0), 0);
      budgetDrops += pack.dropped.filter((d) => d.reason === "budget").length;

      const p = precisionAtK(retrieved, j.relevant ?? [], K);
      const r = recallAtK(retrieved, j.relevant ?? [], K);
      const harm = harmfulInjectionRate(injectable, j.harmful ?? []);
      const conf = conflictExposureRate(retrieved, memoryById);
      const bud = budgetUtilization(used, pack.budget_tokens);

      pAtK.push(p);
      rAtK.push(r);
      harmRates.push(harm);
      conflictRates.push(conf);
      budgetRates.push(bud);
      perCase.push({
        id: j.id,
        precision_at_k: p,
        recall_at_k: r,
        harmful_injection_rate: harm,
        conflict_exposure_rate: conf,
        budget_utilization: bud,
        retrieved,
        injectable,
      });
    }

    const metrics = {
      k: K,
      channel,
      cases: judgments.length,
      precision_at_k: macroAverage(pAtK),
      recall_at_k: macroAverage(rAtK),
      harmful_injection_rate: macroAverage(harmRates),
      conflict_exposure_rate: macroAverage(conflictRates),
      budget_utilization: macroAverage(budgetRates),
      budget_drop_count: budgetDrops,
    };

    return {
      generated_at: new Date().toISOString(),
      gates: DEFAULT_GATES,
      metrics,
      per_case: perCase,
    };
  } finally {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* windows sqlite */
    }
  }
}

const args = parseArgs(process.argv.slice(2));
const report = runEval({ channel: args.channel });
const failures = evaluateGates(report.metrics);

console.log(
  JSON.stringify(
    {
      metrics: report.metrics,
      gate_failures: failures,
    },
    null,
    2,
  ),
);

const outPath =
  args.outPath ??
  (args.writeLatest ? join(root, "fixtures/eval/baselines/latest.json") : null);
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${outPath}`);
}

if (failures.length) {
  console.error(`FAIL eval gates:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS eval-recall gates");

export { runEval };
