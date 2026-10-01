# ADR 0005：整合提案 LLM 精炼默认关闭

日期：2026-10-01  
状态：Accepted

Consolidate 写出 Proposal 时可以选择调用外部模型精炼候选 `SKILL.md`。我们把开关放在 `budget.consolidate.refine_proposals`，**默认 false**：未显式开启时继续用记忆模板落盘，避免一开 LLM Connectivity 就在整合时烧额度。开启后若模型不可用或调用失败，仍写入模板正文并计入 consolidate 的 LLM 调用预算；成功精炼也不自动 apply——Skill 入库仍须人工 `proposal.apply`（ADR 0003）。Config Panel 可编辑该开关，但不得与 `llm.*` 连通性字段混为一谈。
