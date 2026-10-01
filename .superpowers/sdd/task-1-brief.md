# Task 1 Brief — 配置、路径与安全默认值

Work from: d:\dev\workspaces\amem
Branch: feat/dsh-auth-rpc-workbench

## Global Constraints
- 固定验证目标为 DSH `dsh-v0.2.0-rc.2` / commit `639ed015`.
- 禁止把 `connection.requestRejection()` / `connection.admit()` 作为认证或授权条件.
- bearer token 不得进入 URL、日志、`amem.toml`、`localStorage` 或构建产物.
- `config.get` 永不返回 `llm.api_key`；空 write-only 密钥字段表示“不修改”.
- RPC 方法必须来自固定注册表，并在调用 admin 前完成 JSON、参数 schema、scope、Origin 与 CSRF 校验.
- 保留用户现有未跟踪文件 `ocr-review.md`，不得读取后修改、暂存或提交.
- 本计划不实现结构化冲突和 `conflict.resolve` 业务逻辑.

## Task 1 Full Text

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
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "feat(core): add DSH admin security config"
```

Do NOT touch `ocr-review.md`.
Report file: `.superpowers/sdd/task-1-report.md`
