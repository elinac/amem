# DSH 独立认证、RPC 与工作台实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不依赖 DSH 私有 `Connection` 鉴权，交付能力令牌、短浏览器会话、受限 RPC，以及支持筛选分页的美观 DSH 工作台。

**Architecture:** `@amem/adapter-dsh` 持有 DSH 专用 token store、短会话与固定 RPC 注册表；CLI 复用 token store 签发/查看/撤销长期能力。浏览器先用 bearer 换取 HttpOnly 短会话，再携带内存 CSRF token 调用单一 RPC 端点。现有 admin 业务方法保留为 RPC handler 的应用层，不再直接暴露 REST 路由。

**Tech Stack:** TypeScript、Node.js 22 `crypto`/`http`/`fs`、Vitest、React `createElement`、DSH `webServer.register()`、现有 amem workspace packages。

## Global Constraints

- 固定验证目标为 DSH `dsh-v0.2.0-rc.2` / commit `639ed015`。
- 禁止把 `connection.requestRejection()` / `connection.admit()` 作为认证或授权条件。
- bearer token 不得进入 URL、日志、`amem.toml`、`localStorage` 或构建产物。
- `config.get` 永不返回 `llm.api_key`；空 write-only 密钥字段表示“不修改”。
- RPC 方法必须来自固定注册表，并在调用 admin 前完成 JSON、参数 schema、scope、Origin 与 CSRF 校验。
- 保留用户现有未跟踪文件 `ocr-review.md`，不得读取后修改、暂存或提交。
- 本计划不实现结构化冲突和 `conflict.resolve` 业务逻辑；它只建立认证/RPC/面板基础。冲突方法由后续 conflict-governance 计划接入同一注册表。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/core/src/config.ts` | DSH admin origin、短会话 TTL、认证限流配置与 TOML 往返 |
| `packages/core/src/paths.ts` | `auth/`、token store 与 RPC audit 路径 |
| `packages/adapter-dsh/src/auth-store.ts` | 长期 token 的签发、哈希、列表、撤销与原子持久化 |
| `packages/adapter-dsh/src/browser-session.ts` | 短会话、CSRF、cookie 与认证失败限流 |
| `packages/adapter-dsh/src/rpc.ts` | RPC envelope、错误、scope 检查和固定方法注册表 |
| `packages/adapter-dsh/src/admin.ts` | 分页过滤、脱敏配置和现有管理业务 |
| `packages/adapter-dsh/src/plugin.ts` | `/auth/session`、`/auth/csrf`、`/auth/session DELETE`、`/rpc` |
| `packages/cli/src/bin.ts` | `amem auth issue/list/revoke` |
| `packages/amem-dsh-ui/client/api.ts` | 解锁、CSRF、RPC client 与统一错误 |
| `packages/amem-dsh-ui/client/styles.ts` | DSH 自适应设计 token 与共享 style objects |
| `packages/amem-dsh-ui/client/components.ts` | 导航、状态、分页、badge、空态与错误态 |
| `packages/amem-dsh-ui/client/panel.tsx` | 页面级状态和功能组合 |

---

### Task 1：配置、路径与安全默认值

**Files:**
- Modify: `packages/core/src/config.ts`
- Modify: `packages/core/src/config.test.ts`
- Modify: `packages/core/src/paths.ts`
- Modify: `packages/core/src/index.test.ts`

**Interfaces:**
- Produces: `AmemConfig["dsh"]["admin"]`
- Produces: `paths(home).auth`, `.dshTokens`, `.dshRpcAudit`

- [ ] **Step 1: 写失败测试**

在 `config.test.ts` 增加：

```ts
it("round-trips DSH admin security settings", () => {
  const cfg = defaultConfig("u");
  cfg.dsh.admin.allowed_origins = ["http://127.0.0.1:3000"];
  cfg.dsh.admin.session_ttl_minutes = 480;
  cfg.dsh.admin.auth_failure_limit = 8;
  expect(parseSimpleToml(configToToml(cfg)).dsh.admin).toEqual(cfg.dsh.admin);
});
```

在 `index.test.ts` 断言：

```ts
expect(paths(home).dshTokens).toBe(join(home, "auth", "dsh-tokens.json"));
expect(paths(home).dshRpcAudit).toBe(join(home, "logs", "dsh-rpc-audit.jsonl"));
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @amem/core test`  
Expected: FAIL，`dsh` 配置和新路径不存在。

- [ ] **Step 3: 实现最小配置**

配置类型固定为：

```ts
dsh: {
  admin: {
    allowed_origins: string[];
    session_ttl_minutes: number;
    auth_failure_limit: number;
  };
  auto_inject: boolean;
};
```

默认值：

```ts
dsh: {
  admin: {
    allowed_origins: ["http://127.0.0.1", "http://localhost"],
    session_ttl_minutes: 480,
    auth_failure_limit: 8,
  },
  auto_inject: false,
}
```

扩展 TOML reader/writer 支持 `[dsh]`、`[dsh.admin]` 和字符串数组；数组元素必须使用现有 TOML 字符串转义规则。验证 TTL 为 `1..1440`、失败上限为 `1..100`、origin 必须为精确 `http(s)://host[:port]` 且无 path/query/hash。

- [ ] **Step 4: 运行测试与构建**

Run: `pnpm --filter @amem/core test && pnpm --filter @amem/core build`  
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/core/src/config.ts packages/core/src/config.test.ts packages/core/src/paths.ts packages/core/src/index.test.ts
git commit -m "feat(core): add DSH admin security config"
```

---

### Task 2：长期能力令牌与 CLI

**Files:**
- Create: `packages/adapter-dsh/src/auth-store.ts`
- Create: `packages/adapter-dsh/src/auth-store.test.ts`
- Modify: `packages/adapter-dsh/src/index.ts`
- Modify: `packages/cli/src/bin.ts`
- Modify: `packages/cli/src/list-export.test.ts`

**Interfaces:**
- Produces:

```ts
type DshAdminScope =
  | "memory:read" | "memory:forget" | "memory:resolve-conflict"
  | "skill:read" | "proposal:read" | "proposal:apply"
  | "ops:doctor" | "ops:flush" | "ops:rebuild"
  | "ops:consolidate" | "ops:compile"
  | "config:read" | "config:write";

class DshTokenStore {
  issue(scopes: DshAdminScope[], ttlMs: number): { token: string; record: PublicTokenRecord };
  list(): PublicTokenRecord[];
  verify(token: string): VerifiedToken | null;
  revoke(id: string): boolean;
}
```

- [ ] **Step 1: 写 token store 失败测试**

覆盖：

```ts
it("stores only a token hash and verifies the raw token", () => {});
it("rejects expired and revoked tokens", () => {});
it("never returns the raw token from list", () => {});
it("rejects unknown and duplicate scopes", () => {});
it("survives two sequential store instances", () => {});
```

测试读取 `dsh-tokens.json` 并断言不包含签发返回的 token。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @amem/adapter-dsh test -- auth-store.test.ts`  
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 token store**

使用 `randomBytes(32).toString("base64url")` 生成 token，`createHash("sha256")` 保存哈希，`timingSafeEqual` 比较。持久化 schema 版本固定为 `1`，写盘流程为同目录临时文件、`fsync`、`rename`；用 auth 专用 lock directory 串行 issue/revoke。

公开记录不得包含 hash：

```ts
type PublicTokenRecord = {
  id: string;
  scopes: DshAdminScope[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
};
```

- [ ] **Step 4: 添加 CLI 命令测试与实现**

帮助中增加：

```text
amem auth issue --target dsh --scopes memory:read,config:read [--ttl 8h]
amem auth list
amem auth revoke <token-id>
```

抽出可测试的 duration parser，接受 `m`、`h`、`d`，拒绝零值、负数和超过 365 天。`issue` 的 JSON 输出只在该次包含 `token`。

- [ ] **Step 5: 运行测试与构建**

Run:

```powershell
pnpm --filter @amem/adapter-dsh test
pnpm --filter @amem/cli test
pnpm --filter @amem/adapter-dsh build
pnpm --filter @amem/cli build
```

Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
git add packages/adapter-dsh/src/auth-store.ts packages/adapter-dsh/src/auth-store.test.ts packages/adapter-dsh/src/index.ts packages/cli/src/bin.ts packages/cli/src/list-export.test.ts
git commit -m "feat(dsh): add scoped admin tokens"
```

---

### Task 3：短浏览器会话、CSRF 与 Origin guard

**Files:**
- Create: `packages/adapter-dsh/src/browser-session.ts`
- Create: `packages/adapter-dsh/src/browser-session.test.ts`

**Interfaces:**
- Consumes: `DshTokenStore.verify()`
- Produces:

```ts
class BrowserSessionManager {
  login(input: LoginInput): LoginResult;
  issueCsrf(cookie: string, requestMeta: RequestMeta): CsrfResult;
  authenticate(cookie: string, csrf: string | undefined, required: DshAdminScope[], meta: RequestMeta): AuthResult;
  logout(cookie: string): void;
  revokeToken(tokenId: string): void;
}
```

- [ ] **Step 1: 写失败测试**

测试：

```ts
it("exchanges a bearer for an HttpOnly Strict cookie and csrf token", () => {});
it("caps session expiry by token expiry and configured ttl", () => {});
it("rejects origin, host and sec-fetch-site mismatches", () => {});
it("requires csrf for mutating RPC but not read RPC", () => {});
it("invalidates sessions after token revocation", () => {});
it("rate-limits repeated failed login attempts without token oracle", () => {});
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @amem/adapter-dsh test -- browser-session.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现 session manager**

短 session id 和 CSRF token 分别使用 32-byte CSPRNG；服务端仅保存哈希。cookie 名固定 `amem_dsh_session`，属性：

```text
HttpOnly; SameSite=Strict; Path=/amem-api; Max-Age=<ttl>
```

仅当 origin scheme 为 HTTPS 时追加 `Secure`；远程非 HTTPS origin 在配置校验阶段拒绝。认证失败统一返回 `unauthenticated`，不暴露原因。

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @amem/adapter-dsh test -- browser-session.test.ts`  
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/adapter-dsh/src/browser-session.ts packages/adapter-dsh/src/browser-session.test.ts
git commit -m "feat(dsh): add browser admin sessions"
```

---

### Task 4：分页管理方法与固定 RPC 注册表

**Files:**
- Create: `packages/adapter-dsh/src/rpc.ts`
- Create: `packages/adapter-dsh/src/rpc.test.ts`
- Create: `packages/adapter-dsh/src/admin-list.test.ts`
- Modify: `packages/adapter-dsh/src/admin.ts`
- Modify: `packages/adapter-dsh/src/index.ts`

**Interfaces:**
- Produces:

```ts
type ListMemoriesInput = {
  page: number;
  pageSize: 20 | 50 | 100;
  q?: string;
  kind?: MemoryKind;
  level?: ScopeLevel;
  trust?: Trust;
  status?: MemoryStatus;
};

type RpcMethodDef<P, R> = {
  scope: DshAdminScope;
  mutates: boolean;
  parse(params: unknown): P;
  run(admin: AmemAdmin, params: P): Promise<R> | R;
};
```

- [ ] **Step 1: 写 admin 分页失败测试**

建立临时 Markdown 记忆，验证：

```ts
it("filters, sorts and paginates memories on one snapshot", () => {});
it("computes each facet excluding its own selected dimension", () => {});
it("returns page one when total is zero", () => {});
it("rejects invalid enums, page and pageSize", () => {});
it("never returns more than a 200-char preview", () => {});
```

- [ ] **Step 2: 实现 `admin.listMemories(input)` 与配置脱敏**

所有过滤、facet、排序和切片使用同一次 `listAll()` 结果。`getConfig()` 返回：

```ts
{
  path: string;
  config: Omit<AmemConfig, "llm"> & {
    llm: Omit<AmemConfig["llm"], "api_key"> & { has_api_key: boolean };
  };
}
```

`putConfig()` 接受可选 `api_key_replacement`；缺失或空字符串不改变磁盘密钥。

- [ ] **Step 3: 写 RPC 注册表失败测试**

覆盖未知 method、坏 envelope、参数失败、scope 不足、read 不要求 CSRF、mutation 要求 CSRF、异常映射不泄露 stack。

- [ ] **Step 4: 实现固定注册表**

首批方法完整注册：

```ts
memory.list, memory.get, memory.forget,
skill.list,
proposal.list, proposal.apply,
ops.doctor, ops.flush, ops.rebuild, ops.consolidate, ops.compile,
config.get, config.put
```

不注册尚未实现的 `conflict.*`，未知方法明确返回 `not_found`；后续计划通过同一 typed registry 增加。

- [ ] **Step 5: 运行测试与构建**

Run:

```powershell
pnpm --filter @amem/adapter-dsh test
pnpm --filter @amem/adapter-dsh build
```

Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
git add packages/adapter-dsh/src/admin.ts packages/adapter-dsh/src/admin-list.test.ts packages/adapter-dsh/src/rpc.ts packages/adapter-dsh/src/rpc.test.ts packages/adapter-dsh/src/index.ts
git commit -m "feat(dsh): add scoped admin RPC"
```

---

### Task 5：替换 DSH HTTP 路由

**Files:**
- Modify: `packages/adapter-dsh/src/plugin.ts`
- Modify: `packages/adapter-dsh/src/plugin.test.ts`

**Interfaces:**
- Consumes: `DshTokenStore`, `BrowserSessionManager`, RPC registry
- Produces exactly four routes under the existing prefix handler:
  - `POST /amem-api/auth/session`
  - `POST /amem-api/auth/csrf`
  - `DELETE /amem-api/auth/session`
  - `POST /amem-api/rpc`

- [ ] **Step 1: 改写路由测试为独立认证**

删除“`requestRejection` admits/rejects”作为安全测试，增加：

```ts
it("does not probe Connection auth methods", () => {});
it("logs in with bearer and sets a safe cookie", async () => {});
it("rejects RPC without a browser session", async () => {});
it("runs read RPC with session scope", async () => {});
it("rejects mutating RPC without csrf", async () => {});
it("rejects cross-origin and oversized requests", async () => {});
it("does not expose legacy REST management routes", async () => {});
```

- [ ] **Step 2: 运行失败测试**

Run: `pnpm --filter @amem/adapter-dsh test -- plugin.test.ts`  
Expected: FAIL。

- [ ] **Step 3: 实现路由**

`readBody` 在累计超过 64 KiB 时立即停止并返回 `invalid_argument`。Cookie parser 只接受精确 cookie 名。认证端点和 RPC 响应统一 `Cache-Control: no-store`；所有响应加入 `X-Content-Type-Options: nosniff`。

移除旧 REST dispatch 和 `Connection` duck typing；`inject` 只保留 `webServer`。`Connection` 类型、测试和 wrapper 依赖一并删除。

- [ ] **Step 4: 更新 DSH 安装 wrapper**

`installDsh()` 生成的 wrapper 改为：

```js
export const inject = mod.inject ?? ["webServer"];
```

并在安装结果中给出：

```text
amem auth issue --target dsh --scopes memory:read,skill:read,proposal:read
```

- [ ] **Step 5: 运行测试与构建**

Run:

```powershell
pnpm --filter @amem/adapter-dsh test
pnpm --filter @amem/cli test
pnpm --filter @amem/adapter-dsh build
pnpm --filter @amem/cli build
```

Expected: PASS。

- [ ] **Step 6: Commit**

```powershell
git add packages/adapter-dsh/src/plugin.ts packages/adapter-dsh/src/plugin.test.ts packages/cli/src/bin.ts
git commit -m "feat(dsh): protect admin RPC independently"
```

---

### Task 6：组件化并重做 DSH 工作台

**Files:**
- Create: `packages/amem-dsh-ui/client/api.ts`
- Create: `packages/amem-dsh-ui/client/styles.ts`
- Create: `packages/amem-dsh-ui/client/components.ts`
- Modify: `packages/amem-dsh-ui/client/panel.tsx`
- Modify: `packages/amem-dsh-ui/client/locales.ts`
- Modify: `packages/amem-dsh-ui/package.json`

**Interfaces:**
- Produces `createRpcClient()`，token 只作为 `login(token)` 的临时参数
- Produces `UnlockView`, `SideNav`, `FilterBar`, `MemoryRow`, `Pagination`, `StatusMessage`

- [ ] **Step 1: 增加前端纯函数测试能力**

把分页、query 构造、RPC error 文案映射抽为无 DOM 纯函数；在 package scripts 中把 `test` 改为先跑 `vitest run` 再 `tsc --noEmit`。测试：

```ts
it("resets page after a filter change", () => {});
it("ignores a stale request sequence", () => {});
it("keeps total-zero pagination on page one", () => {});
it("does not retain the bearer after login", () => {});
```

- [ ] **Step 2: 实现 API client 与解锁状态**

client state：

```ts
type AuthState =
  | { kind: "locked" }
  | { kind: "unlocking" }
  | { kind: "ready"; csrf: string; scopes: string[]; expiresAt: string }
  | { kind: "error"; message: string };
```

不得把 bearer 放入 React 长期 state、storage 或 URL；`login(token)` 请求完成后调用方立即清空 input value。

- [ ] **Step 3: 实现视觉系统和组件**

使用语义 style token：

```ts
surface, surfaceRaised, text, textMuted, border, accent,
danger, warning, success, radiusSm, radiusMd, space1..space6
```

颜色优先使用宿主 CSS variables，并提供系统深浅色 fallback。禁止渐变、重阴影和统一大圆角卡片墙。宽屏为左导航 + 内容；小于 720px 使用横向 tabs。

- [ ] **Step 4: 实现记忆列表**

提供搜索、kind/level/trust/status 单选、20/50/100 pageSize、刷新和清除。搜索 300ms 防抖，用 request sequence 忽略过期响应。列表覆盖首次骨架、刷新保留旧数据、错误重试、零结果和超范围页回退。

- [ ] **Step 5: 迁移 skills/proposals/ops/config**

所有调用改为 RPC；运维结果先显示摘要，原始 JSON 放入 `<details>`。配置不渲染密钥原值，密钥替换使用空白 write-only input。

导航保留“审阅”入口，但在 conflict-governance 计划接入前显示明确空态：

```text
当前版本尚未建立结构化冲突索引；完成冲突治理迁移后此处将显示待裁决项。
```

该空态不调用不存在的 `conflict.*` 方法。

- [ ] **Step 6: 运行测试与构建**

Run:

```powershell
pnpm --filter @amem/amem-dsh-ui test
pnpm --filter @amem/amem-dsh-ui build
pnpm --filter @amem/adapter-dsh test
```

Expected: PASS。

- [ ] **Step 7: 手动可访问性与响应式验证**

在 320px、768px、1024px 检查：

- Tab 顺序覆盖解锁、导航、筛选、列表、分页；
- focus-visible 清晰；
- 加载/成功/错误通过 `aria-live` 宣告；
- 横向 tabs 和筛选条可键盘滚动；
- 不在 DOM、网络 URL、console 中出现 bearer 或 API key。

- [ ] **Step 8: Commit**

```powershell
git add packages/amem-dsh-ui/client packages/amem-dsh-ui/package.json
git commit -m "feat(dsh-ui): redesign authenticated memory workbench"
```

---

### Task 7：文档、验收和整体验证

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Create: `scripts/accept-dsh-admin.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm accept:dsh-admin`

- [ ] **Step 1: 编写端到端验收脚本**

脚本在临时 `AMEM_HOME`：

1. init；
2. 签发只读 token；
3. 启动 adapter 路由测试服务器；
4. 登录并调用 `memory.list`；
5. 验证 `config.get` 无 `api_key`；
6. 验证只读 token 无法调用 `config.put`；
7. 签发配置 token并验证 CSRF；
8. 撤销 token 并验证短会话失效；
9. 检查 token 原文未出现在磁盘和日志。

- [ ] **Step 2: 更新 README**

记录：

```powershell
amem auth issue --target dsh --scopes memory:read,skill:read,proposal:read
dsh web
```

说明本地/远程 origin 配置、token 只显示一次、浏览器解锁、scope 示例和撤销流程。明确同源恶意插件不在隔离边界内。

- [ ] **Step 3: 全量验证**

Run:

```powershell
pnpm build
pnpm test
pnpm accept:dsh-admin
git diff --check
```

Expected: 全部 PASS，工作区只保留用户原有 `ocr-review.md` 未跟踪。

- [ ] **Step 4: Commit**

```powershell
git add README.md docs/README.md scripts/accept-dsh-admin.mjs package.json
git commit -m "docs: document DSH admin authentication"
```

---

## 后续独立计划

完成本计划后，按顺序执行：

1. `memory-conflict-governance`：MutationCoordinator、结构化 `conflicts_with`、迁移、CLI/RPC 裁决与审阅页。
2. `recall-gating-epoch-snapshots`：`use/verify/ignore`、epoch 固定快照、撤销 generation 与实验性 DSH 自动注入。

两者不得塞回本计划，否则认证/RPC、跨文件事务和 prompt 生命周期会再次形成不可独立审核的大变更。
