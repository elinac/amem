# DSH amem 面板：配置 Tab

日期：2026-09-27  
状态：审核通过（Round 2：PASS_WITH_OPTIONAL，无阻塞项）  
范围：**配置面板（表单编辑常用 `amem.toml`）** — 勿与 ops-help 的「B 能力链路」字母混用  
前置：运维/说明 Tab 已落地（`2026-09-27-dsh-panel-ops-help-design.md`）

## 1. 目标

在 DSH Web amem 面板内查看并编辑常用配置，写回 `AMEM_HOME/amem.toml`，无需手改文件。

成功标准：

1. 新 Tab「配置」可加载当前配置到表单。
2. 可修改常用字段并保存；非法值被拒绝。
3. 不读写真实 API Key（仅 `api_key_env` 名）。
4. 文案跟随 DSH locale（zh/en）；鉴权同 `/amem-api`。
5. 保存**不得**用默认值静默冲掉未在表单中编辑的段（embedding / privacy 等）。

## 2. 架构

与运维 Tab 同模式：扩展 `createAdmin` + `/amem-api` 路由 + 面板 Tab。  
读写复用 `@amem/core` 的 `loadConfig` / `configToToml` / `AmemConfig`。  
校验与 TOML 字符串转义优先落在 `@amem/core`（`escapeTomlString` + `validateAmemConfigPatch` 或等价），adapter 调用。

不采用：跳外编辑器；整 TOML 源码编辑器。

## 3. UI

### 3.1 Tab

顺序：`记忆 | 能力 | 提案 | 运维 | 配置 | 说明`  
locale：`tab.config` → zh「配置」/ en「Config」  
`config` **不是** list tab（`isListTab` 不变；不触发 `/proposals`）。

须同步更新：

- 说明页 `help.tabsBody`（及 en）加入「配置」职责  
- README DSH Web 小节改为六 Tab，顺序与上一致  

### 3.2 表单分区（可编辑）

| 段 | 字段 | 控件 |
|----|------|------|
| identity | `user_id` | text |
| llm | `mode` | select：`stub` \| `external` \| `host` |
| llm | `base_url`, `model`, `api_key_env` | text |
| recall | `budget_tokens`, `l0_items`, `l1_items` | number |
| promotion | `instance_to_domain_min_instances`, `domain_to_global_min_domains`, `domain_to_global_min_instances`, `global_min_lift` | number |
| budget.consolidate | `max_llm_calls`, `max_tokens`, `max_proposals`, `max_minutes` | number |

locale 键（实现时成对补齐）：`config.reload` / `config.save` / `config.confirmSave` / `config.saved` / 各 section 标题与字段 label；`config.hintSecrets` / `config.hintReload`。

### 3.3 本轮不做（UI）

- `embedding.*` 编辑（表单不展示；**服务端仍从磁盘保留**）  
- `privacy.*` 编辑（提示用手改文件；**写盘必须保留磁盘上的 privacy 语义**——见 §4.1）  

### 3.4 交互

- 进入 Tab /「重新加载」→ `GET /amem-api/config`；客户端 state 保留完整 `config`（含未展示的 embedding/privacy），表单只绑定可编辑字段  
- 「保存」→ confirm → `PUT` body = **当前完整 state**（未展示字段保持 GET 值）  
- 独立 `configBusy`；成功展示 `{ path, saved }`；失败展示 `message`  
- 短提示：密钥在环境变量；保存后新请求读盘生效；长期 worker 可能需重启 `dsh web`

## 4. API

| Method | Path | Admin |
|--------|------|-------|
| GET | `/amem-api/config` | `getConfig()` → `{ path, config }` |
| PUT | `/amem-api/config` | `putConfig(body)` → 校验 → 原子写盘 → `{ path, saved: true }` |

鉴权：现有 `checkAuth`（`requestRejection` / `admit`）。威胁模型与现有 `/amem-api` 相同（本轮不加 CSRF token）。

### 4.1 合并与形状（硬约束）

**选定策略：磁盘基线 overlay**（勿称「策略 B」，以免与 ops-help 字母冲突）

```text
base = loadConfig(home)           // 永远以磁盘为准
patch = extractEditable(body)     // 仅 §3.2 字段；非法 → 400
// patch 中缺省的可编辑键：保留 base（不覆盖）
validated = merge(base, patch)    // embedding/privacy 等未在 patch 中的键保持 base
writeAtomic(configPath, configToTomlSafe(validated))
```

- **禁止**用 `defaultConfig()` 作为写盘基线去「补缺」。  
- **PUT body 形状**：`{ config: AmemConfig }`（与 GET 的 `config` 字段对齐）；也接受顶层即 `AmemConfig`（若存在 `config` 键则以之为准）。  
- UI 应 round-trip 完整 GET `config`；服务端**不信任** body 中的 `embedding` / `privacy`：忽略这两段，始终用磁盘 `base`。  
- `configToTomlSafe`：  
  1. 双引号字符串必须转义，或校验拒绝含 `["\\\n\r]` → 400  
  2. **privacy（本轮默认路径）**：写盘时从原 `amem.toml` **原样保留 `[privacy]` 段**拼回（因现网 `parseSimpleToml` 不读数组，`loadConfig().privacy` 恒为 `[]`）。可选后续再修解析+序列化；验收测试：「手改 privacy 非空 → 面板保存后文件中仍非空」。

### 4.2 校验规则（单一）

| 字段类 | 规则 |
|--------|------|
| `llm.mode` | 必须 ∈ `stub` \| `external` \| `host` |
| `user_id`, `api_key_env` | trim 后非空；拒绝含 `"\`、`\`、`\n`、`\r` |
| `base_url`, `model` | trim；允许空字符串；若非空则同样拒绝危险字符 |
| `api_key_env` | 额外：拒绝看起来像密钥的值（如含 `sk-` 前缀或长度异常高的 token 形）→ 400（启发式即可） |
| 整数项（items / instances / domains / max_* / budget_tokens / dim 若出现） | `Number.isFinite` 且 `Number.isInteger` 且 `>= 0` |
| `global_min_lift` | `Number.isFinite` 且 `>= 0`（允许浮点） |
| 非法 JSON body | 400（勿落入 500） |

### 4.3 写盘

`writeFileSync(tmp)` + `renameSync` 到 `paths(home).config`（同目录原子替换）。

### 4.4 错误

校验失败 → 400 `{ error, message }`；IO 失败 → 500。

## 5. 文件变更

| 包 | 变更 |
|----|------|
| `@amem/core` | `escapeTomlString`；改进 `configToToml`；可选 `validateEditableConfigPatch`；privacy 往返或段保留 |
| `adapter-dsh` | `getConfig` / `putConfig`；GET/PUT 路由；测试（含注入样例、privacy 保留、merge 不冲 embedding） |
| `amem-dsh-ui` | locales（含 help.tabsBody 更新）；配置 Tab 表单 |
| README | 六 Tab + 配置可编辑说明一句 |

## 6. 测试

1. getConfig 返回 path+config  
2. putConfig 改 `llm.mode` 后 reload 一致；embedding 保持原值  
3. 非法 mode / 空 user_id / 字符串注入样例 → 400  
4. 磁盘 privacy 非空（或模拟）→ 面板保存后不被抹成空（按 §4.1 选定实现）  
5. 手动：切配置 Tab 不请求 `/proposals`；说明页含配置

## 7. 非目标

- 编辑真实 API Key  
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
