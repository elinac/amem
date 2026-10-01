# Task 5 Brief — 替换 DSH HTTP 路由

Work from: d:\dev\\workspaces\\amem
Branch: feat/dsh-auth-rpc-workbench

Read plan Task 5 fully and current plugin.ts / plugin.test.ts / install paths in cli bin.ts.

## Requirements
Replace Connection-based auth and legacy REST with exactly four routes under /amem-api:
- POST /amem-api/auth/session
- POST /amem-api/auth/csrf
- DELETE /amem-api/auth/session
- POST /amem-api/rpc

Tests (rewrite plugin.test.ts):
- does not probe Connection auth methods
- logs in with bearer and sets a safe cookie
- rejects RPC without a browser session
- runs read RPC with session scope
- rejects mutating RPC without csrf
- rejects cross-origin and oversized requests
- does not expose legacy REST management routes

Implementation:
- readBody stop at >64 KiB -> invalid_argument
- Cookie parser exact name amem_dsh_session
- Cache-Control: no-store on auth+RPC; X-Content-Type-Options: nosniff on all
- Remove old REST dispatch and Connection duck typing
- inject only ['webServer']
- installDsh wrapper: export const inject = mod.inject ?? ['webServer']
- install result hint: amem auth issue --target dsh --scopes memory:read,skill:read,proposal:read

Wire: DshTokenStore + BrowserSessionManager + rpc dispatch from Task 2-4.
Use cfg.dsh.admin for allowed_origins, session_ttl, auth_failure_limit.

Commit files:
packages/adapter-dsh/src/plugin.ts
packages/adapter-dsh/src/plugin.test.ts
packages/cli/src/bin.ts
Message: feat(dsh): protect admin RPC independently

Never touch ocr-review.md
Report: .superpowers/sdd/task-5-report.md
