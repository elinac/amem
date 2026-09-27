# amem 跨会话记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `D:\dev\workspaces\amem` 实现设计文档中的跨会话记忆系统（P0–P2 全量；P3 列进计划但不阻塞验收），并用自动化测试/验收脚本对照退出标准。

**Architecture:** 薄核心 monorepo：Episode(JSONL) / Memory(Markdown) / Capability(Git) 三层；Cursor Adapter + MCP Gateway；两条异步流水线（extract / consolidate）；宿主差异封装在 adapter 包。

**Tech Stack:** Node ≥22、TypeScript、pnpm workspaces、zod、better-sqlite3、@modelcontextprotocol/sdk、vitest

**Spec:** NoteZ `docs/superpowers/specs/2026-09-26-agent-cross-session-memory-design.md`（权威）  
**ADR:** NoteZ `docs/adr/0003-agent-memory-thin-core.md`

## Global Constraints

- 硬不变量 I1–I8（设计 §4）任意实现不得违反
- 默认数据根 `~/.amem/`（`AMEM_HOME` 可覆盖）
- Windows 优先（钩子用 `node.exe` 绝对路径）；钩子 fail-open、限时 ≤5s
- 自动流程不得写 L3、不得新增/放宽约束、不得把 preference 晋升
- 验收以自动化为主：`pnpm test` + `pnpm accept`；人工抽查指标用 fixture 代理

## File Map

```
amem/
├── package.json                 # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── core/                    # types, zod schemas, invariants, config
│   ├── store/                   # episode/memory fs + sqlite index + git
│   ├── pipeline/                # extract, reconcile, consolidate, promote
│   ├── retrieval/               # situation, recall scoring, context pack
│   ├── llm/                     # OpenAI-compatible + structured output
│   ├── gateway-mcp/             # MCP server
│   ├── compiler/                # L3 → cursor/claude-code formats
│   ├── adapter-cursor/
│   ├── adapter-claude-code/
│   └── cli/                     # amem binary
├── fixtures/
├── scripts/accept.mjs           # 自动验收
└── docs/superpowers/plans/      # 本文件
```

---

### Task 1: Monorepo 脚手架与 core 类型

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Create: `packages/core/src/types.ts`, `packages/core/src/schemas.ts`, `packages/core/src/config.ts`, `packages/core/src/invariants.ts`, `packages/core/src/paths.ts`, `packages/core/src/id.ts`
- Test: `packages/core/src/schemas.test.ts`, `packages/core/src/invariants.test.ts`

**Produces:** `CanonicalEvent`, `MemoryRecord`, `EpisodeMeta`, `AmemConfig`, `assertInvariant`, `loadConfig`, `amemHome`, `newId`

- [ ] **Step 1:** 初始化 pnpm workspace + TypeScript + vitest
- [ ] **Step 2:** 实现 zod schemas（设计 §6）与 I1–I8 检查函数
- [ ] **Step 3:** `pnpm --filter @amem/core test` 通过
- [ ] **Step 4:** Commit `chore: scaffold monorepo and core types`

---

### Task 2: Store — Episode / Memory / Index

**Files:**
- Create: `packages/store/**`
- Test: seal episode、write memory md、rebuild FTS index、forget

**Produces:** `EpisodeStore`, `MemoryStore`, `IndexStore`, `GitRepo`

- [ ] **Step 1:** Episode 追加/封存（JSONL + meta yaml）
- [ ] **Step 2:** Memory Markdown 读写（gray-matter frontmatter）
- [ ] **Step 3:** better-sqlite3 FTS5 索引 + `rebuildIndex`
- [ ] **Step 4:** 可选 git commit wrapper（可 mock）
- [ ] **Step 5:** 测试通过后 commit

---

### Task 3: 脱敏、路径规范化、Cursor Adapter

**Files:**
- Create: `packages/core/src/redact.ts`
- Create: `packages/adapter-cursor/**`
- Fixture: 从 `~/.amem/spool/raw` 脱敏样本复制到 `fixtures/hooks/cursor/`

**Produces:** `normalizeCursorEvent`, `normalizeWorkspaceRoot`, `redactPayload`

- [ ] **Step 1:** 路径 `/d:/dev/...` → `D:\dev\...`
- [ ] **Step 2:** 按 §11.2.1 映射 postToolUse / afterShellExecution（后者不单独成事件）
- [ ] **Step 3:** 脱敏零泄漏测试
- [ ] **Step 4:** Commit

---

### Task 4: Spool、Worker、CLI init/doctor/flush

**Files:**
- Create: `packages/cli/**`, worker queue 逻辑在 `packages/pipeline/src/worker.ts`
- Create: `packages/adapter-cursor/src/hook.mjs`（生产钩子，替换探针）

**Produces:** `amem init|doctor|flush|worker`, 用户级 install

- [ ] **Step 1:** `amem init` 创建目录与 amem.toml
- [ ] **Step 2:** hook 只写 spool + 入队 + detached worker
- [ ] **Step 3:** worker 消费 queue 调用 seal
- [ ] **Step 4:** Commit

---

### Task 5: LLM 客户端 + Pipeline① Extract（模式 A）

**Files:**
- Create: `packages/llm/**`, `packages/pipeline/src/extract.ts`, `reconcile.ts`
- Fixture: `fixtures/golden/extract/*`

**Produces:** `extractEpisode`, `reconcileCandidate`, evidence 逐字校验

- [ ] **Step 1:** OpenAI-compatible structured JSON
- [ ] **Step 2:** extract 管线（seal→redact→segment→extract→validate→write）
- [ ] **Step 3:** 无证据 / 假证据拦截测试
- [ ] **Step 4:** 无 LLM 时可用 stub extractor（fixture 模式）跑验收
- [ ] **Step 5:** Commit

---

### Task 6: Retrieval + Context Pack

**Files:**
- Create: `packages/retrieval/**`

**Produces:** `extractSituation`, `recall`, `buildContextPack`

- [ ] **Step 1:** FTS 召回 + 打分（设计 §8.2，P0 无向量）
- [ ] **Step 2:** Context Pack L0/L1 + budget + manifest
- [ ] **Step 3:** Commit

---

### Task 7: MCP Gateway + Cursor Skill + ingest-transcript

**Files:**
- Create: `packages/gateway-mcp/**`
- Create: `packages/adapter-cursor/skill/SKILL.md`
- Create: `packages/adapter-cursor/src/ingest-transcript.ts`

**Produces:** MCP tools；`amem ingest-transcript --host cursor`；`amem install --host cursor`

- [ ] **Step 1:** MCP tools: recall/get/note/feedback/flush
- [ ] **Step 2:** 解析 Cursor agent-transcripts JSONL
- [ ] **Step 3:** install 合并 hooks.json（保留 gsd）
- [ ] **Step 4:** Commit

---

### Task 8: P0 自动验收门

**Files:**
- Create: `scripts/accept-p0.mjs`

**Exit criteria (自动化代理):**
- Adapter fixtures 全事件覆盖
- 脱敏零泄漏
- extract golden 幻觉率 = 0（证据校验）
- 钩子脚本单次耗时 < 200ms（合成 stdin）
- `amem init` + write memory + recall 端到端

- [ ] **Step 1:** 实现 accept-p0
- [ ] **Step 2:** `pnpm accept:p0` 退出码 0
- [ ] **Step 3:** Commit

---

### Task 9: P1 — 泛化、标签、情境、向量、stats、conflict

**Files:**
- Modify: pipeline generalize + promote prep
- Modify: retrieval vector (sqlite-vec 或 LanceDB 回退)
- Create: feedback stats 写入

- [ ] **Step 1:** deentity + applies_when
- [ ] **Step 2:** situation 从 package.json/Cargo.toml 推断
- [ ] **Step 3:** conflict 状态与召回双呈
- [ ] **Step 4:** feedback → stats.lift
- [ ] **Step 5:** 向量可选；不可用则 FTS-only 标记
- [ ] **Step 6:** Commit + `pnpm accept:p1`

---

### Task 10: P1 — Claude Code Adapter + host extract 模式 B

**Files:**
- Create: `packages/adapter-claude-code/**`
- Modify: llm mode=host pending-extract 队列

- [ ] **Step 1:** Claude Adapter normalize + install
- [ ] **Step 2:** `memory_extract_pending` MCP 工具
- [ ] **Step 3:** Commit

---

### Task 11: P2 — Pipeline② consolidate / promote / demote / propose

**Files:**
- Create: `packages/pipeline/src/consolidate.ts`, `promote.ts`, `propose.ts`

- [ ] **Step 1:** 预算门控
- [ ] **Step 2:** 晋升门槛单测边界
- [ ] **Step 3:** 防振荡 frozen
- [ ] **Step 4:** L3 PR 候选目录 `.proposals/`
- [ ] **Step 5:** Commit

---

### Task 12: P2 — Capability 仓、compiler、amem review

**Files:**
- Create: `packages/compiler/**`
- Create: CLI `review`, `compile`

- [ ] **Step 1:** 中立 capability 目录结构
- [ ] **Step 2:** compile → `~/.cursor/skills` + rules 头注释
- [ ] **Step 3:** review 非交互 `--apply` / `--list` 供验收
- [ ] **Step 4:** Commit + `pnpm accept:p2`

---

### Task 13: 总验收 `pnpm accept`

**Files:**
- Create: `scripts/accept.mjs` 串联 p0/p1/p2 + 不变量属性测试

**证明:**
- I1–I8 属性测试 100%
- P0/P1/P2 accept 脚本全绿
- README 记录如何安装与复现验收

- [ ] **Step 1:** 跑全套
- [ ] **Step 2:** 修失败项直至绿
- [ ] **Step 3:** 标记 goal complete

## P3（不阻塞）

- hook 级约束 Rego、团队共享仓、Codex/OpenCode Adapter、服务化、时态知识 — 另立项。

## 验收命令（目标态）

```bash
cd D:\dev\workspaces\amem
pnpm install
pnpm test
pnpm accept        # = accept:p0 && accept:p1 && accept:p2
```
