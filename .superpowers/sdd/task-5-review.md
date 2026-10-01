# Task 5 审阅 — 替换 DSH HTTP 路由

**Commit:** `26d94c3` (`feat(dsh): protect admin RPC independently`)  
**范围:** `plugin.ts`, `plugin.test.ts`, `cli/bin.ts`  
**模式:** 只读 spec + 质量审阅

## Spec 对照

| 要求 | 结果 | 证据 |
|------|------|------|
| 无 Connection / requestRejection / admit | ✅ | `Connection` 类型与探针已删除；`ctx.inject(["webServer"], …)`；测试移除 connection fixture |
| 仅四条 `/amem-api` 路由 | ✅ | `POST /auth/session`, `POST /auth/csrf`, `DELETE /auth/session`, `POST /rpc`；其余 `404` |
| `readBody` >64 KiB → `invalid_argument` | ✅ | `MAX_BODY_BYTES = 64 * 1024`；测试 70KiB RPC → 400 `invalid_argument` |
| Cookie 名 `amem_dsh_session` | ✅ | `parseCookie` 精确匹配；登录 Set-Cookie 测试断言 |
| CSRF / Origin | ✅ | 经 `BrowserSessionManager`；变异 RPC 无 CSRF → 401；跨域登录 → 401 |
| 旧 REST 管理路由移除 | ✅ | doctor/memories/config/flush/compile 等 → 404 测试 |
| `inject` 仅 `webServer` | ✅ | `export const inject = ["webServer"]`；wrapper `mod.inject ?? ["webServer"]` |
| 安装结果 auth 提示 | ✅ | `authHint`: `amem auth issue --target dsh --scopes memory:read,skill:read,proposal:read` |
| 响应头 | ✅ | `sendJson` 全局 `X-Content-Type-Options: nosniff`；auth/RPC 额外 `Cache-Control: no-store` |
| Brief 所列测试场景 | ✅ | `plugin.test.ts` 覆盖 7 条独立 auth 场景 + inject defer |

**Spec 结论: PASS**

## 质量

### Important

1. **超大 body 错误路径不一致** — `POST /auth/session` 与 `POST /rpc` 在 `JSON.parse(await readBody(req))` 的内层 `catch` 中吞掉 `BodyTooLargeError`，返回 `{ message: "invalid JSON" }`，外层 `BodyTooLargeError` 分支对这些路由实际不可达。行为符合 spec（仍为 400 `invalid_argument`），但误导运维/客户端，且与 catch 块设计重复。

2. **`DELETE /auth/session` 无 Origin 校验** — 登录/CSRF/RPC 经 `validateOriginHost`；注销仅删服务端会话，不校验 origin，也不清客户端 cookie（无 `Set-Cookie` 过期）。跨站带 cookie 的 DELETE 可注销会话（类 CSRF）。Brief 未强制，但与其余 auth 面不对称。

### 观察（非阻塞）

- 「does not probe Connection auth methods」仅断言注册了 prefix，未 spy `get("connection")`；对 spec 字面满足，信号偏弱。
- `cli` 侧未见针对 `authHint` 的断言（若 install JSON 有回归测试可补）。

## 验证声明

报告中的 `pnpm --filter @amem/adapter-dsh test`（65）与 build 未在本审阅中重跑；以代码与 commit diff 为准。

---

**Spec: PASS**  
**Quality: CHANGES_REQUESTED**（Important #1 建议合并内层 catch：区分 `BodyTooLargeError` 或先 `readBody` 再 parse；#2 视产品要求决定是否对 DELETE 做 origin + Clear-Cookie）
