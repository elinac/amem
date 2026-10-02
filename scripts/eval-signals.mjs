#!/usr/bin/env node
/**
 * Offline contingency: recalled × feedback label (Phase 2).
 * Does not change production lift / promotion formulas.
 *
 * Usage:
 *   node scripts/eval-signals.mjs --signals fixtures/eval/signals/v0.example.jsonl
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  let signals = join(root, "fixtures/eval/signals/v0.example.jsonl");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--signals") signals = resolve(root, argv[++i] ?? signals);
  }
  return { signals };
}

function loadJsonl(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const { signals: path } = parseArgs(process.argv.slice(2));
const rows = loadJsonl(path);

const labels = ["helpful", "unhelpful", "harmful"];
/** @type {Record<string, Record<string, number>>} */
const table = {
  recalled: Object.fromEntries(labels.map((l) => [l, 0])),
  not_recalled: Object.fromEntries(labels.map((l) => [l, 0])),
};

let skipped = 0;
for (const row of rows) {
  const label = row.label;
  if (!labels.includes(label)) {
    skipped += 1;
    continue;
  }
  const bucket = row.recalled ? "recalled" : "not_recalled";
  table[bucket][label] += 1;
}

const recalledN = Object.values(table.recalled).reduce((a, b) => a + b, 0);
const notN = Object.values(table.not_recalled).reduce((a, b) => a + b, 0);
const helpfulGivenRecalled =
  recalledN === 0 ? 0 : table.recalled.helpful / recalledN;
const harmfulGivenRecalled =
  recalledN === 0 ? 0 : table.recalled.harmful / recalledN;

const report = {
  signals_path: path,
  n: rows.length,
  skipped_unknown_label: skipped,
  contingency: table,
  rates: {
    p_helpful_given_recalled: helpfulGivenRecalled,
    p_harmful_given_recalled: harmfulGivenRecalled,
    recalled_share: rows.length ? recalledN / (recalledN + notN) : 0,
  },
  note: "Offline association only; does not modify online lift or promotion.",
};

console.log(JSON.stringify(report, null, 2));
console.log("PASS eval-signals");
