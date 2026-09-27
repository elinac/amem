# GPT 5.6-sol 方案要点（2026-09-25）

来源：子代理 906914c1-8958-409b-9963-93ead61deb40

## 核心立场

1. 业务能力 ≠ Memory / RAG / Prompt；是可检索、可执行、可测试、可审计、可版本化的能力包。
2. 定义与证据分离：Git+Markdown/YAML 管定义；不可变 Episode 管证据；混合索引可重建。
3. 自动化止于候选；生产发布与高风险约束必须人工批准。
4. 直接采用 Agent Skills 分发格式；借鉴 OpenViking 分层检索、EverOS 可重建索引、Ouroboros 门控演化。
5. 确定性系统守边界（策略/权限/状态机/审计）；模型负责理解与候选生成。

## 架构关键词

- Capability Pack：`SKILL.md` + `capability.yaml` + schemas + workflow + constraints + evals + evidence
- 五级门控：结构 → 证据 → 安全 → 行为 → 发布
- Context Pack + 固定优先级：安全策略 > 法规约束 > 流程状态 > Skill > 知识 > 经验 > 偏好
- 生命周期：draft → candidate → verified → canary → stable → deprecated → retired
- 存储：对象存储轨迹 / Episode Store / Git 能力仓 / PostgreSQL 注册表 / 派生向量+BM25

## 开源取舍

| 项目 | 角色 |
|------|------|
| Agent Skills | 直接采用分发格式 |
| OpenViking | 试点上下文检索层，不当唯一真相源 |
| Ouroboros | 借鉴门控演化，不当记忆底座 |
| EverOS | 个人/本地可试点；企业需补 RBAC/审批 |
| MemOS | PoC/研究，不当唯一控制平面 |
| Mem0 / LangMem | 用户记忆组件 |
| Graphiti | 有时态关系再引入 |

## MVP 边界

不做自动发布、不做复杂图谱、不做多 Agent 自治进化。先做一个低风险高频任务的完整能力包闭环。
