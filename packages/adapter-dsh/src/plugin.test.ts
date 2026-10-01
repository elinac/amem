import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configToToml, defaultConfig, paths } from "@amem/core";
import { DshTokenStore } from "./auth-store.js";
import { apply, type DshPluginContext } from "./plugin.js";

type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

function mockReq(
  method: string,
  url: string,
  opts: { body?: string; headers?: Record<string, string> } = {},
): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = opts.headers ?? {};
  queueMicrotask(() => {
    if (opts.body) req.emit("data", Buffer.from(opts.body, "utf8"));
    req.emit("end");
  });
  return req;
}

function mockRes(): {
  res: ServerResponse;
  status: () => number;
  json: () => unknown;
  headers: () => Record<string, string | number | string[]>;
} {
  let statusCode = 200;
  let payload = "";
  let headersOut: Record<string, string | number | string[]> = {};
  const res = {
    writeHead(code: number, headers: Record<string, string | number | string[]>) {
      statusCode = code;
      headersOut = headers;
    },
    end(data?: string) {
      payload = data ?? "";
    },
  } as ServerResponse;
  return {
    res,
    status: () => statusCode,
    json: () => (payload ? JSON.parse(payload) : null),
    headers: () => headersOut,
  };
}

function mountHandler(amemHome: string): ApiHandler {
  let handler: ApiHandler | undefined;
  const register = vi.fn((route: { handler: ApiHandler }) => {
    handler = route.handler;
    return () => {};
  });
  const ctx: DshPluginContext = {
    webServer: { register },
  };
  apply(ctx, { amemHome });
  expect(handler).toBeDefined();
  return handler!;
}

const tempHomes: string[] = [];
afterEach(() => {
  for (const h of tempHomes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function tempAmemHome(authEnabled = false): string {
  const home = mkdtempSync(join(tmpdir(), "amem-plugin-route-"));
  tempHomes.push(home);
  mkdirSync(home, { recursive: true });
  mkdirSync(paths(home).auth, { recursive: true });
  const cfg = defaultConfig();
  cfg.dsh.admin.auth_enabled = authEnabled;
  writeFileSync(join(home, "amem.toml"), configToToml(cfg));
  return home;
}

describe("apply capture fail-open", () => {
  it("does not propagate throws from session/created handler internals", () => {
    const handlers: Record<string, Array<(...a: unknown[]) => unknown>> = {};
    const ctx: DshPluginContext = {
      on: (event, handler) => {
        (handlers[event] ??= []).push(handler);
      },
    };
    apply(ctx, { amemHome: "C:\\does-not-exist-amem-home-xyz" });
    const created = handlers["session/created"]![0]!;
    expect(() =>
      created({
        get id() {
          throw new Error("boom");
        },
      }),
    ).not.toThrow();
  });

  it("defers /amem-api via inject when webServer is not ready at apply time", () => {
    const register = vi.fn(() => () => {});
    const effect = vi.fn((fn: () => unknown) => fn());
    let nestedDeps: string[] | undefined;
    const ctx: DshPluginContext = {
      get: () => undefined,
      inject: (deps, callback) => {
        nestedDeps = deps;
        const apiCtx: DshPluginContext = {
          webServer: { register },
          effect,
          get: (name) => {
            if (name === "webServer") return { register };
            return undefined;
          },
        };
        callback(apiCtx);
      },
    };
    apply(ctx, { amemHome: process.cwd() });
    expect(nestedDeps).toEqual(["webServer"]);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "prefix", path: "/amem-api" }),
    );
  });
});

describe("/amem-api independent auth routes", () => {
  it("does not probe Connection auth methods", () => {
    const register = vi.fn(() => () => {});
    const ctx: DshPluginContext = { webServer: { register } };
    apply(ctx, { amemHome: process.cwd() });
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "prefix", path: "/amem-api" }),
    );
  });

  it("logs in with bearer and sets a safe cookie", async () => {
    const home = tempAmemHome(true);
    const { token } = new DshTokenStore(home).issue(["memory:read"], 60 * 60 * 1000);
    const handler = mountHandler(home);
    const { res, status, json, headers } = mockRes();
    await handler(
      mockReq("POST", "/amem-api/auth/session", {
        body: JSON.stringify({ bearer: token }),
        headers: { origin: "http://127.0.0.1", host: "127.0.0.1" },
      }),
      res,
    );
    expect(status()).toBe(200);
    const body = json() as { csrfToken?: string; scopes?: string[]; ok?: boolean };
    expect(body.ok).toBe(true);
    expect(body.csrfToken).toBeTruthy();
    expect(body.scopes).toEqual(["memory:read"]);
    const setCookie = String(headers()["set-cookie"]);
    expect(setCookie).toContain("amem_dsh_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Path=/amem-api");
    expect(setCookie).toMatch(/Max-Age=\d+/);
    expect(headers()["cache-control"]).toBe("no-store");
    expect(headers()["x-content-type-options"]).toBe("nosniff");
  });

  it("allows local RPC without a session when auth is disabled by default", async () => {
    const handler = mountHandler(tempAmemHome());
    const { res, status, json } = mockRes();
    await handler(
      mockReq("POST", "/amem-api/rpc", {
        body: JSON.stringify({ id: "1", method: "memory.list", params: {} }),
        headers: { origin: "http://127.0.0.1", host: "127.0.0.1" },
      }),
      res,
    );
    expect(status()).toBe(200);
    expect((json() as { ok: boolean }).ok).toBe(true);
  });

  it("rejects RPC without a browser session", async () => {
    const home = tempAmemHome(true);
    const handler = mountHandler(home);
    const { res, status, json } = mockRes();
    await handler(
      mockReq("POST", "/amem-api/rpc", {
        body: JSON.stringify({
          id: "1",
          method: "memory.list",
          params: {},
        }),
        headers: { origin: "http://127.0.0.1", host: "127.0.0.1" },
      }),
      res,
    );
    expect(status()).toBe(401);
    const body = json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unauthenticated");
  });

  it("runs read RPC with session scope", async () => {
    const home = tempAmemHome(true);
    const { token } = new DshTokenStore(home).issue(["memory:read"], 60 * 60 * 1000);
    const handler = mountHandler(home);

    const login = mockRes();
    await handler(
      mockReq("POST", "/amem-api/auth/session", {
        body: JSON.stringify({ bearer: token }),
        headers: { origin: "http://127.0.0.1", host: "127.0.0.1" },
      }),
      login.res,
    );
    expect(login.status()).toBe(200);
    const setCookie = String(login.headers()["set-cookie"]);
    const cookieValue = setCookie.split(";")[0]!;

    const rpc = mockRes();
    await handler(
      mockReq("POST", "/amem-api/rpc", {
        body: JSON.stringify({
          id: "1",
          method: "memory.list",
          params: {},
        }),
        headers: {
          origin: "http://127.0.0.1",
          host: "127.0.0.1",
          cookie: cookieValue,
        },
      }),
      rpc.res,
    );
    expect(rpc.status()).toBe(200);
    const body = rpc.json() as { ok: boolean; result?: unknown };
    expect(body.ok).toBe(true);
    expect(body.result).toBeDefined();
  });

  it("rejects mutating RPC without csrf", async () => {
    const home = tempAmemHome(true);
    const { token } = new DshTokenStore(home).issue(["config:write"], 60 * 60 * 1000);
    const handler = mountHandler(home);

    const login = mockRes();
    await handler(
      mockReq("POST", "/amem-api/auth/session", {
        body: JSON.stringify({ bearer: token }),
        headers: { origin: "http://127.0.0.1", host: "127.0.0.1" },
      }),
      login.res,
    );
    const setCookie = String(login.headers()["set-cookie"]);
    const cookieValue = setCookie.split(";")[0]!;

    const rpc = mockRes();
    await handler(
      mockReq("POST", "/amem-api/rpc", {
        body: JSON.stringify({
          id: "1",
          method: "config.put",
          params: { config: { identity: { user_id: "x" } } },
        }),
        headers: {
          origin: "http://127.0.0.1",
          host: "127.0.0.1",
          cookie: cookieValue,
        },
      }),
      rpc.res,
    );
    expect(rpc.status()).toBe(401);
    const body = rpc.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unauthenticated");
  });

  it("rejects cross-origin and oversized requests", async () => {
    const home = tempAmemHome(true);
    const { token } = new DshTokenStore(home).issue(["memory:read"], 60 * 60 * 1000);
    const handler = mountHandler(home);

    const cross = mockRes();
    await handler(
      mockReq("POST", "/amem-api/auth/session", {
        body: JSON.stringify({ bearer: token }),
        headers: { origin: "http://evil.example", host: "evil.example" },
      }),
      cross.res,
    );
    expect(cross.status()).toBe(401);

    const big = mockRes();
    const bigBody = JSON.stringify({
      id: "1",
      method: "memory.list",
      params: { q: "x".repeat(70 * 1024) },
    });
    await handler(
      mockReq("POST", "/amem-api/rpc", {
        body: bigBody,
        headers: { origin: "http://127.0.0.1", host: "127.0.0.1" },
      }),
      big.res,
    );
    expect(big.status()).toBe(400);
    const bigBodyJson = big.json() as { error: string; message: string };
    expect(bigBodyJson.error).toBe("invalid_argument");
  });

  it("does not expose legacy REST management routes", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home);
    for (const [method, url] of [
      ["GET", "/amem-api/doctor"],
      ["GET", "/amem-api/memories"],
      ["GET", "/amem-api/config"],
      ["POST", "/amem-api/flush"],
      ["POST", "/amem-api/compile"],
    ] as const) {
      const { res, status } = mockRes();
      await handler(mockReq(method, url), res);
      expect(status()).toBe(404);
    }
  });
});
