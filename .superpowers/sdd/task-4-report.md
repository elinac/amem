# Task 4 Report — 分页管理方法与固定 RPC 注册表

## Status
✅ Done，等待提交。

## Changes

### `packages/adapter-dsh/src/admin.ts`
- 扩展 `listMemories`：保留 `number` 旧签名（`plugin.ts`、CLI 兼容），新增 `ListMemoriesInput` 重载。
- `ListMemoriesInput` 支持 `page`、受限 `pageSize`（20|50|100）、`q` 关键词搜索、以及 `kind/level/trust/status` 单选过滤。
- 所有过滤、排序（`updated_at` 倒序）、切片在同一份 `MemoryStore.listAll()` 快照上完成；分页超限返回空 `items`。
- `facets` 各维度采用“已应用 `q` 及其它维度过滤、但排除该维度自身选择”的计数口径。
- `total === 0` 时固定返回 `page: 1`。
- 正文预览限制为最多 200 字符。
- 非法枚举、非正页码、非允许 `pageSize` 返回 400。
- `getConfig()` 返回的配置中 `llm.api_key` 被替换为 `llm.has_api_key`，永不暴露真实密钥。
- `putConfig()` 支持可选 `api_key_replacement`；缺失或空字符串表示不修改磁盘密钥。
- 复用 `DshAdminScope` 类型。

### `packages/adapter-dsh/src/rpc.ts`（新增）
- 定义 `RpcRequest`、`RpcResponse`、`RpcMethodDef` 与 `RpcAuth` 类型。
- 固定注册表包含：
  - `memory.list/get/forget`
  - `skill.list`
  - `proposal.list/apply`
  - `ops.doctor/flush/rebuild/consolidate/compile`
  - `config.get/put`
- 不注册 `conflict.*`；未知方法统一返回 `not_found`。
- `dispatchRpc` 完成 envelope 校验、scope 检查、参数解析、方法调用和错误映射。
- 错误码稳定输出 `invalid_argument`、`unauthenticated`、`permission_denied`、`not_found`、`conflict`、`internal`；异常不泄露堆栈或密钥。
- 复用 `BrowserSessionManager.isMutating` 与 `DshAdminScope`。

### `packages/adapter-dsh/src/rpc.test.ts`（新增）
- 覆盖：未知方法、坏 envelope、参数校验失败、scope 不足、未认证会话、读 RPC 不要求 CSRF、变更 RPC 要求 CSRF、`config.get` 脱敏、admin `not_found` 不泄露堆栈、意外异常不泄露堆栈、固定注册表范围。

### `packages/adapter-dsh/src/admin-list.test.ts`（新增）
- 覆盖：过滤/排序/分页、facet 排除自身维度、零结果固定 page one、非法枚举与分页、预览 200 字符限制、旧 `number` 重载、`q` 搜索标题/适用情境/正文。

### `packages/adapter-dsh/src/index.ts`
- 导出 `ListMemoriesInput`。
- 导出 `BrowserSessionManager`、`isMutating` 及会话相关类型。
- 导出 `dispatchRpc`、`isRpcMethod`、`RPC_METHODS` 及 RPC 相关类型。

## Build & Test
- Command: `pnpm --filter @amem/adapter-dsh test`
- Result: 8 files / 64 tests passed.
- Command: `pnpm --filter @amem/adapter-dsh build`
- Result: `tsc -p tsconfig.json` clean.

## Self-review
- 旧 `number` 调用方（`plugin.ts` `/memories?limit=`、CLI `list.ts`）行为保持不变。
- `getConfig` 不再返回 `llm.api_key`；`has_api_key` 反映磁盘或环境变量存在性。
- `putConfig` 的 `api_key_replacement` 非空才写入，避免误清密钥。
- RPC 注册表固定，无动态方法解析。
- 错误响应不附带堆栈或原始异常消息（`internal` 统一文案）。
- 所有新增文件与改动均位于提交清单内。

## Concerns / Notes
- 当前 RPC 测试使用进程内 `BrowserSessionManager` 做认证；Task 5 接入 HTTP 路由后将验证真实 cookie/CSRF/Origin 流程。
- `config.put` 的 `api_key_replacement` 字段与 `config` 同级传入 RPC params，再由 dispatcher 组装为 `{ config, api_key_replacement }` 调用 `admin.putConfig`。
- 未实现 `conflict.*` 方法，符合本计划范围。

## Files Touched
- `packages/adapter-dsh/src/admin.ts`
- `packages/adapter-dsh/src/admin-list.test.ts`
- `packages/adapter-dsh/src/rpc.ts`
- `packages/adapter-dsh/src/rpc.test.ts`
- `packages/adapter-dsh/src/index.ts`
