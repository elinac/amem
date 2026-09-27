import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { type CanonicalEvent, sanitizeId } from "@amem/core";

export function appendCanonical(
  amemHome: string,
  sessionId: string,
  events: CanonicalEvent[],
): void {
  if (!events.length) return;
  const sid = sanitizeId(sessionId);
  const spoolDir = join(amemHome, "spool");
  mkdirSync(spoolDir, { recursive: true });
  const spool = join(spoolDir, `${sid}.jsonl`);
  for (const ev of events) {
    appendFileSync(spool, `${JSON.stringify(ev)}\n`);
  }
}

export function enqueueFlush(amemHome: string, sessionId: string): string {
  const sid = sanitizeId(sessionId);
  const qdir = join(amemHome, "queue");
  mkdirSync(qdir, { recursive: true });
  const file = join(qdir, `flush-${sid}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ type: "flush", sessionId: sid }));
  return file;
}

export function wakeWorker(amemHome: string, cliPath?: string): void {
  if (!cliPath || !existsSync(cliPath)) return;
  try {
    const child = spawn(process.execPath, [cliPath, "worker"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, AMEM_HOME: amemHome },
    });
    child.unref();
  } catch {
    /* fail-open */
  }
}
