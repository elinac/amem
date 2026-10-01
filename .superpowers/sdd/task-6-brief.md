# Task 6 Brief — 组件化并重做 DSH 工作台

Work from: d:\dev\workspaces\amem
Branch: feat/dsh-auth-rpc-workbench

Read plan Task 6 fully + design §7-8.
Existing UI: packages/amem-dsh-ui/client/panel.tsx, locales.ts, package.json

## Deliverables
- Create api.ts, styles.ts, components.ts
- Modify panel.tsx, locales.ts, package.json
- Possibly create client/*.test.ts for pure functions

AuthState: locked | unlocking | ready{csrf,scopes,expiresAt} | error
Bearer only as login(token) arg — clear input after; never React long-lived state/storage/URL

Components: UnlockView, SideNav, FilterBar, MemoryRow, Pagination, StatusMessage
Tokens: surface, surfaceRaised, text, textMuted, border, accent, danger, warning, success, radiusSm/Md, space1..6
Prefer host CSS vars + light/dark fallbacks. No gradients/heavy shadows/card walls.
Wide: left nav + content; <720px: horizontal tabs.

Memory list: search debounce 300ms, kind/level/trust/status filters, pageSize 20|50|100, request sequence ignore stale, skeleton/refresh keep old/error retry/empty/out-of-range page fallback.

Migrate skills/proposals/ops/config to RPC.
Ops: summary first, raw JSON in details.
Config: no secret display; blank write-only key field.
Review nav empty state (no conflict.* calls):
当前版本尚未建立结构化冲突索引；完成冲突治理迁移后此处将显示待裁决项。

package.json test: vitest run then tsc --noEmit
Pure tests: resets page after filter; ignores stale sequence; total-zero page one; does not retain bearer after login

Commit message: feat(ui): rebuild DSH memory workbench
Include all UI files changed. Never touch ocr-review.md

Report: .superpowers/sdd/task-6-report.md
