# 剩余能力与工程债修改方案

> 来源：改进方向盘点后的「待完成项」闭环（基线 `38084ed`）。  
> 目标：把规格已写、或部分落地但仍缺真相源/原子性/验收的能力收成可分波实施的方案；**本文件是修改方案，不是已实现代码**。  
> 对照规格：`docs/superpowers/specs/2026-10-01-recall-governance-and-dsh-workbench-design.md`、权威设计 `2026-09-26-agent-cross-session-memory-design.md` §9/§14。  
> **Round 1 review-close 已吸收**（安全 / 数据 / 可行性三维）；见文末关闭矩阵。

## Goal

在**不推翻**已接受 ADR（0003 thin-core、0004 独立 auth+RPC、0005 refine 默认关）的前提下，按依赖顺序关闭下列剩余项：

1. 冲突裁决硬化（审计、Actor 边界、正文标记迁移、协调器最小切片、读屏障）  
2. 情境 epoch 固定快照（`open`→`committed`→`revoked`；裁决可撤销受影响 epoch）  
3. 召回治理审计与反馈关联  
4. 向量检索产品化门控（写时 embed / 降级语义）  
5. 过期与依赖级联  
6. 评测与工程门（eval 扩容、manifests 清理、Biome CI 硬化）  
7. 宿主与 MCP 能力补齐（条件性）  

**Architecture：** 深 module 落在现有缝上——`store`（冲突/协调器/索引向量）、`retrieval`（decideRecall/epoch 装配）、`adapter-dsh` + `amem-dsh-ui`（已有 conflict RPC/UI，只补审计展示）、`pipeline`（过期/迁移）、`llm`（embed）、`cli`（运维与迁移入口）。禁止再开平行写盘路径绕过协调器；**禁止**裁决/迁移调用现有 `MemoryStore.write()`（其会立即 `syncMemoryIndex`）。

**Tech Stack：** TypeScript monorepo、Vitest、Node `fs` + `node:sqlite`、DSH `dsh-v0.2.0-rc.2` / `639ed015`（`webServer.register`；不依赖私有 Connection 鉴权）。

---

## 冻结基线

| 项 | 值 |
|---|---|
| Git | `38084ed`（`feat(accept): spool extract path and live DSH session smoke hooks`） |
| DSH | `dsh-v0.2.0-rc.2` / commit `639ed015` |
| ADR | 0003 / 0004 / 0005 — **不重议**；W1 增补 I9 短 ADR（注入 vs 检索） |
| 已落地（本方案**非目标**重做） | `decideRecall` + `recall.mode`；`listConflicts` / `resolveConflict`；DSH `conflict.list` / `conflict.resolve` + UI（**无** `conflict.get`，见延期）；JSON `mem_vec` + `recallAsync` + `embed-backfill`；`shouldExpire(review_by)`；Biome / `eval:recall` / CHANGELOG / 中文 GLOSSARY |

---

## 范围

### 目标

- 每项有明确 interface、不变量、崩溃/并发语义与验收门。  
- 分波交付；每波可独立合入并过 `pnpm -r test` + 适用 `accept:*`。  
- 规格与实现冲突处写明**冻结选择**（见 I9），必要时短 ADR。

### 非目标

- 不实现图数据库、实体关系检索。  
- 不引入 sqlite-vec 原生扩展作为 **W4 硬依赖**（可 OPTIONAL 后续）；本方案以现有 `mem_vec` JSON 表为真相路径。  
- 不实现完整 `MemoryMutationCoordinator` 规格全文（fencing/租约/多锁）作为单 PR；W1 只交付**双文件裁决 + 迁移 journal 最小切片**（含读屏障与受影响 epoch revoke）。  
- 不开启 `dsh.auto_inject` 默认；不实现完整宿主 section disposer 实验矩阵（W2 epoch 只服务显式 pack 路径）。  
- 不把冲突裁决暴露给 stdio MCP（规格已禁）。  
- 不重做 Config Panel 视觉；不自动升降 `recall.mode`。  
- 不交付独立 `ActorAuthority` 模块；首期本地单用户信任边界下，约定字段 + 服务端注入即闭合（见 W1）。  
- Codex / OpenCode / Gemini 完整 adapter 不在本方案 P0。

### 优先级与波次

| Wave | 内容 | 理由 |
|------|------|------|
| **W1** | 冲突硬化：journal 协调器 + 读屏障 + 审计/Actor + 迁移走 journal + I9 双验收门 | 数据正确性与安全审计；RPC/UI 已在 |
| **W2** | Epoch：`open`→`committed`（CAS）→`revoked`；W1 裁决扫描并 revoke 引用双方 id 的已提交 epoch | 规格核心安全撤销的最小切片；**禁止**「受影响 epoch 空列表合入」 |
| **W3** | 门控审计落盘 + Pack 项带 `decision`；feedback 可选关联 `decision_id`（不驱动模式机） | 可观测；不阻塞注入语义 |
| **W4** | 写时/重建时 embed（`embedding.enabled`）；manifests 保留清理；Biome CI 去 continue-on-error（仅 src） | 检索质量与工程门 |
| **W5** | `depends_on` 级联待审；eval golden≥30；可选 MCP `capability_list` 只读 | 规格 §9/§14 |

条件性交付：未做 Wave 行为保持 `38084ed` 现状。

---

## 不变量矩阵

| ID | 不变量 | 适用 |
|----|--------|------|
| I1 | Memory Markdown + frontmatter 为 L2 **唯一真相**；journal/manifest/索引可丢可重建，不得静默覆盖与 preimage/target 皆不符的人工修改 | W1 W2 |
| I2 | 自动流程不写 L3；冲突裁决须人工（CLI / DSH）；MCP 不暴露 resolve；裁决与 recover 重放必须 `human` 写归因 | W1 |
| I3 | `recall()` 可返回 `conflict`（显式检索）；**Context Pack / 自动注入**仅 `decideRecall` 允许的 `use`/`verify`（模式约束） | W1 W2 W3 |
| I4 | 跨双 Memory：**任一 MD 突变前**必须存在 `prepared` journal；禁止**单侧**已达 target 且无 journal；顺序 `prepared` → 两侧 MD（`persistMarkdownOnly`，**不**经 `MemoryStore.write`）→ `markdown_committed` → 索引同步 → 审计（幂等）→ 受影响 epoch `revoked` → `indexed` 后**允许**删 journal（合法终态） | W1 |
| I5 | 乐观并发：resolve 带双方 `updated_at`；`ConflictError.code` ∈ `conflict_version_mismatch` \| `not_found` \| `not_a_conflict_pair`；admin→HTTP 409、RPC→`"conflict"` **映射不变**；不静默覆盖 | W1 |
| I6 | Epoch：先 `open` 再 CAS/`atomic` 升 `committed`；已 `committed` 复用；`revoked`/损坏 → 零记忆 Pack；`revoked` 不可被写回 `committed`；不得因配置微调重建同 epoch | W2 |
| I7 | `embedding.enabled=false` 时零外部 embed 调用；enabled 但失败 → 仅 FTS，可观测降级 | W4 |
| I8 | `refine_proposals` 默认 false（ADR-0005）不因本方案改变 | 全部 |
| I9 | **冲突语义冻结**：检索可含 conflict；注入禁止未决 conflict / `conflicts_with`；验收**双锁**（见验收总门）；对旧 §8.2「双呈注入」以本条为准 | W1 W3 |
| I10 | 信任边界不扩大：DSH 独立 RPC scope；Actor/`token_id` **永不**进入 RPC parse；审计只写 token **公共 id**（非 secret/CSRF/cookie），对齐 ADR-0004 | W1 W2 |
| I11 | 未 `indexed` 的 journal 所涉 memory id：对 `decideRecall` / `buildContextPack` / 自动注入路径视为不可注入（等同 frozen），直至 recover 完成或人工关闭 journal | W1 |

---

## 候选修改方案

### W1 · 冲突裁决硬化

**Files（预期）**

- Add: `packages/store/src/conflict-journal.ts`（协调器 + recover + 读屏障查询）  
- Modify: `packages/store/src/conflict.ts`（业务语义）；新增 `persistMarkdownOnly` 于 `memory.ts` 或仅协调器内部 gray-matter 写盘  
- Add: `packages/pipeline/src/migrate-conflicts.ts` + CLI `amem migrate conflicts`  
- Modify: `packages/adapter-dsh/src/rpc.ts` / `admin.ts` / `plugin` 分发：resolve 用 `AuthResult` 填 actor，**不**改 `parseResolveConflict` 参数面  
- Modify: `packages/retrieval/src/decide.ts` 或 pack：查询 `listJournalFrozenIds(home)`  
- Test: 崩溃窗口、409 映射、迁移金样、读屏障、审计无 secret  
- Docs: 短 ADR I9；改 `docs/README.md` 去掉「conflict injection still follows older §8.2」

**Problem**  
`resolveConflict` 双文件直写、无 journal；`MemoryStore.write` 立即刷索引；缺 Actor 审计接缝；旧正文标记可能未结构化；半裁决可进入 Pack。

**Solution**

1. **最小协调器**  
   - `resolveConflictTransactional(home, input, actor) → result | ConflictError`  
   - Journal JSON（冻结字段）：`txId`, `action`, `leftId`, `rightId`, `leftPath`, `rightPath`, `leftPreimageHash`, `rightPreimageHash`, `leftTargetHash`, `rightTargetHash`, `leftTargetBytes`, `rightTargetBytes`, `phase`, `affectedEpochKeys`, `auditWritten`, `actor`  
   - `keep_both` **同等**入 journal（两边 target 可仅 bump `updated_at`）  
   - 阶段：`prepared` → 两侧 `persistMarkdownOnly` → `markdown_committed` → `upsertMemory`/`rebuild` → 审计 append（`txId` 幂等）→ 扫描 `manifests/epochs/*.json` 中 `items[].ref` 命中 left/right → 写入 `affectedEpochKeys` 并标 `revoked` → `indexed` → 删 journal  
   - `recoverJournals`：仅 preimage 或 target 哈希匹配才写；否则停并保留 journal 待人工；缺审计则按 `txId` 补写  
   - 互斥：`.amem-tx-lock` 目录锁；文档标明多进程限制  

2. **读屏障（I11）**  
   - `listBlockedMemoryIds(home): Set<string>` = 一切 `phase !== indexed` 的 journal 中的 left/right  
   - `decideRecall`：若 id ∈ blocked → `ignore` / reason `journal_pending`（即便 status 仍是 active）  

3. **审计与 Actor（I10）**  
   - 行：`ts, txId, actor: { kind: "cli"|"dsh", token_id?: string /* 仅公共 id */ , os_user?: string }, …`  
   - 注入点：**仅** RPC/CLI 服务端；`parseResolveConflict` 拒绝未知 `actor`/`token_id` 字段  
   - 主审裁定：无独立 `ActorAuthority` 模块；本约定即 W1 闭合  

4. **迁移**  
   - 成对突变 **必须**走同一 journal API（可内部 action=`migrate_link`）  
   - 无法解析：**只**写旁路报告（如 `manifests/reports/conflict-migrate.jsonl`），**不**改 status、**不**写 validity 备注（无该字段）  

**验收**

- [ ] 写完 left 未写 right 崩溃 → recover 后一致或 journal 保留；**无**无 journal 的单侧 target  
- [ ] 成功路径 `indexed` 后无 journal（合法）  
- [ ] version mismatch → `ConflictError.code=conflict_version_mismatch` → 409 / RPC `conflict`  
- [ ] 未完成 journal 时 Pack **不**注入涉事 id  
- [ ] 审计样本无 bearer/CSRF；含 token **id** 或 cli os_user  
- [ ] 迁移 dry-run/apply；无法解析仅报告  
- [ ] MCP 无 resolve  
- [ ] I9 ADR + README 索引句修正  

**非目标：** DSH 冲突 UI 重做；完整 fencing；`conflict.get` RPC。

---

### W2 · Epoch 最小固定快照

**Files**

- Add: `packages/store/src/epoch-store.ts` 或 `packages/retrieval/src/epoch.ts`  
- Modify: 显式 `getOrCreateEpochPack(...)`；gateway-mcp / dsh 仅显式 `useEpoch`  
- Test: 并发首创；二次复用；revoke 后零记忆；W1 resolve 后引用该记忆的 epoch 被 revoked  

**Solution**

- 键：`{ userId, sessionId, epochId }`（均 `isSafeId`）→ 路径 `manifests/epochs/{sha256}.json`  
- **必须**先原子写 `state: open`（或 mkdir 独占锁）；仅胜者 `decideRecall`+渲染；CAS/`atomicWrite` 升 `committed`（含 `pack_id`, `items`, `safety` 占位可空）  
- 负者：只读已 `committed`；若仍 `open` 等待有限时间后 `degraded` 零记忆  
- `revokeEpoch`：CAS 到 `revoked`；不可写回 `committed`  
- W1 裁决后扫描并 revoke（见上）——**受影响列表不得以「空列表可合入」作为门**；扫描实现可返回空（无引用），但合入门是「扫描已实现 + 测覆盖有引用时必 revoke」  

**验收**

- [ ] 同键两次调用 items/`pack_id` 稳定  
- [ ] 两并发首创不产生互相覆盖的双 committed 真相  
- [ ] revoke / 裁决引用后 → 零记忆  
- [ ] 非法 id 拒绝  

**非目标：** GlobalSafetyGeneration 全网；DSH section disposer。

---

### W3 · 门控审计与 decision 关联

（同前；Pack `decision` / `decision_id`；feedback 可选关联；不改 mode。）

**验收** 同前。

---

### W4 · 向量与工程门

（同前；写时/rebuild embed；gc manifests；CI lint 硬化 src。）

---

### W5 · 过期级联、评测、条件性宿主

**级联策略（冻结）**

- 父 `expired`/`superseded` → 子（`depends_on` 含父 **memory id**）设 `review_by = today`（**待审**）  
- `shouldExpire` 为 `review_by < today` → **当日**不会 expired；最早次日  
- 同轮 consolidate：**只打标、禁止递归 expire**；每记忆每轮至多标一次；环只处理一层  

OPTIONAL：`capability_list` 只读。

**验收**

- [ ] 级联测符合「待审≠当日 expired」  
- [ ] golden≥30；Recall@8≥0.7  
- [ ] MCP 无新增写工具  

---

## 跨波依赖

```text
W1 冲突 journal + 读屏障 + epoch revoke 扫描 ──┬── W2 Epoch open/CAS（依赖扫描 API）
                                                └── W3 审计（可并行，建议 W1 后）
W4 / W5 独立
```

---

## 变更清单

| 类别 | 变更 |
|------|------|
| 类型 | Pack decision 字段；Journal schema；Epoch 记录；审计行；`ConflictError` |
| 状态机 | Epoch: **open→committed→revoked**；Journal: prepared→markdown_committed→indexed |
| 持久化 | manifests 子树；frontmatter 字段集不变（无 validity 备注） |
| 宿主 | DSH 已有 conflict RPC；epoch 默认不接 auto_inject |
| API | `persistMarkdownOnly`；`listBlockedMemoryIds`；actor 仅服务端 |

---

## 明确延期 / OPTIONAL

| 项 | 说明 |
|----|------|
| 完整 MemoryMutationCoordinator（fencing/租约） | W1 最小 journal 后另立项 |
| `conflict.get` RPC | list 载荷已够用；本方案不交付 |
| sqlite-vec | OPTIONAL |
| DSH auto_inject + section disposer | 不交付 |
| 独立 ActorAuthority 模块 | 延期；W1 用约定字段闭合 |
| Workbench Session Client / 其他宿主完整 adapter | 另计划 |
| Biome 全仓 format 历史债 | 只硬化 src lint |

---

## 验收总门

每波：

1. `pnpm -r run build && pnpm -r run test`  
2. 触及 DSH：`pnpm run accept:dsh-admin`（及 path）  
3. 波次 checklist + 适用不变量  
4. **I9 双锁（W1 起永久）：**  
   - （检索）`accept:p1`「conflict memories recallable」保持绿  
   - （注入）既有 `retrieval` 测「does not inject conflict」**或**升格 accept 段：`conflict`/`conflicts_with`/journal_blocked → Pack 无对应 ref  
5. `docs/README.md` 链本方案；去掉与 I9 矛盾的 §8.2 注入表述  

---

## 实施任务索引

### Wave 1

- [ ] Task W1.1：journal schema + persistMarkdownOnly + recover  
- [ ] Task W1.2：resolveTransactional；崩溃/409/读屏障测  
- [ ] Task W1.3：审计 jsonl + 服务端 Actor；禁止 RPC actor 字段  
- [ ] Task W1.4：迁移走 journal；失败仅报告  
- [ ] Task W1.5：epoch 引用扫描 revoke API  
- [ ] Task W1.6：I9 ADR + README + 注入侧验收门  

### Wave 2–5

- [ ] Task W2.1–2：open/CAS/committed/revoke + 并发首创测  
- [ ] Task W3.1–2：decision 审计 / feedback  
- [ ] Task W4.1–3：embed / gc / CI lint  
- [ ] Task W5.1–3：级联澄清测 / golden≥30 / optional capability_list  

---

## Round 1 关闭矩阵（review-close）

| 根因 | 来源 | 最小修复 | 状态 |
|------|------|----------|------|
| R1 I4 终态/write 立即索引 | 数据 B1 | 重写 I4；禁止 write()；persistMarkdownOnly | 已写入方案 |
| R2 journal 载荷未冻结 | 数据 NE1 | 冻结 JSON 字段与 recover | 已写入 |
| R3 待处置 journal 无读屏障 | 数据 B4 | I11 + decideRecall | 已写入 |
| R4 迁移双写/validity 备注 | 数据 B2 | 迁移走 journal；失败仅报告 | 已写入 |
| R5 epoch 无 open/竞态 | 数据 B3 | open→CAS committed | 已写入 |
| R6 空列表 vs 安全撤销 | 可行 B2 | 强制扫描 revoke；禁空列表合入门 | 已写入 |
| R7 I9 验收单锁 | 可行 B1 | 验收总门双锁 + README | 已写入 |
| R8 Actor/token_id/错误码 | 安全 NE | I5/I10 冻结映射与注入点 | 已写入 |
| R9 审计 recover 幂等；human 归因 | 安全 OPT | 已吸入 W1 | 已写入 |
| R10 级联当日语义 | 数据 OPT | W5 冻结待审≠当日 expired | 已写入 |

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| recover 误覆盖人工编辑 | 仅 preimage/target 匹配才写 |
| epoch 首创竞态 | open + CAS；测覆盖 |
| 半裁决进入 Pack | I11 读屏障 |
| lint 全红 | 限 `packages/*/src` |

回滚：按 Wave revert；Memory 格式兼容；删 journal/epoch 文件即降级。
