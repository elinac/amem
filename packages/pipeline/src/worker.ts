import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { loadConfig, paths, sanitizeId } from "@amem/core";
import { extractSession } from "./extract.js";

export function enqueueFlush(home: string, sessionId: string): string {
  const dir = paths(home).queue;
  mkdirSync(dir, { recursive: true });
  const sid = sanitizeId(sessionId);
  const file = join(dir, `flush-${sid}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ type: "flush", sessionId: sid, at: new Date().toISOString() }));
  return file;
}

function isPendingJob(name: string): boolean {
  return name.endsWith(".json") && !name.startsWith(".");
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
    } catch {
      // leave job for retry? for now drop
    }
    rmSync(claimed, { force: true });
  }
  return n;
}
