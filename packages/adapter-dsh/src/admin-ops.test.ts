// packages/adapter-dsh/src/admin-ops.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configToToml, defaultConfig } from "@amem/core";
import { writeFileSync, mkdirSync } from "node:fs";
import { createAdmin } from "./admin.js";

describe("admin ops", () => {
  let home: string;
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function setupHome(): string {
    home = mkdtempSync(join(tmpdir(), "amem-ops-"));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig()));
    return home;
  }

  it("doctor reports home and config", () => {
    const h = setupHome();
    const r = createAdmin(h).doctor();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { home: string; checks: unknown[] };
    expect(data.home).toBe(h);
    expect(data.checks.some((c) => Array.isArray(c) && c[0] === "config" && c[1] === true)).toBe(true);
  });

  it("flush rejects path-like sessionId", async () => {
    const h = setupHome();
    const r = await createAdmin(h).flush("../evil");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it("flush treats blank as manual", async () => {
    const h = setupHome();
    const r = await createAdmin(h).flush("  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { queued: string };
    expect(data.queued).toContain("flush-manual-");
  });

  it("consolidate dryRun returns promotion", () => {
    const h = setupHome();
    const r = createAdmin(h).consolidate(true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.data as { dryRun: boolean }).dryRun).toBe(true);
  });

  it("rebuildIndex returns indexed count", () => {
    const h = setupHome();
    const r = createAdmin(h).rebuildIndex();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof (r.data as { indexed: number }).indexed).toBe("number");
  });

  it("compile rejects non-dsh target", () => {
    const h = setupHome();
    const r = createAdmin(h).compile("cursor");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it("compile dsh succeeds with empty skills", () => {
    const h = setupHome();
    const r = createAdmin(h).compile("dsh");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray((r.data as { written: string[] }).written)).toBe(true);
  });
});
