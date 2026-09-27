# DSH amem 面板：运维命令 + 说明页

日期：2026-09-27  
状态：审核通过（Round 2：PASS_WITH_OPTIONAL，无阻塞项）  
范围：A（日常运维）+ B（能力链路）+ 说明页  
非目标：export / ingest-transcript / install / init / worker 守护进程 / spawn CLI

## 1. 背景与目标

DSH Web 左栏 amem 面板已具备记忆/能力/提案浏览与召回、遗忘、提案应用。用户希望在面板内直接触发与 `amem` CLI 对齐的运维与能力链路命令，并提供使用说明与操作流程介绍。

成功标准：

1. 用户无需离开 DSH Web 即可执行 doctor / flush / rebuild-index / consolidate / compile(dsh)。
2. 提案入库仍走「提案」Tab 的应用（等同 `review --apply`）；说明页写清链路。
3. 文案跟随 DSH locale（zh/en）。
4. 鉴权与现有 `/amem-api` 一致（同域 cookie + Connection 校验）。

## 2. 范围映射（A / B / 说明）

| 桶 | 命令 / 能力 | 落点 |
|----|-------------|------|
| **A 日常运维** | `doctor`、`flush`、`rebuild-index` | 「运维」Tab 按钮 |
| **B 能力链路** | `consolidate`、`compile --target dsh`；`review --apply`（已有） | consolidate/compile →「运维」；apply →「提案」Tab「应用」 |
| **说明** | 使用说明 + 操作流程 + CLI 对照 | 「说明」Tab（只读） |

**不在本轮**：「能力」Tab 不新增动作按钮（仅列表）。

## 3. 架构决策

**选定：扩展 `createAdmin` + `/amem-api` 动作端点 + 面板 Tab；库函数直调（对齐 CLI，不 spawn）。**

依据：

- `@amem/adapter-dsh` 已依赖 `@amem/pipeline` / `@amem/compiler` / `@amem/store`。
- CLI（`packages/cli/src/bin.ts`）对上述命令是薄封装。
- 面板已用 `fetch('/amem-api…', { credentials: 'same-origin' })`。

曾考虑但否决：spawn CLI（路径/解析脆弱）；仅静态说明（达不到 A+B）。

## 4. UI

### 4.1 Tab 与加载契约（硬约束）

```ts
type Tab = "memories" | "skills" | "proposals" | "ops" | "help";
```

locale 键：

| key | zh | en |
|-----|----|----|
| `tab.ops` | 运维 | Ops |
| `tab.help` | 说明 | Guide |

**`load()` / 依赖 `tab` 的列表请求仅当 `tab ∈ {memories, skills, proposals}`。**  
`ops` / `help`：**不得**落入现有 `else → GET /proposals`；不置共享列表 `busy`。  
运维按钮使用独立 `opsBusy`；成功后若需刷新提案/能力，显式调用 `reloadList("proposals"|"skills")` 或切换到对应 Tab。

### 4.2 运维页控件

按钮文案（locale）与 CLI 对照（说明页与按钮 title 同步）：

| UI（zh） | UI（en） | CLI | API |
|----------|----------|-----|-----|
| 健康检查 | Doctor | `amem doctor` | `GET /amem-api/doctor` |
| 冲洗队列 | Flush | `amem flush` | `POST /amem-api/flush` |
| 重建索引 | Rebuild index | `amem rebuild-index` | `POST /amem-api/rebuild-index` |
| 整合（试运行） | Consolidate (dry-run) | `amem consolidate --dry-run` | `POST …/consolidate` `{dryRun:true}` |
| 整合（执行） | Consolidate | `amem consolidate` | `POST …/consolidate` `{dryRun:false}` |
| 编译到 DSH | Compile → DSH | `amem compile --target dsh` | `POST …/compile` `{target:"dsh"}` |

注意：**面板 compile 默认/固定 `dsh`；CLI 默认仍是 `cursor`。** 说明页必须写明此差异。

| 控件细节 | 规则 |
|----------|------|
| flush `sessionId` 输入 | 可选；空 → `"manual"`（对齐 CLI） |
| 整合（执行） | 需 `confirm` |
| 重建索引 / 编译 | 需 `confirm`（写索引 / 写 `~/.dsh/skills`） |
| 结果区 | **成功**：展示服务端 `data`（与现网解包约定一致，无强制顶层 `ok`）；**失败**：展示 `message` |

### 4.3 说明页结构（zh/en 键分段）

1. 三层：记忆 (L2) → 提案 → 能力 (L3 / Skill)  
2. 推荐流程（简版，对齐 README「从会话到能力」）  
3. 各 Tab 职责  
4. 运维按钮 ↔ CLI 对照表（含 compile 默认差异）  
5. 晋升门槛提示；加速路径仅点到「见 CLI/README」，不在面板内手改 frontmatter  

篇幅：一屏滚动可读。

## 5. API 契约

挂在已有 prefix `/amem-api` 的同一 handler。动作端点命名**对齐 CLI 子命令**（非纯 REST 资源，与现有 `/recall` 一致）。

鉴权（已实现，本轮不变）：

- 优先 `connection.requestRejection(req)` → `401|403|undefined`（DSH 0.1.5-rc.3）
- 兼容 `connection.admit(req)`（上游 master）
- 皆无 → 401 fail-closed  
威胁模型：与现有 `/amem-api` 变更接口相同（同域 cookie）；本轮不新增 CSRF token。

官网 WebServer：`register({ kind:'prefix', path, handler })`；**不得**注册 `/api`（Connection 占用）。

### 5.1 端点

| Method | Path（完整） | Admin | 备注 |
|--------|--------------|-------|------|
| GET | `/amem-api/doctor` | `doctor()` | 同步 |
| POST | `/amem-api/flush` | `async flush(sessionId?)` | **必须 await** |
| POST | `/amem-api/rebuild-index` | `rebuildIndex()` | 同步 |
| POST | `/amem-api/consolidate` | `consolidate(dryRun?)` | 同步 |
| POST | `/amem-api/compile` | `compile(target?)` | 默认可 `dsh` |

### 5.2 输入校验

**`sessionId`（flush）**：`undefined` / `null` / `""` / 纯空白 → 归一为 `"manual"`（与 CLI 空缺省一致）；归一后再匹配 `^[A-Za-z0-9._-]{1,128}$`，否则 **400**（防路径逃逸 + 超长文件名）。

**`target`（compile）**：本面板部署 **仅允许 `dsh`**（O3 已确认）；缺省 `dsh`；其它值 → **400**。不接受 `outRoot`。

### 5.3 Admin 实现（import 对齐 CLI）

```ts
import { enqueueFlush, processQueue, consolidate } from "@amem/pipeline";
import { compileCapabilities } from "@amem/compiler";
import { IndexStore, MemoryStore } from "@amem/store";
import { loadConfig, paths } from "@amem/core";
// 勿用 adapter-dsh/spool.ts 的 enqueueFlush 冒充完整 flush（缺少 queue at 等字段语义时以 pipeline 为准）
```

| 方法 | 行为 |
|------|------|
| `doctor()` | 对齐 CLI：`home/config` 存在性、`node` 版本、`spoolRaw` 文件数 |
| `async flush(sid)` | 校验 sid → `enqueueFlush` → `await processQueue` → `{ queued, processed }` |
| `rebuildIndex()` | `IndexStore.rebuild(MemoryStore)` → `{ indexed }` |
| `consolidate(dry)` | dry → `{ dryRun, promotion }`；else `consolidate(home, cfg)` |
| `compile(target)` | try `compileCapabilities`；捕获手改拒绝 → 400 message |

长任务：请求内跑完；UI `opsBusy`；无 SSE。`processed:0` 可能表示抽取失败（queue 项仍被消费）——结果区/说明页一句提示。

## 6. 包与文件变更

| 包 | 变更 |
|----|------|
| `adapter-dsh` | `admin.ts` 新方法 + sessionId/target 校验；`plugin.ts` 路由（flush await）；单测 |
| `amem-dsh-ui` | `locales.ts`；`panel.tsx` Tab/load 契约 + 运维/说明 |
| README | 面板五 Tab；运维对应命令；compile 面板默认 dsh |

## 7. 测试

1. **admin**：doctor；consolidate dryRun；rebuildIndex；flush sessionId 非法 → 失败；compile 非法 target → 失败（临时 home）。  
2. **plugin**：flush 路由 `await`；鉴权拒绝不进业务。  
3. **手动**：`dsh web` → 运维 doctor 有 JSON；切换运维/说明**不**请求 `/proposals`；说明页中英切换。

## 8. 明确不做

- spawn `amem` 子进程  
- export / ingest-transcript / install / init / worker 守护  
- compile 多 target 下拉（API 保留白名单参数，UI 固定 dsh）  
- 说明页远程/可编辑文档  
- 服务端单飞锁 / SSE 进度（可后续）

## 9. 审核循环

| 轮次 | 结论 | 处置 |
|------|------|------|
| R1 | NEEDS_FIX | 已修复：load/Tab 契约、A/B 映射、sessionId 校验、响应形状、async flush、测试、文案与 compile 默认差异、§9 |
| R2 | **PASS_WITH_OPTIONAL** | 无阻塞；可选见 §10。退出循环（未满 5 轮） |

审核维度：可行性、完整性、一致性、清晰性、稳定性、通用性。  
对照：工程代码（adapter-dsh / cli / pipeline / amem-dsh-ui）+ DSH Connection（`requestRejection` / 上游 `admit`）+ WebServer `register`（禁止占用 `/api`）。

## 10. 可选修复项（待你确认）

| # | 项 | 建议 | 默认若不确认 |
|---|----|------|----------------|
| O1 | sessionId 空白归一 + 长度 ≤128 | **已写入 §5.2** | — |
| O2 | 运维按钮/说明分段 locale 键名在实现时自拟，保持 zh/en 成对 | 实现时做 | — |
| O3 | API `compile` 仅允许 `target=dsh` | **已采纳，写入 §5.2** | — |
| O4 | CSRF token / 服务端单飞锁 / SSE | 不做本轮 | 与现有 `/amem-api` 同威胁模型 |

已确认进入实现计划。
