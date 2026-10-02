import type { IncomingHttpHeaders } from "node:http";
import type { DshAdminScope } from "./auth-store.js";
import {
  BrowserSessionManager,
  type AuthResult,
  type CsrfResult,
  type LoginInput,
  type LoginResult,
  type RequestMeta,
} from "./browser-session.js";

/** Everything authorizeRpc needs from an HTTP request (cookie + CSRF stay together). */
export type AuthorizeRpcInput = {
  cookieHeader: string | undefined;
  /** Prefer design-name `X-CSRF-Token`; pass legacy `X-Amem-Csrf` as csrfLegacy. */
  csrf?: string;
  csrfLegacy?: string;
  origin: string;
  host: string;
  secFetchSite?: string;
};

/**
 * Deep request-auth module: owns cookie/CSRF header reading and auth_enabled branching.
 * Plugin only path-dispatches; BrowserSessionManager keeps session crypto/rules.
 */
export class DshRequestAuth {
  constructor(
    private readonly sessions: BrowserSessionManager,
    private readonly authEnabled: boolean,
  ) {}

  login(input: LoginInput): LoginResult {
    return this.sessions.login(input);
  }

  status(meta: RequestMeta): AuthResult {
    return this.sessions.authorizeLocal([], meta);
  }

  issueCsrf(cookieHeader: string | undefined, meta: RequestMeta): CsrfResult {
    return this.sessions.issueCsrf(cookieHeader ?? "", meta);
  }

  logout(cookieHeader: string | undefined): void {
    this.sessions.logout(cookieHeader ?? "");
  }

  authorizeRpc(input: AuthorizeRpcInput, required: DshAdminScope): AuthResult {
    const meta: RequestMeta = {
      origin: input.origin,
      host: input.host,
      secFetchSite: input.secFetchSite,
    };
    const csrf = pickCsrf(input.csrf, input.csrfLegacy);
    if (this.authEnabled) {
      return this.sessions.authenticate(input.cookieHeader ?? "", csrf, [required], meta);
    }
    return this.sessions.authorizeLocal([required], meta);
  }

  rpcAuthFn(input: AuthorizeRpcInput): (required: DshAdminScope) => AuthResult {
    return (required) => this.authorizeRpc(input, required);
  }
}

/** Prefer `X-CSRF-Token`; accept legacy `X-Amem-Csrf`. */
export function readCsrfFromHeaders(headers: IncomingHttpHeaders): {
  csrf?: string;
  csrfLegacy?: string;
} {
  const primary = headers["x-csrf-token"];
  const legacy = headers["x-amem-csrf"];
  return {
    csrf: typeof primary === "string" && primary ? primary : undefined,
    csrfLegacy: typeof legacy === "string" && legacy ? legacy : undefined,
  };
}

function pickCsrf(csrf?: string, csrfLegacy?: string): string | undefined {
  if (csrf) return csrf;
  if (csrfLegacy) return csrfLegacy;
  return undefined;
}
