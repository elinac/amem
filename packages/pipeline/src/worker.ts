import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteJson, loadConfig, paths, sanitizeId } from "@amem/core";
import { extractSession } from "./extract.js";

export function enqueueFlush(home: string, sessionId: string): string {
  const dir = paths(home).queue;
  mkdirSync(dir, { recursive: true });
  const sid = sanitizeId(sessionId);
  const file = join(dir, `flush-${sid}-${Date.now()}.json`);
  atomicWriteJson(file, {
    type: "flush",
    sessionId: sid,
    at: new Date().toISOString(),
  });
  return file;
}

function isPendingJob(name: string): boolean {
  return name.endsWith(".json") && !name.startsWith(".");
}

/** Extraction failures used to be swallowed; they are now logged and dead-lettered. */
function logFailure(home: string, job: string, detail: string): void {
  try {
    const dir = paths(home).logs;
    mkdirSync(dir, { recursive: true });
    const line = `${new Date().toISOString()} extract failed job=${job}\n${detail}\n`;
    appendFileSync(join(dir, "amem.log"), line);
    process.stderr.write(`[amem] extract failed job=${job}: ${detail.split("\n")[0]}\n`);
  } catch {
    /* fail-open: logging must never break the worker */
  }
}

export async function processQueue(home: string): Promise<number> {
  const dir = paths(home).queue;
  if (!existsSync(dir)) return 0;
  const cfg = loadConfig(home);
  let n = 0;
  for (const f of readdirSync(dir).filter(isPendingJob)) {
    const p = join(dir, f);
    const claimed = join(dir, `.claim-${process.pid}-${Date.now()}-${f}`);
    try {
      renameSync(p, claimed);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EEXIST") continue;
      throw e;
    }
    try {
      const job = JSON.parse(readFileSync(claimed, "utf8")) as { type: string; sessionId: string };
      if (job.type === "flush") {
        await extractSession(home, sanitizeId(job.sessionId), cfg);
        n += 1;
      }
      rmSync(claimed, { force: true });
    } catch (e) {
      const detail = e instanceof Error ? (e.stack ?? e.message) : String(e);
      logFailure(home, f, detail);
      try {
        const failedDir = join(dir, "failed");
        mkdirSync(failedDir, { recursive: true });
        renameSync(claimed, join(failedDir, f));
      } catch {
        rmSync(claimed, { force: true });
      }
    }
  }
  return n;
}
