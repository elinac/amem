# Task 5 Report: README + reinstall hint

**Status:** Done  
**Date:** 2026-09-27

## Changes

**File:** `README.md`（「DSH Web 扩展（仅 `dsh web`）」小节）

- 左栏 amem 面板描述由三个 Tab 更新为五个：**记忆 / 能力 / 提案 / 运维 / 说明**。
- 补充 **运维** Tab 与 Admin API 的对应关系：`doctor`、`flush`、`rebuild-index`、`consolidate`、`compile --target dsh`；并注明面板内 compile 固定为 dsh。

## Verification

```text
pnpm --filter @amem/adapter-dsh build
→ tsc -p tsconfig.json
Exit code: 0

pnpm --filter @amem/amem-dsh-ui build
→ dist/client.bundle.cjs + dist/client.js (lazy-CJS)
Exit code: 0
```

## Manual smoke（未在本任务启动 `dsh web`）

实现者或验收时请：

1. 若 Cordis wrapper 未变，可不重装；`@amem/adapter-dsh` / `@amem/amem-dsh-ui` 的 `dist` 经 file URL 引用时，**重启 `dsh web`** 即可加载新 bundle。
2. 重启后：运维 → 健康检查应返回 JSON；切到 **说明** 不应请求 `/proposals`；locale 中英切换时 Tab 与说明文案应变化。

## Not done

- Git commit（per instructions）。
- 未启动 `dsh web` 做浏览器冒烟（见上）。

## Spec coverage (Task 5)

| 项 | 状态 |
|----|------|
| README 五 Tab + 运维 API 说明 | ✓ |
