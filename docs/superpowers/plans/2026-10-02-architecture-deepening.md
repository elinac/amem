# 架构加深修改方案（七候选）

> 来源：`improve-codebase-architecture` 评审（基线 `f78f737`）。  
> 目标：把浅 module / 泄漏 seam 加深为可测、可导航的深 module；**本文件是修改方案，不是已实现代码**。  
> 术语：`module` / `interface` / `implementation` / `depth` / `seam` / `adapter` / `leverage` / `locality`（见 codebase-design）；领域词见 `GLOSSARY.md`。

## Goal

在不推翻已接受 ADR 的前提下，按依赖顺序加深七处热点：

1. Admin Request Auth 编排  
2. AmemConfig 可编辑保存  
3. Proposal 文件系统 locality  
4. Admin↔RPC 结果坍缩  
5. 变更语义单一来源  
6. LlmClient 传输（extract + refine；与 GLOSSARY「LLM Connectivity」配置字段正交）  
7. Memory 晋升路径搬迁  

**Architecture：** 加深落在现有包缝上——`adapter-dsh`（鉴权/RPC）、`core` 或邻近配置 module（AmemConfig 保存）、`store`（Memory / Proposal）、`llm`（Connectivity）、`pipeline` / `compiler` 只保留编排与宿主 compile。禁止为了「薄」把写盘配方继续散在 adapter。

**Tech Stack：** 现有 TypeScript monorepo、Vitest、Node fs、DSH `webServer.register()`（固定 `dsh-v0.2.0-rc.2`）。

---

## 冻结基线

| 项 | 值 |
|---|---|
| Git | `f78f737`（`fix(dsh): allow missing Sec-Fetch-Site for auth-off mutating RPC`） |
| DSH | `dsh-v0.2.0-rc.2` / commit `639ed015`（与 ADR-0004 / 既有计划一致） |
| ADR | 0003 thin-core、0004 独立 auth+RPC、0005 refine 默认关 — **不重议结论**；0003 仅允许「配置保存 module 放置」的张力处理 |

---

## 范围

### 目标

- 每个候选有明确的深 module 责任与单一真相源。  
- 调用方 interface 变小；编排知识不再穿越 seam。  
- 测试主要打加深后的 interface（deletion test：删浅胶水，复杂度集中进深 module）。  
- 分波交付，每波可独立合入并通过现有 accept / 单测门。

### 非目标

- 不改 DSH 私有 `Connection` 鉴权假设（仍禁止当安全条件）。  
- 不把 bearer 写入 URL / localStorage / TOML。  
- 不开启 `budget.consolidate.refine_proposals` 默认值（ADR-0005）。  
- 不重做召回治理业务、冲突裁决语义、Config Panel 视觉大改。  
- 不引入假想第三宿主 adapter「只为抽象」；已有两个角色才开 seam（Proposal 读写 vs list/apply 已满足）。  
- 本方案不要求一次 PR 落地全部七项。

### 优先级与波次

| Wave | 候选 | 理由 |
|------|------|------|
| **W1** | #1 Request Auth + #5 Mutation 语义 | 同包、安全 locality、近期回归热点；#5 改动面小可同批 |
| **W2** | #4 Admin↔RPC 坍缩 | 依赖 W1 的鉴权缝稳定后再收结果形状 |
| **W3** | #2 AmemConfig 保存 | Config Panel / putConfig 热点；与 auth 解耦 |
| **W4** | #3 Proposal store + #7 Memory upsert | 数据 locality；可同 PR 或先 #3 后 #7 |
| **W5** | #6 LlmClient 传输加深 | 不阻塞前序；与 ADR-0005 门控 / GLOSSARY LLM Connectivity 字段正交 |

条件性交付：任一 Wave 可单独合并；未做 Wave 的行为保持现状。

---

## 不变量矩阵

| ID | 不变量 | 适用候选 |
|----|--------|----------|
| I1 | 长期能力令牌只存哈希；短会话 HttpOnly + SameSite=Strict；变更请求校验 CSRF + Origin/Host + Sec-Fetch（auth_enabled 时）；auth_enabled=false 时 Sec-Fetch 缺省允许（`f78f737`） | #1 #5 |
| I2 | 固定 RPC 方法注册表；每方法独立 scope、参数 schema、稳定错误码 | #1 #4 #5 |
| I3 | `config.get` 永不返回 api_key；write-only 空字段 = 不修改；**现行** editable patch 表面冻结 embedding/privacy（GLOSSARY 允许未来产品波次另议，非永久禁令） | #2 |
| I4 | 自动流程只写待审 Proposal，不写 L3 Skill 仓；apply 须人工 | #3 |
| I5 | Memory Markdown + frontmatter 为 L2 唯一真相；路径随 level/kind；晋升不得留孤儿文件 | #7 |
| I6 | `refine_proposals` 默认 false；失败回退模板正文并计预算 | #6 |
| I7 | 加深不得扩大信任边界（同 renderer 恶意插件仍在边界内，ADR-0004） | 全部 |
| I8 | 注释保留的 TOML 往返：未管理段与隐藏节不因可编辑保存丢失 | #2 |

---

## 候选修改方案

### W1-A · #1 加深 Admin Request Auth

**Files**

- Modify: `packages/adapter-dsh/src/browser-session.ts`（或新建同包 `request-auth.ts`）  
- Modify: `packages/adapter-dsh/src/plugin.ts`  
- Modify: `packages/adapter-dsh/src/plugin.test.ts`、`browser-session.test.ts`

**Problem**  
`BrowserSessionManager` 有深度，但 plugin 重复 `parseCookie`、读双 CSRF 头、按 `auth_enabled` 选择 `authenticate` vs `authorizeLocal`，并把闭包交给 `dispatchRpc`。编排知识泄漏在 route 缝上。

**Solution**  
新增深 module（建议名：`DshRequestAuth` 或扩展 `BrowserSessionManager` 的对外 interface）：

- 输入：原始 HTTP 头（cookie / csrf / origin / host / sec-fetch-site）、`auth_enabled`、所需 scopes。  
- 输出：`AuthResult` 或登录/登出 cookie 指令。  
- 内部持有：`DshTokenStore` + 现有 session 规则；**唯一**解析 `amem_dsh_session` cookie。  
- plugin 只保留 path 分发与 `sendJson`；不再本地 `parseCookie`。

**Interface 收缩（调用方只需知道）**

- `authorizeRpc(input, requiredScope)`，其中 `input` **必须**同时携带：
  - `cookie`（原始 `Cookie` 头或已解析会话值——推荐原头，由 module 内唯一解析）
  - `csrf`（经现有双头读取：`x-csrf-token` **或** `x-amem-csrf`，兼容不变）
  - `origin` / `host` / `secFetchSite`
  - 由 plugin 传入的 `auth_enabled`（或 module 构造时固定）
- `login(bearer, reqMeta)` / `logout(cookie)` / `csrf(cookie)` / `status(cookie)`  

**验收**

- [x] plugin 内无第二份 cookie 解析。  
- [x] auth-on / auth-off × mutating / read × 缺省 Sec-Fetch 矩阵仍绿（含 `f78f737` 行为）。  
- [x] 双 CSRF 头等价：仅 `x-csrf-token` 与仅 `x-amem-csrf` 的 mutating 请求均通过（auth_enabled=true）。  
- [x] 新测：假请求 meta 打完整矩阵，不经 Cordis mock。

**非目标：** 不改 cookie 名、不改 CSRF 双头兼容、不改 token 磁盘格式。

---

### W1-B · #5 变更语义单一来源

**Files**

- Modify: `packages/adapter-dsh/src/rpc.ts`、`browser-session.ts`  
- Modify: 相关测试

**Problem**  
`isMutating(scopes)` 驱动 CSRF/Sec-Fetch；`RpcMethodDef.mutates` **从未被读取**（删除全部 `mutates:` 行为不变）。双轨漂移风险。

**Solution**

1. 选定唯一真相：**scope → mutating**（现有 `READ_SCOPES` / `isMutating`），**或** 注册表字段派生且鉴权必读——本方案选定 **scope 分类为真相**。  
2. 从 `RpcMethodDef` **删除** `mutates` 字段；注册表不再声明死字段。  
3. 文档/注释写明：CSRF 与 Sec-Fetch 仅由 required scopes 经 `isMutating` 判定。  
4. 增加静态断言或单测：每个 registry 方法的 `scope` 与期望 mutating 布尔一致（表驱动）。

**验收**

- [x] `rg "mutates:" packages/adapter-dsh/src/rpc.ts` 无匹配。  
- [x] 现有 `isMutating` 测试保留；新增 registry×mutating 一致性表。

**依赖：** 可与 W1-A 同 PR；不依赖 #4。

---

### W2 · #4 坍缩 Admin↔RPC 结果适配

**Files**

- Modify: `packages/adapter-dsh/src/rpc.ts`、`admin.ts`  
- Modify: `rpc.test.ts`、`admin-*.test.ts`  
- 可选：共享列表 schema（与 UI 去重，见下）

**Problem**  
每个 `run`：`admin.*` → `AdminResult` → `throw RpcAdminError` → `mapAdminError`；`MEMORY_KINDS` / pageSize 等在 admin、rpc、UI 多处复制。

**Solution**

1. 保留固定方法注册表（I2 / ADR-0004）。  
2. 加深 `dispatchRpc`（或内部 helper）：统一 `invokeAdmin(fn) → data | RpcError`，去掉 13 处复制胶水。  
3. 错误码以 RPC 稳定码为 seam；`AdminResult.status` 逐步退出对外 interface（可先内部映射表）。  
4. 列表/过滤 schema：**一处**定义（优先 `@amem/core` 或 adapter-dsh 共享模块），admin 校验与 rpc `parse` 共用；UI 可 import 同源常量或通过 RPC 错误收敛。

**验收**

- [x] 新增 RPC 方法时注册表条目 ≤ 声明 scope + parse + 单行 invoke（无手写 throw 模板）。  
- [x] 错误码矩阵单测覆盖既有码。  
- [x] 不改变对外 RPC envelope 与错误码字符串。

**非目标：** 不把业务逻辑从 admin 搬进 rpc 文件；admin 仍是运维行为 locality。

---

### W3 · #2 加深 AmemConfig 可编辑保存

**Files**

- Modify / 抽出: `packages/core/src/config.ts` **或** 新包/文件 `packages/core/src/config-document.ts`（缓解 ADR-0003 张力）  
- Modify: `packages/adapter-dsh/src/admin.ts`（`getConfig` / `putConfig`）  
- Modify: `packages/amem-dsh-ui/client/panel.tsx`、`api.ts`（消费安全视图 + patch）  
- Modify: `packages/core/src/config.test.ts`

**Problem**  
调用方必须串联 `extractEditableConfigPatch` → `validate` → `mergeConfigOverlay` → 冻结 embedding/privacy → `api_key_replacement` → `writeAmemConfigFile(home, merged, diskToml)`。字段地图三重维护。Config Panel 手挖嵌套路径。

**Solution**

深 module interface（示意，实现时再定名）：

- `getSafeConfigView(home) → { path, config }`（无 api_key，含 `has_api_key` / `api_key_source`）  
- `applyEditableConfigPatch(home, body) → { path, saved } | ConfigError`  
  - 实现内：extract、validate、merge、冻结段、密钥 side-channel、读盘 TOML、`updateTomlText`、原子写。

**ADR-0003 处理**

- **优先**：把「配置文档读写」从「契约/不变量」中拆到 `config-document`（仍属 core 包文件，或后续迁出）——薄核心保留类型与校验契约；IO/注释保留是深 implementation。  
- **禁止**：为保持 core 行数好看而把配方留在 `admin.putConfig`。

**验收**

- [x] `putConfig` 变为对 `applyEditableConfigPatch` 的薄调用。  
- [x] 单测一轮：注释保留、privacy 不变、空 api_key 不覆盖、非法 patch 稳定错误。  
- [ ] Panel 不再复制指纹/嵌套读取逻辑中与保存不变量重复的部分（可保留展示态）。

**非目标：** Config Panel **既有**可编辑字段集合不变（GLOSSARY 所述 LLM Connectivity 等）；不开放 embedding/privacy 编辑（现行表面，见 I3）。

---

### W4-A · #3 收拢 Proposal 文件系统

**Files**

- Add: `packages/store/src/proposal.ts`（或 `packages/store/src/proposal-store.ts`）  
- Modify: `packages/pipeline/src/consolidate.ts`（改为调用 store）  
- Modify: `packages/compiler/src/index.ts`（`listProposalsData` / `materializeProposal` 迁出或薄委托）  
- Modify: `packages/adapter-dsh/src/admin.ts`、`packages/cli/src/bin.ts`、`packages/cli/src/list.ts`、`packages/cli/src/export.ts`  
- Modify: pipeline / compiler / admin / cli 测试

**Problem**  
`.proposals/{id}/SKILL.md` + `proposal.md` 布局由 consolidate 裸 `mkdirSync`/`writeFileSync` 写出，compiler 再读；CLI `export.ts` 亦硬编码同根路径；调用方与测试断言绝对路径。

**Solution**

`ProposalStore`（深 module）：

- `writeDraft({ id, skillMd, proposalMd })`  
- `list(): ProposalRow[]`  
- `readSkillMd(id)` / `apply(id, skillName) → destPath`（apply 仍只在人工路径调用）  
- `proposalsRoot(): string` 或 `exportAll(dest)`——供 CLI export **禁止**调用方拼 `.proposals`  
- 布局常量私有于 implementation。

`compiler` 仅保留宿主 **Skill compile**；list/apply 从 compiler 公共 interface 移除或标 deprecated 并委托 store（同一发布波次删完调用方）。

**验收**

- [x] consolidate / admin / CLI（含 `bin.ts` / `list.ts` / `export.ts`）无直接拼接 `.proposals` 路径（除 store 实现）。  
- [x] `rg "\\.proposals" packages` 仅命中 store 实现（及本方案/注释若有）。  
- [x] 测试：emit→list→apply 通过 ProposalStore interface；不 `existsSync(.../.proposals/...)` 散落（store 测除外）。  
- [x] I4：自动路径仍不写 L3 仓。

**依赖：** 无硬依赖 W1–W3；可并行，但建议数据面集中在 W4。

---

### W4-B · #7 Memory 晋升路径搬迁

**Files**

- Modify: `packages/store/src/memory.ts`  
- Modify: `packages/pipeline/src/consolidate.ts`  
- Modify: store / pipeline 测试

**Problem**  
`pathFor` 含 `scope.level`；晋升改 level 时调用方 `forget` + `write`，否则孤儿文件。搬迁知识泄漏在 pipeline。

**Solution**

加深 `MemoryStore`：

- `upsert(record, source)` 崩溃安全顺序（**强制**）：
  1. 解析旧 path（按 id 查找；若多路径命中同 id，视为既有异常，测中禁止）与新 `pathFor(record)`；  
  2. **先 `write` 新 path**（完整落盘）；  
  3. **仅当**旧 path 存在且 `≠` 新 path 时，对**旧 path** 执行 `rmSync`（**禁止** write 成功后再 `forget(id)`——`listAll` 短暂双文件时 `forget` 可能删错）。  
- consolidate 三处 `forget`+`write` 改为单次 `upsert`。  
- （可选，同波或随后）`readById` 可用旁路索引，非本波必须。

**验收**

- [x] 晋升测：成功路径旧 path 不存在、新 path 可读、内容正确。  
- [x] 崩溃窗口测：写新后、删旧前中断 → 新 path 可读（可接受短暂双文件；下次 upsert/运维可清旧）。  
- [x] consolidate 无「为换路径而 forget」的显式配对（forget 仍可用于人工删除）。

**风险：** 并发两写同 id——现有模型已是单 worker；保持单进程假设，不引入锁（非目标）。短暂双文件优于两端皆无。

---

### W5 · #6 加深 LlmClient 传输（extract + refine）

> 命名说明：GLOSSARY「LLM Connectivity」指 AmemConfig 字段面；本波加深的是 `@amem/llm` 的 `LlmClient` 传输 locality，**不**改 Config Panel 字段集合。

**Files**

- Modify: `packages/llm/src/index.ts`  
- Modify: `packages/pipeline/src/extract.ts`、`consolidate.ts`  
- Modify: `packages/llm/src/refine.test.ts` 等

**Problem**  
`LlmClient` 只有 `extractCandidates`；`tryRefineProposalSkill` 平行重复密钥/mode/fetch。

**Solution**

加深 `LlmClient`（保持导出兼容；勿与 GLOSSARY Connectivity 字段混名）：

```ts
interface LlmClient {
  extractCandidates(...): Promise<MemoryCandidate[]>;
  refineProposalSkill?(...): Promise<string | null>; // 或非 optional，Stub 返回 null
}
```

- `OpenAiCompatibleClient` 内共享私有 chat HTTP。  
- `createLlmClient` 继续：stub/host → Stub；external → OpenAI 兼容。  
- consolidate：**仍**读 `cfg.budget.consolidate.refine_proposals`（I6）；为 true 时调 client，失败回退模板。  
- 废弃顶层 `tryRefineProposalSkill` 或薄委托到 client。

**验收**

- [x] 无两套独立 fetch 实现。  
- [x] refine 默认关时零外部调用；开启后失败回退 + 预算计数行为不变。  
- [x] 一个 fake adapter 可同时测 extract + refine。

---

## 跨候选依赖图

```text
W1-A Request Auth ──┬── W2 Admin↔RPC
W1-B Mutation ──────┘
W3 AmemConfig          （独立）
W4-A Proposal ←── 可与 W4-B Memory 同波
W5 LlmClient 传输       （独立）
```

无环。W2 建议在 W1 后，避免同时改鉴权闭包与结果形状导致 diff 难审。

---

## 变更清单（类型 / 状态机 / 持久化 / 宿主）

| 类别 | 变更 |
|------|------|
| 类型 | 可能新增 `DshRequestAuth`、`ProposalStore`、`EditableConfig` 错误联合类型；`RpcMethodDef` 删 `mutates`；`LlmClient` 扩方法 |
| 状态机 | 浏览器会话状态机逻辑不变，仅搬家；auth_enabled 分支仍在实现内 |
| 持久化 | Proposal/Memory/Token/TOML **格式不变**；仅访问 locality 变化 |
| 宿主接缝 | 仍仅 `webServer.register`；路径集合可不变或减（auth 子路径逻辑内聚） |
| UI | Config Panel 改为消费 safe view + patch；RPC 客户端可选后续加深（本方案 W1–W5 **不强制** Workbench Session Client，列作 OPTIONAL） |

---

## 明确延期 / OPTIONAL

| 项 | 说明 |
|----|------|
| Workbench Session Client（原评审 #4 UI） | `api.ts` 模块全局 CSRF vs React AuthState 双 interface；价值真实，但可在 W1 服务端契约稳定后单独立项 |
| Memory `readById` 索引 | 性能优化，非正确性 blocker |
| 配置 module 迁出独立 package | 仅当 core 包边界再次摩擦时再 ADR |
| UI 与 rpc 完全共享 Zod schema 包 | W2 以 adapter 内共享为最小；跨包再议 |

---

## 验收总门

每波合并前：

1. 相关 package `pnpm --filter … test` 全绿。  
2. 触及 DSH 时跑既有 `scripts/accept-dsh-admin.mjs`（或当前文档指向的 accept）。  
3. 对照本文件该波验收 checklist。  
4. 不变量 I1–I8 中适用项无回退。

---

## 实施任务索引（checkbox）

### Wave 1

- [x] Task W1.1：抽出 Request Auth module；删 plugin `parseCookie`  
- [x] Task W1.2：auth 矩阵测试迁到 Request Auth 缝  
- [x] Task W1.3：删除 `RpcMethodDef.mutates`；registry×`isMutating` 表测  
- [x] Task W1.4：更新 ADR-0004 相关实现注释（不改决策）

### Wave 2

- [x] Task W2.1：`invokeAdmin` / 统一错误映射  
- [x] Task W2.2：列表 schema 单源  
- [x] Task W2.3：削 rpc `run` 模板；保持 envelope

### Wave 3

- [x] Task W3.1：`getSafeConfigView` + `applyEditableConfigPatch`  
- [x] Task W3.2：admin 改消费 + round-trip 测（Panel 去重仍开放，见 W3 验收）  
- [x] Task W3.3：记录与 ADR-0003 的文件边界说明（本计划或短 ADR 附录）

### Wave 4

- [x] Task W4.1：`ProposalStore`；迁 write/list/apply；改 `export.ts`  
- [x] Task W4.2：compiler 去 Proposal FS 职责；`rg "\\.proposals"` 门  
- [x] Task W4.3：`MemoryStore.upsert`（先写新再按旧 path 删）；consolidate 改用；崩溃窗口测  


### Wave 5

- [x] Task W5.1：扩展 `LlmClient`；合并 refine 传输  
- [x] Task W5.2：pipeline 改调用；保留 refine 门控  

---

## Round 1 关闭矩阵（review-close）

| 根因 | 受影响 | 最小修复 | 验证 |
|------|--------|----------|------|
| R1 upsert 先删后写崩溃丢 L2 | I5、W4-B | 强制先写新 path，再按旧 path rm；禁 forget(id) 收尾 | 崩溃窗口测 + 成功路径无双文件 |
| R2 Proposal 调用方清单漏 export | W4-A 验收 / rg 门 | Files 含 `cli/export.ts`；store 提供 root/export | rg 仅 store |
| （OPTIONAL 已吸收）authorizeRpc 缺 CSRF | I1 歧义 | input 必含 cookie+csrf+双头 | 双头等价测 |
| （OPTIONAL 已吸收）Wave/术语歧义 | 范围可判定 | 改 W3/W5/I3 措辞 | 人工读方案 |

---

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| 鉴权搬家回归 Sec-Fetch | 先锁矩阵测再搬；W1 单独 PR |
| AmemConfig 注释丢失 | I8 单测必过；对照现有 `updateTomlText` 金样；委托既有 `writeAmemConfigFile` |
| Proposal 路径迁移漏调用方 | `rg "\\.proposals"` 清零（除 store）；Files 含 export |
| upsert 崩溃丢数据 | 先写新、再按旧 path 删；接受短暂双文件 |
| upsert 误删 | 仅当旧 path 存在且 ≠ 新 path 时按路径删 |

回滚：按 Wave revert；持久化格式未变，无数据迁移脚本。
