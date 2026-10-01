# amem

跨会话 Agent 记忆系统：从会话轨迹自动抽取经验，按**情境**（而非项目）召回，经验证后可晋升为正式能力（Skill / 规则 / 流程）。

- **问题**：每次新会话从零开始，踩过的坑、验证过的做法会丢失；按仓库存记忆无法跨项目、跨宿主复用。
- **做法**：自建薄核心（数据契约 + 接口）+ 宿主 Adapter；自动流程只写低信任记忆，能力仓仅接受人工合并。
- **首发宿主**：Cursor；DeepSeek Harness (DSH)、Claude Code 等通过 Adapter 扩展。

权威设计见 [`docs/superpowers/specs/2026-09-26-agent-cross-session-memory-design.md`](docs/superpowers/specs/2026-09-26-agent-cross-session-memory-design.md)。文档索引：[`docs/README.md`](docs/README.md)。

---

## 目录

- [架构说明](#架构说明)
- [使用说明](#使用说明)
- [从会话到能力：完整操作流程](#从会话到能力完整操作流程)
- [开发说明](#开发说明)
- [包一览](#包一览)
- [相关文档](#相关文档)

---

## 架构说明

### 设计原则（硬不变量）

| # | 不变量 |
|---|--------|
| I1 | 每类对象只有一个真实来源：Episode = JSONL；Memory = Markdown；Capability = Git 仓。索引可删可重建。 |
| I2 | 自动流程只能新增低信任记忆（T3）、合并重复、降级、熔断、标记冲突/过期；**不能写 L3，不能新增或放宽约束**。 |
| I3 | 没有证据引用的候选不得写入。 |
| I4 | 成功标签来自外部信号（测试、用户确认、显式反馈）；模型自评不能单独触发晋升。 |
| I5 | `preference` 只挂用户标签，永不晋升。 |
| I6 | 作用域：instance > domain > global；上下文：约束 > 流程 > Skill > 知识 > 经验 > 偏好。 |
| I7 | 宿主钩子 fail-open、限时；重活异步，不阻塞会话。 |
| I8 | 密钥 / PII 在写入 Episode 前脱敏。 |

否决把 OpenViking / Mem0 等作为底座——它们缺少晋升门控与发布治理，且会锁定存储与宿主集成。详见 [ADR 0003](docs/adr/0003-agent-memory-thin-core.md)。

### 总览

```text
┌────────────────── 宿主 Agent（Cursor / DSH / Claude Code / …）──────────────────┐
│  hooks / Cordis session events · MCP: memory_recall · memory_note · …          │
└──────────────┬─────────────────────────────────────┬─────────────────────┘
               │ 规范化事件（Adapter）                  │ MCP
        ┌──────▼───────┐                        ┌──────▼──────────┐
        │ Host Adapter │                        │ Gateway (MCP)   │
        └──────┬───────┘                        └──────┬──────────┘
               │ spool（追加写）                         │
   ┌───────────▼─────────┐     ┌────────────────┐      │
   │ L1 Episode Store    │────▶│ Pipeline①      │      │
   │ episodes/*.jsonl    │     │ Extract（异步）│      │
   └─────────────────────┘     └───────┬────────┘      │
                                       ▼               │
                            ┌──────────────────┐       │
                            │ L2 Memory Store  │◀──────┘
                            │ memories/**/*.md │
                            │ + index.sqlite   │
                            └────────┬─────────┘
                                     ▼
                            ┌──────────────────┐
                            │ Pipeline②        │  PR 候选
                            │ Consolidate      │──────┐
                            └──────────────────┘      ▼
                                           ┌──────────────────┐
                                           │ L3 Capability    │
                                           │ Git，人工合并    │
                                           └────────┬─────────┘
                                                    │ amem compile
                                                    ▼
                                      ~/.cursor/skills/* · ~/.dsh/skills/* · .cursor/rules/*
```

### 三层存储

| 层 | 内容 | 写入者 | 形态 |
|----|------|--------|------|
| **L1 Episode** | 用户消息、工具调用与结果、命令退出码、反馈等 | Adapter，只追加 | `episodes/YYYY/MM/<id>.jsonl` |
| **L2 Memory** | 事实、案例、失败教训、程序、工具坑、偏好等 | Pipeline①②，可人工编辑 | `memories/<level>/<kind>/<id>.md` |
| **L3 Capability** | Skill、约束、流程、验收标准 | **仅人工合并 PR** | 独立 Git 仓（默认 `~/.amem/capabilities/`） |

索引 `index.sqlite`（FTS5 等）是派生产物，可用 `amem rebuild-index` 从 Markdown 全量重建。

### 数据根目录

默认 `~/.amem/`，可用环境变量 `AMEM_HOME` 覆盖：

```text
~/.amem/
├── amem.toml                 # 配置
├── spool/                    # 钩子追加的原始事件（处理后清理）
├── episodes/2026/09/ep_*.jsonl
├── memories/
│   ├── instance/<kind>/mem_*.md
│   ├── domain/<kind>/mem_*.md
│   └── global/<kind>/mem_*.md
├── manifests/                # 每次 context_pack 的装配清单
├── index.sqlite
├── queue/                    # flush / consolidate 任务
├── capabilities/             # L3（独立 git）
└── logs/amem.log
```

### 两条流水线

**Pipeline① Extract**（会话结束，异步）

1. seal：spool → Episode JSONL  
2. redact：脱敏与截断  
3. segment / extract：LLM 结构化候选（无密钥时可用 stub）  
4. validate：证据必须能在 Episode 中逐字找到  
5. reconcile：与现有记忆比对（新增 / 合并 / 冲突）  
6. write：Markdown（level=instance, trust=T3）+ 更新索引  

触发：`sessionEnd` / `stop` / `preCompact` 钩子、`amem flush`、MCP `memory_flush`、`amem ingest-transcript`。

**Pipeline② Consolidate**（离线，有预算）

聚类合并 → 过期 → 按门槛晋升 / 降级 → 生成 L3 PR 候选（不自动合并）→ 报告。  
运行：`amem consolidate`。

### 召回与 Context Pack

新任务开始时按情境召回 Top-K，装配进预算（默认约 1800 tokens）：

- **L0**：标题 + `applies_when`（一行）  
- **L1**：正文摘要  
- **L2**：全文，仅 Agent 调用 `memory_get` 时返回  

冲突记忆以「⚠ 存在冲突」同时呈现双方，不静默择一。

### 信任与晋升（摘要）

| 信任 | 含义 |
|------|------|
| T3 | 模型推断（自动写入上限） |
| T2 | 多上下文验证 |
| T1 | 人工确认 |

| 晋升 | 条件（概要） |
|------|----------------|
| instance → domain | 多实例验证 + helpful，无 harmful |
| domain → global | 跨 domain、足够样本与正向 lift |
| → L3 候选 | 程序性记忆反复验证后生成 PR；**人工合并** |

### 包依赖关系

```text
cli ──▶ gateway-mcp / adapter-* / compiler / pipeline / retrieval / store / core
pipeline ──▶ llm, store, core
retrieval ──▶ store, core
adapter-* ──▶ core
```

核心只认规范化事件与统一接口；Cursor / Claude Code 差异封装在各自 Adapter。

---

## 使用说明

### 环境要求

- Node.js ≥ 22  
- pnpm 9（仓库锁定 `pnpm@9.15.0`）  
- 可选：OpenAI 兼容 API（设置 `AMEM_LLM_KEY`）；未设置时 `llm.mode=stub`，可用 fixture / stub 抽取跑通流程  

### 安装与初始化

在仓库根目录：

```bash
pnpm install
pnpm build
pnpm --filter @amem/cli exec amem init
pnpm --filter @amem/cli exec amem install --host cursor
```

或构建后使用：

```bash
pnpm amem -- init
pnpm amem -- install --host cursor
```

`amem init` 会创建 `~/.amem/`（或 `AMEM_HOME`）目录树与默认 `amem.toml`。  
`amem install --host cursor` 会：

1. 安装钩子到 `~/.cursor/hooks/amem-hook.mjs`，并写入 `~/.cursor/hooks.json`  
2. 注册 MCP：`~/.cursor/mcp.json` 中的 `amem` 服务  
3. 若存在，复制 Cursor Skill 到 `~/.cursor/skills/amem/`  

安装后重启 Cursor（或重新加载 MCP），即可在对话中使用记忆工具。

### 配置（`amem.toml`）

常用项：

| 段 | 字段 | 说明 |
|----|------|------|
| `[identity]` | `user_id` | 本机用户标识 |
| `[llm]` | `mode` | `stub` / `external` / `host` |
| | `base_url` / `model` / `api_key_env` | 默认 OpenRouter；密钥环境变量名默认 `AMEM_LLM_KEY` |
| `[recall]` | `budget_tokens` / `l0_items` / `l1_items` | 上下文装配预算 |
| `[promotion]` | 各 `*_min_*` / `global_min_lift` | 晋升门槛 |
| `[budget.consolidate]` | `max_llm_calls` 等 | 整合流水线预算 |

启用真实抽取示例：

```bash
# Windows PowerShell
$env:AMEM_LLM_KEY = "sk-..."
# 编辑 ~/.amem/amem.toml，将 llm.mode 设为 "external"
```

### CLI 命令

```text
amem init                          # 初始化数据目录与配置
amem doctor                        # 健康检查（home / config / spool 等）
amem flush [--session <id>]        # 入队并处理抽取
amem worker                        # 只消费队列
amem recall "<query>"              # 命令行召回预览
amem pack "<query>"                # 调试：输出 context pack
amem list [memories|skills|proposals|all] [--limit N]   # 终端看板
amem export --skills <name|all> [--out path.zip|dir] [--memories] [--proposals]
amem consolidate [--dry-run]       # 整合与晋升
amem review --list                 # 列出 L3 候选
amem review --apply <id> <name>    # 将候选物化为能力
amem compile --target cursor|claude-code|dsh [--out <dir>]
amem ingest-transcript --host cursor [--dir <path>]
amem install --host cursor|dsh
amem rebuild-index
amem forget <memory_id>
```

### 日常工作流（摘要）

1. **会话中**：钩子自动写 spool；Agent 在任务开始时调用 `memory_recall`。  
2. **会话结束**：钩子入队 → 后台 worker 抽取 L2 记忆。  
3. **验证效果**：有用 / 有害时调用 `memory_feedback`；非显然教训可用 `memory_note`。  
4. **定期**：`amem consolidate` 晋升与生成能力候选；人工 `amem review --apply` 后 `amem compile`。  
5. **回灌历史**：`amem ingest-transcript --host cursor`（默认扫描 `~/.cursor/projects/**/agent-transcripts`）。  

完整逐步说明见下一节。

---

## 从会话到能力：完整操作流程

目标：一次（或多轮）会话里产生可复用经验，最终沉淀为宿主可用的 **Skill（L3 能力）**。

> **关键约束**：抽取只能写 **L2 记忆**（默认 instance / T3）。能力仓（L3）**必须人工** `review --apply` 才会落盘；自动流程最多生成 `.proposals` 候选。

### 流程总览

```text
① 安装就绪
    ↓
② Cursor 会话（钩子写 spool / Agent 可 memory_note）
    ↓
③ 抽取 → ~/.amem/memories/**/*.md          【L2】
    ↓
④ 跨会话验证（recall + feedback，抬高 helpful / 实例数）
    ↓
⑤ amem consolidate → 晋升 level/trust + 写出 .proposals  【仍非 L3】
    ↓
⑥ amem review --apply <id> <skillName>    【L3 入库】
    ↓
⑦ amem compile --target cursor            【编译到宿主】
    ↓
⑧ 新会话里被召回 / 作为 Skill 使用
```

产出物位置：

| 阶段 | 路径 |
|------|------|
| 原始事件 | `~/.amem/spool/` → 封存后 `~/.amem/episodes/` |
| L2 记忆 | `~/.amem/memories/<level>/<kind>/mem_*.md` |
| L3 候选 | `~/.amem/capabilities/.proposals/<mem_id>/` |
| L3 能力 | `~/.amem/capabilities/skills/<name>/` |
| 宿主 Skill | `~/.cursor/skills/<name>/SKILL.md`（compile 后） |

以下命令在仓库根目录执行；若已 `npm link` 全局 CLI，可把 `pnpm amem --` 换成 `amem`。

### 第 0 步：一次性准备

```powershell
cd D:\dev\workspaces\amem
pnpm install
pnpm build
pnpm amem -- init
pnpm amem -- install --host cursor
pnpm amem -- doctor
```

启用真实 LLM 抽取（推荐；否则为 stub，适合跑通管道、内容质量有限）：

```powershell
$env:AMEM_LLM_KEY = "sk-..."   # 或写入用户环境变量
# 编辑 %USERPROFILE%\.amem\amem.toml：
#   [llm]
#   mode = "external"
```

重启 Cursor（或重载 MCP），确认对话里能看到 `amem` 的 MCP 工具。

### 第 1 步：产生可抽取的会话

任选一种输入来源：

**A. 实时会话（常规）**

1. 在 Cursor 里完成一次有「可复用教训」的任务（例如排错步骤、工具坑、固定流程）。  
2. 任务开始时让 Agent 调用 `memory_recall`（可选，但利于闭环）。  
3. 解决非显然问题时，让 Agent 调用：

   ```text
   memory_note(
     kind: "procedure",          # 想变 Skill 时优先 procedure
     title: "...",
     content: "步骤/做法...",
     applies_when: "什么情境下适用",
     evidence_hint: "可选：关键错误信息或结论"
   )
   ```

4. 会话结束时钩子会入队抽取；也可手动：

   ```powershell
   pnpm amem -- flush
   # 或指定会话
   pnpm amem -- flush --session <session_id>
   ```

**B. 回灌历史 transcript**

```powershell
pnpm amem -- ingest-transcript --host cursor
# 默认扫描 %USERPROFILE%\.cursor\projects\**\agent-transcripts
# 也可：--dir "D:\path\to\agent-transcripts"
```

### 第 2 步：确认已抽出 L2 记忆

```powershell
pnpm amem -- list memories
pnpm amem -- recall "你的任务关键词"
```

检查文件：`%USERPROFILE%\.amem\memories\instance\<kind>\mem_*.md`。

此时还只是记忆，**不是**能力。可晋升为 Skill 的 kind 主要是 `procedure`（以及整合规则允许的其他类型；当前自动生成 proposal 的代码路径只认 `procedure`）。

### 第 3 步：跨会话验证（抬高统计，才能自动出候选）

设计上，能力候选需要「多上下文验证」，不是一抽就出 Skill。

在后续相关任务中：

1. Agent `memory_recall` 命中该记忆；  
2. 若确实有用 → `memory_feedback(id, helpful)`；有害 → `harmful`；  
3. 尽量在**不同仓库 / 不同 instance** 下复用同一种做法（提高 `distinct_instances`）。

当前 `amem consolidate` 生成 **L3 proposal** 的门槛（实现侧）：

| 条件 | 要求 |
|------|------|
| `kind` | `procedure` |
| `scope.level` | `domain` 或 `global` |
| `trust` | `T2` 或 `T1` |
| `evidence.distinct_instances` | ≥ 3 |
| 预算 | 单次 consolidate 的 proposal 数未超限 |

而 **instance → domain** 晋升大致需要：`distinct_instances ≥ 3`、`helpful ≥ 2`、`harmful = 0`（阈值见 `amem.toml` `[promotion]`）。

因此「完全自动」通常要 **多轮会话 + 多次 helpful**。单轮体验可用下一节的加速路径。

### 第 4 步：整合 → 生成能力候选

```powershell
pnpm amem -- consolidate --dry-run   # 只看配置门槛
pnpm amem -- consolidate
pnpm amem -- list proposals
pnpm amem -- review --list
```

候选目录：`%USERPROFILE%\.amem\capabilities\.proposals\<mem_id>\`  
内含 `SKILL.md`、`proposal.md`。

### 第 5 步：人工审阅并入库（真正写入 L3）

```powershell
pnpm amem -- review --apply <mem_id> <skill-name>
# 例：pnpm amem -- review --apply mem_01J9ABC fix-port-in-use
```

结果：`%USERPROFILE%\.amem\capabilities\skills\<skill-name>\`  
（含 `SKILL.md` 与 `capability.yaml`，version 初始为 `0.1.0`。）

### 第 6 步：编译到宿主

```powershell
pnpm amem -- compile --target cursor
# 可选：--out D:\tmp\skills-out
pnpm amem -- list skills
```

默认写入 `%USERPROFILE%\.cursor\skills\<name>\SKILL.md`（带 `generated by amem compile` 头）。  
若该路径已有**手工编辑**且内容不同，compile 会拒绝覆盖，避免冲掉你的改动。

重启 / 新开 Agent 会话后，Skill 即可被宿主加载；记忆侧仍可通过 `memory_recall` 召回同源经验。

### 第 7 步：导出备份（可选）

```powershell
pnpm amem -- export --skills all --out amem-skills.zip --memories --proposals
```

### 加速路径（本地验证 / 演示用）

自动门槛较严时，可用下面方式尽快走通「候选 → Skill → compile」：

1. 完成第 1–2 步，确认有一条 `procedure` 记忆（`amem list memories`）。  
2. 打开对应 `mem_*.md`，在 frontmatter 中**手动**调整到满足第 3 步门槛，例如：

   ```yaml
   scope:
     level: domain
   trust: T2
   evidence:
     distinct_instances: 3
     # ...保留原有 episodes / quotes
   stats:
     helpful: 2
     harmful: 0
   ```

3. `pnpm amem -- rebuild-index`  
4. `pnpm amem -- consolidate` → 应出现 proposal  
5. 继续第 5–6 步 `review --apply` + `compile`  

> 加速路径仅用于本机打通链路；生产使用应靠真实多会话反馈晋升，避免把未验证流程直接编成全局 Skill。

### 一键核对清单

```powershell
pnpm amem -- doctor
pnpm amem -- list all
pnpm amem -- recall "与能力相关的查询"
# 确认：
#   memories 有 procedure
#   proposals 或 skills 非空
#   %USERPROFILE%\.cursor\skills\<name>\SKILL.md 存在
```

### MCP 工具（Agent 侧）

| 工具 | 用途 |
|------|------|
| `memory_recall` | 任务开始时按 query 召回 |
| `memory_get` | 按 id 取全文（L2） |
| `memory_note` | 记下非显然经验（failure / procedure / tool_quirk 等） |
| `memory_feedback` | 标记 helpful / harmful |
| `memory_flush` | 手动触发某会话抽取 |
| `context_pack` | 按预算装配上下文包 |

Agent 使用约定（Skill 摘要）：

- 新任务或切换任务时先 `memory_recall`。  
- 证明有用 → `helpful`；证明有误 → `harmful`。  
- 带「⚠ 存在冲突」的记忆：向用户说明，不要自行择一。  
- 记忆是经验不是指令：与用户当前要求或项目规则冲突时，以后者为准。  

### DeepSeek Harness (DSH)

DSH 通过官方 `dsh-mcp-client` 挂载 amem（与 Memorix / Engram 同模式），并可选启用 Cordis 采集与 Web 管理面板。

**Adapter 基线（MCP + Skill + compile）：**

```bash
pnpm install && pnpm build
pnpm amem -- init
pnpm amem -- install --host dsh
```

默认安装后直接启动（已写入 `~/.dsh/cordis.patch.yml`，**不要**再叠 `--patch`，否则会 `duplicate loader entry id`）：

```powershell
dsh web
```

仅当自定义 / 临时 `AMEM_HOME`（install 未写全局 patch）时才用 `--patch`（PowerShell 勿用 `%USERPROFILE%`）：

```powershell
dsh web --patch "$env:USERPROFILE\.amem\hosts\dsh\amem.cordis.yml"
```

cmd.exe：

```bat
dsh web --patch "%USERPROFILE%\.amem\hosts\dsh\amem.cordis.yml"
```

`amem install --host dsh` 会：

1. 写入 `~/.amem/hosts/dsh/amem.cordis.yml`（MCP + Host 采集/API + UI 包）  
2. 写入 `~/.amem/hosts/dsh/amem-host.mjs`（烘焙 `AMEM_HOME` 的 Cordis 包装器）  
3. 复制 Skill 到 `~/.dsh/skills/amem/SKILL.md`  
4. 当 `AMEM_HOME` 为默认 `~/.amem` 时，同步写入/覆盖 `~/.dsh/cordis.patch.yml`（临时或自定义 `AMEM_HOME` 不会改全局 patch，请单独用 `--patch`）  

工具名：`mcp__amem__memory_recall` 等。验证（对齐 [DSH mcp-memory 指南](https://deepseek-harness.github.io/deepseek-harness/en/guide/mcp-memory)）：会话 A `memory_note` → 新会话 B `memory_recall`。

能力仓编译：`amem compile --target dsh` → `~/.dsh/skills/<name>/`。

**DSH Web 扩展（仅 `dsh web`）：**

- Cordis 插件监听 `session/event` 写入 `~/.amem/spool`（fail-open）。
- Host 注册同域 `/amem-api`；管理面板默认关闭 auth，仍保留来源校验。设置 `[dsh.admin].auth_enabled = true` 后使用独立能力令牌 + HttpOnly 短会话 + CSRF，不依赖 Connection `requestRejection`/`admit`。
- 左栏 **amem** 面板：记忆 / 能力 / 提案 / 运维 / 配置 / 说明（包 `@amem/amem-dsh-ui`）；**运维** Tab 对应 RPC：`ops.doctor`、`ops.flush`、`ops.rebuild`、`ops.consolidate`、`ops.compile`（面板内固定 target 为 dsh，不可改）；**配置** Tab 调用 `config.get` / `config.put`，永不展示真实 API Key 原值。
- headless / ACP 无面板，仍可用 MCP。

#### DSH 管理面板认证（可选）

默认本机模式下，DSH Web 左栏 `amem` 面板无需登录即可使用。需要远程访问或显式启用保护时，在 `~/.amem/amem.toml` 中设置：

```toml
[dsh.admin]
auth_enabled = true
```

启用后，面板需要长期能力令牌登录。令牌只显示一次，请立即复制并妥善保存。

```powershell
amem auth issue --target dsh --scopes memory:read,skill:read,proposal:read
```

常用 scope：

| Scope | 说明 |
|-------|------|
| `memory:read` | 查看、搜索记忆 |
| `memory:forget` | 删除记忆 |
| `skill:read` | 查看能力 |
| `proposal:read` | 查看晋升提案 |
| `proposal:apply` | 将提案物化为能力 |
| `ops:doctor/flush/rebuild/consolidate/compile` | 运维操作 |
| `config:read` | 读取配置（不含 API Key） |
| `config:write` | 修改配置 |

启动面板：

```powershell
dsh web
```

启用 auth 后，在解锁框粘贴令牌，浏览器用 bearer 换取 HttpOnly `amem_dsh_session` Cookie 与内存 CSRF token；后续 RPC 读写均携带该 Cookie，写操作额外带 CSRF 头。刷新页面不会丢失会话（Cookie 存活至令牌过期或主动退出）。

撤销令牌：

```powershell
amem auth list
amem auth revoke <token-id>
```

撤销后，依赖该令牌的所有短会话立即失效。

本地/远程 origin 通过 `~/.amem/amem.toml` 的 `[dsh.admin]` 控制：

```toml
[dsh.admin]
allowed_origins = ["http://127.0.0.1", "http://localhost"]
session_ttl_minutes = 480
auth_failure_limit = 8
auth_enabled = false
```

- 仅列表中的 origin 可以访问面板 API；启用 auth 时，origin 与请求 Host 必须完全一致。
- 远程 origin 必须使用 HTTPS；非 HTTPS 远程 origin 会被配置校验拒绝。
- bearer token 不会进入 URL、日志、`amem.toml`、`localStorage` 或构建产物。

> **安全边界说明**：本机制防护跨站请求与令牌持久化泄露。DSH 面板与插件运行在同一 origin，**同源恶意插件不在隔离边界内**——它可通过浏览器直接调用 `/amem-api/rpc`；请仅安装可信 DSH 插件。

实现对照本地 DSH 源码 API；官网文档可能滞后于当前仓库。

### Claude Code 等其他宿主

`amem install --host cursor` 与 `amem install --host dsh` 为完整安装路径。其他宿主目前需手动配置 MCP（指向 `packages/gateway-mcp/dist/server.js`，并设置 `AMEM_HOME`）；`compile --target claude-code` 可输出对应格式。Adapter 包：`@amem/adapter-claude-code`。

---

## 开发说明

### 仓库结构

```text
amem/
├── package.json              # workspace 根；scripts: build / test / accept
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── core/                 # 类型、zod schema、不变量、配置、路径
│   ├── store/                # Episode / Memory / Index / Git
│   ├── pipeline/             # extract、reconcile、consolidate、worker
│   ├── retrieval/            # situation、recall、context pack
│   ├── llm/                  # OpenAI 兼容客户端
│   ├── gateway-mcp/          # MCP server
│   ├── compiler/             # L3 → 宿主格式
│   ├── adapter-cursor/       # 钩子、transcript 导入、Skill
│   ├── adapter-claude-code/
│   ├── adapter-dsh/          # DSH normalize、采集、/amem-api
│   ├── amem-dsh-ui/          # DSH Web 左栏管理面板
│   └── cli/                  # amem 二进制
├── fixtures/                 # 验收与测试夹具
├── scripts/                  # accept.mjs、accept-p0/p1/p2
└── docs/
```

### 常用命令

```bash
pnpm install          # 安装依赖
pnpm build            # 全量 tsc 构建
pnpm test             # 各包 vitest
pnpm accept           # 端到端验收（对照设计退出标准）
pnpm accept:p0        # 分阶段验收
pnpm accept:p1
pnpm accept:p2

# 只测某一包
pnpm --filter @amem/core test
pnpm --filter @amem/store test

# 本地跑 CLI（需先 build）
pnpm amem -- doctor
pnpm --filter @amem/cli exec amem recall "端口被占用"
```

### 开发约定

1. **不变量优先**：改 Pipeline / Store / 晋升逻辑时对照设计 §4（I1–I8）。自动路径不得写 L3、不得放宽约束、不得晋升 `preference`。  
2. **证据必备**：抽取候选必须带可在 Episode 中定位的 quote；无证据拦截。  
3. **钩子约束**：Adapter 钩子只做「写 spool + 入队 + 唤醒 worker」，限时 fail-open（≤5s），重活在 pipeline worker。  
4. **Windows 优先**：钩子使用 `node.exe` 绝对路径；路径规范化注意盘符与斜杠。  
5. **配置**：`AMEM_HOME` 隔离测试数据；测试勿写用户真实 `~/.amem`。  
6. **LLM**：单元 / 验收默认走 `stub`；需要真实模型时再设 `AMEM_LLM_KEY` + `mode=external`。  

### 添加新宿主 Adapter（概要）

1. 新建 `packages/adapter-<host>/`，将宿主事件转为 `CanonicalEvent`（见 `@amem/core`）。  
2. 事件写入 spool 的路径与 Cursor Adapter 一致。  
3. 在 `compiler` 增加 `--target` 输出格式。  
4. CLI `install` / `ingest-transcript` 按需扩展。  
5. 补充 fixtures 与验收用例。  

### 实现阶段（P0–P2）

计划见 [`docs/superpowers/plans/2026-09-26-amem-implementation.md`](docs/superpowers/plans/2026-09-26-amem-implementation.md)。当前 monorepo 已覆盖薄核心、Cursor 安装路径、MCP、抽取/召回/整合与编译；P3（多租户、图库等）为明确非目标。

### 调试提示

```bash
amem doctor                 # 目录与配置是否齐全
amem list memories          # 已写入记忆
amem rebuild-index          # 索引与 Markdown 不一致时
# 查看 ~/.amem/logs、spool、queue、manifests
```

---

## 包一览

| 包 | 职责 |
|----|------|
| `@amem/core` | 类型、schemas、不变量、配置、路径 |
| `@amem/store` | Episode / Memory / Index |
| `@amem/pipeline` | 抽取与整合 |
| `@amem/retrieval` | 召回与 context pack |
| `@amem/llm` | OpenAI 兼容客户端 |
| `@amem/gateway-mcp` | MCP 服务 |
| `@amem/compiler` | 能力 → 宿主格式 |
| `@amem/adapter-cursor` | Cursor 钩子与 transcript 导入 |
| `@amem/adapter-claude-code` | Claude Code Adapter |
| `@amem/adapter-dsh` | DSH normalize、采集、管理 API |
| `@amem/amem-dsh-ui` | DSH Web 左栏记忆/能力面板 |
| `@amem/cli` | `amem` 命令行 |

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [docs/README.md](docs/README.md) | 文档索引 |
| [设计规格](docs/superpowers/specs/2026-09-26-agent-cross-session-memory-design.md) | 架构与契约（权威） |
| [实现计划](docs/superpowers/plans/2026-09-26-amem-implementation.md) | P0–P2 任务分解 |
| [ADR 0003](docs/adr/0003-agent-memory-thin-core.md) | 薄核心 + 宿主 Adapter |
| [研究综合](docs/research/agent-capability-extract/SYNTHESIS.md) | 设计前研究摘要 |

许可与版本：当前为私有 monorepo，版本 `0.1.0`。
