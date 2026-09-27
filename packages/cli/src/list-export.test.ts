import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { newId, type MemoryRecord } from "@amem/core";
import { MemoryStore } from "@amem/store";
import { runList } from "./list.js";
import { runExport } from "./export.js";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) {
    try {
      rmSync(h, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("list + export", () => {
  it("lists memories and exports a skill zip", () => {
    const home = mkdtempSync(join(tmpdir(), "amem-cli-"));
    homes.push(home);
    mkdirSync(join(home, "capabilities", "skills", "fix-port"), { recursive: true });
    writeFileSync(
      join(home, "capabilities", "skills", "fix-port", "SKILL.md"),
      "---\nname: fix-port\ndescription: fix port conflicts\n---\n\nsteps\n",
    );
    writeFileSync(
      join(home, "capabilities", "skills", "fix-port", "capability.yaml"),
      "id: fix-port\nversion: 0.1.0\n",
    );
    const mem: MemoryRecord = {
      id: newId("mem"),
      kind: "failure",
      title: "port in use",
      content: "check process",
      applies_when: "dev fails",
      scope: { level: "domain", tags: { user: "u" } },
      trust: "T3",
      status: "active",
      evidence: { episodes: [], count: 1, distinct_instances: 1, distinct_domains: 1 },
      stats: { recalled: 0, adopted: 0, helpful: 1, harmful: 0, lift: 0 },
      validity: { depends_on: [], valid_from: "2026-01-01" },
      created_by: "t",
      updated_at: new Date().toISOString(),
    };
    new MemoryStore(home).write(mem);

    // should not throw
    runList(home, "all");

    const zip = join(home, "out.zip");
    const r = runExport(home, { skills: "fix-port", out: zip, memories: true });
    expect(r.items).toContain("skills/fix-port");
    expect(r.items.some((i) => i.startsWith("memories/"))).toBe(true);
    expect(existsSync(zip)).toBe(true);
  });
});
