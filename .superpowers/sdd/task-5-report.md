# Task 5 报告：替换 DSH HTTP 路由

**状态：** 完成  
**日期：** 2026-10-01

## 变更文件

- `packages/adapter-dsh/src/plugin.ts`
- `packages/adapter-dsh/src/plugin.test.ts`
- `packages/cli/src/bin.ts`

## 实现摘要

1. 移除 `Connection` duck typing、`requestRejection`/`admit` 探针与全部旧版 REST 路由。
2. `inject` 仅保留 `["webServer"]`。
3. `/amem-api` 下只暴露四个路由：
   - `POST /auth/session` — bearer 换 HttpOnly 短会话 cookie + CSRF token
   - `POST /auth/csrf` — 用有效会话换取新 CSRF token
   - `DELETE /auth/session` — 注销会话
   - `POST /rpc` — 固定 RPC 注册表统一入口
4. 请求体 `readBody` 在累计超过 64 KiB 时返回 `invalid_argument`。
5. Cookie 解析只识别精确名称 `amem_dsh_session`。
6. 认证端点与 RPC 响应均带 `Cache-Control: no-store`；所有响应带 `X-Content-Type-Options: nosniff`。
7. 使用 `cfg.dsh.admin` 的 `allowed_origins`、`session_ttl_minutes`、`auth_failure_limit`。
8. `installDsh` wrapper 改为 `export const inject = mod.inject ?? ["webServer"]`，并在安装结果中加入 token 签发提示：
   `amem auth issue --target dsh --scopes memory:read,skill:read,proposal:read`

## 验证

```text
pnpm --filter @amem/adapter-dsh test
→ 8 files, 65 tests passed

pnpm --filter @amem/cli test
→ 1 file, 3 tests passed

pnpm --filter @amem/adapter-dsh build
→ tsc -p tsconfig.json, exit 0

pnpm --filter @amem/cli build
→ tsc -p tsconfig.json, exit 0
```

## 未做/注意

- 未启动 `dsh web` 做浏览器冒烟；本任务为后端路由层替换。
- 未修改 `ocr-review.md`。
