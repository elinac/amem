import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { paths } from "@amem/core";

export type DshAdminScope =
  | "memory:read"
  | "memory:forget"
  | "memory:resolve-conflict"
  | "skill:read"
  | "proposal:read"
  | "proposal:apply"
  | "ops:doctor"
  | "ops:flush"
  | "ops:rebuild"
  | "ops:consolidate"
  | "ops:compile"
  | "config:read"
  | "config:write";

export type PublicTokenRecord = {
  id: string;
  scopes: DshAdminScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};

export type VerifiedToken = {
  id: string;
  scopes: DshAdminScope[];
};

type InternalTokenRecord = PublicTokenRecord & { hash: string };

type TokenFile = {
  version: 1;
  tokens: InternalTokenRecord[];
};

const ALL_SCOPES: DshAdminScope[] = [
  "memory:read",
  "memory:forget",
  "memory:resolve-conflict",
  "skill:read",
  "proposal:read",
  "proposal:apply",
  "ops:doctor",
  "ops:flush",
  "ops:rebuild",
  "ops:consolidate",
  "ops:compile",
  "config:read",
  "config:write",
];

const MAX_LOCK_WAIT_MS = 5000;
const LOCK_POLL_MS = 10;

function validateScopes(scopes: DshAdminScope[]): void {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error("scopes must be a non-empty array");
  }
  const seen = new Set<string>();
  for (const s of scopes) {
    if (!ALL_SCOPES.includes(s)) {
      throw new Error(`unknown scope: ${s}`);
    }
    if (seen.has(s)) {
      throw new Error(`duplicate scope: ${s}`);
    }
    seen.add(s);
  }
}

function acquireLock(lockDir: string): void {
  const deadline = Date.now() + MAX_LOCK_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lockDir, { recursive: false });
      return;
    } catch {
      const remaining = deadline - Date.now();
      const wait = Math.min(LOCK_POLL_MS, Math.max(0, remaining));
      const start = Date.now();
      while (Date.now() - start < wait) {
        // busy wait
      }
    }
  }
  throw new Error("auth store lock timeout");
}

function releaseLock(lockDir: string): void {
  try {
    rmdirSync(lockDir);
  } catch {
    /* ignore release failures */
  }
}

function withLock<T>(lockDir: string, fn: () => T): T {
  acquireLock(lockDir);
  try {
    return fn();
  } finally {
    releaseLock(lockDir);
  }
}

function atomicWriteJson(path: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(tmp, text, "utf8");
  const fd = openSync(tmp, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export class DshTokenStore {
  private readonly path: string;
  private readonly lockDir: string;

  constructor(home: string) {
    const p = paths(home);
    this.path = p.dshTokens;
    this.lockDir = join(p.auth, ".issue-lock");
  }

  issue(scopes: DshAdminScope[], ttlMs: number): { token: string; record: PublicTokenRecord } {
    validateScopes(scopes);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("ttl must be a positive number of milliseconds");
    }

    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("base64url");
    const now = Date.now();
    const internal: InternalTokenRecord = {
      id: randomBytes(16).toString("base64url"),
      hash,
      scopes: [...scopes],
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };

    return withLock(this.lockDir, () => {
      const file = this.readFile();
      file.tokens.push(internal);
      this.writeFile(file);
      const { hash: _hash, ...record } = internal;
      return { token, record };
    });
  }

  list(): PublicTokenRecord[] {
    const file = this.readFile();
    return file.tokens.map((t) => {
      const { hash, ...rest } = t;
      return rest;
    });
  }

  verify(token: string): VerifiedToken | null {
    if (!token || typeof token !== "string") return null;
    const hash = createHash("sha256").update(token).digest();
    const file = this.readFile();
    const now = Date.now();
    for (const t of file.tokens) {
      if (t.revokedAt) continue;
      if (new Date(t.expiresAt).getTime() <= now) continue;
      const recordHash = Buffer.from(t.hash, "base64url");
      if (recordHash.length !== hash.length) continue;
      if (timingSafeEqual(recordHash, hash)) {
        return { id: t.id, scopes: t.scopes };
      }
    }
    return null;
  }

  revoke(id: string): boolean {
    return withLock(this.lockDir, () => {
      const file = this.readFile();
      const t = file.tokens.find((x) => x.id === id && !x.revokedAt);
      if (!t) return false;
      t.revokedAt = new Date().toISOString();
      this.writeFile(file);
      return true;
    });
  }

  private readFile(): TokenFile {
    if (!existsSync(this.path)) {
      return { version: 1, tokens: [] };
    }
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (
        data &&
        typeof data === "object" &&
        (data as TokenFile).version === 1 &&
        Array.isArray((data as TokenFile).tokens)
      ) {
        return data as TokenFile;
      }
    } catch {
      /* corrupt or empty */
    }
    return { version: 1, tokens: [] };
  }

  private writeFile(file: TokenFile): void {
    atomicWriteJson(this.path, file);
  }
}
