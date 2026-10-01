# Task 4 Brief — 分页管理方法与固定 RPC 注册表

Work from: d:\dev\workspaces\amem
Branch: feat/dsh-auth-rpc-workbench

## Task 4
See plan docs/superpowers/plans/2026-10-01-dsh-auth-rpc-workbench.md Task 4
Design list API: docs/superpowers/specs/2026-10-01-recall-governance-and-dsh-workbench-design.md section 7

**Files:**
- Create: packages/adapter-dsh/src/rpc.ts
- Create: packages/adapter-dsh/src/rpc.test.ts
- Create: packages/adapter-dsh/src/admin-list.test.ts
- Modify: packages/adapter-dsh/src/admin.ts
- Modify: packages/adapter-dsh/src/index.ts

listMemories input: page, pageSize 20|50|100, q?, kind?, level?, trust?, status?
- filters/facets/sort/slice from ONE listAll() snapshot
- facets exclude own selected dimension
- empty total => page one
- reject invalid enums/page/pageSize
- preview max 200 chars

getConfig must omit llm.api_key and expose has_api_key
putConfig accepts optional api_key_replacement; empty means leave unchanged

RPC registry methods:
memory.list, memory.get, memory.forget,
skill.list,
proposal.list, proposal.apply,
ops.doctor, ops.flush, ops.rebuild, ops.consolidate, ops.compile,
config.get, config.put

No conflict.* yet. Unknown method => not_found
RPC tests: unknown method, bad envelope, bad params, insufficient scope, read no CSRF, mutation needs CSRF, exceptions no stack leak

Authenticate integration: rpc dispatcher should accept an AuthResult/session checker; for unit tests you can inject auth or call methods after BrowserSessionManager.authenticate.

Commit:
git add packages/adapter-dsh/src/admin.ts packages/adapter-dsh/src/admin-list.test.ts packages/adapter-dsh/src/rpc.ts packages/adapter-dsh/src/rpc.test.ts packages/adapter-dsh/src/index.ts
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m \"feat(dsh): add scoped admin RPC\"

Do not touch ocr-review.md
Report: .superpowers/sdd/task-4-report.md
