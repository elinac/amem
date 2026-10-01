# Task 3 Report — 短浏览器会话、CSRF 与 Origin guard

状态：已完成  
分支：feat/dsh-auth-rpc-workbench  
提交：待提交 `packages/adapter-dsh/src/browser-session.ts`、`packages/adapter-dsh/src/browser-session.test.ts`

## 完成内容

- 新增 `BrowserSessionManager`，实现：
  - `login`：用长期 bearer 换取 `HttpOnly; SameSite=Strict; Path=/amem-api` 短会话 cookie 与 CSRF token
  - `issueCsrf`：为有效会话重新签发 CSRF token
  - `authenticate`：验证会话、scope、CSRF（变更方法）与 Origin/Host/Sec-Fetch-Site
  - `logout`：使当前会话失效
  - `revokeToken`：使指定 token 绑定的所有会话失效
- session id 与 CSRF token 均使用 32-byte CSPRNG；服务端仅保存 SHA-256 哈希
- cookie 仅在 origin 为 HTTPS 时追加 `Secure`
- 会话有效期取 `min(config.session_ttl_minutes, token 剩余有效期)`
- 认证失败统一返回 `unauthenticated`，不区分 token 无效、过期、已撤销或速率受限
- 按 client key（默认 origin）对失败登录计数，达到 `auth_failure_limit` 后统一拒绝；成功登录清零
- 导出 `isMutating(requiredScopes)`，明确读 scope 列表：`memory:read`、`skill:read`、`proposal:read`、`config:read`、`ops:doctor`
- Origin 必须精确命中 `allowed_origins`，且 Host 必须匹配 origin 的 host
- 变更 RPC 要求 `Sec-Fetch-Site` 为 `same-origin` 或 `none`

## 测试

`packages/adapter-dsh/src/browser-session.test.ts` 共 13 项全部通过：

1. bearer 换取 HttpOnly Strict cookie 与 csrf token（含 HTTPS Secure 分支）
2. 会话有效期受 token 有效期与配置 TTL 双重约束
3. 拒绝 origin、host 不匹配与 cross-site Sec-Fetch-Site
4. 读 RPC 无需 CSRF，变更 RPC 需要正确 CSRF
5. token 撤销后对应会话失效
6. 重复失败登录达到上限后统一拒绝，且不泄露具体原因
7. 成功登录清零失败计数
8. `isMutating` 对读/变更/混合 scope 的行为

整包测试：`pnpm --filter @amem/adapter-dsh test` 45 项通过；`pnpm --filter @amem/adapter-dsh build` 通过。

## 未实现/已知局限

- 会话与失败计数仅存于进程内存；服务重启全部失效，符合设计
- 未接入 HTTP 路由（Task 5）与 RPC 注册表（Task 4）
- 未导出到 `index.ts`；计划仅要求提交两个新文件

## 文件

- `packages/adapter-dsh/src/browser-session.ts`
- `packages/adapter-dsh/src/browser-session.test.ts`
