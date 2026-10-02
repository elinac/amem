# Changelog

本仓库采用面向用户的变更摘要；细项见 git history。

## Unreleased

### Fixed
- 召回打分：FTS 未命中不再压过弱命中；去掉死权重项
- `stats.recalled` / `adopted`：MCP 注入与 helpful 反馈会计数，晋升门槛可在真实使用中触发
- 路径段白名单：拒绝 `.` / `..` 及首尾点；Proposal/skill/memory id 写盘前校验
- 隐私：`redact_patterns` 与 `exclude_workspaces` 真正生效

### Added
- `decideRecall` 与 `recall.mode`（shadow / assist / enforce）；Context Pack 按门控注入
- `amem conflict list|resolve` 结构化冲突裁决
- 原子写入 helper；SQLite WAL + FTS 增量同步；召回不再每次全量 rebuild
- `recallAsync`：embedding.enabled 时 FTS∪向量 RRF（无向量或失败时回退 FTS）
- 离线记忆有效性评测：合成脱敏语料 + judgment、macro P@K / 有害注入 / 冲突暴露 / 预算利用率；`pnpm eval:recall` / `eval:ab` / `eval:ablate` / `eval:signals`；冻结 `fixtures/eval/baselines/v0.json`
- 召回解释面：score parts + decide reason（CLI / MCP / DSH `memory.recall`）；结构化 doctor（failed 队列、index drift）；DSH `conflict.*` + Review Tab；`accept:dsh-session` 与可选真 DSH smoke 钩子
- GitHub Actions CI；Biome 配置
- gateway-mcp：zod 参数校验与 CallTool 错误捕获
- consolidate：`review_by` 过期 → `expired`
