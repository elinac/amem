# 审核闭环：架构加深修改方案

## 审核结论：PASS_WITH_OPTIONAL

### 冻结基线
- **被审对象：** `docs/superpowers/plans/2026-10-02-architecture-deepening.md`
- **Git：** `f78f737`（方案撰写时 HEAD）
- **依赖 / 官方 API：** DSH `dsh-v0.2.0-rc.2` / commit `639ed015`；无新增未固定宿主私有 API
- **相关 ADR：** 0003 thin-core、0004 独立 auth+RPC、0005 refine 默认关（不重议结论）
- **范围：** 七候选分波加深（W1–W5）；非目标含不改 Connection 鉴权、不持久化 bearer、不改 refine 默认、不强制 Workbench Session Client
- **核心不变量：** I1–I8（见方案正文）

### 审核执行
- **协议：** `docs/review-protocol.md` + skill `review-close`（默认两轮）
- **Round 1 子代理：**
  - [安全/认证](6375725b-9b6c-48d1-b8f9-d5bfe16dbc43)：W1/W2 vs I1/I2/I7 → 无 BLOCKER
  - [数据/崩溃/迁移](a78492ff-06f6-4aa3-95df-d1d0435d5fb7)：W3/W4 vs I3/I4/I5/I8 → **1 BLOCKER**（upsert 顺序）
  - [可行性/一致性/范围](9fdff47b-4070-446e-a62a-0e8db97b6736)：可实现性与 ADR 张力 → **1 BLOCKER**（export.ts 漏列）
- **Round 2 子代理：** [差异关闭](282d5f25-d2f1-4a50-a2b6-31fbfc726e74) → R1/R2 均已关闭，无新 blocker

### 阻塞项关闭矩阵

#### R1 · upsert 先删后写导致崩溃丢 L2
- **证据与失败场景：** 原方案「先删旧再写新」；forget 成功、write 未完成时崩溃 → 该 Memory id 两端皆无
- **受影响不变量：** I5
- **最小修复：** `upsert` 强制先写新 path，再对旧 path `rmSync`；禁止 write 后再 `forget(id)`；验收加崩溃窗口测
- **验证证据：** 方案 W4-B Solution/验收/Task W4.3/风险表已改写；Round 2 确认关闭

#### R2 · Proposal 调用方清单漏 `export.ts`
- **证据与失败场景：** Files 未列 `packages/cli/src/export.ts`，但验收/`rg` 要求 CLI 无拼接 `.proposals`
- **受影响：** W4-A locality 验收门
- **最小修复：** Files/Solution/验收/Task 对齐，含 export；store 提供 root 或 exportAll
- **验证证据：** Round 2 确认四处对齐并关闭

#### 已吸收 OPTIONAL（非阻塞，已写入方案）
- `authorizeRpc` 必含 cookie + csrf（双头兼容）+ 双头等价测
- W3「Wave 1」与加深波次消歧；W5 与 GLOSSARY「LLM Connectivity」消歧；I3 标明现行表面

### 可选项（保留，不阻断）
- Proposal `writeDraft` 目录级 tmp+rename（半成品可再跑覆盖，I4 不破）
- Workbench Session Client（浏览器 CSRF 全局 vs React AuthState）— 方案已列延期
- Memory `readById` 旁路索引
- 配置 module 迁出独立 package（仅当 core 边界再摩擦时 ADR）
- UI 与 rpc 跨包共享 Zod（W2 以 adapter 内共享为最小）

### 下一步
1. ~~按方案 Wave 顺序实施；建议 W1 单独 PR（鉴权矩阵）。~~ **已按波次合入 master（阶段 0 提交序列）。**
2. 每波对照方案 checklist + 适用不变量；DSH 相关跑既有 accept 脚本。
3. 实施期若偏离「先写新再删旧」或漏改 `export.ts`，须重新冻结基线发起审核，不得跳过。
4. ~~**递延（阶段 1）：** W4.3 崩溃窗口测~~ **已关闭（阶段 1 崩溃窗口测 + apply staging）。** ~~W3 Panel 去重验收仍开放~~ **已关闭（阶段 3：`config-form.ts` 用 put 面指纹，不再复制保存不变量嵌套读取）。**
5. 阶段 1 另增：统一 atomic write、FlushJob 契约、SQLite `user_version`、`config_version` 迁移合同。
