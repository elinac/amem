import type {
  MemoryKind,
  MemoryStatus,
  ScopeLevel,
  Trust,
} from "@amem/core";
import type { AmemAdmin, ListMemoriesInput } from "./admin.js";
import type { DshAdminScope } from "./auth-store.js";
import type { AuthResult } from "./browser-session.js";

export const RPC_METHODS = [
  "memory.list",
  "memory.get",
  "memory.forget",
  "skill.list",
  "proposal.list",
  "proposal.apply",
  "ops.doctor",
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
  scope: DshAdminScope;
  mutates: boolean;
  parse(params: unknown): P;
  run(admin: AmemAdmin, params: P): Promise<R> | R;
};

export type RpcAuth = AuthResult | ((required: DshAdminScope) => AuthResult);

const MAX_ID_LENGTH = 128;
const MAX_METHOD_LENGTH = 64;
const MAX_STRING_PARAM_LENGTH = 512;
const MAX_QUERY_LENGTH = 256;
const MAX_PAGE_SIZE = 100;

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

function safeOptionalString(v: unknown, name: string, max = MAX_STRING_PARAM_LENGTH): string | undefined {
  if (v === undefined || v === null) return undefined;
  return safeString(v, name, max);
}

function safePositiveInt(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || Math.floor(v) !== v) {
    throw new RpcParseError(`${name} must be a positive integer`);
  }
  return v;
}

function safeOptionalEnum<T extends string | number>(v: unknown, name: string, values: readonly T[]): T | undefined {
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

const MEMORY_KINDS: MemoryKind[] = [
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
const SCOPE_LEVELS: ScopeLevel[] = ["instance", "domain", "global"];
const TRUSTS: Trust[] = ["T3", "T2", "T1"];
const MEMORY_STATUSES: MemoryStatus[] = [
  "candidate",
  "active",
  "superseded",
  "conflict",
  "frozen",
  "expired",
];
const PAGE_SIZES: ListMemoriesInput["pageSize"][] = [20, 50, 100];

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

function adminResultToData(result: { ok: true; data: unknown } | { ok: false; error: string; message: string; status: number }): { data?: unknown; error?: { code: string; message: string } } {
  if (result.ok) return { data: result.data };
  return {
    error: {
      code: mapAdminError(result.error),
      message: result.message,
    },
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
      return "conflict";
    case "internal":
    default:
      return "internal";
  }
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
    mutates: false,
    parse: (p) => parseListMemories(p),
    run: (admin, p) => {
      const r = admin.listMemories(p as ListMemoriesInput);
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "memory.get": {
    scope: "memory:read",
    mutates: false,
    parse: (p) => parseId(p),
    run: (admin, p) => {
      const r = admin.getMemory((p as { id: string }).id);
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "memory.forget": {
    scope: "memory:forget",
    mutates: true,
    parse: (p) => parseId(p),
    run: (admin, p) => {
      const r = admin.forget((p as { id: string }).id);
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "skill.list": {
    scope: "skill:read",
    mutates: false,
    parse: () => undefined,
    run: (admin) => {
      const r = admin.listSkills();
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "proposal.list": {
    scope: "proposal:read",
    mutates: false,
    parse: () => undefined,
    run: (admin) => {
      const r = admin.listProposals();
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "proposal.apply": {
    scope: "proposal:apply",
    mutates: true,
    parse: (p) => parseApplyProposal(p),
    run: (admin, p) => {
      const { id, skillName } = p as { id: string; skillName: string };
      const r = admin.applyProposal(id, skillName);
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "ops.doctor": {
    scope: "ops:doctor",
    mutates: false,
    parse: () => undefined,
    run: (admin) => {
      const r = admin.doctor();
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "ops.flush": {
    scope: "ops:flush",
    mutates: true,
    parse: (p) => parseFlush(p),
    run: async (admin, p) => {
      const r = await admin.flush((p as { sessionId?: string }).sessionId);
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "ops.rebuild": {
    scope: "ops:rebuild",
    mutates: true,
    parse: () => undefined,
    run: (admin) => {
      const r = admin.rebuildIndex();
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "ops.consolidate": {
    scope: "ops:consolidate",
    mutates: true,
    parse: (p) => parseConsolidate(p),
    run: (admin, p) => {
      const r = admin.consolidate((p as { dryRun: boolean }).dryRun);
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "ops.compile": {
    scope: "ops:compile",
    mutates: true,
    parse: (p) => parseCompile(p),
    run: (admin, p) => {
      const r = admin.compile((p as { target?: string }).target);
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "config.get": {
    scope: "config:read",
    mutates: false,
    parse: () => undefined,
    run: (admin) => {
      const r = admin.getConfig();
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
  "config.put": {
    scope: "config:write",
    mutates: true,
    parse: (p) => parsePutConfig(p),
    run: (admin, p) => {
      const { config, api_key_replacement } = p as { config: unknown; api_key_replacement?: string };
      const body = api_key_replacement != null ? { config, api_key_replacement } : { config };
      const r = admin.putConfig(body);
      if (r.ok) return r.data;
      throw new RpcAdminError(r.error, r.message, r.status);
    },
  },
};

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
  if (typeof e.method !== "string" || e.method.length === 0 || e.method.length > MAX_METHOD_LENGTH) {
    throw new RpcParseError("method must be a non-empty string");
  }
  if (!RPC_METHODS.includes(e.method as RpcMethod)) {
    throw new RpcMethodNotFoundError(e.method);
  }
  if (!("params" in e)) {
    throw new RpcParseError("params required");
  }
  return { id: e.id, method: e.method as RpcMethod, params: e.params };
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
    const result = await def.run(admin, parsed);
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
