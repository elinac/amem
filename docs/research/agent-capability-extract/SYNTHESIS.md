# 综合方案：业务能力提取（Opus × GPT 合并）

日期：2026-09-25  
输入：[Claude Opus 5.5](28d9d1d9-d93a-475a-9673-3c9b3d2180e9) + [GPT 5.6-sol](906914c1-8958-409b-9963-93ead61deb40)

## 一句话

把 Agent 做某类业务时的 Skills / Experience / Constraints / Knowledge / Processes，沉淀为 **Git 管理的可测可审可版本化能力包**；记忆系统只提供证据与召回，不充当资产真相源。

## 必须坚持的不变量（来自两方案共识 + Opus 强化）

1. 业务能力 ≠ Memory / RAG / Prompt。
2. SoT = Git（Markdown/YAML）；索引可删可重建。
3. 个人记忆与组织能力资产物理隔离。
4. 自动抽取只产候选；**自动系统只能收紧/降级/熔断，不能新增或放宽约束**。
5. 任务成功标签来自外部业务结果，禁止模型自评晋升。
6. 高风险约束用 OPA/Rego（或等价）在工具网关强制执行。

## 推荐拼装

| 层 | 选型 |
|----|------|
| 分发格式 | Agent Skills（`SKILL.md`） |
| 能力包结构 | GPT：capability.yaml + schemas + workflow + evals + evidence |
| 经验/本地记忆原型 | EverOS 或 MemOS local（外裹晋升门控） |
| 分层检索思路 | OpenViking L0/L1/L2（AGPL 嵌入需法务） |
| 晋升与演化门控 | Ouroboros：机械→语义→共识 + 预算上限 |
| 用户事实记忆 | Mem0（不进资产仓） |
| 时态知识 | 按需 Graphiti |
| 治理薄层 | Git + CI + OPA + 能力注册表 |

## 运行时顺序

任务分类 → 选 Process → 加载不可覆盖 Constraints → 确定性选 Skills → 作用域检索 Knowledge/Experience → Context Pack（固定优先级与 Token 预算）→ Policy 网关 → 执行并写 assembly manifest / Episode。

## 下周开工（压缩自 Opus 12 项 + GPT Day1–7）

1. 选定一个低风险高频、有外部结果信号的业务流程 + 基线指标  
2. 建 `capabilities/` 仓库与 JSON Schema CI  
3. 轨迹采集（工具调用 + 模型/知识版本）+ 脱敏  
4. SME 访谈产出 Process 草案 + T0 约束清单  
5. 手写 5–10 个 Skill + ≥30 EvalCase  
6. 3 条最高风险约束 → Rego + pre-tool hook  
7. 最小 Capability Gateway（resolve / load / policy.check）+ Context Pack  
8. 离线回放 + 人工审批发布；禁止自动写生产  
9. EverOS/MemOS 只读回灌评估经验抽取质量  
10. 写 ADR：Git 为 SoT + 只能收紧不能放宽  

## 详见

- `.scratch/agent-capability-extract/opus-5.5-full.md`
- `.scratch/agent-capability-extract/gpt-5.6-sol-summary.md`
- Canvas：`capability-extract-opus-vs-gpt.canvas.tsx`
