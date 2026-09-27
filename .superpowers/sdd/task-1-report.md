# Task 1 报告：Core — escapeTomlString + configToToml + validate/merge/privacy

## 实现内容

在 `packages/core/src/config.ts` 中新增并导出：

| 符号 | 说明 |
|------|------|
| `escapeTomlString` | 双引号 TOML 字符串转义 `\`、`"`、`\n`、`\r` |
| `configToToml` | 所有字符串字段经 `escapeTomlString`；`[privacy]` 仍输出空数组占位 |
| `EditableConfigPatch` | 仅 §3.2 可编辑字段的类型 |
| `extractEditableConfigPatch` | 从 `{ config }` 或顶层对象抽取 patch；忽略 embedding/privacy；类型错误返回 400 形 `{ error, message }` |
| `validateEditableConfigPatch` | 规格 §4.2：mode 枚举、字符串危险字符、api_key_env 非空且非密钥形、整数 ≥0、global_min_lift ≥0 |
| `mergeConfigOverlay` | 深合并 patch 中已出现键；不修改 embedding/privacy |
| `preservePrivacyTomlSection` | 磁盘存在 `[privacy]` 段时替换生成 TOML 中对应段 |
| `writeAmemConfigFile` | `configToToml` → preserve → tmp + `renameSync` 原子写 `paths(home).config` |

新建 `packages/core/src/config.test.ts`（与 task brief 一致，10 个用例）。

## TDD 证据

### RED（实现前）

```text
cd d:/dev/workspaces/amem/packages/core; pnpm test -- src/config.test.ts
```

结果：`10 failed` — 典型错误 `(0 , escapeTomlString) is not a function`；`configToToml` 未转义 `user_id = "x"y"`。

### GREEN（实现后）

同一命令：

```text
 Test Files  1 passed (1)
      Tests  10 passed (10)
 Exit code: 0
```

## 变更文件

- `packages/core/src/config.ts` — 修改（转义、patch/校验/合并/privacy/写盘）
- `packages/core/src/config.test.ts` — 新建

未执行 git add/commit（仓库尚无 commit，按任务约束）。

## 自审

**符合 brief / spec：**

- 磁盘 overlay 语义由 `mergeConfigOverlay` + 后续 adapter 组合完成；本任务不写 `defaultConfig()` 基线。
- 字符串全字段转义（含 embedding 段字符串与 `mode`）。
- privacy 写盘路径通过 `preservePrivacyTomlSection` + `writeAmemConfigFile` 第三参数或读盘。
- 无数值上界；未强制 external 的 URL。

**实现细节：**

- `preservePrivacyTomlSection` 使用 `(?=^\[|$)` 而非 brief 中的 `\Z`（JavaScript 正则无 `\Z`，`\Z` 会误匹配字面 `Z`）。
- `extractEditableConfigPatch` 对嵌套对象做类型检查；数组顶层/body 拒绝。
- `validateEditableConfigPatch` 失败统一 `{ ok: false, error: "bad_request", message }`。

**可改进（非阻塞）：**

- `extract` 对 `llm.mode` 仍为 string，非法 mode 仅在 validate 阶段拒绝（与测试一致）。
- `parseSimpleToml` 仍不读 privacy 数组（spec 已知；由段保留补偿）。

## 关注点

- 无。
- 若将来在 `[privacy]` 后追加新 TOML 段，段匹配逻辑需扩展（当前与 spec 一致：privacy 通常为末段）。

## Review 修复（PRIVACY_SECTION_RE 末行无 `\n`）

**问题：** `PRIVACY_SECTION_RE` 使用 `(?:.*\n)*?`，磁盘 `[privacy]` 最后一行若无尾随换行则匹配失败，`preservePrivacyTomlSection` 退回生成 TOML（空 `[]`），覆盖手改 privacy。

**修复：** 将段内行匹配改为 `(?:.*(?:\n|$))*?`，末行可在 EOF 结束。

**测试：** `preservePrivacyTomlSection` 与 `writeAmemConfigFile` 各增 1 例（末行无尾随换行）。

```text
cd d:/dev/workspaces/amem/packages/core; pnpm test -- src/config.test.ts
```

```text
 Test Files  1 passed (1)
      Tests  12 passed (12)
 Exit code: 0
```
