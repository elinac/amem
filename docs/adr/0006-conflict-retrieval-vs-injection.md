# ADR 0006：冲突可检索、注入禁止（I9）

日期：2026-10-02  
状态：Accepted

## 背景

早期设计 §8.2 曾描述冲突记忆「双呈注入」以便模型自行权衡。召回治理规格与实践已改为：显式检索可返回 `conflict` / `conflicts_with`，但 Context Pack / 自动注入路径不得注入未决冲突。

## 决策

冻结 **I9**：

1. **检索**：`recall` / 人工列表可包含 `status=conflict` 或带未决 `conflicts_with` 的记忆。  
2. **注入**：`decideRecall` → Pack / 自动注入仅允许 `use` / `verify`；`conflict`、未决 `conflicts_with`、以及未 `indexed` 的冲突 journal 涉事 id（`journal_pending`）一律 `ignore`。  
3. 旧 §8.2「双呈注入」不再作为实现目标；与本 ADR 冲突的表述以本条为准。

验收双锁：检索侧接受测保持 conflict 可召回；注入侧测覆盖 conflict / conflicts_with / journal_blocked 均不进入 Pack。

## 后果

- 冲突审阅依赖 CLI / DSH Workbench，不依赖模型在注入上下文中「看见双方」。  
- 半完成裁决通过 journal 读屏障（I11）防止脏记忆进入 Pack。
