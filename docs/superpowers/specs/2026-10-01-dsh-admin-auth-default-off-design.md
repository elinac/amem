# DSH 管理面板默认关闭认证设计

## 目标

DSH 管理面板默认面向本机单用户场景运行，不要求输入长期能力令牌；需要远程访问或更强隔离时，用户可以显式开启认证。

## 设计

- 在 `[dsh.admin]` 增加 `auth_enabled`，默认值为 `false`。
- `auth_enabled = false` 时，`/amem-api/rpc` 使用本机管理身份执行 RPC，不要求 bearer、短会话或 CSRF。
- `auth_enabled = true` 时，保留现有长期 token、HttpOnly 短会话、scope、Origin 和 CSRF 校验。
- 无论认证开关状态如何，继续保留请求体大小限制、固定 RPC 注册表和已有来源校验。
- Web UI 根据服务端返回的认证模式跳过解锁页；认证开启时继续使用现有解锁流程。
- CLI、MCP 和 DSH headless/ACP 行为不变。

## 测试

- 默认配置的 `auth_enabled` 为 `false`，TOML 序列化和读取可保持该值。
- 认证关闭时，合法来源可直接调用只读和变更 RPC。
- 认证开启时，现有未登录拒绝、scope 和 CSRF 测试继续通过。
