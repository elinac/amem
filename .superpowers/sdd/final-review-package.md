# Final Review Package — DSH Panel Config\n\nPlan: docs/superpowers/plans/2026-09-27-dsh-panel-config.md\n\nCommits: none (working tree)\n\n## Spec\n\n# DSH amem 面板：配置 Tab

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
\n\n## Changed files\n\n### packages/core/src/config.ts (16789 chars)\n\n`	s\nimport { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { amemHome, paths } from "./paths.js";

export interface AmemConfig {
  identity: { user_id: string };
  llm: {
    base_url: string;
    model: string;
    api_key_env: string;
    mode: "external" | "host" | "stub";
  };
  embedding: {
    enabled: boolean;
    base_url: string;
    model: string;
    dim: number;
  };
  recall: {
    budget_tokens: number;
    l0_items: number;
    l1_items: number;
  };
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
  privacy: {
    redact_patterns: string[];
    exclude_workspaces: string[];
  };
}

export function defaultConfig(userId = "local"): AmemConfig {
  return {
    identity: { user_id: userId },
    llm: {
      base_url: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4.1-mini",
      api_key_env: "AMEM_LLM_KEY",
      mode: "stub",
    },
    embedding: { enabled: false, base_url: "", model: "", dim: 1024 },
    recall: { budget_tokens: 1800, l0_items: 8, l1_items: 3 },
    promotion: {
      instance_to_domain_min_instances: 3,
      domain_to_global_min_domains: 2,
      domain_to_global_min_instances: 5,
      global_min_lift: 0.1,
    },
    budget: {
      consolidate: {
        max_llm_calls: 200,
        max_tokens: 300000,
        max_proposals: 5,
        max_minutes: 20,
      },
    },
    privacy: { redact_patterns: [], exclude_workspaces: [] },
  };
}

/** Minimal TOML subset reader for our known keys (no full TOML parser dependency). */
export function parseSimpleToml(text: string): AmemConfig {
  const cfg = defaultConfig();
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      section = sec[1]!;
      continue;
    }
    const kv = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1]!;
    let val: string | number | boolean = kv[2]!.trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    else if (val === "true" || val === "false") val = val === "true";
    else if (/^-?\d+(\.\d+)?$/.test(val)) val = Number(val);
    else if (val === "[]") val = "" as unknown as string;

    assign(cfg, section, key, val);
  }
  return cfg;
}

function assign(cfg: AmemConfig, section: string, key: string, val: unknown): void {
  const set = (obj: Record<string, unknown>, k: string) => {
    if (k in obj) obj[k] = val;
  };
  if (section === "identity") set(cfg.identity as unknown as Record<string, unknown>, key);
  else if (section === "llm") set(cfg.llm as unknown as Record<string, unknown>, key);
  else if (section === "embedding") set(cfg.embedding as unknown as Record<string, unknown>, key);
  else if (section === "recall") set(cfg.recall as unknown as Record<string, unknown>, key);
  else if (section === "promotion") set(cfg.promotion as unknown as Record<string, unknown>, key);
  else if (section === "budget.consolidate")
    set(cfg.budget.consolidate as unknown as Record<string, unknown>, key);
  else if (section === "privacy") {
    if (key === "redact_patterns" || key === "exclude_workspaces") return;
    set(cfg.privacy as unknown as Record<string, unknown>, key);
  }
}

export function loadConfig(home = amemHome()): AmemConfig {
  const p = paths(home).config;
  if (!existsSync(p)) return defaultConfig();
  return parseSimpleToml(readFileSync(p, "utf8"));
}

export function escapeTomlString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

export function configToToml(cfg: AmemConfig): string {
  return `# amem config
[identity]
user_id = "${escapeTomlString(cfg.identity.user_id)}"

[llm]
base_url = "${escapeTomlString(cfg.llm.base_url)}"
model = "${escapeTomlString(cfg.llm.model)}"
api_key_env = "${escapeTomlString(cfg.llm.api_key_env)}"
mode = "${escapeTomlString(cfg.llm.mode)}"

[embedding]
enabled = ${cfg.embedding.enabled}
base_url = "${escapeTomlString(cfg.embedding.base_url)}"
model = "${escapeTomlString(cfg.embedding.model)}"
dim = ${cfg.embedding.dim}

[recall]
budget_tokens = ${cfg.recall.budget_tokens}
l0_items = ${cfg.recall.l0_items}
l1_items = ${cfg.recall.l1_items}

[promotion]
instance_to_domain_min_instances = ${cfg.promotion.instance_to_domain_min_instances}
domain_to_global_min_domains = ${cfg.promotion.domain_to_global_min_domains}
domain_to_global_min_instances = ${cfg.promotion.domain_to_global_min_instances}
global_min_lift = ${cfg.promotion.global_min_lift}

[budget.consolidate]
max_llm_calls = ${cfg.budget.consolidate.max_llm_calls}
max_tokens = ${cfg.budget.consolidate.max_tokens}
max_proposals = ${cfg.budget.consolidate.max_proposals}
max_minutes = ${cfg.budget.consolidate.max_minutes}

[privacy]
redact_patterns = []
exclude_workspaces = []
`;
}

const DANGEROUS_CHARS = /["\\\n\r]/;
const LLM_MODES = ["stub", "external", "host"] as const;
const PRIVACY_SECTION_RE = /^\[privacy\]\s*\n(?:.*(?:\n|$))*?(?=^\[|$)/m;

export type EditableConfigPatch = {
  identity?: { user_id?: string };
  llm?: {
    mode?: AmemConfig["llm"]["mode"];
    base_url?: string;
    model?: string;
    api_key_env?: string;
  };
  recall?: Partial<AmemConfig["recall"]>;
  promotion?: Partial<AmemConfig["promotion"]>;
  budget?: { consolidate?: Partial<AmemConfig["budget"]["consolidate"]> };
};

function looksLikeSecret(name: string): boolean {
  const t = name.trim();
  if (/^sk-[A-Za-z0-9_-]{16,}$/.test(t)) return true;
  if (t.length >= 40 && /^[A-Za-z0-9+/=_-]+$/.test(t)) return true;
  return false;
}

function rejectDangerous(label: string, s: string, allowEmpty: boolean): string | null {
  const t = s.trim();
  if (!allowEmpty && !t) return `${label} required`;
  if (DANGEROUS_CHARS.test(t)) return `${label} contains illegal characters`;
  return null;
}

function badField(message: string): { error: string; message: string } {
  return { error: "bad_request", message };
}

function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> | { error: string; message: string } {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return badField(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function copyStringField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): string | { error: string; message: string } | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "string") return badField(`${label} must be a string`);
  return v;
}

function copyIntField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): number | { error: string; message: string } | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "number") return badField(`${label} must be a number`);
  return v;
}

function copyFloatField(
  obj: Record<string, unknown>,
  key: string,
  label: string,
): number | { error: string; message: string } | undefined {
  if (!(key in obj)) return undefined;
  const v = obj[key];
  if (typeof v !== "number") return badField(`${label} must be a number`);
  return v;
}

export function extractEditableConfigPatch(
  input: unknown,
): EditableConfigPatch | { error: string; message: string } {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { error: "bad_request", message: "config object required" };
  }
  const root = input as Record<string, unknown>;
  const srcRaw =
    root.config != null && typeof root.config === "object" && !Array.isArray(root.config)
      ? root.config
      : input;
  if (typeof srcRaw !== "object" || srcRaw == null || Array.isArray(srcRaw)) {
    return { error: "bad_request", message: "config object required" };
  }
  const src = srcRaw as Record<string, unknown>;
  const patch: EditableConfigPatch = {};

  if ("identity" in src) {
    const identity = requireObject(src.identity, "identity");
    if ("error" in identity) return identity;
    const userId = copyStringField(identity, "user_id", "identity.user_id");
    if (userId != null && typeof userId === "object" && "error" in userId) return userId;
    if (userId !== undefined) {
      patch.identity = { user_id: userId as string };
    }
  }

  if ("llm" in src) {
    const llm = requireObject(src.llm, "llm");
    if ("error" in llm) return llm;
    const part: NonNullable<EditableConfigPatch["llm"]> = {};
    const mode = copyStringField(llm, "mode", "llm.mode");
    if (mode != null && typeof mode === "object" && "error" in mode) return mode;
    if (mode !== undefined) part.mode = mode as AmemConfig["llm"]["mode"];
    for (const [key, label] of [
      ["base_url", "llm.base_url"],
      ["model", "llm.model"],
      ["api_key_env", "llm.api_key_env"],
    ] as const) {
      const v = copyStringField(llm, key, label);
      if (v != null && typeof v === "object" && "error" in v) return v;
      if (v !== undefined) part[key] = v as string;
    }
    if (Object.keys(part).length > 0) patch.llm = part;
  }

  if ("recall" in src) {
    const recall = requireObject(src.recall, "recall");
    if ("error" in recall) return recall;
    const part: Partial<AmemConfig["recall"]> = {};
    for (const [key, label] of [
      ["budget_tokens", "recall.budget_tokens"],
      ["l0_items", "recall.l0_items"],
      ["l1_items", "recall.l1_items"],
    ] as const) {
      const v = copyIntField(recall, key, label);
      if (v != null && typeof v === "object" && "error" in v) return v;
      if (v !== undefined) part[key] = v as number;
    }
    if (Object.keys(part).length > 0) patch.recall = part;
  }

  if ("promotion" in src) {
    const promotion = requireObject(src.promotion, "promotion");
    if ("error" in promotion) return promotion;
    const part: Partial<AmemConfig["promotion"]> = {};
    for (const [key, label] of [
      ["instance_to_domain_min_instances", "promotion.instance_to_domain_min_instances"],
      ["domain_to_global_min_domains", "promotion.domain_to_global_min_domains"],
      ["domain_to_global_min_instances", "promotion.domain_to_global_min_instances"],
    ] as const) {
      const v = copyIntField(promotion, key, label);
      if (v != null && typeof v === "object" && "error" in v) return v;
      if (v !== undefined) part[key] = v as number;
    }
    const lift = copyFloatField(promotion, "global_min_lift", "promotion.global_min_lift");
    if (lift != null && typeof lift === "object" && "error" in lift) return lift;
    if (lift !== undefined) part.global_min_lift = lift as number;
    if (Object.keys(part).length > 0) patch.promotion = part;
  }

  if ("budget" in src) {
    const budget = requireObject(src.budget, "budget");
    if ("error" in budget) return budget;
    if ("consolidate" in budget) {
      const consolidate = requireObject(budget.consolidate, "budget.consolidate");
      if ("error" in consolidate) return consolidate;
      const part: Partial<AmemConfig["budget"]["consolidate"]> = {};
      for (const [key, label] of [
        ["max_llm_calls", "budget.consolidate.max_llm_calls"],
        ["max_tokens", "budget.consolidate.max_tokens"],
        ["max_proposals", "budget.consolidate.max_proposals"],
        ["max_minutes", "budget.consolidate.max_minutes"],
      ] as const) {
        const v = copyIntField(consolidate, key, label);
        if (v != null && typeof v === "object" && "error" in v) return v;
        if (v !== undefined) part[key] = v as number;
      }
      if (Object.keys(part).length > 0) patch.budget = { consolidate: part };
    }
  }

  return patch;
}

function validateInt(label: string, n: number): string | null {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return `${label} must be a non-negative integer`;
  }
  return null;
}

function validateNonNegFloat(label: string, n: number): string | null {
  if (!Number.isFinite(n) || n < 0) return `${label} must be a non-negative number`;
  return null;
}

function validationFail(message: string): { ok: false; error: string; message: string } {
  return { ok: false, error: "bad_request", message };
}

export function validateEditableConfigPatch(
  patch: EditableConfigPatch,
): { ok: true } | { ok: false; error: string; message: string } {
  if (patch.identity?.user_id != null) {
    const err = rejectDangerous("user_id", patch.identity.user_id, false);
    if (err) return validationFail(err);
  }

  if (patch.llm) {
    if (patch.llm.mode != null && !LLM_MODES.includes(patch.llm.mode)) {
      return validationFail("llm.mode invalid");
    }
    if (patch.llm.base_url != null) {
      const err = rejectDangerous("base_url", patch.llm.base_url, true);
      if (err) return validationFail(err);
    }
    if (patch.llm.model != null) {
      const err = rejectDangerous("model", patch.llm.model, true);
      if (err) return validationFail(err);
    }
    if (patch.llm.api_key_env != null) {
      const err = rejectDangerous("api_key_env", patch.llm.api_key_env, false);
      if (err) return validationFail(err);
      if (looksLikeSecret(patch.llm.api_key_env)) {
        return validationFail("api_key_env must be an environment variable name, not a secret value");
      }
    }
  }

  if (patch.recall) {
    for (const [key, label] of [
      ["budget_tokens", "recall.budget_tokens"],
      ["l0_items", "recall.l0_items"],
      ["l1_items", "recall.l1_items"],
    ] as const) {
      const v = patch.recall[key];
      if (v != null) {
        const err = validateInt(label, v);
        if (err) return validationFail(err);
      }
    }
  }

  if (patch.promotion) {
    for (const [key, label] of [
      ["instance_to_domain_min_instances", "promotion.instance_to_domain_min_instances"],
      ["domain_to_global_min_domains", "promotion.domain_to_global_min_domains"],
      ["domain_to_global_min_instances", "promotion.domain_to_global_min_instances"],
    ] as const) {
      const v = patch.promotion[key];
      if (v != null) {
        const err = validateInt(label, v);
        if (err) return validationFail(err);
      }
    }
    if (patch.promotion.global_min_lift != null) {
      const err = validateNonNegFloat(
        "promotion.global_min_lift",
        patch.promotion.global_min_lift,
      );
      if (err) return validationFail(err);
    }
  }

  if (patch.budget?.consolidate) {
    for (const [key, label] of [
      ["max_llm_calls", "budget.consolidate.max_llm_calls"],
      ["max_tokens", "budget.consolidate.max_tokens"],
      ["max_proposals", "budget.consolidate.max_proposals"],
      ["max_minutes", "budget.consolidate.max_minutes"],
    ] as const) {
      const v = patch.budget.consolidate[key];
      if (v != null) {
        const err = validateInt(label, v);
        if (err) return validationFail(err);
      }
    }
  }

  return { ok: true };
}

export function mergeConfigOverlay(base: AmemConfig, patch: EditableConfigPatch): AmemConfig {
  const out: AmemConfig = structuredClone(base);
  if (patch.identity?.user_id != null) out.identity.user_id = patch.identity.user_id.trim();
  if (patch.llm) {
    if (patch.llm.mode != null) out.llm.mode = patch.llm.mode;
    if (patch.llm.base_url != null) out.llm.base_url = patch.llm.base_url.trim();
    if (patch.llm.model != null) out.llm.model = patch.llm.model.trim();
    if (patch.llm.api_key_env != null) out.llm.api_key_env = patch.llm.api_key_env.trim();
  }
  if (patch.recall) Object.assign(out.recall, patch.recall);
  if (patch.promotion) Object.assign(out.promotion, patch.promotion);
  if (patch.budget?.consolidate) Object.assign(out.budget.consolidate, patch.budget.consolidate);
  return out;
}

export function preservePrivacyTomlSection(diskToml: string, generatedToml: string): string {
  const diskMatch = diskToml.match(PRIVACY_SECTION_RE);
  if (!diskMatch) return generatedToml;
  return generatedToml.replace(PRIVACY_SECTION_RE, diskMatch[0]!);
}

export function writeAmemConfigFile(
  home: string,
  cfg: AmemConfig,
  diskTomlForPrivacy?: string,
): void {
  const configPath = paths(home).config;
  const disk =
    diskTomlForPrivacy ??
    (existsSync(configPath) ? readFileSync(configPath, "utf8") : "");
  let text = configToToml(cfg);
  text = preservePrivacyTomlSection(disk, text);
  const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, "utf8");
  renameSync(tmp, configPath);
}
\n`\n\n### packages/core/src/config.test.ts (5636 chars)\n\n`	s\n// packages/core/src/config.test.ts
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configToToml,
  defaultConfig,
  escapeTomlString,
  extractEditableConfigPatch,
  loadConfig,
  mergeConfigOverlay,
  preservePrivacyTomlSection,
  validateEditableConfigPatch,
  writeAmemConfigFile,
} from "./config.js";

describe("escapeTomlString", () => {
  it("escapes quotes and backslashes", () => {
    expect(escapeTomlString('a"b\\c')).toBe('a\\"b\\\\c');
  });
});

describe("configToToml escape", () => {
  it("escapes user_id in output", () => {
    const cfg = defaultConfig();
    cfg.identity.user_id = 'x"y';
    expect(configToToml(cfg)).toContain('user_id = "x\\"y"');
  });
});

describe("validate + merge overlay", () => {
  it("rejects bad mode", () => {
    const r = validateEditableConfigPatch({
      llm: { mode: "nope" as "stub" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty user_id", () => {
    const r = validateEditableConfigPatch({ identity: { user_id: "  " } });
    expect(r.ok).toBe(false);
  });

  it("rejects api_key_env that looks like a secret", () => {
    const r = validateEditableConfigPatch({
      llm: { api_key_env: "sk-abcdefghijklmnopqrstuvwxyz012345" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects string injection chars", () => {
    const r = validateEditableConfigPatch({
      identity: { user_id: 'evil"inject' },
    });
    expect(r.ok).toBe(false);
  });

  it("merge keeps embedding from base", () => {
    const base = defaultConfig();
    base.embedding.enabled = true;
    base.embedding.model = "keep-me";
    const out = mergeConfigOverlay(base, {
      llm: { mode: "host", base_url: "", model: "", api_key_env: "AMEM_LLM_KEY" },
    });
    expect(out.embedding.model).toBe("keep-me");
    expect(out.llm.mode).toBe("host");
  });

  it("extract ignores embedding/privacy in body", () => {
    const patch = extractEditableConfigPatch({
      identity: { user_id: "u1" },
      llm: { mode: "stub", base_url: "", model: "m", api_key_env: "AMEM_LLM_KEY" },
      recall: { budget_tokens: 1, l0_items: 2, l1_items: 3 },
      promotion: {
        instance_to_domain_min_instances: 1,
        domain_to_global_min_domains: 1,
        domain_to_global_min_instances: 1,
        global_min_lift: 0.2,
      },
      budget: {
        consolidate: {
          max_llm_calls: 1,
          max_tokens: 2,
          max_proposals: 3,
          max_minutes: 4,
        },
      },
      embedding: { enabled: true, base_url: "x", model: "y", dim: 9 },
      privacy: { redact_patterns: ["SECRET"], exclude_workspaces: ["/tmp"] },
    });
    expect("error" in patch).toBe(false);
    if ("error" in patch) return;
    expect((patch as { embedding?: unknown }).embedding).toBeUndefined();
    expect((patch as { privacy?: unknown }).privacy).toBeUndefined();
  });
});

describe("preservePrivacyTomlSection", () => {
  it("keeps disk privacy block", () => {
    const disk = `# amem
[identity]
user_id = "a"

[privacy]
redact_patterns = ["foo"]
exclude_workspaces = ["/bar"]
`;
    const generated = configToToml(defaultConfig());
    const out = preservePrivacyTomlSection(disk, generated);
    expect(out).toContain('redact_patterns = ["foo"]');
    expect(out).toContain('exclude_workspaces = ["/bar"]');
  });

  it("keeps disk privacy block when last line has no trailing newline", () => {
    const disk = `# amem
[identity]
user_id = "a"

[privacy]
redact_patterns = ["foo"]
exclude_workspaces = ["/bar"]`;
    const generated = configToToml(defaultConfig());
    const out = preservePrivacyTomlSection(disk, generated);
    expect(out).toContain('redact_patterns = ["foo"]');
    expect(out).toContain('exclude_workspaces = ["/bar"]');
    expect(out).not.toMatch(/redact_patterns = \[\]\s*\n/);
  });
});

describe("writeAmemConfigFile round-trip privacy", () => {
  let home: string;
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("preserves privacy text after save", () => {
    home = mkdtempSync(join(tmpdir(), "amem-cfg-"));
    mkdirSync(home, { recursive: true });
    const initial = configToToml(defaultConfig()).replace(
      `[privacy]
redact_patterns = []
exclude_workspaces = []
`,
      `[privacy]
redact_patterns = ["TOKEN"]
exclude_workspaces = ["/ws"]
`,
    );
    writeFileSync(join(home, "amem.toml"), initial);
    const cfg = loadConfig(home);
    cfg.llm.mode = "host";
    writeAmemConfigFile(home, cfg, initial);
    const text = readFileSync(join(home, "amem.toml"), "utf8");
    expect(text).toContain('redact_patterns = ["TOKEN"]');
    expect(text).toContain('mode = "host"');
  });

  it("preserves privacy when disk block ends without trailing newline", () => {
    home = mkdtempSync(join(tmpdir(), "amem-cfg-"));
    mkdirSync(home, { recursive: true });
    const initial =
      configToToml(defaultConfig()).replace(
        `[privacy]
redact_patterns = []
exclude_workspaces = []
`,
        `[privacy]
redact_patterns = ["TOKEN"]
exclude_workspaces = ["/ws"]
`,
      ).replace(/\n$/, "");
    writeFileSync(join(home, "amem.toml"), initial);
    const cfg = loadConfig(home);
    cfg.llm.mode = "host";
    writeAmemConfigFile(home, cfg, initial);
    const text = readFileSync(join(home, "amem.toml"), "utf8");
    expect(text).toContain('redact_patterns = ["TOKEN"]');
    expect(text).toContain('exclude_workspaces = ["/ws"]');
    expect(text).toContain('mode = "host"');
  });
});
\n`\n\n### packages/adapter-dsh/src/admin.ts (7841 chars)\n\n`	s\nimport { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  amemHome as defaultAmemHome,
  extractEditableConfigPatch,
  loadConfig,
  mergeConfigOverlay,
  newId,
  paths,
  validateEditableConfigPatch,
  writeAmemConfigFile,
  type MemoryRecord,
} from "@amem/core";
import { IndexStore, MemoryStore } from "@amem/store";
import { buildContextPack, extractSituation, recall } from "@amem/retrieval";
import {
  compileCapabilities,
  listProposalsData,
  listSkillsData,
  materializeProposal,
} from "@amem/compiler";
import { consolidate, enqueueFlush, processQueue } from "@amem/pipeline";

export type AdminResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; message: string; status: number };

export function createAdmin(home = defaultAmemHome()) {
  const cfg = () => loadConfig(home);

  return {
    listMemories(limit = 50): AdminResult {
      const all = new MemoryStore(home).listAll();
      all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      return {
        ok: true,
        data: {
          total: all.length,
          items: all.slice(0, limit).map((m) => ({
            id: m.id,
            kind: m.kind,
            level: m.scope.level,
            trust: m.trust,
            status: m.status,
            title: m.title,
            helpful: m.stats.helpful,
            harmful: m.stats.harmful,
            updated_at: m.updated_at,
          })),
        },
      };
    },

    getMemory(id: string): AdminResult {
      const m = new MemoryStore(home).readById(id);
      if (!m) return { ok: false, error: "not_found", message: `memory ${id}`, status: 404 };
      return { ok: true, data: m };
    },

    recall(query: string, k?: number): AdminResult {
      const c = cfg();
      const sit = extractSituation({ query, userId: c.identity.user_id });
      const hits = recall(home, sit, k ?? c.recall.l0_items);
      const pack = buildContextPack({
        home,
        cfg: c,
        situation: sit,
        sessionId: "admin",
      });
      return {
        ok: true,
        data: {
          pack_id: pack.pack_id,
          hits: hits.map((h) => ({
            id: h.memory.id,
            title: h.memory.title,
            score: h.score,
            status: h.memory.status,
            content: h.memory.content.slice(0, 300),
          })),
        },
      };
    },

    note(args: {
      kind: MemoryRecord["kind"];
      title: string;
      content: string;
      applies_when: string;
      evidence_hint?: string;
    }): AdminResult {
      const c = cfg();
      const store = new MemoryStore(home);
      const id = newId("mem");
      const rec: MemoryRecord = {
        id,
        kind: args.kind,
        title: args.title,
        content: args.content,
        applies_when: args.applies_when,
        scope: { level: "instance", tags: { user: c.identity.user_id } },
        trust: "T3",
        status: "candidate",
        evidence: {
          episodes: [],
          quotes: args.evidence_hint
            ? [{ ep: "admin-note", text: args.evidence_hint }]
            : [],
          count: 0,
          distinct_instances: 1,
          distinct_domains: 1,
        },
        stats: { recalled: 0, adopted: 0, helpful: 0, harmful: 0, lift: 0 },
        validity: {
          depends_on: [],
          valid_from: new Date().toISOString().slice(0, 10),
        },
        created_by: "admin-ui",
        updated_at: new Date().toISOString(),
      };
      store.write(rec, "human");
      const idx = new IndexStore(home);
      idx.rebuild(store);
      idx.close();
      return { ok: true, data: { id, status: rec.status } };
    },

    forget(id: string): AdminResult {
      const ok = new MemoryStore(home).forget(id);
      if (!ok) return { ok: false, error: "not_found", message: `memory ${id}`, status: 404 };
      return { ok: true, data: { forgotten: id } };
    },

    listSkills(): AdminResult {
      return { ok: true, data: { items: listSkillsData(home) } };
    },

    listProposals(): AdminResult {
      return { ok: true, data: { items: listProposalsData(home) } };
    },

    applyProposal(id: string, skillName: string): AdminResult {
      try {
        const dest = materializeProposal(home, id, skillName);
        return { ok: true, data: { dest } };
      } catch (e) {
        return {
          ok: false,
          error: "apply_failed",
          message: e instanceof Error ? e.message : String(e),
          status: 400,
        };
      }
    },

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
      const sid =
        sessionId == null || !String(sessionId).trim() ? "manual" : String(sessionId).trim();
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(sid)) {
        return { ok: false, error: "bad_request", message: "invalid sessionId", status: 400 };
      }
      const file = enqueueFlush(home, sid);
      const n = await processQueue(home);
      return { ok: true, data: { queued: file, processed: n } };
    },

    rebuildIndex(): AdminResult {
      const idx = new IndexStore(home);
      const n = idx.rebuild(new MemoryStore(home));
      idx.close();
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

    getConfig(): AdminResult {
      const configPath = paths(home).config;
      return {
        ok: true,
        data: { path: configPath, config: loadConfig(home) },
      };
    },

    putConfig(body: unknown): AdminResult {
      try {
        const extracted = extractEditableConfigPatch(body);
        if ("error" in extracted) {
          return { ok: false, error: extracted.error, message: extracted.message, status: 400 };
        }
        const validated = validateEditableConfigPatch(extracted);
        if (!validated.ok) {
          return {
            ok: false,
            error: validated.error,
            message: validated.message,
            status: 400,
          };
        }
        const base = loadConfig(home);
        const merged = mergeConfigOverlay(base, extracted);
        merged.embedding = base.embedding;
        merged.privacy = base.privacy;
        const configPath = paths(home).config;
        const disk = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
        writeAmemConfigFile(home, merged, disk);
        return { ok: true, data: { path: configPath, saved: true } };
      } catch (e) {
        return {
          ok: false,
          error: "internal",
          message: e instanceof Error ? e.message : String(e),
          status: 500,
        };
      }
    },
  };
}

export type AmemAdmin = ReturnType<typeof createAdmin>;
\n`\n\n### packages/adapter-dsh/src/admin-config.test.ts (2963 chars)\n\n`	s\nimport { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configToToml, defaultConfig, loadConfig } from "@amem/core";
import { createAdmin } from "./admin.js";

describe("admin config", () => {
  let home: string;
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function setup(extra?: (toml: string) => string): string {
    home = mkdtempSync(join(tmpdir(), "amem-admin-cfg-"));
    mkdirSync(home, { recursive: true });
    let toml = configToToml(defaultConfig());
    if (extra) toml = extra(toml);
    writeFileSync(join(home, "amem.toml"), toml);
    return home;
  }

  it("getConfig returns path and config", () => {
    const h = setup();
    const r = createAdmin(h).getConfig();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as { path: string; config: { llm: { mode: string } } };
    expect(data.path).toContain("amem.toml");
    expect(data.config.llm.mode).toBe("stub");
  });

  it("putConfig changes mode and keeps embedding", () => {
    const h = setup();
    const cfg = defaultConfig();
    cfg.embedding.enabled = true;
    cfg.embedding.model = "emb-keep";
    writeFileSync(join(h, "amem.toml"), configToToml(cfg));

    const before = loadConfig(h);
    expect(before.embedding.model).toBe("emb-keep");

    const body = {
      config: {
        ...before,
        llm: { ...before.llm, mode: "host" as const },
      },
    };
    const r = createAdmin(h).putConfig(body);
    expect(r.ok).toBe(true);
    const after = loadConfig(h);
    expect(after.llm.mode).toBe("host");
    expect(after.embedding.model).toBe("emb-keep");
  });

  it("putConfig rejects bad mode with 400", () => {
    const h = setup();
    const r = createAdmin(h).putConfig({
      config: { ...loadConfig(h), llm: { ...loadConfig(h).llm, mode: "nope" } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
  });

  it("putConfig preserves privacy section text", () => {
    const h = setup((t) =>
      t.replace(
        `[privacy]
redact_patterns = []
exclude_workspaces = []
`,
        `[privacy]
redact_patterns = ["KEEP"]
exclude_workspaces = ["/x"]
`,
      ),
    );
    const cfg = loadConfig(h);
    const r = createAdmin(h).putConfig({
      config: { ...cfg, llm: { ...cfg.llm, mode: "external" } },
    });
    expect(r.ok).toBe(true);
    const text = readFileSync(join(h, "amem.toml"), "utf8");
    expect(text).toContain('redact_patterns = ["KEEP"]');
  });

  it("putConfig accepts top-level AmemConfig without wrapper", () => {
    const h = setup();
    const cfg = loadConfig(h);
    const r = createAdmin(h).putConfig({
      ...cfg,
      llm: { ...cfg.llm, mode: "host" },
    });
    expect(r.ok).toBe(true);
    expect(loadConfig(h).llm.mode).toBe("host");
  });
});
\n`\n\n### packages/adapter-dsh/src/plugin.ts (14220 chars)\n\n`	s\nimport type { IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAdmin } from "./admin.js";
import {
  normalizeDshLifecycle,
  normalizeDshSessionEvent,
  type DshSessionMeta,
} from "./normalize.js";
import { appendCanonical, enqueueFlush, wakeWorker } from "./spool.js";

/** Cordis Loader reads this from the host wrapper (re-exported). */
export const inject = ["webServer", "connection"];

/** Minimal duck-typed Cordis context — no @deepseek-ai compile dependency. */
export type DshPluginContext = {
  on?: (event: string, handler: (...args: unknown[]) => unknown) => unknown;
  /** Cordis optional service probe (works after inject has provided the service). */
  get?: (name: string) => unknown;
  /** Nested fiber that waits for named services (DSH Cordis). */
  inject?: (deps: string[], callback: (ctx: DshPluginContext) => void) => unknown;
  /** Track disposers for unload (e.g. webServer.register return value). */
  effect?: (fn: () => unknown, label?: string) => unknown;
  webServer?: WebServer;
  connection?: Connection;
};

function hostLog(home: string, msg: string): void {
  try {
    const dir = join(home, "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "dsh-host.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

export type AmemDshPluginConfig = {
  amemHome: string;
  userId?: string;
  cliPath?: string;
};

type SessionLike = {
  id?: string;
  header?: { cwd?: string };
};

function sessionMeta(session: SessionLike, userId: string): DshSessionMeta {
  const roots = session.header?.cwd ? [session.header.cwd] : [];
  return {
    session_id: String(session.id ?? "unknown"),
    workspace_roots: roots,
    user_id: userId,
  };
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    /* fail-open — never throw from session listeners */
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/**
 * Cordis Host plugin: session capture → spool + authenticated /amem-api.
 * Must not throw from session/created (DSH rolls back session on sync throw).
 */
export function apply(ctx: DshPluginContext, config?: Partial<AmemDshPluginConfig>): void {
  const home =
    config?.amemHome ??
    process.env.AMEM_HOME ??
    join(homedir(), ".amem");
  const userId =
    config?.userId ?? process.env.USERNAME ?? process.env.USER ?? "local";
  const cliPath = config?.cliPath;
  const admin = createAdmin(home);
  const ended = new Set<string>();

  if (typeof ctx.on === "function") {
    ctx.on("session/created", (session) => {
      safe(() => {
        const s = session as SessionLike;
        const meta = sessionMeta(s, userId);
        appendCanonical(home, meta.session_id, normalizeDshLifecycle("session_start", meta));
      });
    });

    ctx.on("session/event", (session, event) => {
      safe(() => {
        const s = session as SessionLike;
        const meta = sessionMeta(s, userId);
        const events = normalizeDshSessionEvent(event, meta);
        appendCanonical(home, meta.session_id, events);
        const ev = event as { type?: string };
        if (ev?.type === "turn/end") {
          enqueueFlush(home, meta.session_id);
          wakeWorker(home, cliPath);
        }
      });
    });

    ctx.on("session/disposed", (session) => {
      safe(() => {
        const s = session as SessionLike;
        const meta = sessionMeta(s, userId);
        if (!ended.has(meta.session_id)) {
          ended.add(meta.session_id);
          appendCanonical(home, meta.session_id, normalizeDshLifecycle("session_end", meta));
        }
        enqueueFlush(home, meta.session_id);
        wakeWorker(home, cliPath);
      });
    });
  }

  hostLog(
    home,
    `apply keys=${Object.keys(ctx as object).join(",")} hasInject=${typeof ctx.inject} hasGet=${typeof ctx.get} hasWS=${!!ctx.webServer} hasConn=${!!ctx.connection}`,
  );

  // Management API needs webServer + connection. Cordis only exposes them after
  // inject waits — probing ctx.get at apply time silently skips registration
  // (UI then sees SPA fallback "Not Found" while CLI list still works).
  // Prefer module/wrapper `export const inject` so apply runs only when ready.
  const mountApi = (apiCtx: DshPluginContext): void => {
    const webServer =
      apiCtx.webServer ??
      (typeof apiCtx.get === "function" ? (apiCtx.get("webServer") as WebServer | undefined) : undefined);
    const connection =
      apiCtx.connection ??
      (typeof apiCtx.get === "function" ? (apiCtx.get("connection") as Connection | undefined) : undefined);
    hostLog(
      home,
      `mountApi ws=${!!webServer?.register} conn=${!!connection} reject=${typeof connection?.requestRejection} admit=${typeof connection?.admit}`,
    );
    if (!webServer?.register) {
      hostLog(home, "mountApi abort: no webServer.register");
      return;
    }

    const checkAuth = (req: IncomingMessage): { status: number; message: string } | null => {
      if (typeof connection?.requestRejection === "function") {
        const rej = connection.requestRejection(req);
        if (rej === undefined) return null;
        return { status: rej, message: rej === 403 ? "forbidden" : "unauthorized" };
      }
      if (typeof connection?.admit === "function") {
        const admission = connection.admit(req);
        if (admission && typeof admission === "object" && "rejection" in admission) {
          const rej = (admission as { rejection: number | { status?: number; message?: string } })
            .rejection;
          if (typeof rej === "number") {
            return { status: rej, message: rej === 403 ? "forbidden" : "unauthorized" };
          }
          return {
            status: rej.status ?? 401,
            message: rej.message ?? "admit rejected",
          };
        }
        return null;
      }
      return { status: 401, message: "connection auth unavailable" };
    };
    const route = {
      kind: "prefix" as const,
      path: "/amem-api",
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const denied = checkAuth(req);
          if (denied) {
            sendJson(res, denied.status, { error: "unauthorized", message: denied.message });
            return;
          }

          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          const path = url.pathname.replace(/^\/amem-api/, "") || "/";
          const method = (req.method ?? "GET").toUpperCase();

          if (method === "GET" && path === "/memories") {
            const limit = Number(url.searchParams.get("limit") ?? 50);
            const r = admin.listMemories(Number.isFinite(limit) ? limit : 50);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          const memMatch = path.match(/^\/memories\/([^/]+)$/);
          if (method === "GET" && memMatch) {
            const r = admin.getMemory(decodeURIComponent(memMatch[1]!));
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }
          if (method === "DELETE" && memMatch) {
            const r = admin.forget(decodeURIComponent(memMatch[1]!));
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/recall") {
            const body = JSON.parse((await readBody(req)) || "{}") as {
              query?: string;
              k?: number;
            };
            if (!body.query) {
              sendJson(res, 400, { error: "bad_request", message: "query required" });
              return;
            }
            const r = admin.recall(body.query, body.k);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/notes") {
            const body = JSON.parse((await readBody(req)) || "{}") as {
              kind?: MemoryRecordKind;
              title?: string;
              content?: string;
              applies_when?: string;
              evidence_hint?: string;
            };
            if (!body.kind || !body.title || !body.content || !body.applies_when) {
              sendJson(res, 400, {
                error: "bad_request",
                message: "kind, title, content, applies_when required",
              });
              return;
            }
            const r = admin.note({
              kind: body.kind,
              title: body.title,
              content: body.content,
              applies_when: body.applies_when,
              evidence_hint: body.evidence_hint,
            });
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "GET" && path === "/skills") {
            const r = admin.listSkills();
            sendJson(res, 200, r.ok ? r.data : r);
            return;
          }

          if (method === "GET" && path === "/proposals") {
            const r = admin.listProposals();
            sendJson(res, 200, r.ok ? r.data : r);
            return;
          }

          const applyMatch = path.match(/^\/proposals\/([^/]+)\/apply$/);
          if (method === "POST" && applyMatch) {
            const body = JSON.parse((await readBody(req)) || "{}") as { skillName?: string };
            if (!body.skillName) {
              sendJson(res, 400, { error: "bad_request", message: "skillName required" });
              return;
            }
            const r = admin.applyProposal(decodeURIComponent(applyMatch[1]!), body.skillName);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

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
            const r = admin.consolidate(body.dryRun === true);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "POST" && path === "/compile") {
            const body = JSON.parse((await readBody(req)) || "{}") as { target?: string };
            const r = admin.compile(body.target);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "GET" && path === "/config") {
            const r = admin.getConfig();
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          if (method === "PUT" && path === "/config") {
            let body: unknown;
            try {
              body = JSON.parse((await readBody(req)) || "{}");
            } catch {
              sendJson(res, 400, { error: "bad_request", message: "invalid JSON" });
              return;
            }
            const r = admin.putConfig(body);
            sendJson(res, r.ok ? 200 : r.status, r.ok ? r.data : r);
            return;
          }

          sendJson(res, 404, { error: "not_found", message: path });
        } catch (e) {
          sendJson(res, 500, {
            error: "internal",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      },
    };

    try {
      const run = () => webServer.register(route);
      if (typeof apiCtx.effect === "function") {
        apiCtx.effect(run, "amem: /amem-api");
      } else {
        run();
      }
      hostLog(home, "mountApi registered /amem-api");
    } catch (e) {
      hostLog(home, `mountApi register failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // If the Loader already honored export const inject, services are on ctx now.
  if (ctx.webServer?.register || (typeof ctx.get === "function" && ctx.get("webServer"))) {
    mountApi(ctx);
  } else if (typeof ctx.inject === "function") {
    hostLog(home, "defer mountApi via ctx.inject");
    ctx.inject(["webServer", "connection"], mountApi);
  } else {
    hostLog(home, "mountApi immediate fallback (no inject)");
    mountApi(ctx);
  }
}

type WebServer = {
  register: (route: {
    kind: "exact" | "prefix";
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }) => () => void;
};

type Connection = {
  /** Current DSH Connection API — prefer this over legacy admit. */
  requestRejection?: (req: IncomingMessage) => 401 | 403 | undefined;
  /** Older harness builds exposed admit(); keep as fallback. */
  admit?: (req: IncomingMessage) =>
    | { rejection: number | { status?: number; message?: string } }
    | Record<string, unknown>;
};

type MemoryRecordKind =
  | "fact"
  | "case"
  | "failure"
  | "procedure"
  | "tool_quirk"
  | "strategy"
  | "criterion"
  | "constraint_hint"
  | "preference"
  | "open_question";

export const name = "amem-dsh-host";
\n`\n\n### packages/amem-dsh-ui/client/locales.ts (7330 chars)\n\n`	s\n/** `amem` namespace dictionaries — both locales required by DSH locale.register. */

export const NS = "amem";

/** Simplified Chinese (key-set source of truth). */
export const zh = {
  panel: "amem",
  title: "amem",
  "tab.memories": "记忆",
  "tab.skills": "能力",
  "tab.proposals": "提案",
  "tab.ops": "运维",
  "tab.config": "配置",
  "tab.help": "说明",
  "config.reload": "重新加载",
  "config.save": "保存",
  "config.confirmSave":
    "确认写入 amem.toml？未在表单中展示的段（embedding/privacy）将保留磁盘原值。",
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
  "config.field.instance_to_domain_min_instances":
    "instance_to_domain_min_instances",
  "config.field.domain_to_global_min_domains": "domain_to_global_min_domains",
  "config.field.domain_to_global_min_instances":
    "domain_to_global_min_instances",
  "config.field.global_min_lift": "global_min_lift",
  "config.field.max_llm_calls": "max_llm_calls",
  "config.field.max_tokens": "max_tokens",
  "config.field.max_proposals": "max_proposals",
  "config.field.max_minutes": "max_minutes",
  "config.hintSecrets":
    "密钥只通过环境变量注入；此处只填变量名（api_key_env），不要粘贴真实 Key。",
  "config.hintReload":
    "保存后新请求会重新读盘；若长期 worker 已缓存配置，可能需重启 dsh web。",
  "config.hintPrivacy":
    "privacy / embedding 请用手改 amem.toml；面板保存不会覆盖磁盘上的这些段。",
  "recall.placeholder": "召回查询",
  "recall.button": "召回",
  "refresh.button": "刷新",
  loading: "加载中…",
  "forget.button": "遗忘",
  "forget.confirm": "遗忘记忆 {id}？",
  "apply.button": "应用",
  "apply.prompt": "要物化的能力名称？",
  "meta.score": "分={score}",
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
  "help.layersBody":
    "记忆(L2) → 提案(候选) → 能力(L3 Skill)。自动流程只写记忆与提案；能力必须人工「应用」提案后才会入库。",
  "help.flowTitle": "推荐流程",
  "help.flowBody":
    "1) 会话中沉淀可复用步骤（memory_note / 自动抽取） 2) 跨会话 recall + helpful 反馈 3) 运维「整合」生成提案 4) 提案 Tab「应用」入库 5) 运维「编译到 DSH」写入 ~/.dsh/skills。",
  "help.tabsTitle": "各 Tab",
  "help.tabsBody":
    "记忆：浏览/召回/遗忘。能力：已入库 Skill 列表。提案：候选与应用。运维：doctor/flush/索引/整合/编译。配置：常用 amem.toml。说明：本页。",
  "help.cliTitle": "与 CLI 对照",
  "help.cliBody":
    "健康检查=amem doctor；冲洗队列=amem flush；重建索引=amem rebuild-index；整合=amem consolidate；编译到 DSH=amem compile --target dsh（注意：CLI 默认 target 是 cursor，面板固定 dsh）。",
  "help.gateTitle": "晋升门槛",
  "help.gateBody":
    "自动出提案通常需要 procedure + 足够多实例/helpful。本地打通可用 CLI 加速路径（手改 frontmatter），见仓库 README。",
} as const;

export type AmemKey = keyof typeof zh;

/** English dictionary, complete against the zh key set. */
export const en: Record<AmemKey, string> = {
  panel: "amem",
  title: "amem",
  "tab.memories": "Memories",
  "tab.skills": "Skills",
  "tab.proposals": "Proposals",
  "tab.ops": "Ops",
  "tab.config": "Config",
  "tab.help": "Guide",
  "config.reload": "Reload",
  "config.save": "Save",
  "config.confirmSave":
    "Confirm writing amem.toml? Sections not shown in the form (embedding/privacy) keep their on-disk values.",
  "config.saved": "Saved: {path}",
  "config.section.identity": "Identity",
  "config.section.llm": "LLM",
  "config.section.recall": "Recall",
  "config.section.promotion": "Promotion",
  "config.section.budget": "Consolidate budget",
  "config.field.user_id": "user_id",
  "config.field.mode": "mode",
  "config.field.base_url": "base_url",
  "config.field.model": "model",
  "config.field.api_key_env": "api_key_env",
  "config.field.budget_tokens": "budget_tokens",
  "config.field.l0_items": "l0_items",
  "config.field.l1_items": "l1_items",
  "config.field.instance_to_domain_min_instances":
    "instance_to_domain_min_instances",
  "config.field.domain_to_global_min_domains": "domain_to_global_min_domains",
  "config.field.domain_to_global_min_instances":
    "domain_to_global_min_instances",
  "config.field.global_min_lift": "global_min_lift",
  "config.field.max_llm_calls": "max_llm_calls",
  "config.field.max_tokens": "max_tokens",
  "config.field.max_proposals": "max_proposals",
  "config.field.max_minutes": "max_minutes",
  "config.hintSecrets":
    "Secrets are injected only via environment variables; fill the variable name (api_key_env) here, never paste a real key.",
  "config.hintReload":
    "New requests re-read disk after save; long-lived workers that cached config may need a dsh web restart.",
  "config.hintPrivacy":
    "Edit privacy / embedding manually in amem.toml; panel saves do not overwrite those on-disk sections.",
  "recall.placeholder": "recall query",
  "recall.button": "Recall",
  "refresh.button": "Refresh",
  loading: "Loading…",
  "forget.button": "Forget",
  "forget.confirm": "Forget memory {id}?",
  "apply.button": "Apply",
  "apply.prompt": "Skill name to materialize?",
  "meta.score": "score={score}",
  "ops.sessionPlaceholder": "sessionId (empty = manual)",
  "ops.doctor": "Doctor",
  "ops.flush": "Flush queue",
  "ops.rebuild": "Rebuild index",
  "ops.consolidateDry": "Consolidate (dry run)",
  "ops.consolidate": "Consolidate (run)",
  "ops.compile": "Compile to DSH",
  "ops.confirmConsolidate":
    "Confirm consolidate? May promote/demote memories and create proposals.",
  "ops.confirmRebuild": "Confirm rebuild index?",
  "ops.confirmCompile": "Confirm compile skills to ~/.dsh/skills?",
  "ops.result": "Result",
  "ops.hintProcessedZero":
    "When processed is 0, the queue may be empty or extraction failed.",
  "help.layersTitle": "Three-layer model",
  "help.layersBody":
    "Memory (L2) → Proposals (candidates) → Skills (L3). Automation writes memories and proposals only; skills enter the library after you Apply a proposal.",
  "help.flowTitle": "Recommended flow",
  "help.flowBody":
    "1) Capture reusable steps in session (memory_note / auto-extract) 2) Cross-session recall + helpful feedback 3) Ops Consolidate to create proposals 4) Proposals tab Apply to library 5) Ops Compile to DSH writes ~/.dsh/skills.",
  "help.tabsTitle": "Tabs",
  "help.tabsBody":
    "Memories: browse/recall/forget. Skills: library list. Proposals: candidates and apply. Ops: doctor/flush/index/consolidate/compile. Config: common amem.toml. Guide: this page.",
  "help.cliTitle": "CLI reference",
  "help.cliBody":
    "Doctor=amem doctor; flush queue=amem flush; rebuild index=amem rebuild-index; consolidate=amem consolidate; compile to DSH=amem compile --target dsh (CLI default target is cursor; panel uses dsh).",
  "help.gateTitle": "Promotion gate",
  "help.gateBody":
    "Auto proposals usually need procedure plus enough instances/helpful. For local end-to-end, use CLI shortcuts (edit frontmatter); see repo README.",
};
\n`\n\n### packages/amem-dsh-ui/client/panel.tsx (24726 chars)\n\n`	s\n/**
 * Browser panel source — bundled into lazy-CJS by scripts/build-client.mjs.
 * Uses createElement so tsc of host stays independent of this file.
 * Copy follows DSH locale: register zh/en, read framework-injected `t` seat.
 */
import { createElement, useCallback, useEffect, useState } from "react";
import { NS, en, zh, type AmemKey } from "./locales.js";

const PANEL_ID = "amem";

type Tab = "memories" | "skills" | "proposals" | "ops" | "config" | "help";
type ListTab = "memories" | "skills" | "proposals";

function isListTab(t: Tab): t is ListTab {
  return t === "memories" || t === "skills" || t === "proposals";
}

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

/** DSH TranslateNS — params replace `{name}` placeholders when provided. */
type Translate = (key: AmemKey | string, params?: Record<string, string | number>) => string;

type AmemPanelProps = {
  /** Framework-injected locale seat when registered with `locale: NS`. */
  t?: Translate;
};

function format(t: Translate, key: AmemKey, params?: Record<string, string | number>): string {
  const raw = t(key, params);
  if (!params) return raw;
  // Fallback if the seat returns the template without substituting.
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] != null ? String(params[name]) : `{${name}}`,
  );
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/amem-api${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message ?? res.statusText);
  return body;
}

function AmemPanel({ t: translate }: AmemPanelProps) {
  const t: Translate = translate ?? ((k) => k);
  const [tab, setTab] = useState<Tab>("memories");
  const [items, setItems] = useState<unknown[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsResult, setOpsResult] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [configBusy, setConfigBusy] = useState(false);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [config, setConfig] = useState<AmemConfigState | null>(null);
  const [configMsg, setConfigMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isListTab(tab)) return;
    setBusy(true);
    setError(null);
    try {
      if (tab === "memories") {
        const data = (await api("/memories?limit=100")) as { items?: unknown[] };
        setItems(data.items ?? []);
      } else if (tab === "skills") {
        const data = (await api("/skills")) as { items?: unknown[] };
        setItems(data.items ?? []);
      } else {
        const data = (await api("/proposals")) as { items?: unknown[] };
        setItems(data.items ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setBusy(false);
    }
  }, [tab]);

  useEffect(() => {
    if (!isListTab(tab)) return;
    void load();
  }, [load, tab]);

  const runOps = async (path: string, init?: RequestInit): Promise<boolean> => {
    setOpsBusy(true);
    setError(null);
    setOpsResult(null);
    try {
      const data = await api(path, init);
      setOpsResult(JSON.stringify(data, null, 2));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setOpsBusy(false);
    }
  };

  const loadConfigTab = useCallback(async () => {
    setConfigBusy(true);
    setError(null);
    setConfigMsg(null);
    try {
      const data = (await api("/config")) as {
        path?: string;
        config?: AmemConfigState;
      };
      setConfigPath(data.path ?? null);
      setConfig(data.config ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfigBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "config") return;
    void loadConfigTab();
  }, [tab, loadConfigTab]);

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
      setConfigMsg(
        format(t, "config.saved", { path: data.path ?? configPath ?? "" }),
      );
      await loadConfigTab();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConfigBusy(false);
    }
  };

  const onRecall = async () => {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const data = (await api("/recall", {
        method: "POST",
        body: JSON.stringify({ query }),
      })) as { hits?: unknown[] };
      setItems(data.hits ?? []);
      setTab("memories");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onForget = async (id: string) => {
    if (!confirm(format(t, "forget.confirm", { id }))) return;
    await api(`/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  };

  const onApply = async (id: string) => {
    const skillName = prompt(format(t, "apply.prompt"));
    if (!skillName) return;
    await api(`/proposals/${encodeURIComponent(id)}/apply`, {
      method: "POST",
      body: JSON.stringify({ skillName }),
    });
    setTab("skills");
    await load();
  };

  const tabLabel = (id: Tab): string => format(t, `tab.${id}` as AmemKey);

  const configField = (
    labelKey: AmemKey,
    input: ReturnType<typeof createElement>,
  ) =>
    createElement(
      "label",
      { style: { display: "flex", flexDirection: "column", gap: 4, flex: 1 } },
      createElement("span", { style: { fontSize: 12, opacity: 0.75 } }, format(t, labelKey)),
      input,
    );

  const configText = (
    value: string,
    onChange: (v: string) => void,
    opts: { type?: string; placeholder?: string } = {},
  ) =>
    createElement("input", {
      type: opts.type ?? "text",
      value,
      placeholder: opts.placeholder ?? "",
      disabled: configBusy,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      style: { padding: 6, fontFamily: "inherit", fontSize: 13 },
    });

  const configNumber = (
    value: number,
    onChange: (v: number) => void,
  ) =>
    createElement("input", {
      type: "number",
      value: Number.isFinite(value) ? value : 0,
      disabled: configBusy,
      onChange: (e: { target: { value: string } }) => {
        const n = Number(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      },
      style: { padding: 6, fontFamily: "inherit", fontSize: 13 },
    });

  const configSelect = (
    value: string,
    options: string[],
    onChange: (v: string) => void,
  ) =>
    createElement(
      "select",
      {
        value,
        disabled: configBusy,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
        style: { padding: 6, fontFamily: "inherit", fontSize: 13 },
      },
      ...options.map((opt) => createElement("option", { key: opt, value: opt }, opt)),
    );

  const configSection = (titleKey: AmemKey, ...children: ReturnType<typeof createElement>[]) =>
    createElement(
      "section",
      { style: { marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 } },
      createElement("h3", { style: { margin: "0 0 4px" } }, format(t, titleKey)),
      ...children,
    );

  const renderConfigForm = () => {
    if (!config) return null;
    const set = (patch: Partial<AmemConfigState>) =>
      setConfig((prev) => (prev ? { ...prev, ...patch } : prev));

    return createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: 12 } },
      configSection(
        "config.section.identity",
        createElement(
          "div",
          { style: { display: "flex", gap: 8 } },
          configField(
            "config.field.user_id",
            configText(config.identity.user_id, (v) =>
              set({ identity: { ...config.identity, user_id: v } }),
            ),
          ),
        ),
      ),
      configSection(
        "config.section.llm",
        createElement(
          "div",
          { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          configField(
            "config.field.mode",
            configSelect(config.llm.mode, ["stub", "external", "host"], (v) =>
              set({ llm: { ...config.llm, mode: v } }),
            ),
          ),
          configField(
            "config.field.base_url",
            configText(config.llm.base_url, (v) =>
              set({ llm: { ...config.llm, base_url: v } }),
            ),
          ),
          configField(
            "config.field.model",
            configText(config.llm.model, (v) =>
              set({ llm: { ...config.llm, model: v } }),
            ),
          ),
          configField(
            "config.field.api_key_env",
            configText(config.llm.api_key_env, (v) =>
              set({ llm: { ...config.llm, api_key_env: v } }),
            ),
          ),
        ),
      ),
      configSection(
        "config.section.recall",
        createElement(
          "div",
          { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          configField(
            "config.field.budget_tokens",
            configNumber(config.recall.budget_tokens, (v) =>
              set({ recall: { ...config.recall, budget_tokens: v } }),
            ),
          ),
          configField(
            "config.field.l0_items",
            configNumber(config.recall.l0_items, (v) =>
              set({ recall: { ...config.recall, l0_items: v } }),
            ),
          ),
          configField(
            "config.field.l1_items",
            configNumber(config.recall.l1_items, (v) =>
              set({ recall: { ...config.recall, l1_items: v } }),
            ),
          ),
        ),
      ),
      configSection(
        "config.section.promotion",
        createElement(
          "div",
          { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          configField(
            "config.field.instance_to_domain_min_instances",
            configNumber(
              config.promotion.instance_to_domain_min_instances,
              (v) =>
                set({
                  promotion: {
                    ...config.promotion,
                    instance_to_domain_min_instances: v,
                  },
                }),
            ),
          ),
          configField(
            "config.field.domain_to_global_min_domains",
            configNumber(
              config.promotion.domain_to_global_min_domains,
              (v) =>
                set({
                  promotion: {
                    ...config.promotion,
                    domain_to_global_min_domains: v,
                  },
                }),
            ),
          ),
          configField(
            "config.field.domain_to_global_min_instances",
            configNumber(
              config.promotion.domain_to_global_min_instances,
              (v) =>
                set({
                  promotion: {
                    ...config.promotion,
                    domain_to_global_min_instances: v,
                  },
                }),
            ),
          ),
          configField(
            "config.field.global_min_lift",
            configNumber(config.promotion.global_min_lift, (v) =>
              set({ promotion: { ...config.promotion, global_min_lift: v } }),
            ),
          ),
        ),
      ),
      configSection(
        "config.section.budget",
        createElement(
          "div",
          { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          configField(
            "config.field.max_llm_calls",
            configNumber(
              config.budget.consolidate.max_llm_calls,
              (v) =>
                set({
                  budget: {
                    consolidate: {
                      ...config.budget.consolidate,
                      max_llm_calls: v,
                    },
                  },
                }),
            ),
          ),
          configField(
            "config.field.max_tokens",
            configNumber(
              config.budget.consolidate.max_tokens,
              (v) =>
                set({
                  budget: {
                    consolidate: { ...config.budget.consolidate, max_tokens: v },
                  },
                }),
            ),
          ),
          configField(
            "config.field.max_proposals",
            configNumber(
              config.budget.consolidate.max_proposals,
              (v) =>
                set({
                  budget: {
                    consolidate: {
                      ...config.budget.consolidate,
                      max_proposals: v,
                    },
                  },
                }),
            ),
          ),
          configField(
            "config.field.max_minutes",
            configNumber(
              config.budget.consolidate.max_minutes,
              (v) =>
                set({
                  budget: {
                    consolidate: {
                      ...config.budget.consolidate,
                      max_minutes: v,
                    },
                  },
                }),
            ),
          ),
        ),
      ),
    );
  };

  const helpSections: { title: AmemKey; body: AmemKey }[] = [
    { title: "help.layersTitle", body: "help.layersBody" },
    { title: "help.flowTitle", body: "help.flowBody" },
    { title: "help.tabsTitle", body: "help.tabsBody" },
    { title: "help.cliTitle", body: "help.cliBody" },
    { title: "help.gateTitle", body: "help.gateBody" },
  ];

  const opsButton = (labelKey: AmemKey, onClick: () => void) =>
    createElement(
      "button",
      { type: "button", disabled: opsBusy, onClick: () => void onClick() },
      format(t, labelKey),
    );

  return createElement(
    "div",
    { style: { padding: 16, fontFamily: "system-ui, sans-serif", height: "100%", overflow: "auto" } },
    createElement("h2", { style: { marginTop: 0 } }, format(t, "title")),
    createElement(
      "div",
      { style: { display: "flex", gap: 8, marginBottom: 12 } },
      (["memories", "skills", "proposals", "ops", "config", "help"] as Tab[]).map((tabId) =>
        createElement(
          "button",
          {
            key: tabId,
            type: "button",
            onClick: () => {
              setError(null);
              setTab(tabId);
            },
            style: {
              fontWeight: tab === tabId ? 700 : 400,
              padding: "4px 10px",
            },
          },
          tabLabel(tabId),
        ),
      ),
    ),
    tab === "memories" &&
      createElement(
        "div",
        { style: { display: "flex", gap: 8, marginBottom: 12 } },
        createElement("input", {
          value: query,
          onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
          placeholder: format(t, "recall.placeholder"),
          style: { flex: 1, padding: 6 },
        }),
        createElement(
          "button",
          { type: "button", onClick: () => void onRecall() },
          format(t, "recall.button"),
        ),
        createElement(
          "button",
          { type: "button", onClick: () => void load() },
          format(t, "refresh.button"),
        ),
      ),
    error && createElement("p", { style: { color: "crimson" } }, error),
    isListTab(tab) && busy && createElement("p", null, format(t, "loading")),
    tab === "ops" &&
      createElement(
        "div",
        null,
        createElement("input", {
          value: sessionId,
          onChange: (e: { target: { value: string } }) => setSessionId(e.target.value),
          placeholder: format(t, "ops.sessionPlaceholder"),
          disabled: opsBusy,
          style: { width: "100%", maxWidth: 480, padding: 6, marginBottom: 12, boxSizing: "border-box" },
        }),
        createElement(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 } },
          opsButton("ops.doctor", () => runOps("/doctor")),
          opsButton("ops.flush", () =>
            runOps("/flush", {
              method: "POST",
              body: JSON.stringify({ sessionId: sessionId.trim() || undefined }),
            }),
          ),
          opsButton("ops.rebuild", () => {
            if (!confirm(format(t, "ops.confirmRebuild"))) return;
            void runOps("/rebuild-index", { method: "POST", body: "{}" });
          }),
          opsButton("ops.consolidateDry", () =>
            runOps("/consolidate", {
              method: "POST",
              body: JSON.stringify({ dryRun: true }),
            }),
          ),
          opsButton("ops.consolidate", () => {
            if (!confirm(format(t, "ops.confirmConsolidate"))) return;
            void (async () => {
              const ok = await runOps("/consolidate", {
                method: "POST",
                body: JSON.stringify({ dryRun: false }),
              });
              if (ok) setTab("proposals");
            })();
          }),
          opsButton("ops.compile", () => {
            if (!confirm(format(t, "ops.confirmCompile"))) return;
            void runOps("/compile", {
              method: "POST",
              body: JSON.stringify({ target: "dsh" }),
            });
          }),
        ),
        createElement("p", { style: { fontSize: 12, opacity: 0.85 } }, format(t, "ops.hintProcessedZero")),
        opsBusy && createElement("p", null, format(t, "loading")),
        opsResult != null &&
          createElement(
            "div",
            { style: { marginTop: 12 } },
            createElement("strong", null, format(t, "ops.result")),
            createElement(
              "pre",
              {
                style: {
                  background: "#f5f5f5",
                  padding: 12,
                  overflow: "auto",
                  fontSize: 12,
                  maxHeight: 360,
                },
              },
              opsResult,
            ),
          ),
      ),
    tab === "config" &&
      createElement(
        "div",
        null,
        createElement(
          "p",
          { style: { fontSize: 12, opacity: 0.85, marginBottom: 8 } },
          format(t, "config.hintSecrets"),
        ),
        createElement(
          "p",
          { style: { fontSize: 12, opacity: 0.85, marginBottom: 8 } },
          format(t, "config.hintPrivacy"),
        ),
        createElement(
          "p",
          { style: { fontSize: 12, opacity: 0.85, marginBottom: 12 } },
          format(t, "config.hintReload"),
        ),
        configPath != null &&
          createElement(
            "p",
            { style: { fontSize: 12, opacity: 0.7, marginBottom: 12 } },
            `${configPath}`,
          ),
        configBusy && createElement("p", null, format(t, "loading")),
        config && renderConfigForm(),
        configMsg != null &&
          createElement(
            "p",
            { style: { color: "green", marginTop: 12 } },
            configMsg,
          ),
        createElement(
          "div",
          { style: { display: "flex", gap: 8, marginTop: 12 } },
          createElement(
            "button",
            {
              type: "button",
              disabled: configBusy,
              onClick: () => void loadConfigTab(),
            },
            format(t, "config.reload"),
          ),
          createElement(
            "button",
            {
              type: "button",
              disabled: configBusy || !config,
              onClick: () => void saveConfig(),
            },
            format(t, "config.save"),
          ),
        ),
      ),
    tab === "help" &&
      createElement(
        "div",
        null,
        helpSections.map(({ title, body }) =>
          createElement(
            "section",
            { key: title, style: { marginBottom: 16 } },
            createElement("h3", { style: { margin: "0 0 6px" } }, format(t, title)),
            createElement("p", { style: { margin: 0, lineHeight: 1.5 } }, format(t, body)),
          ),
        ),
      ),
    isListTab(tab) &&
      createElement(
      "ul",
      { style: { listStyle: "none", padding: 0 } },
      items.map((raw, i) => {
        const row = raw as Record<string, unknown>;
        const id = String(row.id ?? row.name ?? i);
        return createElement(
          "li",
          {
            key: id,
            style: {
              borderBottom: "1px solid #ddd",
              padding: "8px 0",
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
            },
          },
          createElement(
            "div",
            null,
            createElement("strong", null, String(row.title ?? row.name ?? id)),
            createElement(
              "div",
              { style: { fontSize: 12, opacity: 0.75 } },
              [
                row.kind,
                row.trust,
                row.status,
                row.version,
                row.score != null ? format(t, "meta.score", { score: String(row.score) }) : null,
              ]
                .filter(Boolean)
                .join(" · "),
            ),
            row.content != null &&
              createElement(
                "div",
                { style: { fontSize: 12, marginTop: 4 } },
                String(row.content).slice(0, 200),
              ),
          ),
          tab === "memories" &&
            row.id &&
            createElement(
              "button",
              { type: "button", onClick: () => void onForget(String(row.id)) },
              format(t, "forget.button"),
            ),
          tab === "proposals" &&
            createElement(
              "button",
              { type: "button", onClick: () => void onApply(String(row.id)) },
              format(t, "apply.button"),
            ),
        );
      }),
    ),
  );
}

function PanelIcon() {
  return createElement(
    "span",
    { title: "amem", style: { fontSize: 12, fontWeight: 700 } },
    "amem",
  );
}

type SlotsCtx = {
  slots: {
    inject: (name: string, factory: () => unknown) => unknown;
    register: (opts: Record<string, unknown>, component: unknown) => unknown;
  };
  locale?: {
    register: (ns: string, dict: Record<string, Record<string, string>>) => unknown;
    bind: (ns: string) => Translate;
  };
  effect?: (fn: () => unknown, label?: string) => unknown;
};

export const inject = ["slots", "locale", "layout"];

export function apply(ctx: SlotsCtx): void {
  const effect = ctx.effect ?? ((fn: () => unknown) => fn());
  effect(
    () =>
      ctx.locale?.register(NS, {
        en: { ...en },
        zh: { ...zh },
      }),
    "amem-dsh-ui: dictionaries",
  );
  const t = ctx.locale?.bind(NS) ?? ((k: string) => k);

  effect(() =>
    ctx.slots.inject("main", function* () {
      yield ctx.slots.register(
        { name: "main", key: PANEL_ID, locale: NS },
        AmemPanel,
      );
    }),
  );

  effect(() =>
    ctx.slots.inject("sidebar.panellist", () =>
      ctx.slots.register(
        {
          name: "sidebar.panellist",
          id: PANEL_ID,
          order: 80,
          label: () => t("panel"),
          locale: NS,
        },
        PanelIcon,
      ),
    ),
  );
}

export { PANEL_ID, AmemPanel, NS };
\n`\n\n### packages\adapter-dsh\src\plugin.test.ts (6765 chars)\n\n`	s\nimport { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configToToml, defaultConfig } from "@amem/core";
import { apply, type DshPluginContext } from "./plugin.js";

type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

function mockReq(method: string, url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  queueMicrotask(() => {
    if (body) req.emit("data", Buffer.from(body, "utf8"));
    req.emit("end");
  });
  return req;
}

function mockRes(): {
  res: ServerResponse;
  status: () => number;
  json: () => unknown;
} {
  let statusCode = 200;
  let payload = "";
  const res = {
    writeHead(code: number) {
      statusCode = code;
    },
    end(data?: string) {
      payload = data ?? "";
    },
  } as ServerResponse;
  return {
    res,
    status: () => statusCode,
    json: () => (payload ? JSON.parse(payload) : null),
  };
}

function mountHandler(amemHome: string, connection: DshPluginContext["connection"]): ApiHandler {
  let handler: ApiHandler | undefined;
  const register = vi.fn((route: { handler: ApiHandler }) => {
    handler = route.handler;
    return () => {};
  });
  const ctx: DshPluginContext = {
    webServer: { register },
    connection,
  };
  apply(ctx, { amemHome });
  expect(handler).toBeDefined();
  return handler!;
}

const tempHomes: string[] = [];
afterEach(() => {
  for (const h of tempHomes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function tempAmemHome(): string {
  const home = mkdtempSync(join(tmpdir(), "amem-plugin-route-"));
  tempHomes.push(home);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "amem.toml"), configToToml(defaultConfig()));
  return home;
}

describe("apply capture fail-open", () => {
  it("does not propagate throws from session/created handler internals", () => {
    const handlers: Record<string, Array<(...a: unknown[]) => unknown>> = {};
    const ctx: DshPluginContext = {
      on: (event, handler) => {
        (handlers[event] ??= []).push(handler);
      },
    };
    apply(ctx, { amemHome: "C:\\does-not-exist-amem-home-xyz" });
    const created = handlers["session/created"]![0]!;
    expect(() =>
      created({
        get id() {
          throw new Error("boom");
        },
      }),
    ).not.toThrow();
  });

  it("defers /amem-api via inject when webServer is not ready at apply time", () => {
    const register = vi.fn(() => () => {});
    const effect = vi.fn((fn: () => unknown) => fn());
    let nestedDeps: string[] | undefined;
    const ctx: DshPluginContext = {
      // Simulate Cordis: services absent at apply; only available after inject waits.
      get: () => undefined,
      inject: (deps, callback) => {
        nestedDeps = deps;
        const apiCtx: DshPluginContext = {
          webServer: { register },
          connection: { requestRejection: () => undefined },
          effect,
          get: (name) => {
            if (name === "webServer") return { register };
            if (name === "connection") return { requestRejection: () => undefined };
            return undefined;
          },
        };
        callback(apiCtx);
      },
    };
    apply(ctx, { amemHome: process.cwd() });
    expect(nestedDeps).toEqual(["webServer", "connection"]);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "prefix", path: "/amem-api" }),
    );
  });

  it("registers /amem-api when requestRejection exists via get (test/legacy path)", () => {
    const register = vi.fn(() => () => {});
    const ctx: DshPluginContext = {
      get: (name) => {
        if (name === "webServer") return { register };
        if (name === "connection") return { requestRejection: () => undefined };
        return undefined;
      },
    };
    apply(ctx, { amemHome: process.cwd() });
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "prefix", path: "/amem-api" }),
    );
  });
});

describe("/amem-api route handler", () => {
  it("GET /doctor returns 200 JSON when auth admits", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => undefined });
    const { res, status, json } = mockRes();
    await handler(mockReq("GET", "/amem-api/doctor"), res);
    expect(status()).toBe(200);
    const body = json() as { home?: string; checks?: unknown[] };
    expect(body.home).toBe(home);
    expect(Array.isArray(body.checks)).toBe(true);
  });

  it("returns 401 when requestRejection rejects before route handling", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => 401 });
    const { res, status, json } = mockRes();
    await handler(mockReq("GET", "/amem-api/doctor"), res);
    expect(status()).toBe(401);
    expect(json()).toEqual(
      expect.objectContaining({ error: "unauthorized", message: "unauthorized" }),
    );
  });

  it("POST /compile with target cursor returns 400", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => undefined });
    const { res, status, json } = mockRes();
    await handler(
      mockReq("POST", "/amem-api/compile", JSON.stringify({ target: "cursor" })),
      res,
    );
    expect(status()).toBe(400);
    expect(json()).toEqual(
      expect.objectContaining({
        ok: false,
        error: "bad_request",
        message: "compile target must be dsh",
        status: 400,
      }),
    );
  });

  it("GET /config returns path and config when auth admits", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => undefined });
    const { res, status, json } = mockRes();
    await handler(mockReq("GET", "/amem-api/config"), res);
    expect(status()).toBe(200);
    const body = json() as { path?: string; config?: { llm?: { mode?: string } } };
    expect(body.path).toContain("amem.toml");
    expect(body.config?.llm?.mode).toBe("stub");
  });

  it("PUT /config with invalid JSON returns 400", async () => {
    const home = tempAmemHome();
    const handler = mountHandler(home, { requestRejection: () => undefined });
    const { res, status, json } = mockRes();
    await handler(mockReq("PUT", "/amem-api/config", "{not json"), res);
    expect(status()).toBe(400);
    expect(json()).toEqual({ error: "bad_request", message: "invalid JSON" });
  });
});
\n`\n\n### README DSH Web\n`\nDSH Web 扩展（仅 `dsh web`）：**

- Cordis 插件监听 `session/event` 写入 `~/.amem/spool`（fail-open）  
- Host 注册同域 `/amem-api`（需 `export const inject = ['webServer','connection']`，鉴权用 Connection `requestRejection`）  
- 左栏 **amem** 面板：记忆 / 能力 / 提案 / 运维 / 配置 / 说明（包 `@amem/amem-dsh-ui`）；**运维** Tab 对应 Admin API：`doctor`、`flush`、`rebuild-index`、`consolidate`、`compile --target dsh`（面板内 compile 固定为 dsh，不可改 target）；**配置** Tab 可编辑常用 `amem.toml`（不含真实 API Key；privacy/embedding 保留磁盘值）  
- headless / ACP 无面板，仍可用 MCP  

实现对照本地 DSH 源码 API；官网文档可能滞后于当前仓库。

### Claude Code 等其他宿主

`amem install --host cursor` 与 `amem install\n`