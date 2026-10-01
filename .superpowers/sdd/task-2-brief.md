# Task 2 Brief — 长期能力令牌与 CLI

Work from: d:\dev\workspaces\amem
Branch: feat/dsh-auth-rpc-workbench
Depends on Task 1 (done): paths().dshTokens / auth exist; AmemConfig.dsh.admin exists.

## Global Constraints
- No connection.requestRejection / admit for auth
- Bearer never in URL, logs, amem.toml, localStorage, build artifacts
- Do not touch ocr-review.md
- Do not implement conflict.resolve business logic
- Schema version for token store file is 1

## Task 2 Full Text (from plan)

**Files:**
- Create: packages/adapter-dsh/src/auth-store.ts
- Create: packages/adapter-dsh/src/auth-store.test.ts
- Modify: packages/adapter-dsh/src/index.ts
- Modify: packages/cli/src/bin.ts
- Modify: packages/cli/src/list-export.test.ts

**Interfaces:**

```ts
type DshAdminScope =
  | "memory:read" | "memory:forget" | "memory:resolve-conflict"
  | "skill:read" | "proposal:read" | "proposal:apply"
  | "ops:doctor" | "ops:flush" | "ops:rebuild"
  | "ops:consolidate" | "ops:compile"
  | "config:read" | "config:write";

class DshTokenStore {
  issue(scopes: DshAdminScope[], ttlMs: number): { token: string; record: PublicTokenRecord };
  list(): PublicTokenRecord[];
  verify(token: string): VerifiedToken | null;
  revoke(id: string): boolean;
}

type PublicTokenRecord = {
  id: string;
  scopes: DshAdminScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};
```

Steps:
1. Write failing tests covering store-only-hash, reject expired/revoked, list never returns raw token, reject unknown/duplicate scopes, survives two sequential store instances. Read dsh-tokens.json and assert it does not contain issued token.
2. Run: pnpm --filter @amem/adapter-dsh test -- auth-store.test.ts — expect FAIL
3. Implement: randomBytes(32).toString('base64url'), sha256 hash, timingSafeEqual; schema v1; temp file + fsync + rename; auth lock directory for issue/revoke serialization. Public records must not include hash.
4. CLI: amem auth issue --target dsh --scopes ... [--ttl 8h]; amem auth list; amem auth revoke <token-id>. Extract testable duration parser for m/h/d; reject zero/negative/>365d. issue JSON includes token only that once.
5. Run adapter-dsh + cli tests and builds
6. Commit with message: feat(dsh): add scoped admin tokens

Report: .superpowers/sdd/task-2-report.md
