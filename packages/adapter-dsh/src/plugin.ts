import type { IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, paths } from "@amem/core";
import { createAdmin } from "./admin.js";
import { DshTokenStore } from "./auth-store.js";
import { BrowserSessionManager } from "./browser-session.js";
import { dispatchRpc, type RpcAuth } from "./rpc.js";
import {
  normalizeDshLifecycle,
  normalizeDshSessionEvent,
  type DshSessionMeta,
} from "./normalize.js";
import { appendCanonical, enqueueFlush, wakeWorker } from "./spool.js";

/** Cordis Loader reads this from the host wrapper (re-exported). */
export const inject = ["webServer"];

/** Minimal duck-typed Cordis context — no @deepseek-ai compile dependency. */
export type DshPluginContext = {
  on?: (event: string, handler: (...args: unknown[]) => unknown) => unknown;
  /** Cordis optional service probe (works after inject has provided the service). */
  get?: (name: string) => unknown;
  /** Nested fiber that waits for named services (DSH Cordis). */
  inject?: (deps: string[], callback: (ctx: DshPluginContext) => void) => void;
  /** Track disposers for unload (e.g. webServer.register return value). */
  effect?: (fn: () => unknown, label?: string) => unknown;
  webServer?: WebServer;
};

function hostLog(home: string, msg: string): void {
  try {
    const dir = join(home, "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "dsh-host.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

export type AmemDshPluginConfig = {
  amemHome: string;
  userId?: string;
  cliPath?: string;
};

type SessionLike = {
  id?: string;
  header?: { cwd?: string };
};

function sessionMeta(session: SessionLike, userId: string): DshSessionMeta {
  const roots = session.header?.cwd ? [session.header.cwd] : [];
  return {
    session_id: String(session.id ?? "unknown"),
    workspace_roots: roots,
    user_id: userId,
  };
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* fail-open — never throw from session listeners */
  }
}

class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLargeError";
  }
}

const MAX_BODY_BYTES = 64 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    function onData(c: Buffer | string): void {
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(c, "utf8");
      total += buf.length;
      if (total > MAX_BODY_BYTES) {
        req.off("data", onData);
        req.off("end", onEnd);
        req.off("error", onError);
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(buf);
    }
    function onEnd(): void {
      resolve(Buffer.concat(chunks).toString("utf8"));
    }
    function onError(err: Error): void {
      reject(err);
    }
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

type SendHeaders = Record<string, string | string[]>;

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: SendHeaders,
): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string | number | string[]> = {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(payload);
}

function requestMeta(req: IncomingMessage): {
  origin: string;
  host: string;
  secFetchSite: string | undefined;
} {
  const origin = req.headers.origin;
  const host = req.headers.host;
  const secFetchSite = req.headers["sec-fetch-site"];
  return {
    origin: typeof origin === "string" ? origin : "",
    host: typeof host === "string" ? host : "",
    secFetchSite: typeof secFetchSite === "string" ? secFetchSite : undefined,
  };
}

function parseCookie(cookieHeader: string | undefined): string {
  if (!cookieHeader) return "";
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (name === "amem_dsh_session") {
      return part.slice(idx + 1).trim();
    }
  }
  return "";
}

function rpcStatus(code: string): number {
  switch (code) {
    case "not_found":
      return 404;
    case "invalid_argument":
      return 400;
    case "unauthenticated":
      return 401;
    case "permission_denied":
      return 403;
    case "conflict":
      return 409;
    case "internal":
    default:
      return 500;
  }
}

/**
 * Cordis Host plugin: session capture → spool + authenticated /amem-api.
 * Must not throw from session/created (DSH rolls back session on sync throw).
 */
export function apply(ctx: DshPluginContext, config?: Partial<AmemDshPluginConfig>): void {
  const home =
    config?.amemHome ??
    process.env.AMEM_HOME ??
    join(homedir(), ".amem");
  const userId =
    config?.userId ?? process.env.USERNAME ?? process.env.USER ?? "local";
  const cliPath = config?.cliPath;

  mkdirSync(paths(home).auth, { recursive: true });
  const cfg = loadConfig(home).dsh.admin;
  const admin = createAdmin(home);
  const tokenStore = new DshTokenStore(home);
  const sessions = new BrowserSessionManager(home, cfg, tokenStore);
  const ended = new Set<string>();

  if (typeof ctx.on === "function") {
    ctx.on("session/created", (session) => {
      safe(() => {
        const s = session as SessionLike;
        const meta = sessionMeta(s, userId);
        appendCanonical(home, meta.session_id, normalizeDshLifecycle("session_start", meta));
      });
    });

    ctx.on("session/event", (session, event) => {
      safe(() => {
        const s = session as SessionLike;
        const meta = sessionMeta(s, userId);
        const events = normalizeDshSessionEvent(event, meta);
        appendCanonical(home, meta.session_id, events);
        const ev = event as { type?: string };
        if (ev?.type === "turn/end") {
          enqueueFlush(home, meta.session_id);
          wakeWorker(home, cliPath);
        }
      });
    });

    ctx.on("session/disposed", (session) => {
      safe(() => {
        const s = session as SessionLike;
        const meta = sessionMeta(s, userId);
        if (!ended.has(meta.session_id)) {
          ended.add(meta.session_id);
          appendCanonical(home, meta.session_id, normalizeDshLifecycle("session_end", meta));
        }
        enqueueFlush(home, meta.session_id);
        wakeWorker(home, cliPath);
      });
    });
  }

  hostLog(
    home,
    `apply keys=${Object.keys(ctx as object).join(",")} hasInject=${typeof ctx.inject} hasGet=${typeof ctx.get} hasWS=${!!ctx.webServer}`,
  );

  const mountApi = (apiCtx: DshPluginContext): void => {
    const webServer =
      apiCtx.webServer ??
      (typeof apiCtx.get === "function"
        ? (apiCtx.get("webServer") as WebServer | undefined)
        : undefined);
    hostLog(home, `mountApi ws=${!!webServer?.register}`);
    if (!webServer?.register) {
      hostLog(home, "mountApi abort: no webServer.register");
      return;
    }

    const route = {
      kind: "prefix" as const,
      path: "/amem-api",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const meta = requestMeta(req);
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const path = url.pathname.replace(/^\/amem-api/, "") || "/";
        const method = (req.method ?? "GET").toUpperCase();

        try {
          if (method === "POST" && path === "/auth/session") {
            let body: unknown;
            try {
              body = JSON.parse(await readBody(req));
            } catch (e) {
              if (e instanceof BodyTooLargeError) throw e;
              sendJson(res, 400, { error: "invalid_argument", message: "invalid JSON" });
              return;
            }
            const token =
              body != null && typeof body === "object" && "bearer" in body
                ? String((body as Record<string, unknown>).bearer)
                : "";
            const result = sessions.login({
              bearer: token,
              origin: meta.origin,
              host: meta.host,
              secFetchSite: meta.secFetchSite,
            });
            if (!result.ok) {
              sendJson(
                res,
                401,
                { error: "unauthenticated", message: "unauthenticated" },
                { "cache-control": "no-store" },
              );
              return;
            }
            sendJson(
              res,
              200,
              {
                ok: true,
                csrfToken: result.csrfToken,
                scopes: result.scopes,
                expiresAt: result.expiresAt,
              },
              {
                "set-cookie": result.cookie,
                "cache-control": "no-store",
              },
            );
            return;
          }

          if (method === "POST" && path === "/auth/csrf") {
            const cookie = parseCookie(req.headers.cookie);
            const result = sessions.issueCsrf(cookie, meta);
            if (!result.ok) {
              sendJson(
                res,
                401,
                { error: "unauthenticated", message: "unauthenticated" },
                { "cache-control": "no-store" },
              );
              return;
            }
            sendJson(
              res,
              200,
              { ok: true, csrfToken: result.csrfToken, expiresAt: result.expiresAt },
              { "cache-control": "no-store" },
            );
            return;
          }

          if (method === "DELETE" && path === "/auth/session") {
            if (!cfg.allowed_origins.includes(meta.origin)) {
              sendJson(
                res,
                401,
                { error: "unauthenticated", message: "unauthenticated" },
                { "cache-control": "no-store" },
              );
              return;
            }
            try {
              if (new URL(meta.origin).host !== meta.host) {
                sendJson(
                  res,
                  401,
                  { error: "unauthenticated", message: "unauthenticated" },
                  { "cache-control": "no-store" },
                );
                return;
              }
            } catch {
              sendJson(
                res,
                401,
                { error: "unauthenticated", message: "unauthenticated" },
                { "cache-control": "no-store" },
              );
              return;
            }
            const cookie = parseCookie(req.headers.cookie);
            sessions.logout(cookie);
            sendJson(
              res,
              200,
              { ok: true },
              {
                "cache-control": "no-store",
                "set-cookie":
                  "amem_dsh_session=; HttpOnly; SameSite=Strict; Path=/amem-api; Max-Age=0",
              },
            );
            return;
          }

          if (method === "POST" && path === "/rpc") {
            let envelope: unknown;
            try {
              envelope = JSON.parse(await readBody(req));
            } catch (e) {
              if (e instanceof BodyTooLargeError) throw e;
              sendJson(res, 400, { error: "invalid_argument", message: "invalid JSON" });
              return;
            }
            const cookie = parseCookie(req.headers.cookie);
            const csrfHeader = req.headers["x-amem-csrf"];
            const csrf = typeof csrfHeader === "string" ? csrfHeader : undefined;
            const auth: RpcAuth = (required) =>
              sessions.authenticate(cookie, csrf, [required], meta);
            const rpcRes = await dispatchRpc(admin, envelope, auth);
            const status = rpcRes.ok ? 200 : rpcStatus(rpcRes.error.code);
            sendJson(res, status, rpcRes, { "cache-control": "no-store" });
            return;
          }

          sendJson(res, 404, { error: "not_found", message: path });
        } catch (e) {
          if (e instanceof BodyTooLargeError) {
            sendJson(res, 400, { error: "invalid_argument", message: e.message });
            return;
          }
          sendJson(res, 500, {
            error: "internal",
            message: "internal error",
          });
        }
      },
    };

    try {
      const run = () => webServer.register(route);
      if (typeof apiCtx.effect === "function") {
        apiCtx.effect(run, "amem: /amem-api");
      } else {
        run();
      }
      hostLog(home, "mountApi registered /amem-api");
    } catch (e) {
      hostLog(home, `mountApi register failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (ctx.webServer?.register || (typeof ctx.get === "function" && ctx.get("webServer"))) {
    mountApi(ctx);
  } else if (typeof ctx.inject === "function") {
    hostLog(home, "defer mountApi via ctx.inject");
    ctx.inject(["webServer"], mountApi);
  } else {
    hostLog(home, "mountApi immediate fallback (no inject)");
    mountApi(ctx);
  }
}

type WebServer = {
  register: (route: {
    kind: "exact" | "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }) => () => void;
};

export const name = "amem-dsh-host";
