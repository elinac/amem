# Task 1 报告：配置、路径与安全默认值

分支：`feat/dsh-auth-rpc-workbench`  
提交：`8a1e1a4` — `feat(core): add DSH admin security config`

## 实现摘要

| 产出 | 位置 |
|------|------|
| `AmemConfig["dsh"]["admin"]` + `auto_inject` | `packages/core/src/config.ts` |
| `paths(home).auth` / `.dshTokens` / `.dshRpcAudit` | `packages/core/src/paths.ts` |
| TOML `[dsh]`、`[dsh.admin]`、字符串数组读写 | `parseSimpleToml` / `configToToml` |
| Origin / TTL / 失败上限校验 | `sanitizeDshConfig`（读盘后） |

### 默认值

- `allowed_origins`: `http://127.0.0.1`, `http://localhost`
- `session_ttl_minutes`: 480（合法范围 1–1440，越界 clamp）
- `auth_failure_limit`: 8（合法范围 1–100，越界 clamp）
- `auto_inject`: false

### 辅助符号（导出供后续任务复用）

- `unescapeTomlString` / `parseTomlStringArray` / `isValidAllowedOrigin`

Origin 规则：`http(s)://host[:port]`，无 path/query/hash/userinfo；与 `URL` 规范化后的 `protocol//host` 字符串完全一致。

## TDD

### RED（仅加测试、未实现）

```text
pnpm --filter @amem/core test
```

- `config.test.ts`: `Cannot read properties of undefined (reading 'admin')`
- `index.test.ts`: `paths(home).auth` 等为 `undefined`

### GREEN（实现后）

```text
pnpm --filter @amem/core test
pnpm --filter @amem/core build
```

- 测试：24 passed（2 files）
- 构建：`tsc` exit 0

## 变更文件

- `packages/core/src/config.ts`
- `packages/core/src/config.test.ts`
- `packages/core/src/paths.ts`
- `packages/core/src/index.test.ts`

未暂存/提交：`ocr-review.md`（未触碰）、`.superpowers/sdd/task-1-brief.md`（工作区有无关改动，未纳入 commit）。

## 自审

**符合 brief：**

- 类型与默认值与计划一致。
- 数组序列化使用 `escapeTomlString`；反序列化使用 `parseTomlStringArray` + `unescapeTomlString`。
- 路径：`auth/`、`auth/dsh-tokens.json`、`logs/dsh-rpc-audit.jsonl`。
- 验收用例 `round-trips DSH admin security settings` 与 paths 断言已通过。

**实现说明：**

- `parseSimpleToml` 对所有双引号标量改用 `unescapeTomlString`（此前为 raw slice），与 `configToToml` 转义行为一致；现有 14 个 config 测试仍全绿。
- 非法 origin 在读盘时过滤；若过滤后为空则回退默认 origin 列表（避免空 CSRF 允许列表）。
- `preservePrivacyTomlSection` 仍只替换 `[privacy]` 段；`[dsh]` 写在 privacy 之后，写盘合并逻辑未改，privacy 相关测试仍通过。

**非本任务范围（未做）：**

- `EditableConfigPatch` / RPC / token store。
- privacy 数组 TOML 解析（仍为段保留策略）。

## 关注点

- 读盘 clamp 会静默修正越界 TTL/失败次数；若后续 DSH 面板编辑 dsh 段，需在 PUT 路径单独做显式校验与错误响应（Task 2+）。
- 未导出 `sanitizeDshConfig`；外部应通过 `loadConfig` / `parseSimpleToml` 获得已消毒配置。

## 验证命令（Windows PowerShell）

```powershell
pnpm --filter @amem/core test
pnpm --filter @amem/core build
```
