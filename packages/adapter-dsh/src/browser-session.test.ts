import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { paths } from "@amem/core";
import { DshTokenStore } from "./auth-store.js";
import {
  BrowserSessionManager,
  isMutating,
  type LoginInput,
  type RequestMeta,
} from "./browser-session.js";

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

function setup(): { home: string; store: DshTokenStore; manager: BrowserSessionManager } {
  const home = mkdtempSync(join(tmpdir(), "amem-browser-session-"));
  homes.push(home);
  mkdirSync(paths(home).auth, { recursive: true });
  const store = new DshTokenStore(home);
  const manager = new BrowserSessionManager(home, {
    allowed_origins: ["http://127.0.0.1:3000", "http://localhost:3000", "https://example.com"],
    session_ttl_minutes: 480,
    auth_failure_limit: 3,
  }, store);
  return { home, store, manager };
}

function loginMeta(origin = "http://127.0.0.1:3000", secFetchSite?: string): RequestMeta {
  return { origin, host: new URL(origin).host, secFetchSite };
}

function mutateMeta(origin = "http://127.0.0.1:3000"): RequestMeta {
  return { origin, host: new URL(origin).host, secFetchSite: "same-origin" };
}

function cookieValue(cookie: string): string {
  const m = cookie.match(/amem_dsh_session=([^;]+)/);
  expect(m).toBeTruthy();
  return m![1]!;
}

describe("isMutating", () => {
  it("returns false for read scopes", () => {
    expect(isMutating(["memory:read"])).toBe(false);
    expect(isMutating(["skill:read", "proposal:read", "config:read", "ops:doctor"])).toBe(false);
    expect(isMutating([])).toBe(false);
  });

  it("returns true for mutating scopes", () => {
    expect(isMutating(["memory:forget"])).toBe(true);
    expect(isMutating(["memory:resolve-conflict"])).toBe(true);
    expect(isMutating(["proposal:apply"])).toBe(true);
    expect(isMutating(["ops:flush"])).toBe(true);
    expect(isMutating(["ops:rebuild"])).toBe(true);
    expect(isMutating(["ops:consolidate"])).toBe(true);
    expect(isMutating(["ops:compile"])).toBe(true);
    expect(isMutating(["config:write"])).toBe(true);
  });

  it("returns true for mixed read and mutating scopes", () => {
    expect(isMutating(["memory:read", "memory:forget"])).toBe(true);
  });
});

describe("BrowserSessionManager", () => {
  it("exchanges a bearer for an HttpOnly Strict cookie and csrf token", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read", "config:write"], 60 * 60 * 1000);

    const result = manager.login({ bearer: token, ...loginMeta() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.cookie).toContain("amem_dsh_session=");
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Strict");
    expect(result.cookie).toContain("Path=/amem-api");
    expect(result.cookie).toMatch(/Max-Age=\d+/);
    expect(result.cookie).not.toContain("Secure");
    expect(result.csrfToken).toBeTruthy();
    expect(result.csrfToken.length).toBeGreaterThanOrEqual(32);
    expect(result.scopes).toEqual(["memory:read", "config:write"]);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("adds Secure attribute for HTTPS origins", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read"], 60 * 60 * 1000);
    const origin = "https://example.com";
    const result = manager.login({
      bearer: token,
      origin,
      host: "example.com",
      clientKey: "https-example",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cookie).toContain("Secure");
  });

  it("caps session expiry by token expiry and configured ttl", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read"], 5 * 60 * 1000);
    const before = Date.now();
    const result = manager.login({ bearer: token, ...loginMeta() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Date(result.expiresAt).getTime()).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 1000);

    const longToken = store.issue(["memory:read"], 24 * 60 * 60 * 1000);
    const result2 = manager.login({ bearer: longToken.token, ...loginMeta() });
    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    expect(new Date(result2.expiresAt).getTime()).toBeLessThanOrEqual(before + 480 * 60 * 1000 + 5000);
  });

  it("rejects origin, host and sec-fetch-site mismatches", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read", "config:write"], 60 * 60 * 1000);

    expect(manager.login({ bearer: token, origin: "http://evil.com", host: "evil.com" }).ok).toBe(false);
    expect(manager.login({ bearer: token, origin: "http://127.0.0.1:3000", host: "localhost:3000" }).ok).toBe(false);

    const ok = manager.login({ bearer: token, ...loginMeta() });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;

    const read = manager.authenticate(cookieValue(ok.cookie), undefined, ["memory:read"], loginMeta());
    expect(read.ok).toBe(true);

    const crossSite = manager.authenticate(
      cookieValue(ok.cookie),
      ok.csrfToken,
      ["config:write"],
      { origin: "http://127.0.0.1:3000", host: "127.0.0.1:3000", secFetchSite: "cross-site" },
    );
    expect(crossSite.ok).toBe(false);

    const sameOriginMutate = manager.authenticate(
      cookieValue(ok.cookie),
      ok.csrfToken,
      ["config:write"],
      mutateMeta(),
    );
    expect(sameOriginMutate.ok).toBe(true);
  });

  it("requires csrf for mutating RPC but not read RPC", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read", "config:write"], 60 * 60 * 1000);
    const login = manager.login({ bearer: token, ...loginMeta() });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const cookie = cookieValue(login.cookie);

    const read = manager.authenticate(cookie, undefined, ["memory:read"], loginMeta());
    expect(read.ok).toBe(true);

    const mutateNoCsrf = manager.authenticate(cookie, undefined, ["config:write"], mutateMeta());
    expect(mutateNoCsrf.ok).toBe(false);

    const mutateWrongCsrf = manager.authenticate(cookie, "wrong-csrf", ["config:write"], mutateMeta());
    expect(mutateWrongCsrf.ok).toBe(false);

    const mutateOk = manager.authenticate(cookie, login.csrfToken, ["config:write"], mutateMeta());
    expect(mutateOk.ok).toBe(true);
  });

  it("issues fresh csrf tokens for valid sessions", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read", "memory:forget"], 60 * 60 * 1000);
    const login = manager.login({ bearer: token, ...loginMeta() });
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const fresh = manager.issueCsrf(cookieValue(login.cookie), loginMeta());
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.csrfToken).not.toBe(login.csrfToken);

    const mutate = manager.authenticate(cookieValue(login.cookie), fresh.csrfToken, ["memory:forget"], mutateMeta());
    expect(mutate.ok).toBe(true);
  });

  it("invalidates sessions after token revocation", () => {
    const { store, manager } = setup();
    const { token, record } = store.issue(["memory:read"], 60 * 60 * 1000);
    const login = manager.login({ bearer: token, ...loginMeta() });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const cookie = cookieValue(login.cookie);

    expect(manager.authenticate(cookie, undefined, ["memory:read"], loginMeta()).ok).toBe(true);

    manager.revokeToken(record.id);
    expect(manager.authenticate(cookie, undefined, ["memory:read"], loginMeta()).ok).toBe(false);

    const freshCsrf = manager.issueCsrf(cookie, loginMeta());
    expect(freshCsrf.ok).toBe(false);
  });

  it("invalidates sessions after store-level token revoke", () => {
    const { store, manager } = setup();
    const { token, record } = store.issue(["memory:read"], 60 * 60 * 1000);
    const login = manager.login({ bearer: token, ...loginMeta() });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const cookie = cookieValue(login.cookie);

    expect(store.revoke(record.id)).toBe(true);
    expect(manager.authenticate(cookie, undefined, ["memory:read"], loginMeta()).ok).toBe(false);
    expect(manager.issueCsrf(cookie, loginMeta()).ok).toBe(false);
  });

  it("logs out sessions", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read"], 60 * 60 * 1000);
    const login = manager.login({ bearer: token, ...loginMeta() });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const cookie = cookieValue(login.cookie);

    manager.logout(cookie);
    expect(manager.authenticate(cookie, undefined, ["memory:read"], loginMeta()).ok).toBe(false);
  });

  it("rate-limits repeated failed login attempts without token oracle", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read"], 60 * 60 * 1000);

    for (let i = 0; i < 3; i++) {
      const r = manager.login({ bearer: "invalid-token", ...loginMeta() });
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.error).toBe("unauthenticated");
    }

    const rateLimited = manager.login({ bearer: token, ...loginMeta() });
    expect(rateLimited.ok).toBe(false);
    expect(rateLimited.ok === false && rateLimited.error).toBe("unauthenticated");

    expect(manager.login({ bearer: "invalid-token", ...loginMeta() }).ok).toBe(false);
  });

  it("clears failure counter on successful login", () => {
    const { store, manager } = setup();
    const { token } = store.issue(["memory:read"], 60 * 60 * 1000);

    for (let i = 0; i < 2; i++) {
      expect(manager.login({ bearer: "invalid-token", ...loginMeta() }).ok).toBe(false);
    }

    const success = manager.login({ bearer: token, ...loginMeta() });
    expect(success.ok).toBe(true);

    for (let i = 0; i < 2; i++) {
      expect(manager.login({ bearer: "invalid-token", ...loginMeta() }).ok).toBe(false);
    }

    const stillOk = manager.login({ bearer: token, ...loginMeta() });
    expect(stillOk.ok).toBe(true);
  });
});
