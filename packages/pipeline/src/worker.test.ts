import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configToToml, defaultConfig } from "@amem/core";

vi.mock("./extract.js", () => ({
  extractSession: vi.fn(async () => ({ written: [] as string[] })),
}));

import { extractSession } from "./extract.js";
import { createFlushJob, enqueueFlush, parseFlushJob, processQueue } from "./worker.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
  vi.mocked(extractSession).mockClear();
});

function setupHome(): string {
  const home = mkdtempSync(join(tmpdir(), "amem-worker-"));
  homes.push(home);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig()));
  return home;
}

describe("FlushJob schema", () => {
  it("createFlushJob and parseFlushJob round-trip", () => {
    const job = createFlushJob("s1", "2026-10-02T00:00:00.000Z");
    expect(parseFlushJob(job)).toEqual(job);
  });

  it("rejects malformed jobs", () => {
    expect(() => parseFlushJob(null)).toThrow(/object/);
    expect(() => parseFlushJob({ type: "other", sessionId: "s", at: "t" })).toThrow(/type/);
    expect(() => parseFlushJob({ type: "flush", sessionId: "", at: "t" })).toThrow(/sessionId/);
    expect(() => parseFlushJob({ type: "flush", sessionId: "s" })).toThrow(/at/);
  });

  it("enqueueFlush writes the canonical shape", () => {
    const home = setupHome();
    const file = enqueueFlush(home, "session-a");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    expect(parseFlushJob(raw).type).toBe("flush");
    expect(raw.sessionId).toBe("session-a");
    expect(typeof raw.at).toBe("string");
  });
});

describe("processQueue", () => {
  it("does not throw when cleanup runs twice (force rm)", async () => {
    const home = setupHome();
    const dir = join(home, "queue");
    mkdirSync(dir, { recursive: true });
    const jobPath = join(dir, "flush-s1-1.json");
    writeFileSync(jobPath, JSON.stringify(createFlushJob("s1")));
    await expect(processQueue(home)).resolves.toBe(1);
    await expect(processQueue(home)).resolves.toBe(0);
  });

  it("skips dot-claim leftovers and sanitizes unsafe session ids", async () => {
    const home = setupHome();
    const dir = join(home, "queue");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".claim-1-2-flush-old.json"),
      JSON.stringify(createFlushJob("old")),
    );
    writeFileSync(
      join(dir, "flush-evil-1.json"),
      JSON.stringify(createFlushJob("../../../../tmp/evil")),
    );
    await expect(processQueue(home)).resolves.toBe(1);
    expect(extractSession).toHaveBeenCalledTimes(1);
    const sid = vi.mocked(extractSession).mock.calls[0]![1];
    expect(sid).toMatch(/^sid_[a-f0-9]{12}$/);
    expect(sid).not.toContain("..");
  });

  it("logs and dead-letters a failing extraction instead of dropping it silently", async () => {
    const home = setupHome();
    const dir = join(home, "queue");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "flush-s1-7.json"), JSON.stringify(createFlushJob("s1")));
    vi.mocked(extractSession).mockRejectedValueOnce(new Error("llm http 400"));

    await expect(processQueue(home)).resolves.toBe(0);
    expect(existsSync(join(dir, "failed", "flush-s1-7.json"))).toBe(true);
    const log = readFileSync(join(home, "logs", "amem.log"), "utf8");
    expect(log).toContain("extract failed job=flush-s1-7.json");
    expect(log).toContain("llm http 400");

    await expect(processQueue(home)).resolves.toBe(0);
    expect(extractSession).toHaveBeenCalledTimes(1);
  });

  it("dead-letters jobs that fail FlushJob schema validation", async () => {
    const home = setupHome();
    const dir = join(home, "queue");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "flush-bad-1.json"), JSON.stringify({ type: "flush", sessionId: "s1" }));
    await expect(processQueue(home)).resolves.toBe(0);
    expect(existsSync(join(dir, "failed", "flush-bad-1.json"))).toBe(true);
    expect(extractSession).not.toHaveBeenCalled();
    const log = readFileSync(join(home, "logs", "amem.log"), "utf8");
    expect(log).toContain("flush job at");
  });
});
