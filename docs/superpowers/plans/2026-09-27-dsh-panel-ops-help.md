# DSH Panel Ops + Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH amem 面板增加「运维」「说明」Tab，并通过 `/amem-api` 暴露 doctor / flush / rebuild-index / consolidate / compile(dsh only)，文案跟随 DSH locale。

**Architecture:** 扩展 `createAdmin` 用 `@amem/pipeline` / `@amem/compiler` / `@amem/store` 直调（对齐 CLI，不 spawn）；在已有 `/amem-api` prefix handler 增动作路由；面板扩展 Tab，严格限制 `load()` 只服务 memories|skills|proposals。

**Tech Stack:** TypeScript、Vitest、React createElement（amem-dsh-ui）、Cordis DSH webServer + Connection `requestRejection`。

**Spec:** `docs/superpowers/specs/2026-09-27-dsh-panel-ops-help-design.md`

## Global Constraints

- 不 spawn `amem` CLI；不新增 workspace 依赖。
- compile API **仅** `target === "dsh"`（缺省 dsh；其它 → 400）；不接受 `outRoot`。
- flush `sessionId`：空白 → `"manual"`；再校验 `^[A-Za-z0-9._-]{1,128}$`。
- 鉴权沿用现有 `checkAuth`；成功响应解包为 `data`（无强制顶层 `ok`）。
- locale：所有新文案进 `zh`/`en` 成对键。
- flush 路由必须 `await admin.flush(...)`。
- 用户未要求时不要自动 `git commit`；计划中的 Commit 步骤仅在用户明确要求提交时执行。

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/adapter-dsh/src/admin.ts` | doctor / flush / rebuildIndex / consolidate / compile |
| `packages/adapter-dsh/src/admin-ops.test.ts` | admin 运维方法单测（新建） |
| `packages/adapter-dsh/src/plugin.ts` | 五个新路由 |
| `packages/amem-dsh-ui/client/locales.ts` | tab + ops + help 文案 |
| `packages/amem-dsh-ui/client/panel.tsx` | Tab/load 契约 + 运维/说明 UI |
| `README.md` | 五 Tab + 运维命令一句 |

---

### Task 1: Admin ops methods + tests

**Files:**
- Create: `packages/adapter-dsh/src/admin-ops.test.ts`
- Modify: `packages/adapter-dsh/src/admin.ts`
- Test: `packages/adapter-dsh/src/admin-ops.test.ts`

**Interfaces:**
- Produces on `createAdmin(home)` return value:
  - `doctor(): AdminResult`
  - `flush(sessionId?: string | null): Promise<AdminResult>`
  - `rebuildIndex(): AdminResult`
  - `consolidate(dryRun?: boolean): AdminResult`
  - `compile(target?: string): AdminResult`

- [ ] **Step 1: Write failing tests**

```ts
// packages/adapter-dsh/src/admin-ops.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configToToml, defaultConfig } from "@amem/core";
import { writeFileSync, mkdirSync } from "node:fs";
import { createAdmin } from "./admin.js";

describe("admin ops", () => {
  let home: string;
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function setupHome(): string {
    home = mkdtempSync(join(tmpdir(), "amem-ops-"));
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig()));
    return home;
  }

  it("doctor reports home and config", () => {
    const h = setupHome();
    const r = createAdmin(h).doctor();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { home: string; checks: unknown[] };
    expect(data.home).toBe(h);
    expect(data.checks.some((c) => Array.isArray(c) && c[0] === "config" && c[1] === true)).toBe(true);
  });

  it("flush rejects path-like sessionId", async () => {
    const h = setupHome();
    const r = await createAdmin(h).flush("../evil");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it("flush treats blank as manual", async () => {
    const h = setupHome();
    const r = await createAdmin(h).flush("  ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { queued: string };
    expect(data.queued).toContain("flush-manual-");
  });

  it("consolidate dryRun returns promotion", () => {
    const h = setupHome();
    const r = createAdmin(h).consolidate(true);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.data as { dryRun: boolean }).dryRun).toBe(true);
  });

  it("rebuildIndex returns indexed count", () => {
    const h = setupHome();
    const r = createAdmin(h).rebuildIndex();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(typeof (r.data as { indexed: number }).indexed).toBe("number");
  });

  it("compile rejects non-dsh target", () => {
    const h = setupHome();
    const r = createAdmin(h).compile("cursor");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it("compile dsh succeeds with empty skills", () => {
    const h = setupHome();
    const r = createAdmin(h).compile("dsh");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.isArray((r.data as { written: string[] }).written)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @amem/adapter-dsh test -- admin-ops.test.ts
```

Expected: FAIL（`doctor` / `flush` 等方法不存在）

- [ ] **Step 3: Implement admin methods**

在 `packages/adapter-dsh/src/admin.ts` 增加 imports：

```ts
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { amemHome as defaultAmemHome, loadConfig, newId, paths, type MemoryRecord } from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { buildContextPack, extractSituation, recall } from "@amem/retrieval";
import { compileCapabilities, listProposalsData, listSkillsData, materializeProposal } from "@amem/compiler";
import { consolidate, enqueueFlush, processQueue } from "@amem/pipeline";
```

（保留已有 import，合并去重；`existsSync`/`readdirSync` 为 doctor 所需。）

在 `createAdmin` 返回对象末尾、`applyProposal` 之后加入：

```ts
    doctor(): AdminResult {
      const p = paths(home);
      const checks: Array<[string, unknown]> = [
        ["home", existsSync(home)],
        ["config", existsSync(p.config)],
        ["node", process.versions.node],
        ["spool_raw_files", existsSync(p.spoolRaw) ? readdirSync(p.spoolRaw).length : 0],
      ];
      return { ok: true, data: { home, checks } };
    },

    async flush(sessionId?: string | null): Promise<AdminResult> {
      let sid = sessionId == null || !String(sessionId).trim() ? "manual" : String(sessionId).trim();
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(sid)) {
        return { ok: false, error: "bad_request", message: "invalid sessionId", status: 400 };
      }
      const file = enqueueFlush(home, sid);
      const n = await processQueue(home);
      return { ok: true, data: { queued: file, processed: n } };
    },

    rebuildIndex(): AdminResult {
      const n = new IndexStore(home).rebuild(new MemoryStore(home));
      return { ok: true, data: { indexed: n } };
    },

    consolidate(dryRun = false): AdminResult {
      const c = cfg();
      if (dryRun) return { ok: true, data: { dryRun: true, promotion: c.promotion } };
      const r = consolidate(home, c);
      return { ok: true, data: r };
    },

    compile(target?: string): AdminResult {
      const t = target == null || target === "" ? "dsh" : target;
      if (t !== "dsh") {
        return {
          ok: false,
          error: "bad_request",
          message: "compile target must be dsh",
          status: 400,
        };
      }
      try {
        const r = compileCapabilities(home, "dsh");
        return { ok: true, data: r };
      } catch (e) {
        return {
          ok: false,
          error: "compile_failed",
          message: e instanceof Error ? e.message : String(e),
          status: 400,
        };
      }
    },
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
pnpm --filter @amem/adapter-dsh test -- admin-ops.test.ts
```

Expected: PASS（若 `flush` 因缺 spool 目录失败，在 `flush` 内或测试 `setupHome` 中 `mkdirSync(paths(home).queue)` / spool 所需目录——以 `enqueueFlush` 实现为准，优先在 admin `flush` 开头依赖 pipeline 自建目录。）

- [ ] **Step 5: Commit（仅当用户要求提交时）**

```bash
git add packages/adapter-dsh/src/admin.ts packages/adapter-dsh/src/admin-ops.test.ts
git commit -m "feat(adapter-dsh): add admin doctor/flush/consolidate/compile ops"
```

---

### Task 2: Wire `/amem-api` routes

**Files:**
- Modify: `packages/adapter-dsh/src/plugin.ts`（在现有 `applyMatch` / skills / proposals 路由附近追加）
- Test: extend `packages/adapter-dsh/src/plugin.test.ts` 或依赖 Task 1 + 手动；本任务加一个轻量路由注册后 handler 调用 doctor 的单元测试可选。

**Interfaces:**
- Consumes: `admin.doctor`, `admin.flush`, `admin.rebuildIndex`, `admin.consolidate`, `admin.compile`
- Produces: HTTP 路由如下表

| Method | Path | Call |
|--------|------|------|
| GET | `/doctor` | `admin.doctor()` |
| POST | `/flush` | `await admin.flush(body.sessionId)` |
| POST | `/rebuild-index` | `admin.rebuildIndex()` |
| POST | `/consolidate` | `admin.consolidate(!!body.dryRun)` |
| POST | `/compile` | `admin.compile(body.target)` |

- [ ] **Step 1: Add routes inside the existing `/amem-api` handler**（`checkAuth` 之后、最终 404 之前）

```ts
          if (method === "GET" && path === "/doctor") {
            const r = admin.doctor();
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/flush") {
            const body = JSON.parse((await readBody(req)) || "{}") as { sessionId?: string };
            const r = await admin.flush(body.sessionId);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/rebuild-index") {
            const r = admin.rebuildIndex();
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/consolidate") {
            const body = JSON.parse((await readBody(req)) || "{}") as { dryRun?: boolean };
            const r = admin.consolidate(Boolean(body.dryRun));
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/compile") {
            const body = JSON.parse((await readBody(req)) || "{}") as { target?: string };
            const r = admin.compile(body.target);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }
```

- [ ] **Step 2: Build + test package**

```bash
pnpm --filter @amem/adapter-dsh build
pnpm --filter @amem/adapter-dsh test
```

Expected: all PASS

- [ ] **Step 3: Commit（仅当用户要求）**

```bash
git add packages/adapter-dsh/src/plugin.ts
git commit -m "feat(adapter-dsh): expose ops routes on /amem-api"
```

---

### Task 3: Locale strings (ops + help)

**Files:**
- Modify: `packages/amem-dsh-ui/client/locales.ts`

**Interfaces:**
- Produces keys used by Task 4（必须 zh/en 成对）

- [ ] **Step 1: Extend `zh` / `en`**

在 `zh` 中追加（`en` 同步）：

```ts
  "tab.ops": "运维",
  "tab.help": "说明",
  "ops.sessionPlaceholder": "sessionId（可空=manual）",
  "ops.doctor": "健康检查",
  "ops.flush": "冲洗队列",
  "ops.rebuild": "重建索引",
  "ops.consolidateDry": "整合（试运行）",
  "ops.consolidate": "整合（执行）",
  "ops.compile": "编译到 DSH",
  "ops.confirmConsolidate": "确认执行整合？可能晋升/降级记忆并生成提案。",
  "ops.confirmRebuild": "确认重建索引？",
  "ops.confirmCompile": "确认编译能力到 ~/.dsh/skills？",
  "ops.result": "结果",
  "ops.hintProcessedZero": "processed 为 0 时可能表示队列为空或抽取失败。",
  "help.layersTitle": "三层模型",
  "help.layersBody": "记忆(L2) → 提案(候选) → 能力(L3 Skill)。自动流程只写记忆与提案；能力必须人工「应用」提案后才会入库。",
  "help.flowTitle": "推荐流程",
  "help.flowBody": "1) 会话中沉淀可复用步骤（memory_note / 自动抽取） 2) 跨会话 recall + helpful 反馈 3) 运维「整合」生成提案 4) 提案 Tab「应用」入库 5) 运维「编译到 DSH」写入 ~/.dsh/skills。",
  "help.tabsTitle": "各 Tab",
  "help.tabsBody": "记忆：浏览/召回/遗忘。能力：已入库 Skill 列表。提案：候选与应用。运维：doctor/flush/索引/整合/编译。说明：本页。",
  "help.cliTitle": "与 CLI 对照",
  "help.cliBody": "健康检查=amem doctor；冲洗队列=amem flush；重建索引=amem rebuild-index；整合=amem consolidate；编译到 DSH=amem compile --target dsh（注意：CLI 默认 target 是 cursor，面板固定 dsh）。",
  "help.gateTitle": "晋升门槛",
  "help.gateBody": "自动出提案通常需要 procedure + 足够多实例/helpful。本地打通可用 CLI 加速路径（手改 frontmatter），见仓库 README。",
```

`en` 对应英文（Ops / Guide / Doctor / Flush queue / …），键名完全一致。

- [ ] **Step 2: Typecheck via UI build later；本步保证 `en` 满足 `Record<AmemKey, string>`**

- [ ] **Step 3: Commit（仅当用户要求）**

---

### Task 4: Panel UI — ops + help tabs

**Files:**
- Modify: `packages/amem-dsh-ui/client/panel.tsx`

**Interfaces:**
- Consumes: locale keys from Task 3；API from Task 2
- Produces: 五 Tab UI

- [ ] **Step 1: Change Tab type and load()**

```ts
type Tab = "memories" | "skills" | "proposals" | "ops" | "help";
type ListTab = "memories" | "skills" | "proposals";

function isListTab(t: Tab): t is ListTab {
  return t === "memories" || t === "skills" || t === "proposals";
}
```

`load` 仅在 `isListTab(tab)` 时请求；若调用时 tab 不是 list，直接 return。

`useEffect` 依赖 `load`：当 tab 为 ops/help 时 `load` 应 no-op（或 effect 内 `if (!isListTab(tab)) return`）。

- [ ] **Step 2: Add ops/help state and handlers inside `AmemPanel`**

```ts
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsResult, setOpsResult] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");

  const runOps = async (path: string, init?: RequestInit) => {
    setOpsBusy(true);
    setError(null);
    setOpsResult(null);
    try {
      const data = await api(path, init);
      setOpsResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpsBusy(false);
    }
  };
```

按钮：

- Doctor → `runOps("/doctor")`
- Flush → `runOps("/flush", { method:"POST", body: JSON.stringify({ sessionId: sessionId.trim() || undefined }) })`
- Rebuild → confirm → `runOps("/rebuild-index", { method:"POST", body:"{}" })`
- Consolidate dry → `runOps("/consolidate", { method:"POST", body: JSON.stringify({ dryRun: true }) })`
- Consolidate → confirm → `runOps("/consolidate", { method:"POST", body: JSON.stringify({ dryRun: false }) })` 成功后可提示切换到提案
- Compile → confirm → `runOps("/compile", { method:"POST", body: JSON.stringify({ target: "dsh" }) })`

- [ ] **Step 3: Render tabs including ops/help；ops/help 内容区**

Tab 按钮循环改为 `["memories","skills","proposals","ops","help"]`，`tabLabel` 用 `tab.${id}`。

列表 `ul`：**仅** `isListTab(tab)` 时渲染。

`tab === "ops"`：session 输入 + 按钮行 + `ops.hintProcessedZero` + `<pre>{opsResult}</pre>`；`opsBusy` 时禁用按钮。

`tab === "help"`：依次渲染 `help.*Title` 为 h3、`help.*Body` 为 p（layers / flow / tabs / cli / gate）。

回忆区（recall input）仍仅 `tab === "memories"`。

- [ ] **Step 4: Build UI**

```bash
pnpm --filter @amem/amem-dsh-ui build
```

Expected: `wrote dist/client.js`

- [ ] **Step 5: Commit（仅当用户要求）**

---

### Task 5: README + reinstall hint

**Files:**
- Modify: `README.md`（DSH Web 扩展小节，约面板描述处）

- [ ] **Step 1: Update copy**

将「记忆 / 能力 / 提案」改为「记忆 / 能力 / 提案 / 运维 / 说明」，并加一句：运维 Tab 对应 `doctor` / `flush` / `rebuild-index` / `consolidate` / `compile --target dsh`（面板 compile 固定 dsh）。

- [ ] **Step 2: Manual smoke（实现者执行）**

```powershell
pnpm --filter @amem/adapter-dsh build
pnpm --filter @amem/amem-dsh-ui build
# 若 wrapper 未变可不重装；改的是 dist 被 file URL 引用则重启即可
# 重启 dsh web 后：运维→健康检查有 JSON；切到说明不请求 /proposals；中英切换文案变化
```

- [ ] **Step 3: Commit（仅当用户要求）**

---

## Spec coverage checklist

| Spec 项 | Task |
|---------|------|
| A: doctor/flush/rebuild-index | 1–2, 4 |
| B: consolidate/compile(dsh); apply 已有 | 1–2, 4 |
| 说明页 | 3–4 |
| load() 契约 | 4 |
| sessionId 校验 / 空白归一 | 1 |
| compile 仅 dsh (O3) | 1–2, 4 |
| async flush await | 2 |
| locale zh/en | 3 |
| README | 5 |
| 不 spawn / 无 CSRF 新做 | 全局 |

## Placeholder scan

无 TBD /「类似 Task N」占位。

## Type consistency

- Admin 方法名：`doctor` / `flush` / `rebuildIndex` / `consolidate` / `compile`
- 路径：`/doctor` `/flush` `/rebuild-index` `/consolidate` `/compile`
- Tab：`ops` / `help`；locale：`tab.ops` / `tab.help`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-27-dsh-panel-ops-help.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新子代理 + 任务间复审  
2. **Inline Execution** — 本会话按 executing-plans 批量推进并设检查点  

选哪种？
