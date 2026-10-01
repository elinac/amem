# Task 4 代码审查 — 分页 list、config 脱敏与固定 RPC 注册表

**基准:** commit `ac44295`（审查工作区同路径源码）  
**审查范围:** `admin.ts`, `admin-list.test.ts`, `rpc.ts`, `rpc.test.ts`, `index.ts`  
**依据:** `task-4-brief.md`、`task-4-report.md`、设计 §6–§7

---

## 结论摘要

| 维度 | 结果 |
|------|------|
| Spec compliance | **PASS** |
| Quality | **CHANGES_REQUESTED**（1 项 Important） |

---

## Spec 符合性

### 已满足

1. **`listMemories`** — `page` / `pageSize` 仅 20|50|100；`q` 与 `kind|level|trust|status` 单选过滤；非法枚举、非正整数 page、非法 pageSize 返回 400。
2. **单快照** — 一次 `MemoryStore.listAll()` → 排序 → `filtered` 切片；`countFacet` 在同一 `all` 上计数，各维度排除自身选择（`key !== "kind"` 等）。
3. **零结果** — `total === 0` 时 `page: 1`、空 `items`。
4. **预览** — `memoryToListItem` 使用 `MAX_PREVIEW_CHARS = 200`。
5. **超页** — `start >= total && total > 0` 时空 `items`，保留 `total`/`facets`。
6. **旧签名** — `listMemories(number)` 保留 plugin/CLI 行为；测试覆盖。
7. **`getConfig`** — 解构去掉 `api_key`，暴露 `llm.has_api_key`（`resolveLlmApiKey`）。
8. **`putConfig`** — 可选 `api_key_replacement`；空/缺失不写入磁盘密钥。
9. **RPC 注册表** — `RPC_METHODS` 与 brief 一致；无 `conflict.*`；未知方法 `not_found`。
10. **Scope** — `dispatchRpc` 在 parse/run 前校验 `authResult.ok` 与 `scopes.includes(def.scope)`。
11. **CSRF（集成路径）** — 测试经 `BrowserSessionManager.authenticate`：读 RPC 可无 CSRF；变更缺/错 CSRF → `unauthenticated`。
12. **堆栈** — 未捕获异常映射为 `internal` + 固定文案 `"internal error"`；`not_found` 响应 JSON 无 `at ` / `.ts:`。
13. **导出** — `index.ts` 导出 list/RPC/会话类型与方法。
14. **测试** — brief 所列 RPC 与 list 场景均有对应用例；report 声称 64 tests pass（本审查未复跑）。

### 与 design §7.3 的预期差异（brief 已排除，不判 FAIL）

- `conflict.list/get/resolve` 未实现 — Task 4 brief 明确「No conflict.* yet」。

---

## 焦点项核对

| 检查项 | 结论 |
|--------|------|
| 单快照 list + facets + sort + slice | **通过** |
| pageSize 20 \| 50 \| 100 | **通过** |
| preview ≤ 200 | **通过** |
| config 无 `api_key` / `has_api_key` | **通过** |
| 固定方法注册表 | **通过** |
| 无 `conflict.*` | **通过** |
| CSRF / scope 行为 | **通过**（auth 注入 + SessionManager） |
| 无 stack 泄露 | **通过**（异常路径）；见下方 Important |

---

## 质量与风险

### Important — `putConfig` 内部错误经 RPC 回传原始 `message`

`admin.putConfig` 的 `catch` 返回 `{ error: "internal", message: e instanceof Error ? e.message : String(e), status: 500 }`。`config.put` 的 `run` 将其转为 `RpcAdminError`，`dispatchRpc` 对 `RpcAdminError` 使用 **`e.message` 原样返回**，与未捕获异常路径的固定 `"internal error"` 不一致，可能向客户端暴露路径/IO 等实现细节（非堆栈，仍属信息泄露）。

**建议:** `mapAdminError === "internal"` 时对 RPC 响应统一使用 `"internal error"`（或 brief 规定的稳定文案），仅服务端日志记录 `e.message`。

### Nice-to-have（不阻塞）

- `RpcMethodDef.mutates` 在 `dispatchRpc` 中未读取；变更 CSRF 完全依赖 `auth` 回调。与 brief「可注入 auth」一致，Task 5 HTTP 层须固定使用 `authenticate`，勿对变更 RPC 传入静态 `{ ok: true, scopes }`。
- `admin.ts` L139–140 `typeof input === "number"` 分支在 number 已 early-return 后不可达。
- `rpc.ts` 中 `MAX_PAGE_SIZE` 未使用。
- 变更 RPC 成功路径（合法 CSRF + 有效 scope）未单独断言；当前仅覆盖 CSRF 失败。

---

## 审查结论

Task 4 brief 与 §7 列表契约、固定 RPC 表、config 脱敏及测试清单均已落地。**Spec PASS**；修复 `putConfig`→RPC 的 internal 消息策略后可 **Quality APPROVED**。
