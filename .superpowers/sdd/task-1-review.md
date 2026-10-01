# Task 1 代码审查 — 配置、路径与安全默认值

**基准:** `2146953` → **头:** `8a1e1a4`  
**审查范围:** `packages/core/src/config.ts`, `config.test.ts`, `paths.ts`, `index.test.ts`  
**依据:** `task-1-brief.md`（实现报告仅作未验证参考）

---

## 结论摘要

| 维度 | 结果 |
|------|------|
| Spec compliance | **PASS** |
| Quality | **CHANGES_REQUESTED**（1 项 Important，其余为 Nice-to-have） |

---

## Spec 符合性

### 已满足

1. **`AmemConfig["dsh"]` 形状与默认值** — `admin.{allowed_origins, session_ttl_minutes, auth_failure_limit}` 与 `auto_inject: false`；默认 origin、`480`、`8` 与 brief 一致。
2. **路径** — `paths(home).auth`、`dshTokens`（`auth/dsh-tokens.json`）、`dshRpcAudit`（`logs/dsh-rpc-audit.jsonl`）已实现；`index.test.ts` 含 brief 要求的路径断言，并额外覆盖 `auth`（与 brief Interfaces 一致）。
3. **TOML** — `configToToml` 输出 `[dsh]`、`[dsh.admin]`；`allowed_origins` 经 `formatTomlStringArray` + `escapeTomlString` 序列化；读盘经 `parseTomlStringArray` + `unescapeTomlString`。
4. **校验逻辑** — `sanitizeDshConfig` 在 `parseSimpleToml` 末尾执行：TTL `1..1440`、失败上限 `1..100`（clamp）、origin 经 `isValidAllowedOrigin` 过滤，空列表回退默认 origin。
5. **验收测试** — `round-trips DSH admin security settings` 与 paths 用例与 brief Step 1 一致。
6. **全局约束（本 diff 可见部分）** — 未引入 DSH Connection auth、未动 `ocr-review.md`、未向 TOML/路径常量写入 bearer；变更仅限 brief 列出的四个文件。
7. **提交** — 单 commit `feat(core): add DSH admin security config`，与 brief Step 5 一致。

### 与 brief 措辞的细微差异（不判 FAIL）

- Brief 写「验证」TTL/失败上限；实现为读盘 **clamp + fallback**，非法 origin **静默过滤**，无写盘/API 层错误反馈。报告已说明属 Task 2+ 面板 PUT 职责；对 Task 1「配置 + 读盘消毒」目标可接受。

---

## 质量与风险

### Important — `sanitizeDshConfig` 未防御非数组 `allowed_origins`

`assign` 通过 `set` 可将 TOML 标量（例如 `allowed_origins = "http://localhost"`）写入 `allowed_origins`，类型变为 `string`。随后：

```ts
dsh.admin.allowed_origins.filter(isValidAllowedOrigin)
```

会在 `loadConfig` → `parseSimpleToml` 路径上 **抛出 TypeError**，整盘配置无法加载。

**建议（下一任务前或本任务小补丁）：** 在 `sanitizeDshConfig` 内 `Array.isArray(dsh.admin.allowed_origins)`，否则回退 `DEFAULT_DSH_ADMIN.allowed_origins`（或对非数组先归一化为单元素数组再过滤）。

### Nice-to-have

1. **测试缺口** — 无针对非法 origin 过滤、TTL/失败次数 clamp、畸形 `allowed_origins` 标量、`auto_inject` TOML 往返的用例；brief 未强制，但后续 DSH 面板易回归。
2. **`parseSimpleToml` 全局行为变更** — 所有双引号标量改为 `unescapeTomlString`（此前为 raw slice）；与 `configToToml` 一致且现有 config 测试仍绿，但历史 hand-edited 含字面反斜杠的标量可能语义变化（低概率）。
3. **模块级 `DEFAULT_DSH_ADMIN = defaultConfig().dsh.admin`** — 每次加载模块构造完整默认配置；可接受，仅风格/微优化。
4. **导出 API** — `unescapeTomlString` / `parseTomlStringArray` / `isValidAllowedOrigin` 公开导出；brief 未要求，利于后续任务，注意 semver 表面扩大。

---

## 安全与全局约束（静态审查）

- Token 存储路径为 `auth/dsh-tokens.json`，未进入 `amem.toml` 模板，符合「bearer 不进 toml」方向。
- `config.get` / `llm.api_key`、RPC 注册表等 **未在本任务实现**，无违规。
- Origin 规则拒绝 userinfo、path、query、hash，并与规范化 `protocol//host` 字符串相等，与 brief 描述一致。

---

## 对实现报告声称的核对（未重跑全量测试）

| 声称 | 审查结论 |
|------|----------|
| 24 tests / build PASS | 未复跑；diff 范围与测试增量合理，**未验证** |
| privacy 段保留策略未破坏 | `preservePrivacyTomlSection` 未改；`[dsh]` 在 generated 模板 privacy 之后，逻辑一致 |
| 未触碰 `ocr-review.md` | diff stat 仅四文件，**一致** |

---

## 审查清单

- [x] 类型与默认值
- [x] paths 三元组
- [x] TOML 读写与转义
- [x] 读盘消毒（TTL / limit / origin）
- [x] 全局约束（本任务范围）
- [ ] 畸形 TOML 下 `loadConfig` 不崩溃（**Important 缺口**）

---

## 建议下一步

1. 修复 `allowed_origins` 非数组时的 `sanitizeDshConfig` 防御（Important）。
2. 可选：为 origin 过滤与 clamp 各加 1～2 个单元测试。
3. 进入 Task 2 时：面板 PUT 对 dsh 段做显式校验与错误响应，避免仅依赖读盘 clamp。
