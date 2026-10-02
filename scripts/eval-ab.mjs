#!/usr/bin/env node
/**
 * Offline A/B compare for recall eval baselines (Phase 2).
 *
 * Usage:
 *   node scripts/eval-ab.mjs --baseline fixtures/eval/baselines/v0.json --candidate fixtures/eval/baselines/latest.json
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_GATES } from "./lib/eval-metrics.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  let baseline = null;
  let candidate = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--baseline") baseline = argv[++i];
    else if (argv[i] === "--candidate") candidate = argv[++i];
  }
  if (!baseline || !candidate) {
    throw new Error("usage: eval-ab --baseline <path> --candidate <path>");
  }
  return {
    baseline: resolve(root, baseline),
    candidate: resolve(root, candidate),
  };
}

function loadReport(path) {
  const j = JSON.parse(readFileSync(path, "utf8"));
  if (!j.metrics?.precision_at_k && j.metrics?.precision_at_k !== 0) {
    throw new Error(`missing metrics.precision_at_k in ${path}`);
  }
  return j;
}

const args = parseArgs(process.argv.slice(2));
const base = loadReport(args.baseline);
const cand = loadReport(args.candidate);
const gates = { ...DEFAULT_GATES, ...(base.gates ?? {}) };

const deltaP = cand.metrics.precision_at_k - base.metrics.precision_at_k;
const deltaHarm =
  cand.metrics.harmful_injection_rate - base.metrics.harmful_injection_rate;

const failures = [];
if (deltaP <= gates.rollbackDeltaPrecision) {
  failures.push(
    `Δprecision_at_k ${deltaP.toFixed(3)} <= ${gates.rollbackDeltaPrecision} (rollback)`,
  );
}
if (deltaHarm > gates.rollbackHarmfulAbsIncrease) {
  failures.push(
    `Δharmful_injection_rate +${deltaHarm.toFixed(3)} > ${gates.rollbackHarmfulAbsIncrease}`,
  );
}

const summary = {
  baseline: args.baseline,
  candidate: args.candidate,
  baseline_metrics: base.metrics,
  candidate_metrics: cand.metrics,
  delta: {
    precision_at_k: deltaP,
    harmful_injection_rate: deltaHarm,
    recall_at_k: cand.metrics.recall_at_k - base.metrics.recall_at_k,
    conflict_exposure_rate:
      cand.metrics.conflict_exposure_rate - base.metrics.conflict_exposure_rate,
  },
  failures,
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  console.error(`FAIL eval-ab:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("PASS eval-ab");
