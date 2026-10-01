# 研究：「记忆 → 提案 → 能力」路径是否可跑通

日期：2026-10-01  
范围：`d:\dev\workspaces\amem` 一手源码 / 测试 / 一方规格与 ADR（不含对话断言、外部博客）

## Question

「记忆 → 提案 → 能力」这条路径在 amem 仓库里现在是否真的能跑通？可核验证据是什么？

术语对齐（产品文案侧；`GLOSSARY.md` 当前仅含 Configuration，尚未收录这三项）：

| 产品用语 | 实现名 | 落盘 |
|----------|--------|------|
| 记忆 (L2) | Memory / `MemoryRecord` | `AMEM_HOME/memories/.../*.md` |
| 提案 (候选) | Proposal | `AMEM_HOME/capabilities/.proposals/<id>/` |
| 能力 (L3 Skill) | Skill / Capability | `AMEM_HOME/capabilities/skills/<name>/`；compile 后再到宿主 `~/.dsh/skills` 等 |

UI 文案见 `packages/amem-dsh-ui/client/locales.ts`（`help.layersBody`：记忆 → 提案 → 能力）。

## Verdict

**部分可跑通（partially works）。**  
CLI 侧在「已满足门槛的 procedure 记忆」前提下，有验收脚本证明 **整合 → 提案 → 人工 apply → compile** 可端到端成功；DSH Admin/RPC/UI 已接线同一套库函数，但**没有**等价的端到端验收，且从真实会话自动抽记忆到自动出提案仍受严格门槛与同次整合不提案等缺口限制，生产上通常需手改 frontmatter 或多次会话反馈。

## Evidence by hop

### Hop 1 — 记忆创建 / 存储

| 判定 | **可工作（多入口）** |
|------|----------------------|
| 存储 | `MemoryStore.write` → Markdown + frontmatter（`packages/store/src/memory.ts`） |
| 自动抽取 | `extractSession`（`packages/pipeline/src/extract.ts`）经 worker `processQueue` flush 任务调用（`packages/pipeline/src/worker.ts`） |
| LLM | `createLlmClient`：`stub` 或 `external`（`packages/llm/src/index.ts`）；缺 API key 时 external 会抛错 |
| Agent 直写 | MCP `memory_note` 写 instance/T3/`candidate`（`packages/gateway-mcp/src/handlers.ts`） |
| 反馈抬升 | MCP `memory_feedback` 增减 `helpful`/`harmful`（同上） |
| DSH 读侧 | RPC `memory.list` / `memory.get` / `memory.forget` → `admin.listMemories` 等（`packages/adapter-dsh/src/rpc.ts` L208–236；`admin.ts`） |
| 测试 | `extractSession` stub 写入：`packages/pipeline/src/index.test.ts`「writes memory from stub llm…」；列表：`admin-list.test.ts`；验收：`scripts/accept-dsh-admin.mjs` 覆盖登录后 `memory.list` |

**证据要点：** 记忆层有真实落盘与测试；自动抽取依赖 LLM（stub 可跑通管道，质量有限）；`memory_note` 不产生 domain 级 procedure，不足以单独触发后续提案。

### Hop 2 — 记忆 → 提案

| 判定 | **规则引擎可工作；非 LLM；门槛严；同次晋升不提案** |
|------|-----------------------------------------------------|
| 生成入口 | `consolidate(home, cfg)`（`packages/pipeline/src/consolidate.ts` L56–118） |
| 提案条件 | `kind === "procedure"` 且 `scope.level` ∈ `{domain,global}` 且 `trust` ∈ `{T1,T2}` 且 `evidence.distinct_instances >= 3` 且未超 `budget.consolidate.max_proposals`（L94–111） |
| 写出 | `.proposals/<mem.id>/SKILL.md` + `proposal.md`（内容为记忆 title/content 模板，**无 LLM 调用**；`calls` 计数只挡预算） |
| 晋升门控 | `shouldPromoteToDomain` / `shouldPromoteToGlobal`（同文件；单元测试 `packages/pipeline/src/index.test.ts`「promotion gates」） |
| CLI | `amem consolidate`（`packages/cli/src/bin.ts` L316–325） |
| DSH | RPC `ops.consolidate` → `admin.consolidate`（`rpc.ts` L299–307；`admin.ts` L353–357）；UI 运维 Tab（`panel.tsx` + `api.ts` `rpc.ops.consolidate`） |
| dryRun | **只返回 promotion 配置**，不模拟提案（`admin.ts` L355；`admin-ops.test.ts`「consolidate dryRun returns promotion」） |
| 验收 | `scripts/accept-p2.mjs`：预置 **已是 domain/T2** 的 `mem_proc`，`consolidate` 后 `proposals` 含 `mem_proc` |

**同次整合缺口（可核验）：** 晋升写回用的是提升后的副本，但提案判断仍读循环中的原 `m`。若记忆本轮才从 instance 晋升到 domain，**同一次** `consolidate` 不会出提案（需再跑一次，或预先手改 level）。见 `consolidate.ts` L82–111。

### Hop 3 — 提案 → 能力（Skill 入库）

| 判定 | **可工作（必须人工 apply；设计如此）** |
|------|----------------------------------------|
| 物化 | `materializeProposal` 复制 `.proposals/<id>/SKILL.md` → `capabilities/skills/<skillName>/` + `capability.yaml`（`packages/compiler/src/index.ts` L160–171） |
| CLI | `amem review --apply <id> <name>`（`packages/cli/src/bin.ts` L335–341） |
| DSH | RPC `proposal.apply` → `admin.applyProposal`（`rpc.ts` L258–267；`admin.ts` L307–318）；UI 提案 Tab「应用」（`panel.tsx` `onApplyProposal`） |
| 列表 | `listProposalsData` / `listSkillsData`；RPC `proposal.list` / `skill.list`；CLI `amem list` |
| 设计约束 | ADR `docs/adr/0003-agent-memory-thin-core.md`：自动流程不能写能力仓；README / UI `help.layersBody` 明确须人工应用 |
| 验收 | `scripts/accept-p2.mjs`：`review --apply mem_proc fix-port` 后 compile 写出 Skill |

### Hop 4 — 能力 → 宿主可用（compile）

| 判定 | **可工作（CLI 全 target；DSH Admin 仅 dsh）** |
|------|-----------------------------------------------|
| 实现 | `compileCapabilities`（`packages/compiler/src/index.ts` L128–157） |
| CLI | `amem compile --target cursor|claude-code|dsh`（`bin.ts`） |
| DSH | `ops.compile` 强制 `target === "dsh"`（`admin.ts` L360–380）；UI 固定 dsh |
| 验收 | `accept-p2.mjs`：`--target cursor --out <tmpdir>` 且存在 `SKILL.md`；`admin-ops.test.ts`：空 skills 时 compile dsh 成功、非 dsh 拒绝 |

### Hop 5 — DSH 是否暴露各跳

| RPC | UI | 实现落点 |
|-----|-----|----------|
| `memory.list/get/forget` | 记忆 Tab | `rpc.ts` + `api.ts` + `panel.tsx` |
| `ops.consolidate` | 运维 Tab | 同上 |
| `proposal.list` / `proposal.apply` | 提案 Tab | 同上 |
| `skill.list` | 能力 Tab | 同上 |
| `ops.compile` | 运维 Tab | 同上 |

方法注册表：`RPC_METHODS`（`packages/adapter-dsh/src/rpc.ts` L11–25）。规格：`docs/superpowers/specs/2026-09-27-dsh-panel-ops-help-design.md`（能力链路桶 B）。

### 端到端测试覆盖矩阵

| 路径 | 覆盖情况 |
|------|----------|
| CLI：预置合格 procedure → consolidate → apply → compile | **有** — `scripts/accept-p2.mjs`（`package.json` script `accept:p2`） |
| 单元：晋升门控 / extract stub / memory list / compile 空仓 | **有** — 见上列测试文件 |
| consolidate **真实写出** `.proposals`（vitest） | **未见**（仅 accept-p2） |
| `proposal.apply` / `listProposals` Admin 或 RPC 集成测试 | **未见**（rpc 测试主要测鉴权/解析/错误面） |
| DSH UI/RPC：记忆→整合→提案→应用→编译全链路 | **未见** — `accept-dsh-admin.mjs` 停在 `memory.list` |
| 真实会话 spool → extract(procedure) → 多轮 feedback → 自动提案 | **未见自动化**；README 写明加速路径需手改 frontmatter |

## Gaps / 生产上仍会失败或卡住的点

1. **自动出提案门槛高**：需 procedure + domain/global + T1/T2 + `distinct_instances ≥ 3`；instance→domain 另需 `helpful ≥ 2` 等。单轮会话几乎不会自动到提案（README 与 `locales` `help.gateBody` 已说明）。
2. **同次 consolidate 晋升后不提案**：刚晋升的记忆要再跑一次整合（见 Hop 2）。
3. **提案内容非 LLM 精炼**：直接把记忆 content 灌进候选 `SKILL.md`；`max_llm_calls` 名存实亡。
4. **DSH 全链路无验收**：Admin/RPC/UI 接线存在，但缺与 `accept-p2` 对等的 DSH 脚本；运维测试未覆盖「有记忆时 consolidate 出提案 / apply」。
5. **抽取质量与配置**：生产级记忆依赖 `llm.mode=external` + API key；stub 只适合管道演示。Auth 开启时需对应 scope（如 `proposal:apply`、`ops:consolidate`）。
6. **审阅/冲突未接入**：UI「审阅」Tab 文案标明冲突裁决「待接入」（`locales.ts` `help.tabsBody`）；`conflict.list` 不在 RPC 注册表（`rpc.test.ts` 断言 `isRpcMethod("conflict.list") === false`）。
7. **`GLOSSARY.md` 未收录** Memory / Proposal / Skill 正式词条，术语以 README + UI + 设计稿为准。

## Sources consulted

- `packages/pipeline/src/consolidate.ts`, `extract.ts`, `worker.ts`, `index.test.ts`
- `packages/compiler/src/index.ts`
- `packages/store/src/memory.ts`
- `packages/llm/src/index.ts`
- `packages/cli/src/bin.ts`, `list.ts`
- `packages/gateway-mcp/src/handlers.ts`
- `packages/adapter-dsh/src/admin.ts`, `rpc.ts`, `admin-ops.test.ts`, `admin-list.test.ts`, `rpc.test.ts`
- `packages/amem-dsh-ui/client/api.ts`, `panel.tsx`, `locales.ts`
- `scripts/accept-p2.mjs`, `scripts/accept-dsh-admin.mjs`
- `README.md`（「从会话到能力」）
- `docs/adr/0003-agent-memory-thin-core.md`
- `docs/superpowers/specs/2026-09-26-agent-cross-session-memory-design.md`
- `docs/superpowers/specs/2026-09-27-dsh-panel-ops-help-design.md`
- `GLOSSARY.md`（确认尚无 Memory/Proposal/Skill 词条）
