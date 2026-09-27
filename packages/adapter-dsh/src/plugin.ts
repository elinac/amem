import type { IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAdmin } from "./admin.js";
import {
  normalizeDshLifecycle,
  normalizeDshSessionEvent,
  type DshSessionMeta,
} from "./normalize.js";
import { appendCanonical, enqueueFlush, wakeWorker } from "./spool.js";

/** Cordis Loader reads this from the host wrapper (re-exported). */
export const inject = ["webServer", "connection"];

/** Minimal duck-typed Cordis context — no @deepseek-ai compile dependency. */
export type DshPluginContext = {
  on?: (event: string, handler: (...args: unknown[]) => unknown) => unknown;
  /** Cordis optional service probe (works after inject has provided the service). */
  get?: (name: string) => unknown;
  /** Nested fiber that waits for named services (DSH Cordis). */
  inject?: (deps: string[], callback: (ctx: DshPluginContext) => void) => unknown;
  /** Track disposers for unload (e.g. webServer.register return value). */
  effect?: (fn: () => unknown, label?: string) => unknown;
  webServer?: WebServer;
  connection?: Connection;
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
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
  const admin = createAdmin(home);
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
    `apply keys=${Object.keys(ctx as object).join(",")} hasInject=${typeof ctx.inject} hasGet=${typeof ctx.get} hasWS=${!!ctx.webServer} hasConn=${!!ctx.connection}`,
  );

  // Management API needs webServer + connection. Cordis only exposes them after
  // inject waits — probing ctx.get at apply time silently skips registration
  // (UI then sees SPA fallback "Not Found" while CLI list still works).
  // Prefer module/wrapper `export const inject` so apply runs only when ready.
  const mountApi = (apiCtx: DshPluginContext): void => {
    const webServer =
      apiCtx.webServer ??
      (typeof apiCtx.get === "function" ? (apiCtx.get("webServer") as WebServer | undefined) : undefined);
    const connection =
      apiCtx.connection ??
      (typeof apiCtx.get === "function" ? (apiCtx.get("connection") as Connection | undefined) : undefined);
    hostLog(
      home,
      `mountApi ws=${!!webServer?.register} conn=${!!connection} reject=${typeof connection?.requestRejection} admit=${typeof connection?.admit}`,
    );
    if (!webServer?.register) {
      hostLog(home, "mountApi abort: no webServer.register");
      return;
    }

    const checkAuth = (req: IncomingMessage): { status: number; message: string } | null => {
      if (typeof connection?.requestRejection === "function") {
        const rej = connection.requestRejection(req);
        if (rej === undefined) return null;
        return { status: rej, message: rej === 403 ? "forbidden" : "unauthorized" };
      }
      if (typeof connection?.admit === "function") {
        const admission = connection.admit(req);
        if (admission && typeof admission === "object" && "rejection" in admission) {
          const rej = (admission as { rejection: number | { status?: number; message?: string } })
            .rejection;
          if (typeof rej === "number") {
            return { status: rej, message: rej === 403 ? "forbidden" : "unauthorized" };
          }
          return {
            status: rej.status ?? 401,
            message: rej.message ?? "admit rejected",
          };
        }
        return null;
      }
      return { status: 401, message: "connection auth unavailable" };
    };
    const route = {
      kind: "prefix" as const,
      path: "/amem-api",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const denied = checkAuth(req);
          if (denied) {
            sendJson(res, denied.status, { error: "unauthorized", message: denied.message });
            return;
          }

          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          const path = url.pathname.replace(/^\/amem-api/, "") || "/";
          const method = (req.method ?? "GET").toUpperCase();

          if (method === "GET" && path === "/memories") {
            const limit = Number(url.searchParams.get("limit") ?? 50);
            const r = admin.listMemories(Number.isFinite(limit) ? limit : 50);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          const memMatch = path.match(/^\/memories\/([^/]+)$/);
          if (method === "GET" && memMatch) {
            const r = admin.getMemory(decodeURIComponent(memMatch[1]!));
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }
          if (method === "DELETE" && memMatch) {
            const r = admin.forget(decodeURIComponent(memMatch[1]!));
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/recall") {
            const body = JSON.parse((await readBody(req)) || "{}") as {
              query?: string;
              k?: number;
            };
            if (!body.query) {
              sendJson(res, 400, { error: "bad_request", message: "query required" });
              return;
            }
            const r = admin.recall(body.query, body.k);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/notes") {
            const body = JSON.parse((await readBody(req)) || "{}") as {
              kind?: MemoryRecordKind;
              title?: string;
              content?: string;
              applies_when?: string;
              evidence_hint?: string;
            };
            if (!body.kind || !body.title || !body.content || !body.applies_when) {
              sendJson(res, 400, {
                error: "bad_request",
                message: "kind, title, content, applies_when required",
              });
              return;
            }
            const r = admin.note({
              kind: body.kind,
              title: body.title,
              content: body.content,
              applies_when: body.applies_when,
              evidence_hint: body.evidence_hint,
            });
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "GET" && path === "/skills") {
            const r = admin.listSkills();
            sendJson(res, 200, r.ok ? r.data : r);
            return;
          }

          if (method === "GET" && path === "/proposals") {
            const r = admin.listProposals();
            sendJson(res, 200, r.ok ? r.data : r);
            return;
          }

          const applyMatch = path.match(/^\/proposals\/([^/]+)\/apply$/);
          if (method === "POST" && applyMatch) {
            const body = JSON.parse((await readBody(req)) || "{}") as { skillName?: string };
            if (!body.skillName) {
              sendJson(res, 400, { error: "bad_request", message: "skillName required" });
              return;
            }
            const r = admin.applyProposal(decodeURIComponent(applyMatch[1]!), body.skillName);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "GET" && path === "/doctor") {
            const r = admin.doctor();
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/flush") {
            const body = JSON.parse((await readBody(req)) || "{}") as { sessionId?: string };
            const r = await admin.flush(body.sessionId);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/rebuild-index") {
            const r = admin.rebuildIndex();
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/consolidate") {
            const body = JSON.parse((await readBody(req)) || "{}") as { dryRun?: boolean };
            const r = admin.consolidate(body.dryRun === true);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/compile") {
            const body = JSON.parse((await readBody(req)) || "{}") as { target?: string };
            const r = admin.compile(body.target);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "GET" && path === "/config") {
            const r = admin.getConfig();
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "PUT" && path === "/config") {
            let body: unknown;
            try {
              body = JSON.parse((await readBody(req)) || "{}");
            } catch {
              sendJson(res, 400, { error: "bad_request", message: "invalid JSON" });
              return;
            }
            const r = admin.putConfig(body);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          sendJson(res, 404, { error: "not_found", message: path });
        } catch (e) {
          sendJson(res, 500, {
            error: "internal",
            message: e instanceof Error ? e.message : String(e),
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

  // If the Loader already honored export const inject, services are on ctx now.
  if (ctx.webServer?.register || (typeof ctx.get === "function" && ctx.get("webServer"))) {
    mountApi(ctx);
  } else if (typeof ctx.inject === "function") {
    hostLog(home, "defer mountApi via ctx.inject");
    ctx.inject(["webServer", "connection"], mountApi);
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

type Connection = {
  /** Current DSH Connection API — prefer this over legacy admit. */
  requestRejection?: (req: IncomingMessage) => 401 | 403 | undefined;
  /** Older harness builds exposed admit(); keep as fallback. */
  admit?: (req: IncomingMessage) =>
    | { rejection: number | { status?: number; message?: string } }
    | Record<string, unknown>;
};

type MemoryRecordKind =
  | "fact"
  | "case"
  | "failure"
  | "procedure"
  | "tool_quirk"
  | "strategy"
  | "criterion"
  | "constraint_hint"
  | "preference"
  | "open_question";

export const name = "amem-dsh-host";
