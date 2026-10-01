# DSH 管理面板默认关闭认证实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 DSH 管理面板默认无需认证，同时保留通过配置显式启用长期 token、短会话、scope 和 CSRF 保护的能力。

**Architecture:** 在 `dsh.admin` 配置中加入 `auth_enabled`。服务端根据该开关选择匿名本机管理身份或现有浏览器会话认证；API 返回认证模式，UI 据此初始化为 ready 或 locked。来源校验、请求限制和固定 RPC 注册表始终保留。

**Tech Stack:** TypeScript、Vitest、React、TOML 配置。

## Global Constraints

- 默认 `dsh.admin.auth_enabled = false`。
- `auth_enabled = true` 时现有认证安全行为不变。
- CLI、MCP、headless/ACP 行为不变。
- 不记录 bearer、CSRF、记忆正文或完整配置。

---

### Task 1: 配置开关

**Files:**
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/src/config.test.ts`

- [ ] 写测试：断言 `defaultConfig().dsh.admin.auth_enabled === false`，并断言 `configToToml`/`parseSimpleToml` 保留显式 `true`。
- [ ] 运行 `pnpm exec vitest run packages/core/src/config.test.ts`，确认测试因字段不存在或序列化缺失而失败。
- [ ] 在 `AmemConfig`、默认值、TOML 解析和序列化中加入 `auth_enabled: boolean`。
- [ ] 重新运行该测试，确认通过。

### Task 2: 服务端无认证模式

**Files:**
- Modify: `packages/adapter-dsh/src/plugin.ts`
- Test: `packages/adapter-dsh/src/plugin.test.ts`

- [ ] 写测试：默认配置下，带合法 loopback 来源的 `POST /amem-api/rpc` 在没有 cookie 和 CSRF 时成功执行 `memory.list`；认证开启的配置下保留无会话返回 `401 unauthenticated`。
- [ ] 运行 `pnpm exec vitest run packages/adapter-dsh/src/plugin.test.ts`，确认新增默认无认证测试失败。
- [ ] 将服务端认证分支封装为：`auth_enabled` 时调用 `sessions.authenticate`，否则返回具备全部 RPC scope 的本机管理身份；新增轻量的面板模式端点或响应字段供 UI 判断。
- [ ] 保留现有 `/auth/session`、`/auth/csrf`、`DELETE /auth/session` 路由，仅在认证开启模式下要求它们参与 RPC 授权。
- [ ] 重新运行插件测试，确认通过。

### Task 3: UI 自动进入面板

**Files:**
- Modify: `packages/amem-dsh-ui/client/api.ts`
- Modify: `packages/amem-dsh-ui/client/panel.tsx`
- Test: `packages/amem-dsh-ui/client/pure.test.ts`

- [ ] 写测试：API 初始化能识别服务端返回的 `authEnabled: false`，并返回 ready 状态及面板 scope；认证开启或模式未知时仍保持 locked。
- [ ] 运行 `pnpm exec vitest run packages/amem-dsh-ui/client/pure.test.ts`，确认测试失败。
- [ ] 增加获取面板认证模式的 API，并让 `AmemPanel` 首次加载时在认证关闭时设置 ready；认证开启时继续展示原解锁页。
- [ ] 让登出操作仅在认证开启时调用会话注销，避免无认证模式进入无意义的锁定状态。
- [ ] 重新运行 UI 测试，确认通过。

### Task 4: 文档与全量验证

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-01-recall-governance-and-dsh-workbench-design.md`

- [ ] 更新配置和面板说明：默认无需 auth，`dsh.admin.auth_enabled = true` 才启用 token 解锁。
- [ ] 运行 `pnpm test`。
- [ ] 运行 `pnpm build`。
- [ ] 检查最近编辑文件的 lint，修复可明确定位的错误。
