# Agent 跨会话记忆采用自建薄核心 + 宿主 Adapter

记忆系统自建一个只定义数据契约与接口的薄核心：Episode（JSONL）、Memory（Markdown + frontmatter）、Capability（Git 仓）三层各有唯一真实来源，索引为派生产物；按多维标签与情境召回，不以项目为分区键；自动流程只能新增低信任记忆或降级熔断，不能写能力仓、不能放宽约束。宿主差异（Cursor 首发，其后 Claude Code 等）封装在 Adapter，能力仓通过编译器输出各宿主格式。否决整体采用 OpenViking / MemOS / EverOS / Mem0 之一作为底座——它们都不提供晋升门控、约束执行与发布治理，且会把存储格式和宿主集成锁定在单一产品上（OpenViking 另有 AGPL 约束）；这些项目作为设计参照或可选 L2 后端适配器。详见 `docs/superpowers/specs/2026-09-26-agent-cross-session-memory-design.md`。
