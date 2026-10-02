import { MEMORY_KINDS, MEMORY_PAGE_SIZES, MEMORY_STATUSES, SCOPE_LEVELS, TRUSTS } from "@amem/core";
import type { AdminResult, AmemAdmin, ListMemoriesInput } from "./admin.js";
import type { DshAdminScope } from "./auth-store.js";
import type { AuthResult } from "./browser-session.js";

export const RPC_METHODS = [
  "memory.list",
  "memory.get",
  "memory.forget",
  "memory.recall",
  "conflict.list",
  "conflict.resolve",
  "skill.list",
  "proposal.list",
  "proposal.apply",
  "ops.doctor",
  "ops.failed.list",
  "ops.failed.purge",
  "ops.flush",
  "ops.rebuild",
  "ops.consolidate",
  "ops.compile",
  "config.get",
  "config.put",
] as const;

export type RpcMethod = (typeof RPC_METHODS)[number];

export type RpcRequest = {
  id: string;
  method: RpcMethod;
  params: unknown;
};

export type RpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: string; message: string; details?: unknown } };

export type RpcMethodDef<P, R> = {
  /** Required scope; CSRF / Sec-Fetch mutating? is derived via isMutating([scope]). */
  scope: DshAdminScope;
  parse(params: unknown): P;
  run(
    admin: AmemAdmin,
    params: P,
    auth: { tokenId: string; scopes: DshAdminScope[] },
  ): Promise<R> | R;
};

export type RpcAuth = AuthResult | ((required: DshAdminScope) => AuthResult);

const MAX_ID_LENGTH = 128;
const MAX_METHOD_LENGTH = 64;
const MAX_STRING_PARAM_LENGTH = 512;
const MAX_QUERY_LENGTH = 256;

class RpcParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcParseError";
  }
}

function safeString(v: unknown, name: string, max = MAX_STRING_PARAM_LENGTH): string {
  if (typeof v !== "string") throw new RpcParseError(`${name} must be a string`);
  if (v.length > max) throw new RpcParseError(`${name} too long`);
  return v;
}

function safeOptionalString(
  v: unknown,
  name: string,
  max = MAX_STRING_PARAM_LENGTH,
): string | undefined {
  if (v === undefined || v === null) return undefined;
  return safeString(v, name, max);
}

function safePositiveInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || Math.floor(v) !== v) {
    throw new RpcParseError(`${name} must be a positive integer`);
  }
  return v;
}

function safeOptionalEnum<T extends string | number>(
  v: unknown,
  name: string,
  values: readonly T[],
): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") {
    if (!values.includes(v as T)) throw new RpcParseError(`invalid ${name}`);
    return v as T;
  }
  if (typeof v !== "string") throw new RpcParseError(`${name} must be a string or number`);
  if (!values.includes(v as T)) throw new RpcParseError(`invalid ${name}`);
  return v as T;
}

function requireObject(v: unknown, name = "params"): Record<string, unknown> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) {
    throw new RpcParseError(`${name} must be an object`);
  }
  return v as Record<string, unknown>;
}

const PAGE_SIZES = MEMORY_PAGE_SIZES;

function parseListMemories(params: unknown): ListMemoriesInput {
  const p = requireObject(params);
  return {
    page: safePositiveInt(p.page ?? 1, "page"),
    pageSize: safeOptionalEnum(p.pageSize, "pageSize", PAGE_SIZES) ?? 20,
    q: safeOptionalString(p.q, "q", MAX_QUERY_LENGTH),
    kind: safeOptionalEnum(p.kind, "kind", MEMORY_KINDS),
    level: safeOptionalEnum(p.level, "level", SCOPE_LEVELS),
    trust: safeOptionalEnum(p.trust, "trust", TRUSTS),
    status: safeOptionalEnum(p.status, "status", MEMORY_STATUSES),
  };
}

function parseId(params: unknown): { id: string } {
  const p = requireObject(params);
  return { id: safeString(p.id, "id") };
}

function parseApplyProposal(params: unknown): { id: string; skillName: string } {
  const p = requireObject(params);
  return {
    id: safeString(p.id, "id"),
    skillName: safeString(p.skillName, "skillName"),
  };
}

function parseFlush(params: unknown): { sessionId?: string } {
  const p = requireObject(params);
  return { sessionId: safeOptionalString(p.sessionId, "sessionId") };
}

function parseConsolidate(params: unknown): { dryRun: boolean } {
  const p = requireObject(params);
  return { dryRun: p.dryRun === true };
}

function parseCompile(params: unknown): { target?: string } {
  const p = requireObject(params);
  return { target: safeOptionalString(p.target, "target") };
}

function parsePutConfig(params: unknown): { config: unknown; api_key_replacement?: string } {
  const p = requireObject(params);
  if (!("config" in p)) throw new RpcParseError("config required");
  return {
    config: p.config,
    api_key_replacement: safeOptionalString(p.api_key_replacement, "api_key_replacement", 4096),
  };
}

function parseRecall(params: unknown): { query: string; k?: number } {
  const p = requireObject(params);
  const query = safeString(p.query, "query", MAX_QUERY_LENGTH);
  const k = p.k == null ? undefined : safePositiveInt(p.k, "k");
  if (k != null && k > 50) throw new RpcParseError("k must be <= 50");
  return { query, k };
}

const RESOLVE_ACTIONS = ["keep_left", "keep_right", "keep_both"] as const;

function parseResolveConflict(params: unknown): {
  leftId: string;
  rightId: string;
  action: (typeof RESOLVE_ACTIONS)[number];
  leftUpdatedAt: string;
  rightUpdatedAt: string;
} {
  const p = requireObject(params);
  // Actor/token_id must never come from the client (I10 / ADR-0004).
  if ("actor" in p || "token_id" in p || "tokenId" in p || "os_user" in p) {
    throw new RpcParseError("actor fields are not accepted in params");
  }
  const action = safeOptionalEnum(p.action, "action", RESOLVE_ACTIONS);
  if (!action) throw new RpcParseError("invalid action");
  return {
    leftId: safeString(p.leftId, "leftId"),
    rightId: safeString(p.rightId, "rightId"),
    action,
    leftUpdatedAt: safeString(p.leftUpdatedAt, "leftUpdatedAt"),
    rightUpdatedAt: safeString(p.rightUpdatedAt, "rightUpdatedAt"),
  };
}

function mapAdminError(error: string): string {
  switch (error) {
    case "not_found":
      return "not_found";
    case "bad_request":
    case "invalid_argument":
      return "invalid_argument";
    case "apply_failed":
    case "compile_failed":
      return "invalid_argument";
    case "conflict":
    case "conflict_version_mismatch":
    case "not_a_conflict_pair":
      return "conflict";
    default:
      return "internal";
  }
}

class RpcAdminError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "RpcAdminError";
  }
}

/** Collapse AdminResult → data or stable RpcAdminError (single glue for all methods). */
function invokeAdmin(result: AdminResult): unknown {
  if (result.ok) return result.data;
  throw new RpcAdminError(result.error, result.message, result.status);
}

async function invokeAdminAsync(result: Promise<AdminResult> | AdminResult): Promise<unknown> {
  return invokeAdmin(await result);
}

function okResponse<R>(id: string, result: R): RpcResponse {
  return { id, ok: true, result };
}

function errorResponse(id: string, code: string, message: string, details?: unknown): RpcResponse {
  return { id, ok: false, error: { code, message, details } };
}

const registry: Record<RpcMethod, RpcMethodDef<unknown, unknown>> = {
  "memory.list": {
    scope: "memory:read",
    parse: (p) => parseListMemories(p),
    run: (admin, p) => invokeAdmin(admin.listMemories(p as ListMemoriesInput)),
  },
  "memory.get": {
    scope: "memory:read",
    parse: (p) => parseId(p),
    run: (admin, p) => invokeAdmin(admin.getMemory((p as { id: string }).id)),
  },
  "memory.forget": {
    scope: "memory:forget",
    parse: (p) => parseId(p),
    run: (admin, p) => invokeAdmin(admin.forget((p as { id: string }).id)),
  },
  "memory.recall": {
    scope: "memory:read",
    parse: (p) => parseRecall(p),
    run: (admin, p) => {
      const { query, k } = p as { query: string; k?: number };
      return invokeAdmin(admin.recall(query, k));
    },
  },
  "conflict.list": {
    scope: "memory:read",
    parse: () => undefined,
    run: (admin) => invokeAdmin(admin.listConflicts()),
  },
  "conflict.resolve": {
    scope: "memory:resolve-conflict",
    parse: (p) => parseResolveConflict(p),
    run: (admin, p, auth) =>
      invokeAdmin(
        admin.resolveConflict(
          p as {
            leftId: string;
            rightId: string;
            action: "keep_left" | "keep_right" | "keep_both";
            leftUpdatedAt: string;
            rightUpdatedAt: string;
          },
          { kind: "dsh", token_id: auth.tokenId },
        ),
      ),
  },
  "skill.list": {
    scope: "skill:read",
    parse: () => undefined,
    run: (admin) => invokeAdmin(admin.listSkills()),
  },
  "proposal.list": {
    scope: "proposal:read",
    parse: () => undefined,
    run: (admin) => invokeAdmin(admin.listProposals()),
  },
  "proposal.apply": {
    scope: "proposal:apply",
    parse: (p) => parseApplyProposal(p),
    run: (admin, p) => {
      const { id, skillName } = p as { id: string; skillName: string };
      return invokeAdmin(admin.applyProposal(id, skillName));
    },
  },
  "ops.doctor": {
    scope: "ops:doctor",
    parse: () => undefined,
    run: (admin) => invokeAdmin(admin.doctor()),
  },
  "ops.failed.list": {
    scope: "ops:doctor",
    parse: (p) => {
      if (p == null || typeof p !== "object" || Array.isArray(p)) return { limit: undefined };
      const limit = (p as { limit?: unknown }).limit;
      if (limit == null) return { limit: undefined };
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new RpcParseError("limit must be an integer 1..100");
      }
      return { limit };
    },
    run: (admin, p) => invokeAdmin(admin.listFailed((p as { limit?: number }).limit)),
  },
  "ops.failed.purge": {
    scope: "ops:flush",
    parse: (p) => {
      if (p == null || typeof p !== "object" || Array.isArray(p)) return { names: undefined };
      const names = (p as { names?: unknown }).names;
      if (names == null) return { names: undefined };
      if (!Array.isArray(names) || !names.every((n) => typeof n === "string")) {
        throw new RpcParseError("names must be a string array");
      }
      return { names: names as string[] };
    },
    run: (admin, p) => invokeAdmin(admin.purgeFailed((p as { names?: string[] }).names)),
  },
  "ops.flush": {
    scope: "ops:flush",
    parse: (p) => parseFlush(p),
    run: (admin, p) => invokeAdminAsync(admin.flush((p as { sessionId?: string }).sessionId)),
  },
  "ops.rebuild": {
    scope: "ops:rebuild",
    parse: () => undefined,
    run: (admin) => invokeAdmin(admin.rebuildIndex()),
  },
  "ops.consolidate": {
    scope: "ops:consolidate",
    parse: (p) => parseConsolidate(p),
    run: (admin, p) => invokeAdminAsync(admin.consolidate((p as { dryRun: boolean }).dryRun)),
  },
  "ops.compile": {
    scope: "ops:compile",
    parse: (p) => parseCompile(p),
    run: (admin, p) => invokeAdmin(admin.compile((p as { target?: string }).target)),
  },
  "config.get": {
    scope: "config:read",
    parse: () => undefined,
    run: (admin) => invokeAdmin(admin.getConfig()),
  },
  "config.put": {
    scope: "config:write",
    parse: (p) => parsePutConfig(p),
    run: (admin, p) => {
      const { config, api_key_replacement } = p as {
        config: unknown;
        api_key_replacement?: string;
      };
      const body = api_key_replacement != null ? { config, api_key_replacement } : { config };
      return invokeAdmin(admin.putConfig(body));
    },
  },
};

function resolveAuth(auth: RpcAuth, scope: DshAdminScope): AuthResult {
  if (typeof auth === "function") return auth(scope);
  return auth;
}

function parseEnvelope(envelope: unknown): RpcRequest {
  if (envelope == null || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new RpcParseError("request must be an object");
  }
  const e = envelope as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id.length === 0 || e.id.length > MAX_ID_LENGTH) {
    throw new RpcParseError("id must be a non-empty string");
  }
  if (
    typeof e.method !== "string" ||
    e.method.length === 0 ||
    e.method.length > MAX_METHOD_LENGTH
  ) {
    throw new RpcParseError("method must be a non-empty string");
  }
  if (!RPC_METHODS.includes(e.method as RpcMethod)) {
    throw new RpcMethodNotFoundError(e.method);
  }
  const params = "params" in e ? e.params : {};
  return { id: e.id, method: e.method as RpcMethod, params };
}

class RpcMethodNotFoundError extends Error {
  constructor(public readonly method: string) {
    super(`method not found: ${method}`);
    this.name = "RpcMethodNotFoundError";
  }
}

export function isRpcMethod(v: string): v is RpcMethod {
  return RPC_METHODS.includes(v as RpcMethod);
}

/** Scope for a registered method (CSRF mutating derived via isMutating). */
export function getRpcMethodScope(method: RpcMethod): DshAdminScope {
  return registry[method].scope;
}

export async function dispatchRpc(
  admin: AmemAdmin,
  envelope: unknown,
  auth: RpcAuth,
): Promise<RpcResponse> {
  let req: RpcRequest;
  try {
    req = parseEnvelope(envelope);
  } catch (e) {
    if (e instanceof RpcMethodNotFoundError) {
      return errorResponse(
        typeof envelope === "object" && envelope != null && "id" in envelope
          ? String((envelope as Record<string, unknown>).id ?? "")
          : "",
        "not_found",
        e.message,
      );
    }
    return errorResponse(
      typeof envelope === "object" && envelope != null && "id" in envelope
        ? String((envelope as Record<string, unknown>).id ?? "")
        : "",
      "invalid_argument",
      e instanceof Error ? e.message : "bad request",
    );
  }

  const def = registry[req.method];
  const authResult = resolveAuth(auth, def.scope);
  if (!authResult.ok) {
    return errorResponse(req.id, "unauthenticated", "unauthenticated");
  }
  if (!authResult.scopes.includes(def.scope)) {
    return errorResponse(req.id, "permission_denied", `scope ${def.scope} required`);
  }

  let parsed: unknown;
  try {
    parsed = def.parse(req.params);
  } catch (e) {
    return errorResponse(
      req.id,
      "invalid_argument",
      e instanceof Error ? e.message : "invalid params",
    );
  }

  try {
    const result = await def.run(admin, parsed, {
      tokenId: authResult.tokenId,
      scopes: authResult.scopes,
    });
    return okResponse(req.id, result);
  } catch (e) {
    if (e instanceof RpcAdminError) {
      return errorResponse(req.id, mapAdminError(e.code), e.message);
    }
    if (e instanceof RpcParseError) {
      return errorResponse(req.id, "invalid_argument", e.message);
    }
    return errorResponse(req.id, "internal", "internal error");
  }
}
