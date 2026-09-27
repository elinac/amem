### Task 4: Locales + panel Config Tab + README

**Files:**
- Modify: `packages/amem-dsh-ui/client/locales.ts`
- Modify: `packages/amem-dsh-ui/client/panel.tsx`
- Modify: `README.md`（DSH Web 五 Tab → 六 Tab）
- Test: 手动 / `pnpm --filter @amem/amem-dsh-ui build`（或仓库现有 client build 脚本）

**Interfaces:**
- Consumes: `GET /amem-api/config` → `{ path, config }`；`PUT /amem-api/config` body `{ config }`
- Produces: Tab `"config"`；`isListTab` **不含** config

- [ ] **Step 1: Update locales**

在 `zh` 增加（并对 `en` 成对补齐）：

```ts
"tab.config": "配置",
"config.reload": "重新加载",
"config.save": "保存",
"config.confirmSave": "确认写入 amem.toml？未在表单中展示的段（embedding/privacy）将保留磁盘原值。",
"config.saved": "已保存：{path}",
"config.section.identity": "身份",
"config.section.llm": "LLM",
"config.section.recall": "召回",
"config.section.promotion": "晋升",
"config.section.budget": "整合预算",
"config.field.user_id": "user_id",
"config.field.mode": "mode",
"config.field.base_url": "base_url",
"config.field.model": "model",
"config.field.api_key_env": "api_key_env",
"config.field.budget_tokens": "budget_tokens",
"config.field.l0_items": "l0_items",
"config.field.l1_items": "l1_items",
"config.field.instance_to_domain_min_instances": "instance_to_domain_min_instances",
"config.field.domain_to_global_min_domains": "domain_to_global_min_domains",
"config.field.domain_to_global_min_instances": "domain_to_global_min_instances",
"config.field.global_min_lift": "global_min_lift",
"config.field.max_llm_calls": "max_llm_calls",
"config.field.max_tokens": "max_tokens",
"config.field.max_proposals": "max_proposals",
"config.field.max_minutes": "max_minutes",
"config.hintSecrets": "密钥只通过环境变量注入；此处只填变量名（api_key_env），不要粘贴真实 Key。",
"config.hintReload": "保存后新请求会重新读盘；若长期 worker 已缓存配置，可能需重启 dsh web。",
"config.hintPrivacy": "privacy / embedding 请用手改 amem.toml；面板保存不会覆盖磁盘上的这些段。",
```

更新 `help.tabsBody` zh：

```text
记忆：浏览/召回/遗忘。能力：已入库 Skill 列表。提案：候选与应用。运维：doctor/flush/索引/整合/编译。配置：常用 amem.toml。说明：本页。
```

en `help.tabsBody`：

```text
Memories: browse/recall/forget. Skills: library list. Proposals: candidates and apply. Ops: doctor/flush/index/consolidate/compile. Config: common amem.toml. Guide: this page.
```

en `tab.config`: `"Config"`；其余 `config.*` 用对应英文短句。

- [ ] **Step 2: Panel — types and state**

```ts
type Tab = "memories" | "skills" | "proposals" | "ops" | "config" | "help";
// isListTab 不变（不含 config）

type AmemConfigState = {
  identity: { user_id: string };
  llm: { base_url: string; model: string; api_key_env: string; mode: string };
  embedding: { enabled: boolean; base_url: string; model: string; dim: number };
  recall: { budget_tokens: number; l0_items: number; l1_items: number };
  promotion: {
    instance_to_domain_min_instances: number;
    domain_to_global_min_domains: number;
    domain_to_global_min_instances: number;
    global_min_lift: number;
  };
  budget: {
    consolidate: {
      max_llm_calls: number;
      max_tokens: number;
      max_proposals: number;
      max_minutes: number;
    };
  };
  privacy: { redact_patterns: string[]; exclude_workspaces: string[] };
};

const [configBusy, setConfigBusy] = useState(false);
const [configPath, setConfigPath] = useState<string | null>(null);
const [config, setConfig] = useState<AmemConfigState | null>(null);
const [configMsg, setConfigMsg] = useState<string | null>(null);
```

Tab 按钮顺序插入 `config`（在 ops 与 help 之间）。

- [ ] **Step 3: loadConfig / saveConfig**

```ts
const loadConfigTab = async () => {
  setConfigBusy(true);
  setError(null);
  setConfigMsg(null);
  try {
    const data = (await api("/config")) as { path?: string; config?: AmemConfigState };
    setConfigPath(data.path ?? null);
    setConfig(data.config ?? null);
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setConfigBusy(false);
  }
};

useEffect(() => {
  if (tab !== "config") return;
  void loadConfigTab();
}, [tab]);

const saveConfig = async () => {
  if (!config) return;
  if (!confirm(format(t, "config.confirmSave"))) return;
  setConfigBusy(true);
  setError(null);
  setConfigMsg(null);
  try {
    const data = (await api("/config", {
      method: "PUT",
      body: JSON.stringify({ config }),
    })) as { path?: string; saved?: boolean };
    setConfigMsg(format(t, "config.saved", { path: data.path ?? configPath ?? "" }));
    await loadConfigTab();
  } catch (e) {
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setConfigBusy(false);
  }
};
```

注意：`useEffect` 依赖勿引入 eslint 死循环；`loadConfigTab` 可用 inline 或 `useCallback` 空依赖 + 仅 `[tab]`。

- [ ] **Step 4: Config form UI**

当 `tab === "config"` 时渲染：

- 提示三段：`config.hintSecrets` / `config.hintPrivacy` / `config.hintReload`
- 分区标题 + 字段（text / select / number），通过 `setConfig` 不可变更新嵌套字段
- `mode` select：`stub` | `external` | `host`
- 按钮：重新加载、保存；`disabled={configBusy}`
- 成功信息：`configMsg`；路径只读展示 `configPath`

参考运维 Tab 的简洁 `createElement` 风格，**不要**引入新 UI 库。

- [ ] **Step 5: README**

将：

```text
记忆 / 能力 / 提案 / 运维 / 说明
```

改为：

```text
记忆 / 能力 / 提案 / 运维 / 配置 / 说明
```

并加一句：配置 Tab 可编辑常用 `amem.toml`（不含真实 API Key；privacy/embedding 保留磁盘值）。

- [ ] **Step 6: Build UI client**

Run: 仓库内现有 amem-dsh-ui 构建命令（例如 `pnpm --filter @amem/amem-dsh-ui build` 或 `node packages/amem-dsh-ui/scripts/build-client.mjs`）  
Expected: exit 0

- [ ] **Step 7: Manual smoke**

1. `dsh web` 打开面板 → 切「配置」→ 网络无 `/proposals`
2. 改 `mode` 保存 → 磁盘 `amem.toml` 更新
3. 手改 `[privacy]` 非空 → 再面板保存 → privacy 仍非空
4. 说明页文案含「配置」

- [ ] **Step 8: Commit**（仅当用户要求时）

```bash
git add packages/amem-dsh-ui/client/locales.ts packages/amem-dsh-ui/client/panel.tsx README.md
git commit -m "feat(amem-dsh-ui): config tab for amem.toml form edit"
```

---

