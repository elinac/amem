/**
 * Authenticated RPC client for the amem DSH workbench.
 *
 * Security rules:
 * - The long-lived bearer token is only ever passed to `login()` and is never
 *   stored in React state, browser storage, the URL, or any closure after login.
 * - CSRF token and session metadata live only in page memory.
 * - All mutating RPC calls send `X-AMEM-CSRF`.
 */

export type MemoryKind =
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

export type ScopeLevel = "instance" | "domain" | "global";
export type Trust = "T3" | "T2" | "T1";
export type MemoryStatus =
  | "candidate"
  | "active"
  | "superseded"
  | "conflict"
  | "frozen"
  | "expired";

export const MEMORY_KINDS: MemoryKind[] = [
  "fact",
  "case",
  "failure",
  "procedure",
  "tool_quirk",
  "strategy",
  "criterion",
  "constraint_hint",
  "preference",
  "open_question",
];
export const SCOPE_LEVELS: ScopeLevel[] = ["instance", "domain", "global"];
export const TRUSTS: Trust[] = ["T3", "T2", "T1"];
export const MEMORY_STATUSES: MemoryStatus[] = [
  "candidate",
  "active",
  "superseded",
  "conflict",
  "frozen",
  "expired",
];
export const PAGE_SIZES = [20, 50, 100] as const;

export type MemoryListItem = {
  id: string;
  kind: MemoryKind;
  level: ScopeLevel;
  trust: Trust;
  status: MemoryStatus;
  title: string;
  applies_when: string;
  content: string;
  helpful: number;
  harmful: number;
  updated_at: string;
};

export type MemoryFacets = {
  kind: Record<MemoryKind, number>;
  level: Record<ScopeLevel, number>;
  trust: Record<Trust, number>;
  status: Record<MemoryStatus, number>;
};

export type MemoryListResult = {
  items: MemoryListItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: MemoryFacets;
};

export type ListMemoryFilters = {
  q?: string;
  kind?: MemoryKind;
  level?: ScopeLevel;
  trust?: Trust;
  status?: MemoryStatus;
};

export type AuthState =
  | { kind: "locked" }
  | { kind: "unlocking" }
  | { kind: "ready"; csrf: string; scopes: string[]; expiresAt: string; authEnabled: boolean }
  | { kind: "error"; message: string };

export function authStateForMode(authEnabled: boolean, scopes: string[] = []): AuthState {
  return authEnabled
    ? { kind: "locked" }
    : { kind: "ready", csrf: "", scopes, expiresAt: "", authEnabled: false };
}

type RpcEnvelope = {
  id: string;
  method: string;
  params: unknown;
};

export type RpcError = { code: string; message: string; details?: unknown };

export type RpcResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: RpcError };

let currentCsrf: string | undefined;
let currentScopes: string[] = [];
let currentExpiresAt: string | undefined;

function api(path: string, init?: RequestInit): Promise<unknown> {
  const { headers: initHeaders, ...rest } = init ?? {};
  return fetch(`/amem-api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(initHeaders ?? {}),
    },
  }).then(async (res) => {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof body.message === "string"
          ? body.message
          : typeof body.error === "string"
            ? body.error
            : res.statusText;
      throw new Error(msg);
    }
    return body;
  });
}

async function rpcCall<T>(method: string, params: unknown): Promise<RpcResult<T>> {
  const csrf = currentCsrf;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const envelope: RpcEnvelope = { id, method, params };
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (csrf) headers["x-amem-csrf"] = csrf;
  const res = await fetch("/amem-api/rpc", {
    method: "POST",
    credentials: "same-origin",
    headers,
    body: JSON.stringify(envelope),
  });
  const body = (await res.json().catch(() => ({ ok: false, error: { code: "internal", message: "bad response" } }))) as Record<string, unknown>;
  if (!res.ok || body.ok === false) {
    const err = body.error as RpcError | undefined;
    return {
      ok: false,
      error: {
        code: err?.code ?? String(body.error ?? "internal"),
        message: err?.message ?? "RPC failed",
        details: err?.details,
      },
    };
  }
  return { ok: true, result: body.result as T };
}

function setSession(csrf: string, scopes: string[], expiresAt: string): void {
  currentCsrf = csrf;
  currentScopes = scopes;
  currentExpiresAt = expiresAt;
}

function clearSession(): void {
  currentCsrf = undefined;
  currentScopes = [];
  currentExpiresAt = undefined;
}

export async function login(bearer: string): Promise<AuthState> {
  // bearer is consumed here and never retained.
  const body = (await api("/auth/session", {
    method: "POST",
    body: JSON.stringify({ bearer }),
  })) as {
    ok?: boolean;
    csrfToken?: string;
    scopes?: string[];
    expiresAt?: string;
  };
  if (!body.ok || typeof body.csrfToken !== "string") {
    return { kind: "error", message: "登录失败" };
  }
  setSession(body.csrfToken, body.scopes ?? [], body.expiresAt ?? "");
  return {
    kind: "ready",
    csrf: body.csrfToken,
    scopes: body.scopes ?? [],
    expiresAt: body.expiresAt ?? "",
    authEnabled: true,
  };
}

export async function getAuthStatus(): Promise<AuthState> {
  try {
    const body = (await api("/auth/status")) as {
      ok?: boolean;
      authEnabled?: boolean;
      scopes?: string[];
    };
    if (body.ok !== true || typeof body.authEnabled !== "boolean") {
      return { kind: "error", message: "无法读取面板认证模式" };
    }
    return authStateForMode(body.authEnabled, body.scopes ?? []);
  } catch {
    return { kind: "error", message: "无法连接到 amem 服务" };
  }
}

export async function refreshCsrf(): Promise<AuthState> {
  const body = (await api("/auth/csrf", { method: "POST" })) as {
    ok?: boolean;
    csrfToken?: string;
    expiresAt?: string;
  };
  if (!body.ok || typeof body.csrfToken !== "string") {
    clearSession();
    return { kind: "locked" };
  }
  setSession(body.csrfToken, currentScopes, body.expiresAt ?? "");
  return {
    kind: "ready",
    csrf: body.csrfToken,
    scopes: currentScopes,
    expiresAt: body.expiresAt ?? "",
    authEnabled: true,
  };
}

export async function logout(): Promise<void> {
  await api("/auth/session", { method: "DELETE" }).catch(() => undefined);
  clearSession();
}

function hasScope(scope: string): boolean {
  return currentScopes.includes(scope);
}

export const auth = {
  hasScope,
  getScopes: () => [...currentScopes],
};

export const rpc = {
  memory: {
    list: (params: {
      page: number;
      pageSize: 20 | 50 | 100;
    } & ListMemoryFilters) =>
      rpcCall<MemoryListResult>("memory.list", {
        page: params.page,
        pageSize: params.pageSize,
        q: params.q,
        kind: params.kind,
        level: params.level,
        trust: params.trust,
        status: params.status,
      }),
    get: (id: string) => rpcCall<MemoryListItem>("memory.get", { id }),
    forget: (id: string) => rpcCall<{ forgotten: string }>("memory.forget", { id }),
  },
  skill: {
    list: () => rpcCall<{ items: unknown[] }>("skill.list", undefined),
  },
  proposal: {
    list: () => rpcCall<{ items: unknown[] }>("proposal.list", undefined),
    apply: (id: string, skillName: string) =>
      rpcCall<{ dest: string }>("proposal.apply", { id, skillName }),
  },
  ops: {
    doctor: () => rpcCall<unknown>("ops.doctor", undefined),
    flush: (sessionId?: string) =>
      rpcCall<unknown>("ops.flush", { sessionId: sessionId ?? "" }),
    rebuild: () => rpcCall<unknown>("ops.rebuild", undefined),
    consolidate: (dryRun = false) =>
      rpcCall<unknown>("ops.consolidate", { dryRun }),
    compile: (target = "dsh") => rpcCall<unknown>("ops.compile", { target }),
  },
  config: {
    get: () => rpcCall<{ path: string; config: unknown }>("config.get", undefined),
    put: (config: unknown, apiKeyReplacement?: string) =>
      rpcCall<unknown>("config.put", { config, api_key_replacement: apiKeyReplacement }),
  },
};

/** Pure helper: build the next query when a filter changes. */
export function nextQuery<P extends number>(
  current: ListMemoryFilters & { page: number; pageSize: P },
  patch: Partial<ListMemoryFilters>,
): ListMemoryFilters & { page: number; pageSize: P } {
  return {
    ...current,
    ...patch,
    page: 1,
  };
}

/** Pure helper: decide the effective page given total and requested page. */
export function effectivePage(
  requestedPage: number,
  total: number,
  pageSize: number,
): number {
  if (total === 0) return 1;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(requestedPage, maxPage);
}

/** Pure helper: returns true when an in-flight response is stale. */
export function isStale(
  currentSequence: number,
  responseSequence: number,
): boolean {
  return responseSequence < currentSequence;
}

/** Format an RPC error for display. */
export function rpcErrorMessage(error: RpcError | undefined): string {
  if (!error) return "未知错误";
  switch (error.code) {
    case "unauthenticated":
      return "会话已过期，请重新解锁";
    case "permission_denied":
      return "权限不足";
    case "not_found":
      return "未找到";
    case "invalid_argument":
      return `参数错误：${error.message}`;
    case "conflict":
      return `冲突：${error.message}`;
    case "rate_limited":
      return "请求过于频繁，请稍后再试";
    default:
      return error.message || "请求失败";
  }
}
