# Task 7 Brief — 文档、验收和整体验证

Work from: d:\dev\workspaces\amem
Branch: feat/dsh-auth-rpc-workbench

## Deliverables
- Create scripts/accept-dsh-admin.mjs
- Modify package.json with accept:dsh-admin script
- Modify README.md and docs/README.md

Acceptance script in temp AMEM_HOME:
1. init
2. issue read-only token
3. start adapter route test server (reuse plugin test harness patterns if present)
4. login + memory.list
5. config.get has no api_key
6. read-only token cannot config.put
7. issue config token + verify CSRF for mutation
8. revoke token + short session fails
9. raw token never in disk/logs

README must document:
amem auth issue --target dsh --scopes memory:read,skill:read,proposal:read
dsh web
local/remote origin config, one-time token display, browser unlock, scopes, revoke
same-origin malicious plugin is outside isolation boundary

Then run FULL verification:
pnpm build
pnpm test
pnpm accept:dsh-admin
git diff --check

Commit ONLY:
README.md docs/README.md scripts/accept-dsh-admin.mjs package.json
message: docs: document DSH admin authentication

NEVER stage/commit ocr-review.md or .superpowers/sdd scratch if avoidable.
Working tree after commit should only leave ocr-review.md (and maybe sdd reports) untracked — do not delete user ocr-review.md.

Report: .superpowers/sdd/task-7-report.md
