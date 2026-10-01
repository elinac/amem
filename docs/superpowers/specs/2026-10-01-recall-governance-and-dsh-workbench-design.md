# amem 召回治理与 DSH 记忆工作台

日期：2026-10-01  
状态：已确认，待实施计划  
范围：L2 召回门控、任务情境 epoch 的固定快照、冲突人工裁决，以及 DSH Web 面板的列表、审阅与视觉重构。

## 1. 目标

amem 已具备证据约束、信任等级、分层存储与 L3 人工晋升；本轮补齐“已检索的记忆如何被使用”的治理与可见性：

1. 将“检索”与“注入”分开，每条候选先得到可审计的使用决定。
2. 在同一任务情境 epoch 内固定首次自动装配的记忆，保持 prompt 前缀稳定而不妨碍长会话切换任务。
3. 冲突记忆不再自动注入；用户可在 DSH 面板中对比、裁决和追溯。
4. 将当前简陋的六 Tab 列表升级为紧凑 DSH 原生工作台；筛选、分页和在线审阅仅在 HTTP/RPC 安全发布门满足后交付。

## 2. 非目标

- 不实现图数据库、实体关系检索或新的 embedding 后端。
- 不把 workspace 变成记忆的主分区键；情境召回仍是核心。
- 不自动写入 L3，不放宽现有人工合并门槛。
- 不使用 DSH 私有事件、DOM 注入或浏览器 hack 自动写 system prompt。
- 不实现跨宿主历史导入、负知识账本、自动 handoff、自动健康降级、下一 epoch 预测或快照差异视图；它们是后续独立范围。
- 不引入 UI 组件库、CSS 框架或外部运行时依赖。

## 3. 召回门控

### 3.1 职责边界

现有 `recall()` 只负责按情境找回并排序检索命中。新增 `decideRecall()` 作为纯决策层：它接收排序命中及配置，输出每条记忆的 `use`、`verify` 或 `ignore` 决定和机器可读理由。这里的“检索命中”不等同于 `MemoryStatus.candidate`。

门控不修改 `MemoryRecord`，不修改排序分数，也不做新的模型调用。决策依据限定为：

- 记忆状态和有效期；
- T1/T2/T3 信任等级；
- 召回分数；
- helpful/harmful 统计；
- 当前模式与预算。

只有 `active` 且不存在未决 `conflicts_with` 关联的记忆可得到 `use` 或 `verify`。`candidate`、`conflict`、`frozen`、`expired`、`superseded` 永远为 `ignore`，不允许自动注入。它们仍可由人工检索、详情页和冲突审阅查看；显式检索可返回不占经验注入预算的“存在冲突，请人工裁决”提示。

### 3.2 模式

`amem.toml` 的 recall 配置扩展为：

| 模式 | 行为 |
|---|---|
| `shadow` | 运行检索和门控，记录审计，Context Pack 零记忆注入。 |
| `assist`（默认） | 注入 `use`；`verify` 以明确“待核验线索”形式、受较小预算进入 Pack。 |
| `enforce` | 仅注入 `use`，省略 `verify`。 |

首期只支持用户显式切换模式，不根据反馈自动降级或恢复。每个决定仍记录模式、情境 epoch 和曝光状态，为后续在已有 Pack 级反馈归因后加入健康状态机保留证据。

### 3.3 反馈关联

每次 `ContextPack` 中的注入项目保留决定和记忆引用。既有 `memory_feedback` 继续更新记忆统计；首期不把未关联 `decision_id` 的反馈用于门控健康判断。模型自评不构成 helpful 信号，也不能改变门控模式。

## 4. 情境 epoch 固定快照

### 4.1 规则

同一 session 的同一情境 epoch 首次请求自动 Context Pack 时：

1. 运行 recall 与 `decideRecall()`；
2. 按模式和预算生成 Pack；
3. 保存可渲染的注入文本、每条决定、预算用量和配置指纹；
4. 将该 Pack 标记为该 session + epoch 的固定快照。

同一 epoch 后续自动装配复用快照，不因新记忆、反馈、普通配置变更或索引重建而改变前缀。任务切换时由调用方显式创建新的 epoch；仅基于新用户请求重建情境，不由模型自行猜测。新写入的记忆仍可通过显式 `memory_recall` 查询，但不会改变当前 epoch 的自动注入文本。新 session 建立新的 epoch。

稳定性不高于安全撤销：`MemoryMutationCoordinator` 对把记忆变为 `conflict`、`frozen`、`expired`、`superseded` 的状态收紧，必须在同一恢复 journal 中写入受影响 epoch 的 `revoked` 目标状态，并递增持久化的 `GlobalSafetyGeneration`。该 generation 是单调全局整数；每个新快照保存创建时的 `safety_generation`，每个 revoked epoch 保存使其失效的相同整数作为 `revocation_generation`。

journal 完成后，任何尚未开始模型调用的 Pack 都必须在投递线性化点读取当前全局 generation 与 epoch 状态：快照 generation 不等于当前值时，在全局 safety lock 内重新验证全部引用；epoch 为 `revoked` 或存在不安全引用时投递零记忆 Pack。已经开始模型调用的请求不可回收，审计必须如实标记其发生在撤销前。DSH section disposer 在 epoch 状态提交后异步调用；调用失败保持 revoked 且禁止后续投递。

### 4.2 存储与恢复

固定快照和门控审计写入 `manifests/`，是由 Markdown 记忆与当时配置派生的审计产物，而不是第四层真相源。`openEpoch()` 先在 `manifests/epochs/` 原子建立状态为 `open` 的 epoch 记录；它的不可变键为 `{ host, tenantOrUser, authenticatedSessionId, epochId }`，文件路径为该规范化键的 SHA-256。`rendererVersion` 是快照元数据而非键的一部分。只有 `EpochAuthority` 依据宿主会话创建、且拒绝缺失或 `"unknown"` 身份的可信 `EpochContext` 可执行 `getOrCreateSnapshot()`。

`getOrCreateSnapshot()` 在该键的跨进程锁内执行：以单个 epoch 状态文件原子替换提交 `{ snapshotId, snapshotHash, state: committed }`，该文件是快照正文可用性的唯一提交标记。`open` 且无提交标记时创建唯一快照；已 `committed` 时只读返回；`revoked` 时只返回零记忆 Pack；`open` 但存在失败标记、快照损坏或无法验证时转换为 `degraded` 并返回零记忆 Pack。它绝不把一个已打开 epoch 当作“首次请求”再次生成不同快照。快照有版本化 schema，保存 `snapshot_id`、完整 epoch 键、渲染器版本、配置指纹、可渲染文本、决定摘要和预算；文件通过临时文件加原子替换写入。

所有写入 manifest/audit 的文本再次执行与 Episode 相同的脱敏策略；审计只保存记忆 ID、决定、计数、哈希和配置指纹，不复制查询原文或记忆全文。journal 是不可公开的恢复材料，允许保存未脱敏的规范化目标字节以保证恢复正确性，但必须使用仅当前用户可读写的目录权限；不得在面板、导出或审计中显示。快照包含的渲染文本应视为敏感本地数据，目录使用仅当前用户可读写的权限并有可配置保留期/清理；面板展示前再次按同一策略脱敏。

Context Pack 使用唯一的版本化编码：固定的系统说明、带 ID/信任/来源的结构化分隔符、受总量与单项长度限制的正文引用。记忆内容一律以不可信引用呈现，渲染器会转义所有边界标记。文本隔离只能降低提示注入风险，不能保证模型不会遵从恶意正文；自动注入因此只接受经过既有脱敏、证据和信任门槛的记忆，并始终是默认关闭的宿主实验能力。

进程重启后按完整 epoch 键读取唯一已提交快照，而非按“最近”选择。只要快照 schema 可读，就复用其中的渲染文本，配置指纹仅生成“已过期”告警；不得因配置变更重建同一 epoch。缺失、损坏或无法验证的快照使该 epoch 降级为零记忆 Pack / `shadow`，并记录原因；只有用户显式关闭并新开 epoch 才可创建新快照。

宿主在把 Pack 发往模型前必须读取 epoch 状态的 `revocation_generation`，并在投递点再次比较；不一致则拒绝旧 Pack 并重新取得零记忆 Pack。每个 agent 由 `EpochLifecycleCoordinator` 串行化：切换 epoch 时递增不可复用 generation，所有异步快照完成、section 注册和投递均需匹配当前 generation，旧 generation 的结果必须丢弃。

面板可显示：

- 当前 session + epoch 的固定快照、预算和决定。

## 5. 冲突裁决

### 5.1 裁决动作

`MemoryRecord` 前置元数据增加 `conflicts_with: string[]`。抽取流程发现冲突时，以双向关联将双方标为 `conflict`；任意一方有未解决关联都不自动注入。审阅页展示两条记忆的标题、种类、层级、信任、正文、证据、更新时间和统计，并提供：

| 动作 | 写入结果 |
|---|---|
| 保留 A | B 设为 `superseded`，其 `supersedes` 指向 A；双方清除彼此冲突关联。A 只有在没有其它 `conflicts_with` 边时才设为 `active`，否则保持 `conflict`。 |
| 保留 B | A 设为 `superseded`，其 `supersedes` 指向 B；双方清除彼此冲突关联。B 只有在没有其它 `conflicts_with` 边时才设为 `active`，否则保持 `conflict`。 |
| 并存 | 不清除双方冲突关联，二者保持 `conflict`；审计记录为“人工并存，自动注入继续禁用”。这种动作只确认保留历史，不解除门控。 |

裁决是宿主无关的 core/CLI/MCP 契约；DSH 审阅页仅在 HTTP 发布门满足后提供图形入口。裁决记录写入 manifest/audit，包含不可由调用参数伪造的 `ActorContext`、输入 id、动作、双方更新前的 `updated_at` 和结果。记忆 Markdown 仍是状态和关系的唯一真实来源。

核心变更 API 必须接收由私有 `ActorAuthority` 签发、不可从调用参数构造的 `ActorContext`，并要求相应权限。首期运行在单用户本地信任边界：CLI 和 stdio MCP 均代表启动它们的 OS 用户，依赖该用户对 amem 根目录的已有 OS 权限；POSIX 使用 0700/0600，Windows 记录“由目录 ACL 管理”而不宣称 Node 能验证或设置 ACL。

工具暴露矩阵固定如下：CLI 具有 `memory:read`、`memory:note`、`memory:feedback`、`memory:resolve-conflict`；通用 stdio MCP 只具有 `memory:read`、`memory:note`、`memory:feedback`，且所有 note/feedback 均通过 `MemoryMutationCoordinator`；stdio MCP **不暴露**冲突裁决、快照读取、队列冲洗或任何运维写操作。读取冲突要求 `memory:read`；匿名和无权限调用一律拒绝；`EpochContext` 只在宿主内部存在。

上线前运行一次可重跑迁移：识别旧正文中的 `⚠ conflicts with <id>` 标记，验证双方 id 后写入双向 `conflicts_with` 并将双方置为 `conflict`。无法唯一解析或目标缺失的旧记录保守设为 `frozen`，附迁移原因并列入人工修复清单；迁移不得让旧冲突另一侧继续自动注入。

### 5.2 并发和失败

裁决请求带双方加载时的 `updated_at`。服务端写入前重读：任一时间戳不一致即返回 409，前端提示刷新；不得静默覆盖人类编辑。

裁决跨两份 Markdown 文件，不能假设单文件 rename 可以提供跨文件原子性。所有 Markdown 写入、删除和索引更新必须经 `MemoryMutationCoordinator`；业务层禁止直接调用 `MemoryStore.write/forget` 或 `IndexStore.rebuild`。协调器定义单记忆锁、按字典序的双记忆锁、全局 safety lock 和全局索引锁，锁顺序固定为“safety lock（仅状态收紧）→ 记忆锁 → 索引锁”。

协调器使用同一跨进程 lockfile 协议：原子创建锁目录后立即原子写入 owner、启动标识、事务 ID、单调 fencing token、租约和续期时间；无 owner 的孤儿锁按有限等待后回收，过期锁仅在启动标识确认原持有者已失效时接管。每次 journal 创建、文件替换、阶段提升、epoch 撤销和索引更新均校验当前 fencing token；失配立即停止，不得提交。恢复、版本检查、写入和索引更新必须持有同一把锁。

服务端先在 `manifests/transactions/` 原子写入幂等 journal：随机事务 ID、受 `isSafeId` 校验的两条记忆 ID、每个文件的 `preimage_hash`、完整规范化 `target_bytes`、`target_hash`、受影响 epoch 的目标状态/前后哈希、目标 `GlobalSafetyGeneration`、待追加的审计事件和阶段（`prepared`、`markdown_committed`、`indexed`）。随后以原子替换写两份 Markdown 和 epoch/全局 safety 状态。

启动和每次裁决前恢复遗留 journal：仅当每个记忆文件、epoch 状态和全局 generation 文件仍匹配其 preimage 或 target hash 时才处理；`prepared` 将匹配 preimage 的文件写至 target，并按实际哈希组合决定下一阶段——所有目标都已写入时立即提升为 `markdown_committed`；该阶段随后重建索引并幂等补写审计，`indexed` 仅清理 journal。若任一文件不匹配两种哈希，停止恢复、保留 journal 并报告人工处理，绝不覆盖人工修改。journal 路径不得由请求提供，恢复只处理 schema 与哈希均通过验证、且目标位于 `memories/` 下的文件。journal 是恢复材料，不是记忆真相源。

读端一致性屏障：`recall()`、`decideRecall()`、快照创建与自动投递在读取记忆前取得 coordinator 的共享读锁；列表读取可返回上次已提交版本，但不得把涉及 `prepared` 或 `markdown_committed` journal 的记忆用于自动注入。任一未完成 journal 涉及的记忆一律视为 `frozen`，直到恢复将事务推进到 `indexed` 或人工处置。这样两份 Markdown 的中间替换状态不能进入 Context Pack。

### 5.3 审阅契约

首期通过 core 与 CLI 暴露：

- `list_conflicts()` 返回当前结构化冲突对，按最近更新时间倒序；
- `resolve_conflict({ leftId, rightId, action, leftUpdatedAt, rightUpdatedAt })` 执行裁决；`action` 只能为 `keep_left`、`keep_right` 或 `keep_both`；
- 快照读取是宿主内部 `getEpochSnapshot(epochContext)`，不向通用 CLI/MCP/浏览器公开 session 或 epoch 参数。

未知记忆返回 not found；两个记忆不构成当前冲突对、非法动作或非法 RFC 3339 时间戳返回 invalid argument；版本冲突返回 conflict。ID 必须通过 `isSafeId`，查询文本、请求体和审计字段有长度上限，且 ID 只能交给 `MemoryStore` 查找，不能用于路径拼接。

只有满足第 6 节 HTTP 信任边界后，才将同一契约投影为 `/amem-api/review` 和 `POST /amem-api/conflicts/:leftId/resolve`。届时变更请求必须有独立认证、Origin / `Sec-Fetch-Site` 校验和 CSRF 防护；actor 一律由认证上下文生成，不接受请求体提供的身份。

## 6. DSH 集成与 HTTP 信任边界

本轮核心提供稳定的门控、固定快照和 `context_pack` 契约。DSH Adapter 继续采集会话。

截至 2026-10-01，DSH `dsh-v0.2.0-rc.2`（commit `639ed015`）公开提供 `ctx.systemPrompt.section()` 与 `system-prompt/assemble`，并在模型 step 前提供 `agent/pre-step` waterfall。实验性 DSH 自动注入可在 `agent/pre-step` 的首个 epoch 创建快照，并以 agent-scoped `systemPrompt.section()` 注册固定文本；每个 agent 同时只能存在一个由 amem 管理的 section，epoch 切换/撤销/会话销毁必须先调用旧 section 的 disposer 再注册新 section。

`amem.toml` 增加默认 `false` 的 `dsh.auto_inject` 和全局 `recall.auto_inject_enabled` kill switch；两者在每次装配和投递前检查。Adapter 必须取得并严格匹配目标 DSH 版本、所需 capability 与 disposer，否则保持 fail-open。自动注入仅在固定 tag、通过 capability probe、section 替换/撤销/任务切换集成测试后才能打开；若官方表面无法提供可验证的 disposer，不发布自动注入。探测失败、事件超时或 session 元数据无效时不注入，MCP/显式 Context Pack 继续可用。

DSH 的公开 `webServer.register()` 只提供 HTTP carrier；`Connection` 对自定义路由的 cookie/launch-token 鉴权没有公开稳定契约。现有 Adapter 对 `connection.requestRejection()` / `connection.admit()` 的 duck typing 只能作为受版本锁定的兼容实现，不得被当作安全边界或发布前提。

本规范不允许通过 `/amem-api` 发布任何读取或变更型业务端点，直到满足其一：

1. DSH 发布公开、稳定的自定义路由认证 guard / native RPC；或
2. amem 定义并实现独立、可审计的认证与 CSRF 模型，且通过本地及跨站安全测试。

在此之前，冲突裁决等变更操作由 CLI 完成；DSH 面板只可发布无业务请求的静态视觉框架、说明和 CLI 入口提示。筛选、分页、读取列表、配置和所有操作按钮显示“等待安全 HTTP/RPC 发布门”，不可触发网络请求；它们使用可聚焦的说明按钮（非误导性 disabled 控件），以 `aria-live` 宣告原因并将焦点带到 CLI 替代说明。现有 Adapter 的 `DELETE /memories`、配置写入、flush、rebuild、consolidate、compile 和提案应用等变更路由必须运行时硬禁用；`GET /config` 也不得再向浏览器返回 `api_key`。不得以现有 `requestRejection/admit` 私有 duck typing 绕开该门。

## 7. 列表 API、过滤与分页

### 7.1 记忆 API

在满足第 6 节 HTTP 信任边界后，`GET /amem-api/memories` 接受：

- `page`：正整数，默认 `1`；
- `pageSize`：`20`、`50` 或 `100`，默认 `20`；
- `q`：可选标题、适用情境和正文关键词；
- `kind`、`level`、`trust`、`status`：可选枚举过滤条件。

`facets` 的每个维度采用“已应用 `q` 及其它维度过滤条件、但排除该维度自身选择”的计数口径，因此用户可看到切换同维度筛选后的可用数量。

返回：

```ts
{
  items: MemoryListItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    kind: Record<MemoryKind, number>;
    level: Record<ScopeLevel, number>;
    trust: Record<Trust, number>;
    status: Record<MemoryStatus, number>;
  };
}
```

过滤、排序（`updated_at` 倒序）和切片必须在同一份 `MemoryStore.listAll()` 快照数组中完成。第一期以 Markdown 真相源为基础实现；不得为了列表功能引入第二份数据源。`q` 限长且不写入审计原文。首期目标是本地个人规模；达到预先定义的数据量或延迟阈值后，可改用从 Markdown 可重建的派生索引，不改变契约。

非法枚举、非正页码、非允许的 pageSize 返回 400。超出总页数的合法 page 返回空 `items`，保留正确的 `total` 和 `facets`。

### 7.2 能力与提案

首期只有记忆列表实现服务端筛选与分页。能力和提案保持当前完整列表 API，避免在没有真实大数据需求时扩大 HTTP 契约。

### 7.3 HTTP 发布门后的变更与审阅

安全发布门满足后，HTTP 端点逐项开放且都使用认证 actor、权限检查、Origin / CSRF 防护和请求体上限：

- `DELETE /amem-api/memories/:id` 要求 `memory:forget`，确认后执行单记忆 coordinator mutation；成功后面板重新请求当前页，若页空则按第 8.2 的页码规则调整，并将焦点移至同一行的相邻项或列表标题。
- `GET/PUT /amem-api/config` 分别要求 `config:read` / `config:write`；读取永不返回 `api_key`，写入使用既有磁盘基线 overlay，成功后返回脱敏配置和刷新提示。
- `GET /amem-api/review` 返回冲突对列表及版本 token；默认选中第一对。`GET /amem-api/conflicts/:leftId/:rightId` 读取当前对比详情；用户切换对比对象时未完成确认须先显式取消。详情 404/409 时返回列表、刷新并以 `aria-live` 说明该冲突已变更。
- `POST /amem-api/conflicts/:leftId/resolve` 要求 `memory:resolve-conflict`；成功后刷新冲突列表，保留下一条可用选择或返回列表标题。

## 8. DSH 面板信息架构与视觉

### 8.1 布局

面板改为紧凑工作台：

- 顶部显示 amem 标识、当前视图标题与全局摘要计数（总记忆、冲突、提案）及最近刷新时间；列表总数始终在工具栏附近显示，避免和全局摘要混淆。
- 宽屏采用左侧窄导航，按“记忆资产”（记忆、能力、提案、审阅）和“系统”（运维、配置、说明）分组。
- 窄屏降级为可横向滚动的 Tab 导航，保持所有原有入口可达。
- 使用 DSH 宿主颜色、系统字体、清晰边框和有限圆角；禁止渐变、大阴影和装饰性卡片网格。

### 8.2 记忆列表

工具栏依次为搜索、分类、层级、信任、状态过滤器和清除筛选。各 facet 首期为单选；计数为零的选项仍可见但禁用。搜索在提交或 300ms 防抖后请求；请求序号保证较晚返回的旧响应不得覆盖新状态。筛选条件、搜索词或 pageSize 改变时，页码重置为 1。筛选器有可见 label；窄屏可横向滚动。

每行记忆显示标题、状态 badge、种类/层级/信任、适用情境、两行内正文预览、更新时间和遗忘操作。状态必须有文字，不可只用颜色。无结果时说明筛选结果为零并提供“清除筛选”。请求刷新时保留旧列表并显示轻量加载状态；首次加载显示骨架；失败显示错误、保留可用旧内容并给出重试；当 `total=0` 时固定显示第 1 页，不跳转；其它超范围空页自动跳转最后一页。底部显示总数、页码、上一页/下一页和 pageSize 选择。

### 8.3 审阅、运维与配置

HTTP 发布门满足后的首期“审阅”视图只聚焦冲突列表、详情对比与裁决；冲突按更新时间倒序并优先展示。冲突以左右并排的可比较视图呈现，窄屏改为 A 后 B 的纵向布局及固定裁决区，固定区不得遮挡可滚动正文。

确认框必须展示 A/B 标题、动作后果和“并存”的含义；提交时禁用所有动作，成功后关闭确认、刷新列表并以 `aria-live` 宣告结果。409 时保留用户选择，重新读取两条记忆并要求再次确认。确认框使用原生语义或完整焦点陷阱、Esc 关闭和焦点返还。

运维结果默认渲染状态、关键计数和摘要，原始 JSON 收进 `<details>`。配置表单改为有说明的分区和固定的保存操作区，但保持现有 API Key、privacy、embedding 的安全限制。半可信记忆、证据和 JSON 必须仅以 React 文本节点渲染；不得用 `innerHTML` 或允许 HTML 的 Markdown 渲染器。

客户端拆分数据请求、列表、分页、过滤器、记忆行、审阅和表单展示组件；避免继续扩张单一 `panel.tsx`。审阅中冲突、快照或门控数据的任一独立加载失败不得阻塞其它区块，并各自提供重试。

## 9. 验收与测试

1. 管理层测试验证 kind/level/trust/status/q 组合过滤、排除自身筛选的 facet 计数、排序、页边界、非法查询和搜索竞态。
2. 门控测试覆盖三种显式模式、全部 `MemoryStatus`、未决和人工并存冲突硬拒绝、`use/verify/ignore`、预算截断、安全撤销、注入文本编码和提示注入攻击集。
3. 快照测试覆盖 epoch `open/committed/revoked/degraded` 状态机、完整键 SHA-256 映射、并发首次创建的单一胜者、同 epoch 稳定、每个提交点崩溃恢复、配置变化只告警、安全收紧的投递前 generation 校验、任务切换 generation fencing、损坏快照零记忆降级和显式 epoch 重置。
4. 冲突测试覆盖旧标记迁移、结构化双向关联、多重冲突状态重算、三种裁决、所有 mutation 经过 coordinator、跨进程 fencing lockfile 互斥、每个 journal 阶段的崩溃重放、preimage 不匹配拒绝恢复、恶意 journal 拒绝、版本冲突和幂等审计。
5. CLI 测试覆盖由 ActorAuthority 签发的权限、审阅契约的 not found、invalid argument 和 conflict 映射；通用 stdio MCP 测试确认不存在冲突裁决/快照写工具。HTTP API 只有满足第 6 节发布门后才测试独立鉴权、CSRF、Origin、请求体限制、跨站拒绝及第 7.3 节各端点权限。
6. HTTP 发布门满足后，UI 测试或可验证渲染覆盖筛选重置页码、翻页、首次加载、刷新、空态、超范围页、错误/部分失败、禁用态、确认/409 恢复、Tab/筛选/分页焦点顺序和结果数 `aria-live` 宣告；人工检查 320px、768px、1024px 宽度。门前静态面板测试不得发出 `/amem-api` 请求，并提供 CLI/MCP 替代入口提示。
7. 安全测试覆盖含密钥/PII 的快照和审计脱敏、目录权限、恶意 HTML/URL 纯文本渲染、session 越权、被拒绝的跨站变更及搜索字段不留原文。工具调用、权限升级、数据导出和状态修改必须由用户请求与宿主授权决定，不能仅因记忆文本触发。
8. 回归运行 core、retrieval、store、gateway-mcp、adapter-dsh 和 amem-dsh-ui 的现有测试与构建。

## 10. 实施顺序

1. 核心类型、配置、结构化冲突关系、门控决定、EpochAuthority/ActorAuthority、epoch 快照、编码/脱敏、MutationCoordinator 和 journal。
2. 将 pipeline、CLI、gateway-mcp、adapter-dsh admin、MemoryStore 相关调用和索引重建全部迁移至 MutationCoordinator；在编译期收紧直接写接口为 coordinator 私有。
3. CLI 审阅、裁决及记忆列表契约；通用 stdio MCP 仅保留 read/note/feedback 且走 coordinator；完成并发和故障恢复测试。
4. DSH 面板组件化、导航和门前静态降级态；仅在第 6 节 HTTP 发布门满足后接入筛选分页和审阅视图。
5. 固定 DSH `dsh-v0.2.0-rc.2` 的实验性自动注入 feature flag、section 生命期和撤销集成测试。
6. 全量测试、构建、手动 DSH 宽窄屏验证。
