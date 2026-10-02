import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configToToml, defaultConfig, paths } from "@amem/core";
import { createAdmin } from "./admin.js";
import { DshTokenStore, type DshAdminScope } from "./auth-store.js";
import { BrowserSessionManager, type RequestMeta } from "./browser-session.js";
import { dispatchRpc, getRpcMethodScope, isRpcMethod, RPC_METHODS } from "./rpc.js";
import { isMutating } from "./browser-session.js";

describe("rpc registry", () => {
  let home: string;
  const homes: string[] = [];

  afterEach(() => {
    for (const h of homes.splice(0)) {
      try {
        rmSync(h, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    if (home) {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  function setupAdmin() {
    home = mkdtempSync(join(tmpdir(), "amem-rpc-"));
    homes.push(home);
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig()));
    return { admin: createAdmin(home) };
  }

  function setupSession(origin = "http://127.0.0.1:3000") {
    mkdirSync(paths(home).auth, { recursive: true });
    const store = new DshTokenStore(home);
    const manager = new BrowserSessionManager(
      home,
      {
        allowed_origins: [origin],
        session_ttl_minutes: 480,
        auth_failure_limit: 8,
      },
      store,
    );
    const { token } = store.issue(
      [
        "memory:read",
        "memory:forget",
        "skill:read",
        "proposal:read",
        "proposal:apply",
        "ops:doctor",
        "ops:flush",
        "ops:rebuild",
        "ops:consolidate",
        "ops:compile",
        "config:read",
        "config:write",
      ],
      60 * 60 * 1000,
    );
    const login = manager.login({
      bearer: token,
      origin,
      host: new URL(origin).host,
    });
    expect(login.ok).toBe(true);
    if (!login.ok) throw new Error("login failed");

    const cookieMatch = login.cookie.match(/amem_dsh_session=([^;]+)/);
    expect(cookieMatch).toBeTruthy();
    const cookie = cookieMatch![1]!;

    const meta: RequestMeta = { origin, host: new URL(origin).host };
    const mutateMeta: RequestMeta = { origin, host: new URL(origin).host, secFetchSite: "same-origin" };

    return { manager, cookie, csrf: login.csrfToken, meta, mutateMeta };
  }

  function authFn(
    manager: BrowserSessionManager,
    cookie: string,
    csrf: string | undefined,
    meta: RequestMeta,
  ) {
    return (scope: DshAdminScope) => manager.authenticate(cookie, csrf, [scope], meta);
  }

  it("rejects unknown method with not_found", async () => {
    const { admin } = setupAdmin();
    const r = await dispatchRpc(
      admin,
      { id: "1", method: "memory.bogus", params: {} },
      { ok: true, tokenId: "t", scopes: ["memory:read"] },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("not_found");
  });

  it("accepts omitted params as empty object", async () => {
    const { admin } = setupAdmin();
    const skill = await dispatchRpc(
      admin,
      { id: "1", method: "skill.list" },
      { ok: true, tokenId: "t", scopes: ["skill:read"] },
    );
    expect(skill.ok).toBe(true);

    const memories = await dispatchRpc(
      admin,
      { id: "2", method: "memory.list" },
      { ok: true, tokenId: "t", scopes: ["memory:read"] },
    );
    expect(memories.ok).toBe(true);
  });

    it("rejects bad envelope", async () => {
    const { admin } = setupAdmin();
    const cases = [
      null,
      {},
      { id: "1" },
      { id: "", method: "memory.list", params: {} },
      { id: "1", method: "", params: {} },
      { id: 1, method: "memory.list", params: {} },
    ];
    for (const envelope of cases) {
      const r = await dispatchRpc(
        admin,
        envelope,
        { ok: true, tokenId: "t", scopes: ["memory:read"] },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_argument");
    }
  });

  it("rejects bad params", async () => {
    const { admin } = setupAdmin();
    const cases = [
      { id: "1", method: "memory.list", params: { page: 0 } },
      { id: "2", method: "memory.list", params: { pageSize: 99 } },
      { id: "3", method: "memory.list", params: { kind: "bogus" } },
      { id: "4", method: "memory.get", params: {} },
      { id: "5", method: "memory.get", params: { id: 123 } },
    ];
    for (const envelope of cases) {
      const r = await dispatchRpc(
        admin,
        envelope,
        { ok: true, tokenId: "t", scopes: ["memory:read"] },
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_argument");
    }
  });

  it("rejects insufficient scope", async () => {
    const { admin } = setupAdmin();
    const r = await dispatchRpc(
      admin,
      { id: "1", method: "memory.forget", params: { id: "x" } },
      { ok: true, tokenId: "t", scopes: ["memory:read"] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("permission_denied");
  });

  it("requires unauthenticated for missing session", async () => {
    const { admin } = setupAdmin();
    const r = await dispatchRpc(
      admin,
      { id: "1", method: "memory.list", params: {} },
      { ok: false, error: "unauthenticated" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unauthenticated");
  });

  it("read RPC does not require CSRF", async () => {
    const { admin } = setupAdmin();
    const { manager, cookie, meta } = setupSession();
    const r = await dispatchRpc(
      admin,
      { id: "1", method: "memory.list", params: {} },
      authFn(manager, cookie, undefined, meta),
    );
    expect(r.ok).toBe(true);
  });

  it("mutation RPC requires CSRF", async () => {
    const { admin } = setupAdmin();
    const { manager, cookie, meta, mutateMeta } = setupSession();

    const noCsrf = await dispatchRpc(
      admin,
      { id: "1", method: "memory.forget", params: { id: "x" } },
      (scope) => manager.authenticate(cookie, undefined, [scope], mutateMeta),
    );
    expect(noCsrf.ok).toBe(false);
    if (!noCsrf.ok) expect(noCsrf.error.code).toBe("unauthenticated");

    const wrongCsrf = await dispatchRpc(
      admin,
      { id: "2", method: "memory.forget", params: { id: "x" } },
      (scope) => manager.authenticate(cookie, "wrong", [scope], mutateMeta),
    );
    expect(wrongCsrf.ok).toBe(false);
    if (!wrongCsrf.ok) expect(wrongCsrf.error.code).toBe("unauthenticated");

    const csrfOnly = await dispatchRpc(
      admin,
      { id: "3", method: "memory.forget", params: { id: "x" } },
      authFn(manager, cookie, "csrf", mutateMeta),
    );
    // missing csrf token -> unauthenticated
    expect(csrfOnly.ok).toBe(false);
    if (!csrfOnly.ok) expect(csrfOnly.error.code).toBe("unauthenticated");
  });

  it("runs config.get and omits api_key", async () => {
    const { admin } = setupAdmin();
    const { manager, cookie, csrf, meta } = setupSession();
    const r = await dispatchRpc(
      admin,
      { id: "1", method: "config.get", params: {} },
      authFn(manager, cookie, csrf, meta),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cfg = r.result as {
      config: { llm: { api_key?: string; has_api_key: boolean; api_key_source: string } };
    };
    expect(cfg.config.llm.api_key).toBeUndefined();
    expect(typeof cfg.config.llm.has_api_key).toBe("boolean");
    expect(["inline", "env", "none"]).toContain(cfg.config.llm.api_key_source);
  });

  it("maps admin not_found without stack leak", async () => {
    const { admin } = setupAdmin();
    const { manager, cookie, csrf, meta } = setupSession();
    const r = await dispatchRpc(
      admin,
      { id: "1", method: "memory.get", params: { id: "missing" } },
      authFn(manager, cookie, csrf, meta),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("not_found");
      expect(JSON.stringify(r.error)).not.toContain("at ");
      expect(JSON.stringify(r.error)).not.toContain(".ts:");
    }
  });

  it("does not expose stack on unexpected errors", async () => {
    const { admin } = setupAdmin();
    const brokenAdmin = { ...admin };
    // Force an internal error by replacing listSkills with a thrower.
    Object.defineProperty(brokenAdmin, "listSkills", {
      value: () => {
        const e = new Error("boom");
        e.stack = "boom\n  at secret.ts:1:1";
        throw e;
      },
    });

    const { manager, cookie, csrf, meta } = setupSession();
    const r = await dispatchRpc(
      brokenAdmin as ReturnType<typeof createAdmin>,
      { id: "1", method: "skill.list", params: {} },
      authFn(manager, cookie, csrf, meta),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("internal");
      expect(JSON.stringify(r.error)).not.toContain("secret.ts");
      expect(r.error.message).toBe("internal error");
    }
  });

  it("exposes fixed method registry", () => {
    expect(isRpcMethod("memory.list")).toBe(true);
    expect(isRpcMethod("conflict.list")).toBe(false);
    expect(isRpcMethod("ops.doctor")).toBe(true);
    expect(isRpcMethod("config.put")).toBe(true);
  });

  it("derives mutating from scope for every registry method", () => {
    const expected: Record<(typeof RPC_METHODS)[number], boolean> = {
      "memory.list": false,
      "memory.get": false,
      "memory.forget": true,
      "skill.list": false,
      "proposal.list": false,
      "proposal.apply": true,
      "ops.doctor": false,
      "ops.failed.list": false,
      "ops.failed.purge": true,
      "ops.flush": true,
      "ops.rebuild": true,
      "ops.consolidate": true,
      "ops.compile": true,
      "config.get": false,
      "config.put": true,
    };
    for (const method of RPC_METHODS) {
      expect(isMutating([getRpcMethodScope(method)]), method).toBe(expected[method]);
    }
  });
});
