# Task 3 代码审查 — 短浏览器会话、CSRF 与 Origin guard

**基准:** commit `78d2623`  
**审查范围:** `browser-session.ts`, `browser-session.test.ts`  
**依据:** `task-3-brief.md`、`task-3-report.md`、设计 §6.3

---

## 结论摘要

| 维度 | 结果 |
|------|------|
| Spec compliance | **PASS** |
| Quality | **CHANGES_REQUESTED**（1 项 Important） |

---

## Spec 符合性

### 已满足

1. **接口** — `BrowserSessionManager` 五方法 + 构造函数 `(home, admin cfg, DshTokenStore)` 与 brief/plan 一致；导出 `isMutating` 与读 scope 列表符合 report。
2. **Cookie** — `amem_dsh_session`；`HttpOnly; SameSite=Strict; Path=/amem-api; Max-Age=<ttl>`；HTTPS origin 追加 `Secure`（含测试）。
3. **哈希仅存服务端** — 32-byte CSPRNG session/CSRF；Map 键为 session SHA-256 base64url；内存仅存 `csrfHash`。
4. **会话 TTL** — `min(session_ttl_minutes, token 剩余有效期)`，测试覆盖短 token 与长 token + 配置上限。
5. **Origin/Host** — `allowed_origins` 精确匹配 + `URL(origin).host === meta.host`。
6. **Sec-Fetch-Site** — 变更 RPC（`isMutating`）要求 `same-origin` 或 `none`；读 RPC 不强制 CSRF/Sec-Fetch-Site。
7. **CSRF** — 变更方法 `timingSafeEqual(sha256(csrf), session.csrfHash)`；读方法可省略 CSRF。
8. **认证失败** — 统一 `{ ok: false, error: "unauthenticated" }`；登录失败计数达 `auth_failure_limit` 后合法 bearer 亦同码拒绝（无 token oracle）。
9. **必选测试 1–6** — brief 六项均有对应用例；额外覆盖 HTTPS Secure、`issueCsrf`、logout、成功登录清零计数、`isMutating`。
10. **全局约束** — diff 仅两文件；bearer 不进 cookie/持久化；未触 `ocr-review.md`、未引入 Connection auth。

### 与 brief 的细微差异（不判 FAIL）

- `LoginInput.secFetchSite` 未在 `login` 中使用；brief 测试 3 的 Sec-Fetch-Site 断言在 `authenticate` 变更路径，与实现一致。
- 远程非 HTTPS origin 在配置层拒绝 — brief 标明已有校验，本模块未重复实现。
- 未导出 `index.ts` — brief/plan 本 commit 仅两文件，可接受。

---

## 焦点项核对

| 检查项 | 结论 |
|--------|------|
| Cookie 属性 | **通过** |
| 哈希仅存服务端 | **通过** |
| 变更 RPC CSRF | **通过** |
| Origin / Host / Sec-Fetch-Site | **通过**（变更路径） |
| 登录速率限制无 oracle | **通过** |
| 会话受 token + 配置 TTL 约束 | **通过** |

---

## 质量与风险

### Important — CLI 撤销长期 token 后内存会话仍可用

`authenticate` 仅检查进程内 `revokedTokenIds`（由 `BrowserSessionManager.revokeToken` 填充），**不**查询 `DshTokenStore` 的 `revokedAt`。管理员执行 `amem auth revoke <id>` 后，已签发的浏览器会话在 `session.expiresAt` 之前仍可通过 `authenticate`（含读/变更 + CSRF）。

brief 测试 5 使用 `manager.revokeToken`，Task 3 接口验收通过；与设计「撤销状态」及后续 HTTP 集成存在真实缺口。

**建议:** 在 `authenticate`（及可选 `issueCsrf`）中按 `session.tokenId` 校验 store 未撤销/未过期；或约定 Task 5 在 `store.revoke` 时必调 `manager.revokeToken`，并增加跨模块测试锁定行为。

### Nice-to-have（不阻塞）

- `login` 在 `verify` 成功后再次 `list().find` 取 `expiresAt` — 正确但多一次读盘；后续若 `VerifiedToken` 带 expiry 可简化。
- `parseCookie` 对非标准字符串有宽松回退 — HTTP 层应传完整 `Cookie` 头。
- 未复跑 `pnpm test`/`build`；与 report 声称一致但未验证。

---

## 安全与全局约束（静态审查）

| 检查项 | 结论 |
|--------|------|
| Bearer 不进 URL/日志/cookie 明文持久化 | **通过** |
| 登录失败不区分原因 | **通过** |
| CSRF 比较 | **通过** — `timingSafeEqual` on 定长 SHA-256 |
| 进程内存会话 | **通过** — 符合设计 |

---

## 审查清单

- [x] 六项必选测试
- [x] Cookie / CSRF / Origin guard
- [x] 速率限制无 oracle
- [x] TTL 双重上限
- [ ] 长期 token 撤销与会话一致性（Important 未闭合）
