import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configToToml, defaultConfig } from "@amem/core";

vi.mock("./extract.js", () => ({
  extractSession: vi.fn(async () => ({ written: [] as string[] })),
}));

import { extractSession } from "./extract.js";
import { processQueue } from "./worker.js";

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

describe("processQueue", () => {
  it("does not throw when cleanup runs twice (force rm)", async () => {
    const home = setupHome();
    const dir = join(home, "queue");
    mkdirSync(dir, { recursive: true });
    const jobPath = join(dir, "flush-s1-1.json");
    writeFileSync(
      jobPath,
      JSON.stringify({ type: "flush", sessionId: "s1", at: new Date().toISOString() }),
    );
    await expect(processQueue(home)).resolves.toBe(1);
    await expect(processQueue(home)).resolves.toBe(0);
  });

  it("skips dot-claim leftovers and sanitizes unsafe session ids", async () => {
    const home = setupHome();
    const dir = join(home, "queue");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ".claim-1-2-flush-old.json"),
      JSON.stringify({ type: "flush", sessionId: "old" }),
    );
    writeFileSync(
      join(dir, "flush-evil-1.json"),
      JSON.stringify({ type: "flush", sessionId: "../../../../tmp/evil" }),
    );
    await expect(processQueue(home)).resolves.toBe(1);
    expect(extractSession).toHaveBeenCalledTimes(1);
    const sid = vi.mocked(extractSession).mock.calls[0]![1];
    expect(sid).toMatch(/^sid_[a-f0-9]{12}$/);
    expect(sid).not.toContain("..");
  });
});
