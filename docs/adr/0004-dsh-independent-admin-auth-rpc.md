# ADR 0004：DSH 面板使用独立能力令牌与受限 RPC

日期：2026-10-01  
状态：Accepted

## 背景

amem 的 DSH Web 面板需要读取记忆、修改配置、执行运维命令和裁决冲突。DSH `dsh-v0.2.0-rc.2` 提供 `webServer.register()`，但没有公开稳定的 API 让第三方自定义路由复用 DSH 的 cookie 或 launch-token 鉴权。

现有 Adapter 通过 duck typing 调用 `connection.requestRejection()` / `connection.admit()`。它能兼容特定 DSH 构建，但属于私有实现猜测，不能作为安全边界。

## 决策

本期 P0 自建独立管理认证与受限 RPC：

1. CLI 签发 256-bit 长期能力令牌，磁盘只保存哈希、scope 和生命周期元数据。
2. 浏览器用 bearer token 换取短期 HttpOnly、SameSite=Strict 会话；长期 token 不进入 URL、配置或浏览器持久存储。
3. 变更请求同时校验短会话、CSRF token、精确 Origin/Host 与 `Sec-Fetch-Site`。
4. 业务调用统一走 `POST /amem-api/rpc` 的固定方法注册表；每个方法声明独立 scope、参数 schema 和稳定错误码。
5. `config.get` 不返回 API key；审计不记录 token、CSRF、查询原文、记忆正文或完整配置。
6. 不再把 DSH 私有 `Connection` 方法视为发布安全条件。

完整协议、scope 和验收标准见：
`docs/superpowers/specs/2026-10-01-recall-governance-and-dsh-workbench-design.md`。

## 备选方案

### 等待 DSH 提供公开认证 guard / native RPC

优点：与宿主登录态统一，用户体验最好。  
拒绝原因：时间与 API 形态不可控，本期无法交付可操作工作台。

### 继续使用 `requestRejection()` / `admit()`

优点：改动最小。  
拒绝原因：非公开契约，升级后可能失效，也无法形成可审计的权限矩阵。

### 仅限制 loopback + Origin

优点：实现简单。  
拒绝原因：不能满足远程 DSH，也缺少主体、权限、撤销和会话生命周期。

### 在浏览器永久保存 bearer token

优点：免重复解锁。  
拒绝原因：扩大 XSS、调试工具和同源脚本泄露窗口。

## 后果

- 面板首次使用需通过 CLI 签发并粘贴 token。
- 服务重启后短会话失效，但长期 token 在未过期或撤销前可重新解锁。
- 可按 scope 控制只读、配置、运维和冲突裁决权限。
- 需要实现 token 管理、短会话、CSRF、Origin、RPC schema、审计和速率限制。
- 同一 renderer 中的恶意 DSH 插件、同一 OS 用户下的恶意进程仍在信任边界内；本方案不提供插件沙箱。
