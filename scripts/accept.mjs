#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(label, args) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(pnpm, args, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("build", ["-r", "run", "build"]);
run("accept:p0", ["accept:p0"]);
run("accept:p1", ["accept:p1"]);
run("accept:p2", ["accept:p2"]);
console.log("\nALL ACCEPTANCE GATES PASSED");
