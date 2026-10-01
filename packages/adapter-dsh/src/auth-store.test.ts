import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { paths } from "@amem/core";
import { DshTokenStore } from "./auth-store.js";

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

function setup(): string {
  const home = mkdtempSync(join(tmpdir(), "amem-auth-"));
  homes.push(home);
  mkdirSync(paths(home).auth, { recursive: true });
  return home;
}

describe("DshTokenStore", () => {
  it("stores only a token hash and verifies the raw token", () => {
    const home = setup();
    const store = new DshTokenStore(home);
    const { token, record } = store.issue(["memory:read"], 60 * 60 * 1000);

    const raw = readFileSync(paths(home).dshTokens, "utf8");
    expect(raw).not.toContain(token);
    expect(JSON.parse(raw).version).toBe(1);

    const verified = store.verify(token);
    expect(verified).toEqual({ id: record.id, scopes: ["memory:read"] });
  });

  it("rejects expired and revoked tokens", async () => {
    const home = setup();
    const store = new DshTokenStore(home);

    const expired = store.issue(["memory:read"], 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(store.verify(expired.token)).toBeNull();

    const revoked = store.issue(["config:read"], 60 * 60 * 1000);
    expect(store.revoke(revoked.record.id)).toBe(true);
    expect(store.verify(revoked.token)).toBeNull();

    expect(store.revoke("missing-id")).toBe(false);
  });

  it("never returns the raw token from list", () => {
    const home = setup();
    const store = new DshTokenStore(home);
    const { token, record } = store.issue(["memory:read", "config:read"], 60 * 60 * 1000);

    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(record.id);
    expect(list[0]!.scopes).toEqual(["memory:read", "config:read"]);

    const raw = JSON.stringify(list);
    expect(raw).not.toContain(token);
    expect(list[0]).not.toHaveProperty("hash");
  });

  it("rejects unknown and duplicate scopes", () => {
    const home = setup();
    const store = new DshTokenStore(home);

    expect(() => store.issue(["unknown:scope" as any], 60 * 60 * 1000)).toThrow();
    expect(() => store.issue(["memory:read", "memory:read"], 60 * 60 * 1000)).toThrow();
    expect(store.list()).toHaveLength(0);
  });

  it("survives two sequential store instances", () => {
    const home = setup();
    const store1 = new DshTokenStore(home);
    const { token, record } = store1.issue(["memory:read"], 60 * 60 * 1000);

    const store2 = new DshTokenStore(home);
    expect(store2.verify(token)).toEqual({ id: record.id, scopes: ["memory:read"] });
    expect(store2.list()).toHaveLength(1);
  });

  it("refuses to overwrite a corrupt token store", () => {
    const home = setup();
    writeFileSync(paths(home).dshTokens, "{not-json", "utf8");
    const store = new DshTokenStore(home);
    expect(() => store.issue(["memory:read"], 60 * 60 * 1000)).toThrow(/corrupt/);
    expect(readFileSync(paths(home).dshTokens, "utf8")).toBe("{not-json");
  });

  it("skips records with missing hash during verify", () => {
    const home = setup();
    const store = new DshTokenStore(home);
    const { token } = store.issue(["memory:read"], 60 * 60 * 1000);
    const file = JSON.parse(readFileSync(paths(home).dshTokens, "utf8"));
    delete file.tokens[0].hash;
    writeFileSync(paths(home).dshTokens, JSON.stringify(file), "utf8");
    expect(store.verify(token)).toBeNull();
  });
});
