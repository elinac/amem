# Task 4 Review Package\n\nCommits: none\n\n### packages/amem-dsh-ui/client/locales.ts\n\n`	s\n/** `amem` namespace dictionaries — both locales required by DSH locale.register. */

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
\n`\n\n### packages/amem-dsh-ui/client/panel.tsx\n\n`	sx\n/**
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
\n`\n\n### README.md (DSH Web excerpt)\n\n`md\nH mcp-memory 指南](https://deepseek-harness.github.io/deepseek-harness/en/guide/mcp-memory)）：会话 A `memory_note` → 新会话 B `memory_recall`。

能力仓编译：`amem compile --target dsh` → `~/.dsh/skills/<name>/`。

**DSH Web 扩展（仅 `dsh web`）：**

- Cordis 插件监听 `session/event` 写入 `~/.amem/spool`（fail-open）  
- Host 注册同域 `/amem-api`（需 `export const inject = ['webServer','connection']`，鉴权用 Connection `requestRejection`）  
- 左栏 **amem** 面板：记忆 / 能力 / 提案 / 运维 / 配置 / 说明（包 `@amem/amem-dsh-ui`）；**运维** Tab 对应 Admin API：`doctor`、`flush`、`rebuild-index`、`consolidate`、`compile --target dsh`（面板内 compile 固定为 dsh，不可改 target）；**配置** Tab 可编辑常用 `amem.toml`（不含真实 API Key；privacy/embedding 保留磁盘值）  
- headless / ACP 无面板，仍可用 MCP  

实现对照本地 DSH 源码 API；官网文档可能滞后于当前仓库。

### Claude Code 等其他宿主

`amem install --host cursor` 与 `amem install --host dsh` 为完整安装路径。其他宿主目前需手动配置 MCP（指向 `packages/gateway-mcp/dist/server.js`，并设置 `AMEM_HOME`）；`compile --target claude-code` 可输出对应格式。Adapter 包：`@amem/adapter-claude-code`。

---

## 开发说明

### 仓库结构

``\n`\n