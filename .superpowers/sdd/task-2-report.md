# Task 2 报告 — 长期能力令牌与 CLI

## 状态
完成。

## 提交
- `043e256` feat(dsh): add scoped admin tokens

## 变更文件
- `packages/adapter-dsh/src/auth-store.ts`（新建）
- `packages/adapter-dsh/src/auth-store.test.ts`（新建）
- `packages/adapter-dsh/src/index.ts`（导出 `DshTokenStore` 等类型）
- `packages/cli/src/bin.ts`（新增 `amem auth issue/list/revoke` 与可测试 duration parser）
- `packages/cli/src/list-export.test.ts`（新增 CLI auth 测试）

## 测试摘要
| 包 | 测试 | 结果 |
|---|---|---|
| `@amem/adapter-dsh` | `auth-store.test.ts` 等全量 | 30 passed |
| `@amem/cli` | `list-export.test.ts` | 3 passed |
| `@amem/adapter-dsh` | build | PASS |
| `@amem/cli` | build | PASS |

## 关键实现点
- Token 使用 `randomBytes(32).toString("base64url")` 生成，仅持久化 SHA-256 base64url 哈希。
- 验证使用 `timingSafeEqual`，并跳过过期/撤销记录。
- 文件 schema 版本固定为 `1`；写盘采用同目录临时文件 + `fsync` + `rename`。
- `issue`/`revoke` 通过 `auth/.issue-lock` 目录锁串行化。
- 公开记录 `list()` 不含 `hash`，磁盘文件经测试也不含原始 token。
- CLI duration parser 支持 `m`/`h`/`d`，拒绝零值、负数、超过 365 天及非法格式。
- `amem auth issue` 的 JSON 输出仅在本次返回 `token`。

## 顾虑
- 无。

## 报告路径
`.superpowers/sdd/task-2-report.md`
