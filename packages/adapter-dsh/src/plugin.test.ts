import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configToToml, defaultConfig } from "@amem/core";
import { apply, type DshPluginContext } from "./plugin.js";

type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

function mockReq(method: string, url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  queueMicrotask(() => {
    if (body) req.emit("data", Buffer.from(body, "utf8"));
    req.emit("end");
  });
  return req;
}

function mockRes(): {
  res: ServerResponse;
  status: () => number;
  json: () => unknown;
} {
  let statusCode = 200;
  let payload = "";
  const res = {
    writeHead(code: number) {
      statusCode = code;
    },
    end(data?: string) {
      payload = data ?? "";
    },
  } as ServerResponse;
  return {
    res,
    status: () => statusCode,
    json: () => (payload ? JSON.parse(payload) : null),
  };
}

function mountHandler(amemHome: string, connection: DshPluginContext["connection"]): ApiHandler {
  let handler: ApiHandler | undefined;
  const register = vi.fn((route: { handler: ApiHandler }) => {
    handler = route.handler;
    return () => {};
  });
  const ctx: DshPluginContext = {
    webServer: { register },
    connection,
  };
  apply(ctx, { amemHome });
  expect(handler).toBeDefined();
  return handler!;
}

const tempHomes: string[] = [];
afterEach(() => {
  for (const h of tempHomes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function tempAmemHome(): string {
  const home = mkdtempSync(join(tmpdir(), "amem-plugin-route-"));
  tempHomes.push(home);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig()));
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
      // Simulate Cordis: services absent at apply; only available after inject waits.
      get: () => undefined,
      inject: (deps, callback) => {
        nestedDeps = deps;
        const apiCtx: DshPluginContext = {
          webServer: { register },
          connection: { requestRejection: () => undefined },
          effect,
          get: (name) => {
            if (name === "webServer") return { register };
            if (name === "connection") return { requestRejection: () => undefined };
            return undefined;
          },
        };
        callback(apiCtx);
      },
    };
    apply(ctx, { amemHome: process.cwd() });
    expect(nestedDeps).toEqual(["webServer", "connection"]);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "prefix", path: "/amem-api" }),
    );
  });

  it("registers /amem-api when requestRejection exists via get (test/legacy path)", () => {
    const register = vi.fn(() => () => {});
    const ctx: DshPluginContext = {
      get: (name) => {
        if (name === "webServer") return { register };
        if (name === "connection") return { requestRejection: () => undefined };
        return undefined;
      },
    };
    apply(ctx, { amemHome: process.cwd() });
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "prefix", path: "/amem-api" }),
    );
  });
});

describe("/amem-api route handler", () => {
  it("GET /doctor returns 200 JSON when auth admits", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => undefined });
    const { res, status, json } = mockRes();
    await handler(mockReq("GET", "/amem-api/doctor"), res);
    expect(status()).toBe(200);
    const body = json() as { home?: string; checks?: unknown[] };
    expect(body.home).toBe(home);
    expect(Array.isArray(body.checks)).toBe(true);
  });

  it("returns 401 when requestRejection rejects before route handling", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => 401 });
    const { res, status, json } = mockRes();
    await handler(mockReq("GET", "/amem-api/doctor"), res);
    expect(status()).toBe(401);
    expect(json()).toEqual(
      expect.objectContaining({ error: "unauthorized", message: "unauthorized" }),
    );
  });

  it("POST /compile with target cursor returns 400", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => undefined });
    const { res, status, json } = mockRes();
    await handler(
      mockReq("POST", "/amem-api/compile", JSON.stringify({ target: "cursor" })),
      res,
    );
    expect(status()).toBe(400);
    expect(json()).toEqual(
      expect.objectContaining({
        ok: false,
        error: "bad_request",
        message: "compile target must be dsh",
        status: 400,
      }),
    );
  });

  it("GET /config returns path and config when auth admits", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => undefined });
    const { res, status, json } = mockRes();
    await handler(mockReq("GET", "/amem-api/config"), res);
    expect(status()).toBe(200);
    const body = json() as { path?: string; config?: { llm?: { mode?: string } } };
    expect(body.path).toContain("amem.toml");
    expect(body.config?.llm?.mode).toBe("stub");
  });

  it("PUT /config with invalid JSON returns 400", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => undefined });
    const { res, status, json } = mockRes();
    await handler(mockReq("PUT", "/amem-api/config", "{not json"), res);
    expect(status()).toBe(400);
    expect(json()).toEqual({ error: "bad_request", message: "invalid JSON" });
  });
});
