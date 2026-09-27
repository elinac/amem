# Agent 跨会话记忆与能力复用 — Design

**Status:** Draft（2026-09-26）  
**ADR:** `docs/adr/0003-agent-memory-thin-core.md`  
**背景研究:** `.scratch/agent-capability-extract/`（Opus / GPT 两套方案与综合稿）  
**首个宿主:** Cursor；后续适配 Claude Code、Codex CLI、OpenCode、Gemini CLI 等

> 本系统是独立于 NoteZ 应用的工具（代号 `amem`），文档暂存于本仓库。文中标注 **〔待核实〕** 的宿主接口细节，实现前需以宿主官方文档或实测为准。

---

## 1. Problem

Agent 每次会话从零开始：上次踩过的坑、验证过的做法、用户确认过的约定都会丢失。按项目存记忆只能在同一仓库内复用；换了项目、换了 Agent 宿主（Cursor → Claude Code），经验全部失效。

需要一个系统：

1. 在会话边界自动从轨迹中抽取记忆；
2. 不依赖项目分区，按**情境**召回，支持跨项目、跨宿主复用；
3. 经验经跨上下文验证后逐级泛化，最终可沉淀为正式能力（Skill / 约束 / 流程）；
4. 首先在 Cursor 上运行，核心与宿主解耦，后续低成本适配其他 Agent。

## 2. Goals

- **G1 自动抽取**：会话结束后无需人工操作即产生记忆候选，每条带证据。
- **G2 情境召回**：新会话开始时按任务情境召回 Top-K，注入上下文；不以项目作为分区键。
- **G3 逐级泛化**：instance → domain → global 晋升，依据独立上下文数与效果统计。
- **G4 能力沉淀**：反复验证的程序性记忆生成 L3 能力 PR 候选，人工合并后编译为宿主格式（Cursor Skills / Rules）。
- **G5 宿主无关**：核心只认规范化事件与统一接口；宿主差异封装在 Adapter。
- **G6 可审计可回滚**：记忆以 Markdown 为真实来源并纳入 Git；索引可重建；每次上下文装配留 manifest。

## 3. Non-Goals

- 图数据库、时态知识图（P3 之后按需）
- 模型微调 / 蒸馏
- 自动发布到 L3（能力仓只接受人工合并的 PR）
- 多 Agent 自治进化
- 团队多租户服务化部署（P3；P0–P2 为单用户本地）
- 替代宿主自带的会话历史 / 检查点功能

---

## 4. 硬不变量（任何实现不得违反）

| # | 不变量 |
|---|--------|
| I1 | 每类对象只有一个真实来源：Episode = JSONL；Memory = Markdown；Capability = Git 能力仓。索引可删可重建。 |
| I2 | 自动流程只能：新增低信任记忆（T3）、合并重复、降级、熔断、标记冲突/过期。**不能写 L3，不能新增或放宽约束。** |
| I3 | 没有证据引用的候选不得写入。 |
| I4 | 成功标签来自外部信号（测试结果、用户确认、显式反馈）；模型自评只计弱信号，不能单独触发晋升。 |
| I5 | `preference` 类记忆只挂用户标签，永不晋升。 |
| I6 | 作用域优先级固定：instance > domain > global；上下文优先级固定：约束 > 流程 > Skill > 知识 > 经验 > 偏好。 |
| I7 | 宿主钩子 fail-open、限时；重活异步执行，绝不阻塞用户会话。 |
| I8 | 密钥、令牌、PII 在写入 Episode 前脱敏；原文不出本机（除非用户显式配置远端 LLM 抽取）。 |

---

## 5. 架构总览

```text
┌──────────────────────── 宿主 Agent（Cursor / Claude Code / …）────────────────────────┐
│  hooks: sessionStart · postToolUse · afterShellExecution · stop · sessionEnd          │
│  MCP:   memory_recall · memory_note · memory_feedback · context_pack · capability_*   │
└──────────────┬───────────────────────────────────────────────┬────────────────────────┘
               │ 规范化事件（Adapter）                            │ MCP / HTTP
        ┌──────▼───────┐                                 ┌──────▼──────────┐
        │ Host Adapter │ cursor / claude-code / …        │ Gateway         │
        └──────┬───────┘                                 └──┬─────┬─────┬──┘
               │ spool（追加写，毫秒级）                     │     │     │
   ┌───────────▼─────────┐     ┌──────────────────────┐   │     │     │
   │ L1 Episode Store    │────▶│ Pipeline① Extract    │   │     │     │
   │ episodes/*.jsonl    │     │ （会话结束，异步）   │   │     │     │
   └─────────────────────┘     └──────────┬───────────┘   │     │     │
                                          ▼               │     │     │
                               ┌──────────────────────┐   │     │     │
                               │ L2 Memory Store      │◀──┘     │     │
                               │ memories/**/*.md     │         │     │
                               │ + index.sqlite(派生) │◀────────┘     │
                               └──────────┬───────────┘               │
                                          ▼                           │
                               ┌──────────────────────┐               │
                               │ Pipeline② Consolidate│  PR 候选      │
                               │ （每晚，有预算）     │──────────┐    │
                               └──────────────────────┘          ▼    │
                                                     ┌─────────────────▼──┐
                                                     │ L3 Capability Repo │
                                                     │ Git，人工合并      │
                                                     └─────────┬──────────┘
                                                               │ amem compile --target <host>
                                                               ▼
                                              ~/.cursor/skills/*  ·  .cursor/rules/*.mdc  ·  …
```

### 5.1 三层存储

| 层 | 内容 | 写入者 | 形态 |
|---|---|---|---|
| L1 Episode | 用户消息、工具调用与结果、文件变更、命令退出码、反馈、所用模型/能力版本 | Adapter，只追加 | `episodes/YYYY/MM/<episode_id>.jsonl` |
| L2 Memory | 事实、案例、失败教训、程序、工具坑、策略、验收标准、偏好、未决问题 | Pipeline①②，人工可编辑 | `memories/<level>/<kind>/<id>.md`（YAML frontmatter + 正文） |
| L3 Capability | Skill、约束、流程、验收标准、知识清单 | 仅人工合并 PR | 独立 Git 仓，目录结构见 §10 |

### 5.2 数据根目录

默认 `~/.amem/`（可由 `AMEM_HOME` 覆盖），整个目录 `git init`，由 Pipeline 自动提交，获得免费的历史与回滚：

```text
~/.amem/
├── amem.toml                 # 配置
├── spool/                    # 钩子追加写的原始事件（处理后清理）
├── episodes/2026/09/ep_*.jsonl
├── memories/
│   ├── instance/<kind>/mem_*.md
│   ├── domain/<kind>/mem_*.md
│   └── global/<kind>/mem_*.md
├── manifests/2026/09/cp_*.json   # 每次 context_pack 的装配清单
├── index.sqlite              # 派生索引（FTS5 + sqlite-vec + 统计表）
├── queue/                    # 待处理任务（flush / consolidate）
└── logs/amem.log
```

L3 能力仓默认 `~/.amem/capabilities/`（独立 git 仓，可指向团队远端）。

---

## 6. 数据契约

### 6.1 规范化事件（Canonical Event）

所有宿主事件经 Adapter 转成同一结构，追加到 spool，再归档为 Episode。

```ts
type CanonicalEvent = {
  v: 1;
  ts: string;                       // ISO8601
  host: 'cursor' | 'claude-code' | 'codex' | 'opencode' | 'gemini' | 'generic';
  host_version?: string;
  session_id: string;               // 宿主会话 ID（Cursor: conversation_id）
  turn_id?: string;                 // 宿主轮次 ID（Cursor: generation_id）
  workspace?: { roots: string[]; git_remote?: string; instance_id: string };
  user_id: string;                  // 本机用户或配置值
  model?: string;
  type:
    | 'session_start' | 'user_prompt' | 'agent_response'
    | 'tool_call' | 'tool_result' | 'shell_result' | 'file_edit'
    | 'compact' | 'feedback' | 'session_end';
  payload: Record<string, unknown>; // 已脱敏
  refs?: { memory_ids?: string[]; pack_id?: string; capability_versions?: string[] };
};
```

`instance_id`：`sha256(git_remote || 首个 workspace root)` 的前 12 位。它只是一个**标签**，不是分区键。

### 6.2 Episode

Episode = 一个会话封存后的事件序列 + 头部摘要：

```yaml
episode_id: ep_01J9...
session_id: <host session>
host: cursor
started_at / ended_at
instance_id, domains_guess: [tauri, react]
events_path: episodes/2026/09/ep_01J9....jsonl
outcome:
  signals:                    # 外部信号，见 §8.4
    tests: { passed: 3, failed: 0 }
    user_confirmations: 1
    user_corrections: 0
    reverted_edits: 0
  label: success | partial | failure | unknown
transcript_source: hook | transcript_import
hash: sha256:...
```

### 6.3 Memory（L2）

文件：`memories/<level>/<kind>/<id>.md`

```markdown
---
id: mem_01J9ABC
kind: failure            # 见下方枚举
title: 开发服务器端口被占用导致宿主 dev 启动失败
applies_when: 本地 dev server 启动失败，且配置中写死了端口并开启 strictPort
not_applies_when: 容器端口映射场景；使用随机端口
scope:
  level: domain          # instance | domain | global
  tags:
    user: farme
    domains: [tauri, vite]
    tools: [vite@7]
    task_type: debug-startup
    instances: [a1b2c3d4e5f6]
trust: T3                # T3 模型推断 | T2 多上下文验证 | T1 人工确认
status: active           # candidate | active | superseded | conflict | frozen | expired
evidence:
  episodes: [ep_01J9..., ep_01JA...]
  quotes:
    - ep: ep_01J9...
      event: 42
      text: "Error: Port 3000 is already in use"
  count: 2
  distinct_instances: 1
  distinct_domains: 1
stats: { recalled: 5, adopted: 3, helpful: 3, harmful: 0, lift: 0.0 }
validity:
  depends_on: []         # 其它 mem_ id 或 "tool:vite@>=7"
  valid_from: 2026-09-26
  review_by: 2027-03-26
supersedes: null
created_by: pipeline-extract@0.1.0
updated_at: 2026-09-26T08:00:00+08:00
---

先用 `netstat -ano | findstr :<port>`（Windows）或 `lsof -i :<port>` 找占用进程；
若宿主 devUrl 与前端端口硬绑定，不要改单侧端口。
```

`kind` 枚举与语义：

| kind | 回答 | 可晋升 | 可成为 L3 候选 |
|---|---|---|---|
| `fact` | 是什么 | 是 | 知识清单 |
| `case` | 以前遇到过什么（情境→做法→结果） | 是 | 否（作为证据） |
| `failure` | 什么路走不通（错误特征→根因→修复） | 是 | Skill 的排错段落 |
| `procedure` | 怎么做（步骤/工具序列） | 是 | **Skill / 流程** |
| `tool_quirk` | 工具/环境的坑与限制 | 是 | Skill 附注 |
| `strategy` | 怎么推进（何时先问、如何拆解、何时升级） | 是 | Skill / 规则 |
| `criterion` | 怎样算做完 | 是 | 验收标准 |
| `constraint_hint` | 疑似约束 | 是（仅作提示） | **约束 PR（只能人工确认）** |
| `preference` | 用户喜欢怎样 | **否（I5）** | 否 |
| `open_question` | 尚未确定的事项 | 否 | 否 |

### 6.4 索引（派生，`index.sqlite`）

```sql
CREATE TABLE mem (
  id TEXT PRIMARY KEY, kind TEXT, level TEXT, status TEXT, trust TEXT,
  title TEXT, applies_when TEXT, body TEXT, path TEXT, mtime INTEGER,
  review_by TEXT, user TEXT
);
CREATE TABLE mem_tag (id TEXT, key TEXT, value TEXT);          -- 多维标签
CREATE VIRTUAL TABLE mem_fts USING fts5(title, applies_when, body, content='mem');
CREATE VIRTUAL TABLE mem_vec USING vec0(id TEXT, emb FLOAT[<dim>]); -- 对 applies_when 向量化（P1）
CREATE TABLE mem_stat (id TEXT PRIMARY KEY, recalled INT, adopted INT, helpful INT, harmful INT, lift REAL);
CREATE TABLE mem_event (id TEXT, ts TEXT, type TEXT, episode_id TEXT, detail TEXT); -- 召回/采纳/熔断日志
```

`amem rebuild-index` 从 `memories/**/*.md` 全量重建；`stats` 以 frontmatter 为准，索引表只是缓存（Pipeline 写回 frontmatter 时同步）。

### 6.5 Context Pack Manifest

```json
{
  "pack_id": "cp_01J9...",
  "session_id": "...",
  "host": "cursor",
  "situation": { "task_type": "debug-startup", "domains": ["tauri"], "tools": ["vite"], "query": "tauri dev 起不来" },
  "budget_tokens": 1800,
  "items": [
    { "layer": "constraint", "ref": "cap:constraints/no-force-push@1.0.0", "tokens": 60 },
    { "layer": "memory", "ref": "mem_01J9ABC", "level": "domain", "score": 0.82, "tokens": 90 }
  ],
  "dropped": [{ "ref": "mem_...", "reason": "budget" }],
  "created_at": "..."
}
```

---

## 7. Pipeline①：抽取（会话结束，异步）

### 7.1 触发

| 触发 | 来源 |
|---|---|
| `sessionEnd` 钩子 | 主路径 |
| `stop` 钩子 + 空闲 N 分钟无新事件 | 兜底（会话未显式结束） |
| `preCompact` 钩子 | 压缩前先封存一段，防止细节丢失 |
| `amem flush [--session]` / MCP `memory_flush` | 手动 |
| `amem ingest-transcript` | 回灌历史会话（Cursor agent-transcripts） |

钩子只做两件事：追加 spool、在 `queue/` 放一个任务文件，然后启动（或唤醒）后台 worker 进程并立刻返回。

### 7.2 步骤

```text
1. seal        spool → Episode JSONL；补齐 outcome.signals；计算 hash
2. redact      正则 + 熵检测：密钥、token、邮箱、手机号、身份证、内网 URL；大输出截断为头尾各 2KB
3. segment     按用户意图切分子任务（新目标 / 话题切换 / 长时间间隔）
4. extract     LLM 结构化输出（§7.3），每个子任务 0–N 条候选
5. validate    JSON Schema 校验；证据 quote 必须能在 Episode 中逐字找到（防编造）
6. generalize  去实体化（路径/项目名/人名→类型占位）、补 applies_when / not_applies_when
7. reconcile   与现有记忆比对（§7.4）
8. write       写 Markdown（level=instance, trust=T3），更新索引，git commit
```

### 7.3 抽取提示契约

输入给模型的内容（不是整段聊天原文）：

- 子任务的用户目标（首条消息 + 关键追问）
- 工具调用序列摘要：工具名、关键参数、成功/失败、错误首行
- 被修改文件路径列表与变更规模
- 用户明确的肯定/否定语句
- outcome.signals

输出 JSON Schema（节选）：

```json
{
  "type": "object",
  "properties": {
    "candidates": {
      "type": "array",
      "maxItems": 8,
      "items": {
        "type": "object",
        "required": ["kind", "title", "content", "applies_when", "evidence"],
        "properties": {
          "kind": { "enum": ["fact","case","failure","procedure","tool_quirk","strategy","criterion","constraint_hint","preference","open_question"] },
          "title": { "type": "string", "maxLength": 80 },
          "content": { "type": "string", "maxLength": 1200 },
          "applies_when": { "type": "string" },
          "not_applies_when": { "type": "string" },
          "domains": { "type": "array", "items": { "type": "string" } },
          "tools": { "type": "array", "items": { "type": "string" } },
          "task_type": { "type": "string" },
          "evidence": { "type": "array", "minItems": 1, "items": { "type": "object", "required": ["event", "quote"] } },
          "confidence": { "type": "number" }
        }
      }
    }
  }
}
```

提示中的硬规则：

- 只抽「换一个会话仍然有用」的内容；一次性信息（临时变量名、某次的具体数值）丢弃。
- 必须附逐字证据；给不出证据就不要输出。
- 区分「已确定的决策」和「未决问题」。
- 不输出任何密钥、个人身份信息。
- 用户偏好只记为 `preference`，不要写成通用做法。

### 7.4 Reconcile（合并判定）

```text
对每个候选 c：
  N = recall_similar(c.applies_when + c.title, same kind, top 5)   # FTS + 向量
  if N 为空                         → ADD
  elif 与某条 m 语义等价             → NOOP，m.evidence += c.evidence，更新 distinct_* 计数
  elif c 是 m 的细化/更新            → UPDATE m（旧内容写入 git 历史，不另存）
  elif c 与 m 矛盾                   → c 以 status=conflict 写入，并与 m 互相引用；m 不改
  else                              → ADD
```

等价/细化/矛盾的判定：先规则（同 kind + 标签重叠 + 相似度 ≥ 0.9 视为等价候选），再由 LLM 在候选对上做三选一裁决。LLM 只判关系，不改写内容。

---

## 8. 召回与上下文装配

### 8.1 情境提取

会话开始（或任务切换）时，从首条用户消息 + workspace 信息得到：

```ts
type Situation = {
  query: string;
  task_type?: string;        // 规则 + 轻量分类
  domains: string[];         // 由 package.json / Cargo.toml / 语言占比 / 关键词推断
  tools: string[];           // 依赖清单 + 提及的 CLI
  instance_id?: string;
  user_id: string;
};
```

`domains` / `tools` 的推断在本地确定性完成（读清单文件），不调用模型。

### 8.2 检索与排序

```text
1. 过滤：status ∈ {active, conflict}；未过期；user 可见；preference 仅限本人
2. 召回：FTS(query) ∪ Vec(applies_when, query) ∪ Tag(domains ∩ / tools ∩ / task_type =)
3. 打分：
   score = 0.40·sim_applies + 0.20·bm25_norm + 0.15·tag_overlap
         + 0.10·trust_w + 0.10·lift_norm + 0.05·recency − stale_penalty
   level 调整：instance_id 匹配的 instance 记忆 +0.10；无匹配的 instance 记忆 −0.20
4. 作用域合并：同一主题（冲突组 / supersedes 链）只保留最小作用域版本（I6）
5. 冲突记忆以「⚠ 存在冲突」标记同时呈现双方，不静默择一
```

P0 无向量时 `sim_applies` 用 FTS 对 `applies_when` 字段的得分代替。

### 8.3 Context Pack

- 默认预算 1500–2000 tokens（可配置），按 I6 的层级顺序填充。
- **L0**：每条一行「标题 + applies_when」；**L1**：正文前 300 字；**L2**：全文，仅当 Agent 调用 `memory_get` 时返回。
- 默认注入 L0 × 8 条 + L1 × 前 3 条；预算不足时先丢低分经验，约束不参与裁剪。
- 每次装配写 manifest（§6.5），并把 `pack_id` 写回 spool，供抽取和效果统计关联。

### 8.4 效果信号（用于 stats.lift）

| 信号 | 获取方式 | 强度 |
|---|---|---|
| 显式反馈 | Agent 调用 `memory_feedback(id, helpful|harmful)`；用户 `amem review` | 强 |
| 测试/构建结果 | `afterShellExecution` 中识别测试命令及退出码 | 中 |
| 用户纠正 | 用户消息中的否定/纠正模式（「不对」「回滚」「不是这样」） | 中 |
| 编辑被撤销 | 同一文件短时间内被还原 | 中 |
| 模型自述成功 | Agent 回复 | 弱（I4） |

`adopted`：记忆出现在 pack 中，且后续轮次的工具调用或回复与其内容相关（关键词/向量相似度判定）。  
`lift`：`success_rate(adopted) − success_rate(recalled_not_adopted)`，样本 < 5 时记为 0。这是启发式估计，只用于排序和晋升门槛，不作为精确指标。

---

## 9. Pipeline②：整合与晋升（每晚离线，限定预算）

### 9.1 步骤

```text
1. cluster     同 kind 内按 applies_when 向量聚类
2. merge       簇内等价项合并证据，保留最早 id，其余 superseded
3. expire      review_by 到期 / depends_on 的工具版本变化 → status=expired（可被召回但降权并标注）
4. promote     按 §9.2 门槛晋升 level 与 trust
5. demote      按 §9.3 降级或熔断
6. propose     满足 §9.4 的记忆生成 L3 PR 候选
7. report      生成 reports/YYYY-MM-DD.md：新增/晋升/降级/冲突/待审
8. commit      git commit（信息含统计摘要）
```

预算（`amem.toml` 可调）：单次运行 LLM 调用 ≤ 200、tokens ≤ 300k、PR 候选 ≤ 5、墙钟 ≤ 20 分钟；超限即停并在报告中注明。

### 9.2 晋升门槛

| 晋升 | 条件 |
|---|---|
| instance → domain | `distinct_instances ≥ 3` 且 `helpful ≥ 2` 且 `harmful = 0`；泛化后的 `applies_when` 不含实例专有实体 |
| domain → global | `distinct_domains ≥ 2` 且 `distinct_instances ≥ 5` 且 `lift > 0.1`（样本 ≥ 10） |
| T3 → T2 | 任一晋升发生，或 `helpful ≥ 3` 且来自 ≥ 2 个会话 |
| T2 → T1 | **仅人工**：`amem review` 确认 |

`preference`、`open_question` 不参与晋升。

### 9.3 降级与熔断

- `harmful ≥ 2`，或 `lift < −0.1`（样本 ≥ 5）→ level 降一级、trust 降一级。
- 召回后紧接着出现用户纠正 ≥ 2 次 → `status=frozen`，不再召回，进入待审。
- 同一记忆 7 天内被熔断 2 次 → 冻结自动演化，仅人工可解冻（防振荡）。

### 9.4 L3 候选

| 来源 | 条件 | 产出 |
|---|---|---|
| `procedure` | level ≥ domain，trust ≥ T2，`distinct_instances ≥ 3` | Skill 草案（SKILL.md + evals 草稿） |
| `failure` / `tool_quirk` 簇 | 同一 domain 下 ≥ 3 条且互不冲突 | 追加到相关 Skill 的排错段落 |
| `constraint_hint` | 出现于 ≥ 2 个 instance，或 T1 | 约束 PR 草案（**必须人工审核**，I2） |
| `criterion` | trust ≥ T2 | 验收标准草案 |

PR 以分支 + Markdown 描述提交到能力仓；无远端时生成 `capabilities/.proposals/<id>/` 目录，`amem review` 中列出。

---

## 10. L3 能力仓与多宿主编译

### 10.1 中立格式

```text
capabilities/
├── skills/<name>/
│   ├── capability.yaml     # id、version、owner、risk、domains、depends_on、status
│   ├── SKILL.md            # Agent Skills 兼容（name/description frontmatter + 正文）
│   ├── scripts/ templates/ references/
│   └── evals/cases.jsonl
├── constraints/<name>.yaml # 规则描述 + severity + enforcement: prompt | hook | policy
├── processes/<name>.yaml   # 状态机（P2 后）
└── criteria/<name>.md
```

### 10.2 编译目标

`amem compile --target <host> [--scope user|project]`

| 目标 | Skills | 约束（prompt 级） | 约束（hook 级） |
|---|---|---|---|
| cursor | `~/.cursor/skills/<name>/SKILL.md` | `.cursor/rules/amem-<name>.mdc` 或用户级规则摘要 | `~/.cursor/hooks.json` 中 `preToolUse` / `beforeShellExecution` 检查脚本 |
| claude-code | `~/.claude/skills/<name>/SKILL.md` | `CLAUDE.md` 片段 | `settings.json` 中 `PreToolUse` 钩子 〔待核实〕 |
| codex / opencode | 各自 skills 目录或 `AGENTS.md` 片段 〔待核实〕 | `AGENTS.md` 片段 | 视宿主能力，否则仅 prompt 级 |
| gemini | `GEMINI.md` 片段 〔待核实〕 | 同左 | 视宿主能力 |
| generic | 无（通过 MCP `capability_get` 按需读取） | MCP 返回 | 不支持 |

编译产物带 `# generated by amem compile, do not edit` 头与源版本号；手工修改会在下次编译时被检测并拒绝覆盖（提示先回写能力仓）。

---

## 11. Cursor 集成（P0 首发宿主）

### 11.1 组件与安装位置

全部安装为**用户级**，因为记忆不按项目分区：

| 组件 | 位置 | 作用 |
|---|---|---|
| MCP server | `~/.cursor/mcp.json` 注册 `amem`（`node <amem>/dist/mcp.js`） | Agent 主动调用召回/反馈/笔记 |
| Hooks | `~/.cursor/hooks.json` + `~/.cursor/hooks/amem-hook.mjs` | 被动采集事件与会话边界 |
| Skill | `~/.cursor/skills/amem/SKILL.md` | 告诉 Agent 何时召回、何时反馈、何时记笔记 |
| 历史回灌 | `amem ingest-transcript --host cursor` | 读取 `~/.cursor/projects/<ws>/agent-transcripts/*.jsonl` |

项目级可选：`.cursor/rules/amem.mdc`（alwaysApply）强化「任务开始先调用 `memory_recall`」。

### 11.2 钩子映射

`~/.cursor/hooks.json`（用户级钩子从 `~/.cursor/` 目录运行）：

```json
{
  "version": 1,
  "hooks": {
    "sessionStart":        [{ "command": "node hooks/amem-hook.mjs sessionStart",        "timeout": 5 }],
    "beforeSubmitPrompt":  [{ "command": "node hooks/amem-hook.mjs beforeSubmitPrompt",  "timeout": 3 }],
    "postToolUse":         [{ "command": "node hooks/amem-hook.mjs postToolUse",         "timeout": 3 }],
    "postToolUseFailure":  [{ "command": "node hooks/amem-hook.mjs postToolUseFailure",  "timeout": 3 }],
    "afterShellExecution": [{ "command": "node hooks/amem-hook.mjs afterShellExecution", "timeout": 3 }],
    "afterFileEdit":       [{ "command": "node hooks/amem-hook.mjs afterFileEdit",       "timeout": 3 }],
    "afterAgentResponse":  [{ "command": "node hooks/amem-hook.mjs afterAgentResponse",  "timeout": 3 }],
    "preCompact":          [{ "command": "node hooks/amem-hook.mjs preCompact",          "timeout": 5 }],
    "stop":                [{ "command": "node hooks/amem-hook.mjs stop",                "timeout": 5 }],
    "sessionEnd":          [{ "command": "node hooks/amem-hook.mjs sessionEnd",          "timeout": 5 }]
  }
}
```

| Cursor 事件 | 规范化事件 | 额外动作 |
|---|---|---|
| `sessionStart` | `session_start` | 同步执行轻量召回（≤ 1s，仅 FTS + 标签），若宿主支持则返回附加上下文 〔待核实：输出字段名〕；不支持则仅预热缓存，依赖 Skill 引导 Agent 调用 `memory_recall` |
| `beforeSubmitPrompt` | `user_prompt` | 始终返回允许；检测纠正/确认用语，打信号 |
| `postToolUse` / `postToolUseFailure` | `tool_call` + `tool_result` | 截断大输出；失败保留错误首行 |
| `afterShellExecution` | `shell_result` | 识别测试/构建命令（`vitest`、`cargo test`、`npm run build`…）；**该事件无退出码**，退出码从同一 `tool_use` 的 `postToolUse.tool_output.exitCode` 关联（见 §11.2.1） |
| `afterFileEdit` | `file_edit` | 只记路径与增删行数，不记内容 |
| `afterAgentResponse` | `agent_response` | 只存摘要（前 500 字）与 `refs.memory_ids`（若回复引用了记忆） |
| `preCompact` | `compact` | 入队部分封存任务 |
| `stop` | —— | 记录轮次结束；启动空闲计时 |
| `sessionEnd` | `session_end` | 入队 flush 任务，唤醒 worker |

实现要点：

- 钩子脚本从 stdin 读 JSON，写一行到 `spool/<session_id>.jsonl`，输出 `{}` 或该事件允许的最小字段，退出码 0。任何异常吞掉并写日志（I7）。
- 会话 ID 取 `conversation_id`（实测与 `session_id` 相同），轮次取 `generation_id`，工具调用取 `tool_use_id`；workspace 取 `workspace_roots`，需把 `/d:/dev/...` 规范化为 `D:\dev\...`（见 §11.2.1）。
- 输入含 `transcript_path`（已实测），`sessionEnd` 时以 transcript 为准补全 Episode（钩子漏采时的兜底）。
- `user_email` 会出现在每个事件中，写入 Episode 前替换为 `user_id`（I8）。
- worker：单实例（`queue/.lock` 文件锁），处理完队列后空闲 60s 自动退出；由钩子以 detached 方式拉起。
- Windows：命令统一 `node ...`，路径用 `path` 模块处理，避免依赖 bash / jq。

#### 11.2.1 实测字段（2026-09-26，Cursor 3.22.7，Windows）

探针 `~/.cursor/hooks/amem-probe.mjs` 已注册到用户级 `hooks.json`，原始输入落在 `~/.amem/spool/raw/YYYY-MM-DD.jsonl`；`node ~/.amem/bin/probe-report.mjs` 汇总每个事件的字段。

**所有事件共有**：`conversation_id`、`session_id`（两者相同）、`generation_id`、`hook_event_name`、`cursor_version`、`model`、`transcript_path`、`user_email`、`workspace_roots[]`（形如 `/d:/dev/workspaces/QCoder/NoteZ`）。

| 事件 | 已确认的专有字段 |
|---|---|
| `postToolUse` | `tool_name`、`tool_use_id`、`tool_input`（对象，如 Shell 的 `command`/`cwd`/`timeout`）、`tool_output`（**JSON 字符串**，Shell 为 `{"output","exitCode"}`）、`duration`（ms）、`cwd` |
| `afterShellExecution` | `command`、`output`、`duration`、`sandbox`；**无 exitCode、无 tool_use_id** |

尚未观察到的事件（`sessionStart`、`sessionEnd`、`stop`、`beforeSubmitPrompt`、`afterAgentResponse`、`afterFileEdit`、`preCompact`、`postToolUseFailure`）继续采样；`sessionStart` 能否返回附加上下文需单独试验。

Adapter 定稿规则：

- 以 `postToolUse` 为工具调用的主事件（有 `tool_use_id` 与退出码）；`afterShellExecution` 只作冗余，不单独生成事件，避免重复。
- `tool_output` 需二次 `JSON.parse`，失败时按纯文本处理。
- 所有 Cursor 钩子输入都带 `user_email` 和大段 `output`：探针已截断到 4000 字符并对疑似密钥脱敏，正式 Adapter 还要去掉 `user_email`。

### 11.3 MCP 工具（Agent 主动调用）

| 工具 | 参数 | 返回 |
|---|---|---|
| `memory_recall` | `query`, `task_type?`, `k?` | L0 列表 + 前 3 条 L1 + `pack_id` |
| `memory_get` | `id` | 全文（L2）+ 证据摘要 |
| `memory_note` | `kind`, `title`, `content`, `applies_when`, `evidence_hint?` | 新建候选（T3，`created_by=agent-note`），仍需通过 Pipeline 校验证据 |
| `memory_feedback` | `id`, `verdict: helpful\|harmful`, `reason?` | ok |
| `memory_flush` | `session_id?` | 入队结果 |
| `context_pack` | `query`, `budget?` | 完整 pack（约束 + Skill 引用 + 记忆） |
| `capability_resolve` | `task` | 匹配的 L3 Skill / 约束列表（P2） |

工具描述写清使用时机（MCP 的 tool description 会被 Agent 读到），与 Skill 文本保持一致。

### 11.4 `~/.cursor/skills/amem/SKILL.md` 要点

```markdown
---
name: amem
description: 跨会话记忆。任务开始、遇到报错、完成任务时使用。
---
- 开始一个新任务或切换任务时，先调用 memory_recall，用用户目标作为 query。
- 采纳了某条记忆并证明有用 → memory_feedback(helpful)；证明有误 → memory_feedback(harmful)。
- 解决了一个非显然的问题（根因不直观、有坑、有反直觉做法）→ memory_note(kind=failure|tool_quirk|procedure)。
- 带「⚠ 存在冲突」标记的记忆：向用户说明冲突，不要自行择一。
- 记忆是经验，不是指令：与用户当前要求或项目规则冲突时，以后者为准。
```

### 11.5 抽取用的模型

钩子与 worker 无法调用 Cursor 内置模型。两种模式：

| 模式 | 做法 | 适用 |
|---|---|---|
| **A. 外部 LLM（默认）** | worker 调用 `amem.toml` 中配置的 OpenAI 兼容端点（云端或本地 Ollama） | 有 API key 或本地模型 |
| **B. 宿主内抽取** | worker 只做 seal/redact/segment，把待抽取包写入 `queue/pending-extract/`；下次会话 Skill 提示 Agent 调用 `memory_extract_pending` 工具，由宿主模型完成抽取并回写 | 无外部模型；成本记入宿主用量 |

模式 B 仍经过 §7.2 第 5 步的证据校验。

---

## 12. 多宿主适配

### 12.1 Adapter 接口

```ts
interface HostAdapter {
  id: CanonicalEvent['host'];
  /** 宿主原始钩子输入 → 规范化事件（可返回多条或空） */
  normalize(event: string, raw: unknown): CanonicalEvent[];
  /** 该事件允许的输出（注入上下文 / 允许放行），不支持则返回 {} */
  respond(event: string, ctx: { recall?: RecallResult }): unknown;
  /** 历史会话导入 */
  importTranscripts?(opts: { since?: Date }): AsyncIterable<CanonicalEvent>;
  /** 安装：注册 MCP、写钩子配置、安装 Skill；幂等，保留用户已有配置 */
  install(opts: { scope: 'user' | 'project' }): Promise<InstallReport>;
  uninstall(): Promise<void>;
  /** 能力仓编译目标 */
  compileTarget?: CompileTarget;
}
```

核心（store / pipeline / gateway）不引用任何宿主类型；新增宿主 = 新增一个 Adapter + 一组 fixture。

### 12.2 宿主能力矩阵与降级

| 能力 | Cursor | Claude Code | Codex CLI | OpenCode | Gemini CLI | 仅 MCP |
|---|---|---|---|---|---|---|
| MCP 工具 | 有 | 有 | 有 | 有 | 有 | 有 |
| 会话开始钩子 | `sessionStart` | `SessionStart` 〔待核实〕 | 〔待核实〕 | 插件事件 〔待核实〕 | 〔待核实〕 | 无 |
| 工具后钩子 | `postToolUse` | `PostToolUse` | 〔待核实〕 | 插件 | 〔待核实〕 | 无 |
| 会话结束钩子 | `sessionEnd` | `SessionEnd` / `Stop` 〔待核实〕 | 〔待核实〕 | 〔待核实〕 | 〔待核实〕 | 无 |
| 转录文件 | agent-transcripts JSONL | transcript JSONL 〔待核实〕 | 会话日志 〔待核实〕 | 〔待核实〕 | 〔待核实〕 | 无 |
| Skills 目录 | `~/.cursor/skills` | `~/.claude/skills` | 〔待核实〕 | 〔待核实〕 | —— | —— |

降级策略（从强到弱）：

1. **钩子 + 转录 + MCP**：全自动采集与召回（Cursor、Claude Code 目标形态）。
2. **转录 + MCP**：无钩子时，由 `amem watch --host <x>` 轮询转录目录，检测到会话文件静止 10 分钟即封存。
3. **仅 MCP**：Agent 通过指令文件（`AGENTS.md` 等）被要求在开始时 `memory_recall`、结束时 `memory_session_summary(summary, outcome)`；抽取质量较低，Episode 标记 `transcript_source=agent_summary`。

### 12.3 适配顺序

1. Cursor（P0）
2. Claude Code（P1 末）：钩子模型与 Cursor 最接近，验证 Adapter 抽象
3. Codex CLI / OpenCode（P2）
4. 其它宿主走「转录 + MCP」或「仅 MCP」降级路径

---

## 13. 代码组织

独立仓库（建议名 `amem`），TypeScript / Node ≥ 22（与宿主 MCP 生态、Windows 兼容性最好；NoteZ 开发机已具备 Node）：

```text
amem/
├── packages/
│   ├── core/            # 类型、schema（zod）、不变量检查、配置
│   ├── store/           # Episode / Memory 文件读写、index.sqlite、git 提交
│   ├── pipeline/        # extract、reconcile、consolidate、promote、propose
│   ├── retrieval/       # situation 提取、召回打分、context pack
│   ├── llm/             # OpenAI 兼容客户端、结构化输出、预算计量
│   ├── gateway-mcp/     # MCP server
│   ├── compiler/        # L3 → 各宿主格式
│   ├── adapter-cursor/
│   ├── adapter-claude-code/
│   └── cli/             # amem 命令
├── fixtures/
│   ├── transcripts/cursor/*.jsonl        # 真实会话脱敏样本
│   └── golden/extract/*.expected.json    # 抽取期望
└── docs/
```

依赖选择：`node:sqlite`（Node 22 内置）或 `better-sqlite3`；向量用 `sqlite-vec`；schema 用 `zod`；MCP 用官方 TypeScript SDK；嵌入模型可配置（云端或本地）。

### 13.1 CLI

| 命令 | 作用 |
|---|---|
| `amem init` | 创建 `~/.amem`、`git init`、生成 `amem.toml` |
| `amem install --host cursor [--scope user]` | 注册 MCP、写 hooks.json（合并，不覆盖）、安装 Skill |
| `amem doctor` | 检查 Node、sqlite-vec、LLM 连通性、钩子是否在触发（读 spool 时间戳） |
| `amem ingest-transcript --host cursor [--since]` | 回灌历史会话 |
| `amem flush [--session]` / `amem worker` | 手动触发 / 前台运行 worker |
| `amem recall "<query>"` | 调试召回，输出分数明细 |
| `amem consolidate [--dry-run]` | 手动运行 Pipeline② |
| `amem review` | 交互式审核：冲突、冻结、L3 候选、T1 确认 |
| `amem compile --target cursor` | 编译能力仓 |
| `amem rebuild-index` | 从 Markdown 重建索引 |
| `amem forget <id> \| --instance <id>` | 删除记忆（含证据引用），满足隐私需求 |

### 13.2 配置 `amem.toml`

```toml
[identity]
user_id = "farme"

[llm]                      # Pipeline 抽取与裁决
base_url = "https://openrouter.ai/api/v1"
model = "..."
api_key_env = "AMEM_LLM_KEY"
mode = "external"          # external | host

[embedding]                # P1 起启用
enabled = false
base_url = ""
model = ""
dim = 1024

[recall]
budget_tokens = 1800
l0_items = 8
l1_items = 3

[promotion]
instance_to_domain_min_instances = 3
domain_to_global_min_domains = 2
domain_to_global_min_instances = 5
global_min_lift = 0.1

[budget.consolidate]
max_llm_calls = 200
max_tokens = 300000
max_proposals = 5
max_minutes = 20

[privacy]
redact_patterns = []       # 追加自定义正则
exclude_workspaces = []    # 不采集的目录（glob）
```

---

## 14. 测试与评估

| 层 | 方法 | 通过标准 |
|---|---|---|
| Adapter | 录制真实 Cursor 钩子输入作 fixture，断言规范化结果 | 所有事件类型覆盖 |
| 脱敏 | 注入已知密钥/PII 样本 | 零泄漏 |
| 抽取 | golden 集（≥ 30 个真实会话，人工标注期望记忆） | 召回率 ≥ 60%，幻觉率（证据对不上）= 0（校验拦截），人工可用率 ≥ 70% |
| Reconcile | 构造等价/细化/矛盾对 | 关系判定准确率 ≥ 85% |
| 召回 | 标注「情境 → 应召回记忆」≥ 50 条，含跨项目样例 | Recall@8 ≥ 0.7；跨项目误召回率 ≤ 10% |
| 晋升 | 模拟多实例事件流 | 门槛边界单测全覆盖；防振荡生效 |
| 不变量 | 属性测试：任意 Pipeline 输出不写 L3、不产生 T1、不提升 preference | 100% |
| 端到端 | 在 Cursor 中跑 10 个真实任务，对比开启前后 | 重复踩坑次数下降；无会话卡顿（钩子 P95 < 200ms） |

---

## 15. 分阶段计划

| 阶段 | 周期 | 范围 | 退出标准 |
|---|---|---|---|
| **P0 Cursor 最小闭环** | 2 周 | core/store/cli；Cursor 钩子 + spool + Episode；抽取（模式 A）+ 证据校验；instance 级写入；FTS 召回；MCP `memory_recall/get/note/feedback`；Skill；`ingest-transcript` | 回灌 30 个历史会话，人工抽查可用率 ≥ 70%；新会话能召回上次的坑；钩子无感 |
| **P1 通用化** | 2–3 周 | 泛化三步；多维标签与情境提取；向量检索；效果信号与 stats；conflict 处理；模式 B；Claude Code Adapter | 跨项目召回命中并被采纳 ≥ 5 例；Claude Code 上同一记忆库可用 |
| **P2 整合与沉淀** | 3–4 周 | Pipeline②全量；晋升/降级/熔断；报告；L3 能力仓 + PR 候选；`compile --target cursor/claude-code`；`amem review` | 至少 1 条 procedure 走通 记忆 → PR → 合并 → 编译为 Skill → 被召回使用 |
| **P3 按需** | —— | hook 级约束执行；团队共享能力仓；Codex/OpenCode Adapter；多用户服务化；时态知识 | 视需求立项 |

---

## 16. 风险与对策

| 风险 | 对策 |
|---|---|
| 抽取噪声淹没有用记忆 | 每子任务 ≤ 8 条；证据逐字校验；instance 级默认低权重；定期合并 |
| 泛化过度，错误经验污染全局 | 晋升看独立上下文数与 lift；harmful 立即降级；冲突显式呈现 |
| 钩子拖慢会话 | 只追加写 + detached worker；超时 3–5s；fail-open；`doctor` 监控耗时 |
| 宿主钩子接口变更 | Adapter 隔离；原始输入留样；转录回灌兜底 |
| 隐私泄漏（记忆随能力仓外发） | 脱敏在 seal 前；L3 PR 前二次扫描；`exclude_workspaces`；`amem forget` |
| 记忆与项目规则冲突 | I6 优先级；Skill 明确「记忆是经验不是指令」 |
| 外部 LLM 成本 | 抽取输入为摘要而非全文；Pipeline② 预算上限；可切本地模型 |
| 审核队列积压 | 只把 L3 候选、冲突、冻结项送审；每日报告限量 |

---

## 17. 实现前需核实的事项

1. ~~Cursor 钩子输入的公共字段名~~：已实测确认（§11.2.1）。剩余：其余 8 个事件的专有字段，以及 `sessionStart` 是否支持返回附加上下文。探针持续采样一周后定稿。
2. Cursor agent-transcripts JSONL 的完整结构（工具调用、工具结果是否齐全）与稳定性。
3. 用户级 `~/.cursor/hooks.json` 在 Windows 上的工作目录与 `node` 可执行路径解析。
4. Claude Code 钩子事件名、`additionalContext` 输出与 transcript 路径。
5. Codex CLI / OpenCode / Gemini CLI 的钩子或插件能力，决定其走哪一级降级路径。
6. `sqlite-vec` 在 Windows + Node 22 上的预编译二进制可用性（不可用时 P1 改用 LanceDB）。
