# DSH amem 面板：配置 Tab

日期：2026-09-27  
状态：审核通过（Round 2：PASS_WITH_OPTIONAL，无阻塞项）  
范围：**配置面板（表单编辑常用 `amem.toml`）** — 勿与 ops-help 的「B 能力链路」字母混用  
前置：运维/说明 Tab 已落地（`2026-09-27-dsh-panel-ops-help-design.md`）

## 1. 目标

在 DSH Web amem 面板内查看并编辑常用配置，写回 `AMEM_HOME/amem.toml`，无需手改文件。

成功标准：

1. 新 Tab「配置」可加载当前配置到表单。
2. 可修改常用字段并保存；非法值被拒绝；存在未保存修改时不静默丢弃。
3. **密钥**：可写入真实 API Key 或仅填环境变量名（2026-10-01 裁决）；服务端回读只给来源与是否存在，**永不回显密钥原值**。
4. 文案跟随 DSH locale（zh/en）；鉴权同 `/amem-api`。
5. 保存**不得**用默认值静默冲掉未在表单中编辑的段（embedding / privacy 等），**也不得丢弃文件中的手写注释与未知键**。

## 2. 架构

与运维 Tab 同模式：扩展 `createAdmin` + `/amem-api` 路由 + 面板 Tab。  
读写复用 `@amem/core` 的 `loadConfig` / `updateTomlText`（写盘）/ `configToToml`（全新生成）/ `AmemConfig`。  
校验与 TOML 字符串转义优先落在 `@amem/core`（`escapeTomlString` + `validateAmemConfigPatch` 或等价），adapter 调用。

不采用：跳外编辑器；整 TOML 源码编辑器。

## 3. UI

### 3.1 Tab

顺序：`记忆 | 能力 | 提案 | 审阅 | 运维 | 配置 | 说明`（七 Tab；「审阅」为后续加入）  
locale：`tab.config` → zh「配置」/ en「Config」  
`config` **不是** list tab（`isListTab` 不变；不触发 `/proposals`）。

须同步更新：

- 说明页 `help.tabsBody`（及 en）加入「配置」职责  
- README DSH Web 小节改为七 Tab，顺序与上一致  

### 3.2 表单分区（可编辑）

**第一波（已落地；2026-10-01 按界面评审结论修订）**

| 段 | 字段 | 控件 |
|----|------|------|
| llm | `mode` | select：`stub` \| `external` \| `host` |
| llm | `base_url`, `model` | text |
| llm | `api_key` | password（写入磁盘；留空＝不修改磁盘值） |
| llm | `api_key_env` | text（仅变量名；见 §4.2 启发式） |
| budget.consolidate | `refine_proposals` | checkbox，分区名「整合时的 LLM 精炼」（原「整合预算」名不副实） |

**后续波次（locale 键与后端 4 层已就绪，尚未渲染）**

| 段 | 字段 | 控件 |
|----|------|------|
| identity | `user_id` | text |
| recall | `budget_tokens`, `l0_items`, `l1_items` | number |
| promotion | `instance_to_domain_min_instances`, `domain_to_global_min_domains`, `domain_to_global_min_instances`, `global_min_lift` | number |
| budget.consolidate | `max_llm_calls`, `max_tokens`, `max_proposals`, `max_minutes` | number |

> 加数值字段前先抽字段渲染器；输入框空串必须表示「不发该键」，**不得**写成 0。

locale 键（成对补齐，zh/en 键集合必须一致）：`config.reload` / `config.save` / `config.confirmSave` / `config.confirmDiscard` / `config.saved` / `config.dirtyHint` / `config.hintSummary` / `config.detailsTitle` / `config.keySource.{inline,env,none}` / `config.warnKeyOverridesEnv` / 各 section 标题与字段 label。

### 3.3 本轮不做（UI）

- `embedding.*` 编辑（表单不展示；**服务端仍从磁盘保留**）  
- `privacy.*` 编辑（提示用手改文件；**写盘必须保留磁盘上的 privacy 语义**——见 §4.1）  

### 3.4 交互

- 进入 Tab /「重新加载」→ `GET /amem-api/config`；客户端 state 保留完整 `config`（含未展示的 embedding/privacy），表单只绑定可编辑字段  
- 以「可编辑子集指纹」判定 dirty：**存在未保存修改时**切 Tab /「重新加载」先 `confirm`；`保存` 按钮 `disabled={configBusy || !dirty}`  
- 「保存」→ confirm → `PUT` body = **当前完整 state**（未展示字段保持 GET 值）+ `api_key_replacement`（留空＝不修改）；成功后按「重载 → 写提示」顺序展示 `{path}`，不得被重载清空  
- 独立 `configBusy`；失败展示 `message`  
- 密钥来源三态明示（内联 / 环境变量 <名字> / 未配置）；填内联密钥且存在环境变量名时给出「回退将失效」警告  
- 顶部说明区压为一行摘要 + `<details>` 折叠；「保存后新请求读盘生效、长期 worker 可能需重启 `dsh web`」紧邻保存结果展示  
- 可访问名：每个控件的 `<label htmlFor>` 只含短标签，说明文字用 `aria-describedby` 引用（复选框同此）

## 4. API

| Method | Path | Admin |
|--------|------|-------|
| GET | `/amem-api/config` | `getConfig()` → `{ path, config }` |
| PUT | `/amem-api/config` | `putConfig(body)` → 校验 → 原子写盘 → `{ path, saved: true }` |

鉴权：现有 `checkAuth`（`requestRejection` / `admit`）。威胁模型与现有 `/amem-api` 相同（本轮不加 CSRF token）。

### 4.1 合并与形状（硬约束）

**选定策略：磁盘基线 overlay + 行级改写**（勿称「策略 B」，以免与 ops-help 字母冲突）

```text
base = loadConfig(home)           // 永远以磁盘为准
patch = extractEditable(body)     // 仅 §3.2 字段；非法 → 400
// patch 中缺省的可编辑键：保留 base（不覆盖）
validated = merge(base, patch)    // embedding/privacy 等未在 patch 中的键保持 base
api_key_replacement 非空时覆盖 merged.llm.api_key
text = updateTomlText(diskToml, validated)   // 只改写受管键，其余按磁盘原样
writeAtomic(text)
```

- **禁止**用 `defaultConfig()` 作为写盘基线去「补缺」。  
- **PUT body 形状**：`{ config: AmemConfig, api_key_replacement?: string }`（与 GET 的 `config` 字段对齐）；也接受顶层即 `AmemConfig`（若存在 `config` 键则以之为准）。  
- UI 应 round-trip 完整 GET `config`；服务端**不信任** body 中的 `embedding` / `privacy`：忽略这两段，始终用磁盘 `base`。  
- `updateTomlText`（**2026-10-01 修订**，替代原「整文件重生成 + `[privacy]` 段拼回」）：  
  1. 逐行扫描，**只改写** `configToToml` 拥有的段/键（identity、llm、embedding、recall、promotion、budget.consolidate、dsh、dsh.admin）；`[privacy]` 与未知段不在受管集合内，因此天然不被改写。  
  2. 引号外的行尾注释随该行保留；独立注释行、未知键、缩进与行尾符（CRLF/LF）原样保留。  
  3. 段内缺失的受管键紧跟该段表头补写；整个缺失的段追加到文件末尾（不产生重复表头）。  
  4. 磁盘文件为空 → 退化为 `configToToml(cfg)` 全新生成。  
  5. `preservePrivacyTomlSection` 只服务「全新生成」路径（如 `amem init`），不再参与面板保存。  
  6. `parseSimpleToml` 必须剥离引号外的行尾注释，否则 `key = "v" # 注释` 会被读成脏值（**2026-10-01 修复**）。  
- 字符串转义仍要求双引号必须转义（`escapeTomlString`）；含 `["\\\n\r]` 的值由 §4.2 拒绝 → 400。

### 4.2 校验规则（单一）

| 字段类 | 规则 |
|--------|------|
| `llm.mode` | 必须 ∈ `stub` \| `external` \| `host` |
| `user_id`, `api_key_env` | trim 后非空；拒绝含 `"\`、`\`、`\n`、`\r` |
| `base_url`, `model` | trim；允许空字符串；若非空则同样拒绝危险字符 |
| `api_key_env` | **已实现**：额外拒绝「像密钥」的值 —— 以 `sk-` 开头（不区分大小写），或长度 ≥ 40 且只由 `[A-Za-z0-9_+/=-]` 组成且不是常规 `[A-Z][A-Z0-9_]*` 变量名 → 400 |
| `api_key` | 允许任意密钥字面值（含 `sk-` 前缀）；仅拒绝危险字符；留空表示不修改磁盘值 |
| 整数项（items / instances / domains / max_* / budget_tokens / dim 若出现） | `Number.isFinite` 且 `Number.isInteger` 且 `>= 0` |
| `global_min_lift` | `Number.isFinite` 且 `>= 0`（允许浮点） |
| 非法 JSON body | 400（勿落入 500） |

### 4.3 写盘

`text = updateTomlText(diskToml, merged)` → `writeFileSync(tmp)` + `renameSync` 到 `paths(home).config`（同目录原子替换）。

### 4.4 错误

校验失败 → 400 `{ error, message }`；IO 失败 → 500。

## 5. 文件变更

| 包 | 变更 |
|----|------|
| `@amem/core` | `escapeTomlString`；`configToToml`（全新生成路径）；**`updateTomlText`（行级改写，保留注释 / 未知键 / 行尾符）**；`validateEditableConfigPatch`（含 `api_key_env` 密钥形拒绝）；`llmApiKeySource`；`parseSimpleToml` 剥离引号外行尾注释 |
| `adapter-dsh` | `getConfig`（返回 `api_key_source`，不回显密钥）/ `putConfig`；GET/PUT 路由；测试（注入样例、privacy 保留、注释保留、merge 不冲 embedding、`api_key_source`） |
| `amem-dsh-ui` | locales（含 help.tabsBody 与配置键集合）；配置 Tab 表单（dirty 保护、保存反馈、密钥来源三态、`api_key_env`、说明折叠、可访问名） |
| README | 七 Tab + 配置 Tab 能力（含密钥可写、注释保留） |

## 6. 测试

1. getConfig 返回 path+config（不含 `api_key`，含 `has_api_key` / `api_key_source`）  
2. putConfig 改 `llm.mode` 后 reload 一致；embedding 保持原值  
3. 非法 mode / 空 user_id / 字符串注入样例 → 400；`api_key_env` 形如密钥 → 400  
4. 磁盘 privacy 非空（或模拟）→ 面板保存后不被抹成空  
5. 手写注释与未知键 → 面板保存后仍在（含行尾注释、CRLF 行尾符）  
6. `key = "v" # 注释` 解析为 `v`；引号内的 `#` 不当作注释  
7. `updateTomlText`：段内缺键补写不产生重复表头；空磁盘文件退化为全新生成  
8. 手动：切配置 Tab 不请求 `/proposals`；未保存修改时切 Tab / 重新加载会确认

## 7. 非目标

> **2026-10-01 用户裁决**：原「不编辑真实 API Key」已解除——面板允许把密钥写入 `amem.toml`（内联优先于环境变量；留空表示不修改磁盘值）。README 与计划中相反表述同步修订。

- 整 TOML textarea  
- embedding / privacy **表单**编辑  
- CSRF token / worker 热更新通知  
- spawn / 改 CLI

## 8. 审核循环

| 轮次 | 结论 | 处置 |
|------|------|------|
| R1 | NEEDS_FIX | 已修复：磁盘 overlay、TOML 转义、privacy 保留、数值单一规则、范围命名、六 Tab/locale |
| R2 | **PASS_WITH_OPTIONAL** | 无阻塞；可选见 §9。退出循环 |

审核维度：可行性、完整性、一致性、清晰性、稳定性、通用性。  
对照：`packages/core/src/config.ts`、adapter-dsh `/amem-api`、面板 `isListTab`、DSH Connection `requestRejection`。

## 9. 可选修复项（待你确认）

| # | 项 | 建议 | 默认若不确认 |
|---|----|------|----------------|
| O1 | privacy 用磁盘段保留（因 parser 不读数组） | **已写入 §4.1 默认路径** | — |
| O2 | PUT body 固定 `{ config }` + 兼容顶层 AmemConfig；缺字段保留 base | **已写入 §4.1** | — |
| O3 | 数值字段加合理上界（防极端资源耗尽） | **跳过** | 本轮仅 `>= 0` / 有限 |
| O4 | `mode=external` 时强制 `base_url` 为 http(s) URL | **跳过** | 允许空 base_url |
| O5 | CSRF token / 日志脱敏完整 PUT body | 建议本轮不做 | 与现有 `/amem-api` 同威胁模型 |

已确认进入实现计划（O3/O4 跳过）。

## 10. 2026-10-01 界面评审与修订

依据 `docs/superpowers/reviews/2026-10-01-dsh-panel-config-ui-review.md`（专家团并行评审 + 主理人逐条回源复核）。

| 评审项 | 处置 |
|--------|------|
| F1 保存成功提示被 `loadConfig` 清空 | 已修：重载保留消息，提示写入移到重载之后 |
| F2 切 Tab / 重新加载静默丢弃未保存编辑 | 已修：可编辑子集指纹 + `config.confirmDiscard` 确认；保存按钮按 dirty 门控 |
| F3 密钥来源不可见 + 文案指向屏幕上不存在的字段 | 已修：补 `api_key_env` 字段、三态来源文案、覆盖回退警告；相关文案重写 |
| F4 `mode=host` 文案与实现矛盾 | 已修：文案注明「由宿主提供（当前尚未接入，行为等同 stub）」 |
| F5 说明区无层级、重启提示排最后 | 已修：一行摘要 + `<details>` 折叠；重启提示移到保存结果旁 |
| F6 分区名与内容不符、复选框居中错位与可访问名过长 | 已修：分区改名「整合时的 LLM 精炼」；`htmlFor`/`id` + `aria-describedby`；短标签左对齐 |
| F7 字段级错误定位（中文 + 就近） | 暂缓：需先定跨包字段级错误契约 |
| F8 设计基线与实现双向漂移 | 已按裁决同步：本规格 §3.2/§4.1/§4.2/§7、计划、README |
| F9 写盘丢弃手写注释（**已进验收标准**） | 已修：`updateTomlText` 行级改写，注释 / 未知键 / 行尾符保留 |
| 额外发现：`parseSimpleToml` 不剥离行尾注释 | 已修——F9 的前置条件，否则「保留注释」会读到脏值并在保存时 400 |

验证：`pnpm -r build` 通过（含 `tsc -p tsconfig.client.json --noEmit`）；`pnpm -r run test` 全绿（12 个包 / 164 项测试）。
