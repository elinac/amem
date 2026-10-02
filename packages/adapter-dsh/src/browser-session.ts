import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ALL_DSH_ADMIN_SCOPES,
  type DshAdminScope,
  type DshTokenStore,
  type VerifiedToken,
} from "./auth-store.js";

export type LoginInput = {
  bearer: string;
  origin: string;
  host: string;
  secFetchSite?: string;
  clientKey?: string;
};

export type RequestMeta = {
  origin: string;
  host: string;
  secFetchSite?: string;
};

export type LoginResult =
  | { ok: true; cookie: string; csrfToken: string; scopes: DshAdminScope[]; expiresAt: string }
  | { ok: false; error: "unauthenticated" };

export type CsrfResult =
  | { ok: true; csrfToken: string; expiresAt: string }
  | { ok: false; error: "unauthenticated" };

export type AuthResult =
  | { ok: true; tokenId: string; scopes: DshAdminScope[] }
  | { ok: false; error: "unauthenticated" };

type AdminConfig = {
  allowed_origins: string[];
  session_ttl_minutes: number;
  auth_failure_limit: number;
};

const READ_SCOPES: readonly DshAdminScope[] = [
  "memory:read",
  "skill:read",
  "proposal:read",
  "config:read",
  "ops:doctor",
];

const COOKIE_NAME = "amem_dsh_session";
const COOKIE_PATH = "/amem-api";

export function isMutating(required: DshAdminScope[]): boolean {
  return required.some((s) => !READ_SCOPES.includes(s));
}

type InternalSession = {
  tokenId: string;
  scopes: DshAdminScope[];
  csrfHash: Buffer;
  expiresAt: number;
};

function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLoopbackHost(host: string): boolean {
  try {
    return isLoopbackHostname(new URL(`http://${host}`).hostname);
  } catch {
    const hostname = host
      .replace(/^\[|\]$/g, "")
      .split("%")[0]!
      .split(":")[0]!;
    return isLoopbackHostname(hostname);
  }
}

function clientKeyFor(input: LoginInput): string {
  return input.clientKey ?? input.origin;
}

export class BrowserSessionManager {
  private readonly home: string;
  private readonly cfg: AdminConfig;
  private readonly store: DshTokenStore;
  private readonly sessions = new Map<string, InternalSession>(); // key = base64url session hash
  private readonly failures = new Map<string, number>();
  private readonly revokedTokenIds = new Set<string>();

  constructor(home: string, cfg: AdminConfig, store: DshTokenStore) {
    this.home = home;
    this.cfg = cfg;
    this.store = store;
  }

  login(input: LoginInput): LoginResult {
    if (!this.validateLocalAccess(input)) {
      return { ok: false, error: "unauthenticated" };
    }

    const key = clientKeyFor(input);
    if (this.isRateLimited(key)) {
      return { ok: false, error: "unauthenticated" };
    }

    const verified = this.store.verify(input.bearer);
    if (!verified) {
      this.recordFailure(key);
      return { ok: false, error: "unauthenticated" };
    }

    const record = this.store.list().find((r) => r.id === verified.id);
    if (!record) {
      this.recordFailure(key);
      return { ok: false, error: "unauthenticated" };
    }

    const tokenExpiry = new Date(record.expiresAt).getTime();
    const now = Date.now();
    if (tokenExpiry <= now) {
      this.recordFailure(key);
      return { ok: false, error: "unauthenticated" };
    }

    this.failures.delete(key);
    return this.createSession(verified, input.origin, tokenExpiry);
  }

  issueCsrf(cookie: string, requestMeta: RequestMeta): CsrfResult {
    if (!this.validateLocalAccess(requestMeta)) {
      return { ok: false, error: "unauthenticated" };
    }
    const session = this.resolveSession(cookie);
    if (!session) {
      return { ok: false, error: "unauthenticated" };
    }
    if (this.revokedTokenIds.has(session.tokenId) || this.isTokenInactive(session.tokenId)) {
      const raw = this.parseCookie(cookie);
      if (raw) this.sessions.delete(sha256(raw).toString("base64url"));
      return { ok: false, error: "unauthenticated" };
    }
    const csrf = randomToken();
    session.csrfHash = sha256(csrf);
    return { ok: true, csrfToken: csrf, expiresAt: new Date(session.expiresAt).toISOString() };
  }

  authenticate(
    cookie: string,
    csrf: string | undefined,
    required: DshAdminScope[],
    meta: RequestMeta,
  ): AuthResult {
    if (!this.validateLocalAccess(meta)) {
      return { ok: false, error: "unauthenticated" };
    }
    if (isMutating(required) && !this.validateSecFetchSite(meta)) {
      return { ok: false, error: "unauthenticated" };
    }
    const session = this.resolveSession(cookie);
    if (!session) {
      return { ok: false, error: "unauthenticated" };
    }
    if (isMutating(required)) {
      if (!csrf || !timingSafeEqual(sha256(csrf), session.csrfHash)) {
        return { ok: false, error: "unauthenticated" };
      }
    }
    if (this.revokedTokenIds.has(session.tokenId) || this.isTokenInactive(session.tokenId)) {
      const raw = this.parseCookie(cookie);
      if (raw) this.sessions.delete(sha256(raw).toString("base64url"));
      return { ok: false, error: "unauthenticated" };
    }
    return { ok: true, tokenId: session.tokenId, scopes: session.scopes };
  }

  authorizeLocal(required: DshAdminScope[], meta: RequestMeta): AuthResult {
    if (!this.validateLocalAccess(meta)) {
      return { ok: false, error: "unauthenticated" };
    }
    // Auth-off / local identity: embedded DSH workbenches often omit Sec-Fetch-Site
    // (clients cannot forge it). Allow missing; still reject explicit cross-site.
    if (isMutating(required) && meta.secFetchSite != null && !this.validateSecFetchSite(meta)) {
      return { ok: false, error: "unauthenticated" };
    }
    return { ok: true, tokenId: "local", scopes: [...ALL_DSH_ADMIN_SCOPES] };
  }

  logout(cookie: string): void {
    const raw = this.parseCookie(cookie);
    if (!raw) return;
    this.sessions.delete(sha256(raw).toString("base64url"));
  }

  revokeToken(tokenId: string): void {
    this.store.revoke(tokenId);
    this.revokedTokenIds.add(tokenId);
    for (const [key, session] of this.sessions) {
      if (session.tokenId === tokenId) {
        this.sessions.delete(key);
      }
    }
  }

  private isTokenInactive(tokenId: string): boolean {
    const record = this.store.list().find((r) => r.id === tokenId);
    if (!record) return true;
    if (record.revokedAt) return true;
    return new Date(record.expiresAt).getTime() <= Date.now();
  }

  private createSession(verified: VerifiedToken, origin: string, tokenExpiry: number): LoginResult {
    const now = Date.now();
    const configuredTtlMs = this.cfg.session_ttl_minutes * 60 * 1000;
    const ttlMs = Math.max(0, Math.min(configuredTtlMs, tokenExpiry - now));
    const expiresAt = now + ttlMs;
    const rawSession = randomToken();
    const sessionHash = sha256(rawSession);
    const csrf = randomToken();
    const csrfHash = sha256(csrf);
    this.sessions.set(sessionHash.toString("base64url"), {
      tokenId: verified.id,
      scopes: verified.scopes,
      csrfHash,
      expiresAt,
    });
    const secure = origin.startsWith("https:");
    const maxAgeSec = Math.floor(ttlMs / 1000);
    const cookie = `${COOKIE_NAME}=${rawSession}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
    return {
      ok: true,
      cookie,
      csrfToken: csrf,
      scopes: verified.scopes,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  private resolveSession(cookie: string): InternalSession | undefined {
    const raw = this.parseCookie(cookie);
    if (!raw) return undefined;
    const key = sha256(raw).toString("base64url");
    const session = this.sessions.get(key);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return undefined;
    }
    return session;
  }

  private parseCookie(cookie: string): string | undefined {
    if (!cookie) return undefined;
    const prefix = `${COOKIE_NAME}=`;
    if (cookie.includes(";")) {
      const entries = cookie.split(";").map((p) => p.trim());
      for (const entry of entries) {
        if (entry.startsWith(prefix)) {
          const value = entry.slice(prefix.length).trim();
          return value || undefined;
        }
      }
      return undefined;
    }
    if (cookie.startsWith(prefix)) {
      const value = cookie.slice(prefix.length).trim();
      return value || undefined;
    }
    return cookie.trim() || undefined;
  }

  private validateOriginHost(meta: RequestMeta): boolean {
    const origin = meta.origin;
    if (!this.cfg.allowed_origins.includes(origin)) return false;
    try {
      const u = new URL(origin);
      if (u.host !== meta.host) return false;
      return true;
    } catch {
      return false;
    }
  }

  private validateLocalAccess(meta: RequestMeta): boolean {
    if (this.validateOriginHost(meta)) return true;
    if (!meta.origin) {
      return isLoopbackHost(meta.host);
    }
    try {
      const originUrl = new URL(meta.origin);
      if (originUrl.host !== meta.host) return false;
      if (!isLoopbackHostname(originUrl.hostname)) return false;
      return this.cfg.allowed_origins.some((allowed) => {
        try {
          const allowedUrl = new URL(allowed);
          return (
            allowedUrl.protocol === originUrl.protocol &&
            allowedUrl.hostname === originUrl.hostname &&
            (allowedUrl.port === "" || allowedUrl.port === originUrl.port)
          );
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  private validateSecFetchSite(meta: RequestMeta): boolean {
    if (meta.secFetchSite == null) return false;
    // DSH / embedded webviews often send same-site for same-host fetches.
    return (
      meta.secFetchSite === "same-origin" ||
      meta.secFetchSite === "same-site" ||
      meta.secFetchSite === "none"
    );
  }

  private isRateLimited(clientKey: string): boolean {
    const count = this.failures.get(clientKey) ?? 0;
    return count >= this.cfg.auth_failure_limit;
  }

  private recordFailure(clientKey: string): void {
    this.failures.set(clientKey, (this.failures.get(clientKey) ?? 0) + 1);
  }
}
