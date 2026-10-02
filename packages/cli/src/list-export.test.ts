import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type MemoryRecord, newId, paths } from "@amem/core";
import { MemoryStore } from "@amem/store";
import { afterEach, describe, expect, it } from "vitest";
import { parseDurationMs, runAuthIssue, runAuthList, runAuthRevoke } from "./bin.js";
import { runExport } from "./export.js";
import { runList } from "./list.js";

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

describe("auth cli", () => {
  let home: string;

  afterEach(() => {
    if (home) {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  function setup(): string {
    home = mkdtempSync(join(tmpdir(), "amem-cli-auth-"));
    mkdirSync(paths(home).auth, { recursive: true });
    return home;
  }

  it("parses m/h/d and rejects invalid durations", () => {
    expect(parseDurationMs("30m")).toBe(30 * 60_000);
    expect(parseDurationMs("8h")).toBe(8 * 3_600_000);
    expect(parseDurationMs("1d")).toBe(86_400_000);
    expect(parseDurationMs("365d")).toBe(365 * 86_400_000);

    expect(() => parseDurationMs("0m")).toThrow();
    expect(() => parseDurationMs("-1h")).toThrow();
    expect(() => parseDurationMs("366d")).toThrow();
    expect(() => parseDurationMs("8")).toThrow();
    expect(() => parseDurationMs("abc")).toThrow();
  });

  it("issues a token and list/revoke work", () => {
    home = setup();
    const { token, record } = runAuthIssue(home, "dsh", "memory:read,config:read", "8h");
    expect(token).toBeTruthy();
    expect(record.scopes).toEqual(["memory:read", "config:read"]);

    const raw = readFileSync(paths(home).dshTokens, "utf8");
    expect(raw).not.toContain(token);

    const list = runAuthList(home);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(record.id);
    expect(list[0]!).not.toHaveProperty("hash");

    const revoked = runAuthRevoke(home, record.id);
    expect(revoked).toBe(true);
    expect(runAuthList(home)[0]!.revokedAt).toBeTruthy();
    expect(runAuthRevoke(home, "missing")).toBe(false);
  });
});
