/**
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
  llm: { base_url: string; model: string; api_key: string; api_key_env: string; mode: string };
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
    params[name] !== null && params[name] !== undefined ? String(params[name]) : `{${name}}`,
  );
}

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const { headers: initHeaders, ...rest } = init ?? {};
  const res = await fetch(`/amem-api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: { "content-type": "application/json", ...(initHeaders ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { message?: string }).message ?? res.statusText);
  return body;
}

const fallbackTranslate: Translate = (k) => k;

function AmemPanel({ t: translate }: AmemPanelProps) {
  const t: Translate = translate ?? fallbackTranslate;
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
      setConfig(null);
      setConfigPath(null);
      const raw = e instanceof Error ? e.message : String(e);
      setError(format(t, "config.loadFailed", { message: raw || "unknown" }));
    } finally {
      setConfigBusy(false);
    }
  }, [t]);

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
    setError(null);
    try {
      await api(`/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onApply = async (id: string) => {
    const skillName = prompt(format(t, "apply.prompt"));
    if (!skillName) return;
    setError(null);
    try {
      await api(`/proposals/${encodeURIComponent(id)}/apply`, {
        method: "POST",
        body: JSON.stringify({ skillName }),
      });
      setTab("skills");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const tabLabel = (id: Tab): string => format(t, `tab.${id}` as AmemKey);

  const configField = (
    labelKey: AmemKey,
    helpKey: AmemKey,
    input: ReturnType<typeof createElement>,
  ) =>
    createElement(
      "label",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flex: "1 1 220px",
          minWidth: 200,
        },
      },
      createElement(
        "span",
        { style: { fontSize: 13, fontWeight: 600 } },
        format(t, labelKey),
      ),
      createElement(
        "span",
        { style: { fontSize: 12, opacity: 0.7, lineHeight: 1.4 } },
        format(t, helpKey),
      ),
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
          { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
          configField(
            "config.field.user_id",
            "config.help.user_id",
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
            "config.help.mode",
            configSelect(config.llm.mode, ["stub", "external", "host"], (v) =>
              set({ llm: { ...config.llm, mode: v } }),
            ),
          ),
          configField(
            "config.field.base_url",
            "config.help.base_url",
            configText(config.llm.base_url, (v) =>
              set({ llm: { ...config.llm, base_url: v } }),
            ),
          ),
          configField(
            "config.field.model",
            "config.help.model",
            configText(config.llm.model, (v) =>
              set({ llm: { ...config.llm, model: v } }),
            ),
          ),
          configField(
            "config.field.api_key",
            "config.help.api_key",
            configText(
              config.llm.api_key ?? "",
              (v) => set({ llm: { ...config.llm, api_key: v } }),
              { type: "password" },
            ),
          ),
          configField(
            "config.field.api_key_env",
            "config.help.api_key_env",
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
            "config.help.budget_tokens",
            configNumber(config.recall.budget_tokens, (v) =>
              set({ recall: { ...config.recall, budget_tokens: v } }),
            ),
          ),
          configField(
            "config.field.l0_items",
            "config.help.l0_items",
            configNumber(config.recall.l0_items, (v) =>
              set({ recall: { ...config.recall, l0_items: v } }),
            ),
          ),
          configField(
            "config.field.l1_items",
            "config.help.l1_items",
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
            "config.help.instance_to_domain_min_instances",
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
            "config.help.domain_to_global_min_domains",
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
            "config.help.domain_to_global_min_instances",
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
            "config.help.global_min_lift",
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
            "config.help.max_llm_calls",
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
            "config.help.max_tokens",
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
            "config.help.max_proposals",
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
            "config.help.max_minutes",
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
            void runOps("/consolidate", {
              method: "POST",
              body: JSON.stringify({ dryRun: false }),
            });
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
            format(t, "config.path", { path: configPath }),
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
        const title = String(row.title ?? row.name ?? id);
        const subtitle =
          row.applies_when != null && String(row.applies_when).trim()
            ? String(row.applies_when)
            : row.summary != null && String(row.summary).trim()
              ? String(row.summary)
              : row.description != null && String(row.description).trim()
                ? String(row.description)
                : "";
        const preview =
          row.content != null && String(row.content).trim()
            ? String(row.content).slice(0, 200)
            : row.summary != null && String(row.summary).trim() && subtitle !== String(row.summary)
              ? String(row.summary).slice(0, 200)
              : "";
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
            { style: { minWidth: 0, flex: 1 } },
            createElement("strong", null, title),
            createElement(
              "div",
              { style: { fontSize: 12, opacity: 0.75, marginTop: 2 } },
              [
                row.kind,
                row.level,
                row.trust,
                row.status,
                row.version,
                row.score != null ? format(t, "meta.score", { score: String(row.score) }) : null,
                row.helpful != null ? `helpful=${row.helpful}` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            ),
            subtitle
              ? createElement(
                  "div",
                  { style: { fontSize: 12, marginTop: 4, lineHeight: 1.4 } },
                  subtitle,
                )
              : null,
            preview
              ? createElement(
                  "div",
                  {
                    style: {
                      fontSize: 12,
                      marginTop: 4,
                      opacity: 0.85,
                      lineHeight: 1.4,
                      whiteSpace: "pre-wrap",
                    },
                  },
                  preview,
                )
              : null,
            title !== id
              ? createElement(
                  "div",
                  {
                    style: {
                      fontSize: 11,
                      marginTop: 4,
                      opacity: 0.55,
                      fontFamily: "ui-monospace, monospace",
                    },
                  },
                  id,
                )
              : null,
          ),
          tab === "memories" &&
            row.id &&
            createElement(
              "button",
              { type: "button", onClick: () => void onForget(String(row.id)) },
              format(t, "forget.button"),
            ),
          tab === "proposals" &&
            row.id &&
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
