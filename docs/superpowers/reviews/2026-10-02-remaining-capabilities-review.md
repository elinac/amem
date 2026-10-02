# 审核闭环：剩余能力与工程债方案

## 审核结论：PASS_WITH_OPTIONAL

### 冻结基线
- **被审对象：** `docs/superpowers/plans/2026-10-02-remaining-capabilities.md`
- **Git：** `38084ed`（方案撰写与审核时 HEAD）
- **依赖 / 官方 API：** DSH `dsh-v0.2.0-rc.2` / commit `639ed015`；无新增未固定宿主私有 API
- **相关 ADR：** 0003 thin-core、0004 独立 auth+RPC、0005 refine 默认关 — 不重议；W1 实施期另交 I9 短 ADR（检索可含 conflict / Pack 不注入）
- **范围：** W1–W5（冲突 journal、epoch 快照、门控审计、embed/gc、过期级联与评测）；非目标含完整 fencing、sqlite-vec 硬依赖、auto_inject、MCP resolve、独立 ActorAuthority
- **核心不变量：** I1–I11（见方案正文）

### 审核执行
- **协议：** `docs/review-protocol.md` + skill `review-close`（默认两轮；用户上限 5；本对象两轮关闭）
- **Round 1 子代理：**
  - [安全/认证/审计](fc2b4ac7-b9a6-4098-b7a9-6efd81098ca7)：无 BLOCKER；NEEDS_EVIDENCE（Actor/token_id/错误码）+ OPTIONAL
  - [数据/崩溃/迁移](723dc274-7df2-4c73-9877-11ca06ffb00e)：**4 BLOCKER**（I4/write 索引、迁移、epoch open、读屏障）
  - [可行性/一致性/范围](2b37b16a-01e0-4966-8cee-92b3dc94d8fa)：**2 BLOCKER**（I9 双验收门、空列表 vs 安全撤销）
- **Round 2 子代理：** [差异关闭](54530b1b-2b74-4aed-ae1e-72940adef143) → R1–R10 均 CLOSED，无新 blocker

### 阻塞项关闭矩阵

| 根因 | 受影响 | 最小修复 | 验证 |
|------|--------|----------|------|
| I4 终态与 `write()` 立即索引 | I1/I4 | 重写 I4；`persistMarkdownOnly`；禁裁决走 `MemoryStore.write` | 方案 I4 + W1 Solution/验收 |
| journal 载荷未冻结 | I1/I4 | 冻结 JSON 字段与 recover 规则 | W1 Solution 字段表 |
| 待处置 journal 无读屏障 | I3/I9/I11 | `listBlockedMemoryIds` + decideRecall `journal_pending` | I11 + 验收 |
| 迁移双写 / validity 备注 | I4 | 迁移走 journal；失败仅报告 | W1 迁移节 |
| epoch 跳过 open 竞态 | I6 | `open`→CAS `committed` | W2 Solution/验收 |
| 受影响 epoch「空列表」合入 | 规格 §4.1 / I6 | 强制扫描 revoke；禁空列表作合入门 | W1.5 + W2 |
| I9 仅锁检索侧 | I9 | 验收总门双锁 + README | 总门 + README L10 |
| Actor/token/错误码 | I5/I10 / ADR-0004 | 服务端注入；审计仅公共 id；409/`conflict` 映射 | W1 审计节 |

### 可选项（保留，不阻断）
- 完整 MemoryMutationCoordinator（fencing/租约）
- `conflict.get` RPC
- sqlite-vec；DSH auto_inject + section disposer
- 独立 ActorAuthority；Workbench Session Client；其他宿主完整 adapter
- Biome 全仓 format；W5 `capability_list`

### 下一步
1. 按方案 Wave 顺序实施；建议 W1 单独 PR（journal + 读屏障 + I9 ADR）。
2. 每波对照 checklist + 适用不变量；DSH 相关跑既有 accept。
3. 实施期若绕过 `persistMarkdownOnly`、漏读屏障，或把 actor 放进 RPC 参数，须重新冻结基线审核。
