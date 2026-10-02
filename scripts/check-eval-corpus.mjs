#!/usr/bin/env node
/**
 * Guardrails for fixtures/eval corpus + judgments (Phase 2).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { containsSecrets, redactDeep } from "../packages/core/dist/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const memPath = join(root, "fixtures/eval/corpus/v0/memories.jsonl");
const judPath = join(root, "fixtures/eval/judgments/v0.jsonl");

function loadJsonl(path) {
  if (!existsSync(path)) throw new Error(`missing ${path}`);
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (e) {
        throw new Error(`${path}:${i + 1} invalid JSON: ${e.message}`);
      }
    });
}

const memories = loadJsonl(memPath);
const judgments = loadJsonl(judPath);
if (memories.length < 30) throw new Error(`need ≥30 memories, got ${memories.length}`);
if (judgments.length < 50) throw new Error(`need ≥50 judgments, got ${judgments.length}`);

for (const m of memories) {
  for (const field of ["title", "content", "applies_when"]) {
    const text = String(m[field] ?? "");
    if (containsSecrets(text)) {
      throw new Error(`secret-like text in ${m.id}.${field}: ${text.slice(0, 80)}`);
    }
  }
}

const poisoned = {
  api_key: "sk-thisisafakesecretkey12",
  note: "contact user@example.com",
};
const cleaned = redactDeep(poisoned);
if (JSON.stringify(cleaned).includes("sk-thisisafakesecretkey12")) {
  throw new Error("redactDeep failed to mask api_key-like value");
}
if (JSON.stringify(cleaned).includes("user@example.com")) {
  throw new Error("redactDeep failed to mask email");
}

console.log(
  `PASS eval corpus check memories=${memories.length} judgments=${judgments.length}`,
);
