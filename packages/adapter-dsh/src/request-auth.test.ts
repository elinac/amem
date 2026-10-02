import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { paths } from "@amem/core";
import { DshTokenStore } from "./auth-store.js";
import { BrowserSessionManager } from "./browser-session.js";
import { DshRequestAuth, readCsrfFromHeaders } from "./request-auth.js";

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

function setup(authEnabled: boolean) {
  const home = mkdtempSync(join(tmpdir(), "amem-request-auth-"));
  homes.push(home);
  mkdirSync(paths(home).auth, { recursive: true });
  const store = new DshTokenStore(home);
  const sessions = new BrowserSessionManager(
    home,
    {
      allowed_origins: ["http://127.0.0.1:3000"],
      session_ttl_minutes: 480,
      auth_failure_limit: 8,
    },
    store,
  );
  const auth = new DshRequestAuth(sessions, authEnabled);
  return { home, store, sessions, auth };
}

describe("DshRequestAuth", () => {
  it("auth-off allows mutating RPC when Sec-Fetch-Site is missing", () => {
    const { auth } = setup(false);
    const result = auth.authorizeRpc(
      {
        cookieHeader: undefined,
        origin: "http://127.0.0.1:3000",
        host: "127.0.0.1:3000",
      },
      "config:write",
    );
    expect(result.ok).toBe(true);
  });

  it("auth-off rejects mutating RPC with explicit cross-site Sec-Fetch-Site", () => {
    const { auth } = setup(false);
    const result = auth.authorizeRpc(
      {
        cookieHeader: undefined,
        origin: "http://127.0.0.1:3000",
        host: "127.0.0.1:3000",
        secFetchSite: "cross-site",
      },
      "config:write",
    );
    expect(result.ok).toBe(false);
  });

  it("auth-on accepts either CSRF header name for mutating RPC", () => {
    const { store, auth } = setup(true);
    const { token } = store.issue(["config:write", "config:read"], 60_000);
    const login = auth.login({
      bearer: token,
      origin: "http://127.0.0.1:3000",
      host: "127.0.0.1:3000",
    });
    expect(login.ok).toBe(true);
    if (!login.ok) throw new Error("login failed");

    const base = {
      cookieHeader: login.cookie,
      origin: "http://127.0.0.1:3000",
      host: "127.0.0.1:3000",
      secFetchSite: "same-origin" as const,
    };
    expect(auth.authorizeRpc({ ...base, csrf: login.csrfToken }, "config:write").ok).toBe(true);
    expect(auth.authorizeRpc({ ...base, csrfLegacy: login.csrfToken }, "config:write").ok).toBe(
      true,
    );
    expect(auth.authorizeRpc({ ...base }, "config:write").ok).toBe(false);
  });

  it("readCsrfFromHeaders prefers x-csrf-token over legacy", () => {
    expect(
      readCsrfFromHeaders({
        "x-csrf-token": "primary",
        "x-amem-csrf": "legacy",
      }),
    ).toEqual({ csrf: "primary", csrfLegacy: "legacy" });
  });
});
