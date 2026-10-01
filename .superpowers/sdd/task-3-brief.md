# Task 3 Brief — 短浏览器会话、CSRF 与 Origin guard

Work from: d:\dev\workspaces\amem
Branch: feat/dsh-auth-rpc-workbench

## Dependencies ready
- DshTokenStore with verify/revoke/issue
- AmemConfig.dsh.admin: allowed_origins, session_ttl_minutes, auth_failure_limit

## Global Constraints
- No connection.requestRejection/admit
- Bearer never in URL/logs/toml/localStorage
- Auth failures return uniform unauthenticated (no token oracle)
- Do not touch ocr-review.md

## Task 3

**Files:**
- Create: packages/adapter-dsh/src/browser-session.ts
- Create: packages/adapter-dsh/src/browser-session.test.ts

**Interface:**

```ts
class BrowserSessionManager {
  login(input: LoginInput): LoginResult;
  issueCsrf(cookie: string, requestMeta: RequestMeta): CsrfResult;
  authenticate(cookie: string, csrf: string | undefined, required: DshAdminScope[], meta: RequestMeta): AuthResult;
  logout(cookie: string): void;
  revokeToken(tokenId: string): void;
}
```

Tests required:
1. exchanges a bearer for an HttpOnly Strict cookie and csrf token
2. caps session expiry by token expiry and configured ttl
3. rejects origin, host and sec-fetch-site mismatches
4. requires csrf for mutating RPC but not read RPC
5. invalidates sessions after token revocation
6. rate-limits repeated failed login attempts without token oracle

Implementation:
- session id and CSRF: 32-byte CSPRNG; server stores hashes only
- cookie name: amem_dsh_session
- attributes: HttpOnly; SameSite=Strict; Path=/amem-api; Max-Age=<ttl>
- Secure only when origin scheme is HTTPS
- remote non-HTTPS origins rejected at config validation stage (already have isValidAllowedOrigin; enforce https for non-loopback if needed in this module)
- Consumes DshTokenStore.verify()
- Constructor should take home + admin config (allowed_origins, session_ttl_minutes, auth_failure_limit) + token store

Also export from index.ts if needed for later tasks — optional for this commit; plan only lists the two new files for commit. Stick to plan commit files:
git add packages/adapter-dsh/src/browser-session.ts packages/adapter-dsh/src/browser-session.test.ts
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m \"feat(dsh): add browser admin sessions\"

Design reference: docs/superpowers/specs/2026-10-01-recall-governance-and-dsh-workbench-design.md section 6
Plan: docs/superpowers/plans/2026-10-01-dsh-auth-rpc-workbench.md Task 3

Report: .superpowers/sdd/task-3-report.md
