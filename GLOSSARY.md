# amem

跨会话智能体记忆（面向编码宿主）。本词汇表只覆盖产品用语。

## 记忆分层

**Memory（记忆）**：
跨会话持久的 L2 记录（Markdown + frontmatter），有别于原始 Episode 日志。
_避免_：Note、snippet、episode

**Proposal（提案）**：
整合流程产出的候选 Skill，等待人工审阅；尚未进入能力仓。
_避免_：Draft skill、pending capability、suggestion

**Skill（技能/能力）**：
仅在人工 apply Proposal 后进入能力仓的 L3 能力，随后可编译到宿主。产品文案可称「能力」。
_避免_：Capability（产品用语中的同义替换）、auto-published memory

## 配置

**AmemConfig**：
磁盘上的完整配置文档 `AMEM_HOME/amem.toml`，含 LLM、recall、promotion、budget、embedding、privacy、DSH admin 等。
_避免_：Settings file blob、app preferences

**Config Panel**：
DSH 工作台中渐进编辑 AmemConfig 的标签页。Wave 1 覆盖 LLM 连通性（`mode`、`base_url`、`model`、只写 `api_key`）；后续波次加入 recall 等常用字段。Embedding / privacy 可稍后开放，并非永久禁令。
_避免_：Config surface（当作永久缩减产品面）、secrets-only tab

**LLM Connectivity（LLM 连通性）**：
离开 stub 模式、调用外部模型所需的最小 AmemConfig 字段：`llm.mode`、`llm.base_url`、`llm.model`，以及经只写 `api_key`（或随后的 `api_key_env`）提供的密钥。
_避免_：Just the API key

## 召回治理

**decideRecall（召回门控）**：
在 `recall()` 排序命中之后的纯决策层，输出 `use` / `verify` / `ignore`。不修改记忆正文，也不调用模型。

**recall.mode**：
- `shadow`：只审计，Context Pack 零注入
- `assist`（默认）：注入 `use`，并以较小预算注入 `verify`
- `enforce`：仅注入 `use`
