/**
 * amem DSH workbench panel.
 *
 * Refactored into page-level composition over:
 * - api.ts     (auth + RPC client)
 * - styles.ts  (design tokens + shared style objects)
 * - components.ts (UnlockView, SideNav, FilterBar, MemoryRow, Pagination, ...)
 */
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  auth,
  getAuthStatus,
  login,
  logout,
  refreshCsrf,
  rpc,
  type AuthState,
  type ListMemoryFilters,
  type MemoryListResult,
  type RpcResult,
  effectivePage,
  isStale,
  nextQuery,
  rpcErrorMessage,
} from "./api.js";
import {
  type ConfigFormState,
  type LlmForm,
  buildConfigPutBody,
  editableFingerprint,
  isConfigDirty,
  patchLlm,
  patchRefineProposals,
  readLlmForm,
  readRefineProposals,
} from "./config-form.js";
import {
  dominantGateRollup,
  formatGateGaps,
  proposalGateGaps,
  proposalGateInputFromListRow,
  rollupProposalGateGaps,
} from "./proposal-gates.js";
import {
  EmptyState,
  FilterBar,
  MemoryRow,
  Pagination,
  SideNav,
  SkeletonList,
  StatusMessage,
  TopNav,
  UnlockView,
  enumLabel,
  format,
  mergeStyle,
  type Translate,
} from "./components.js";
import { NS, en, zh, type AmemKey } from "./locales.js";
import { styles, tokens } from "./styles.js";

const PANEL_ID = "amem";

type Tab =
  | "memories"
  | "skills"
  | "proposals"
  | "review"
  | "ops"
  | "config"
  | "help";

const LIST_TABS: Tab[] = ["memories", "skills", "proposals"];

const fallbackTranslate: Translate = (k) => k;

const DEFAULT_MEM_FILTERS: ListMemoryFilters & { page: number; pageSize: 20 | 50 | 100 } = {
  page: 1,
  pageSize: 20,
};

function useWindowWidth(): number {
  const [width, setWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

type AsyncListState =
  | { kind: "idle" }
  | { kind: "loading"; keep?: MemoryListResult }
  | { kind: "ready"; data: MemoryListResult }
  | { kind: "error"; message: string; keep?: MemoryListResult };

function isListTab(t: Tab): boolean {
  return LIST_TABS.includes(t);
}

function AmemPanel({ t: translate }: { t?: Translate }) {
  const t: Translate = translate ?? fallbackTranslate;
  const [authState, setAuthState] = useState<AuthState>({ kind: "unlocking" });
  const [tab, setTab] = useState<Tab>("memories");
  const [filters, setFilters] = useState(DEFAULT_MEM_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const debouncedQ = useDebouncedValue(searchInput, 300);
  const [listState, setListState] = useState<AsyncListState>({ kind: "idle" });
  const [skills, setSkills] = useState<unknown[]>([]);
  const [proposals, setProposals] = useState<unknown[]>([]);
  const [conflicts, setConflicts] = useState<
    Array<{
      left: { id: string; title: string; status: string; updated_at: string };
      right: { id: string; title: string; status: string; updated_at: string };
    }>
  >([]);
  const [gapMemories, setGapMemories] = useState<
    import("./api.js").MemoryListItem[]
  >([]);
  const [tabBusy, setTabBusy] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);
  const [opsResult, setOpsResult] = useState<unknown | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [configState, setConfigState] = useState<ConfigFormState | null>(null);
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const width = useWindowWidth();
  const narrow = width < 720;

  const handleAuthError = useCallback(
    (err: { code: string; message: string }) => {
      if (err.code !== "unauthenticated") return;
      setAuthState((prev) => {
        if (prev.kind === "ready" && prev.authEnabled === false) return prev;
        return { kind: "error", message: rpcErrorMessage(err) };
      });
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void getAuthStatus().then((state) => {
      if (!cancelled) setAuthState(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMemories = useCallback(
    async (wanted: ListMemoryFilters & { page: number; pageSize: 20 | 50 | 100 }) => {
      sequenceRef.current += 1;
      const seq = sequenceRef.current;
      setTabError(null);
      setListState((prev) => ({
        kind: "loading",
        keep: prev.kind === "ready" ? prev.data : undefined,
      }));
      const result = await rpc.memory.list({
        page: wanted.page,
        pageSize: wanted.pageSize,
        q: wanted.q,
        kind: wanted.kind,
        level: wanted.level,
        trust: wanted.trust,
        status: wanted.status,
      });
      if (isStale(seq, sequenceRef.current)) return;
      if (!result.ok) {
        handleAuthError(result.error);
        setListState((prev) => ({
          kind: "error",
          message: rpcErrorMessage(result.error),
          keep: prev.kind === "ready" ? prev.data : prev.kind === "loading" ? prev.keep : undefined,
        }));
        return;
      }
      const data = result.result;
      const page = effectivePage(data.page, data.total, data.pageSize);
      if (page !== data.page) {
        // Page was out of range; retry on the last valid page.
        void loadMemories({ ...wanted, page });
        return;
      }
      setListState({ kind: "ready", data });
    },
    [handleAuthError],
  );

  // Sync debounced search into filters.
  useEffect(() => {
    if (debouncedQ !== (filters.q ?? "")) {
      setFilters((f) => nextQuery(f, { q: debouncedQ }));
    }
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load memory list whenever filters change.
  useEffect(() => {
    if (authState.kind !== "ready") return;
    if (tab !== "memories") return;
    void loadMemories(filters);
  }, [filters, tab, authState.kind, loadMemories]);

  const loadSkills = useCallback(async () => {
    setTabBusy(true);
    setTabError(null);
    const result = await rpc.skill.list();
    if (!result.ok) {
      handleAuthError(result.error);
      setTabError(rpcErrorMessage(result.error));
    } else {
      setSkills((result.result.items as unknown[]) ?? []);
    }
    setTabBusy(false);
  }, [handleAuthError]);

  const loadProposals = useCallback(async () => {
    setTabBusy(true);
    setTabError(null);
    const [result, memResult] = await Promise.all([
      rpc.proposal.list(),
      rpc.memory.list({ page: 1, pageSize: 100 }),
    ]);
    if (!result.ok) {
      handleAuthError(result.error);
      setTabError(rpcErrorMessage(result.error));
    } else {
      setProposals((result.result.items as unknown[]) ?? []);
    }
    if (memResult.ok) {
      setGapMemories(memResult.result.items ?? []);
    }
    setTabBusy(false);
  }, [handleAuthError]);

  const loadConflicts = useCallback(async () => {
    setTabBusy(true);
    setTabError(null);
    const result = await rpc.conflict.list();
    if (!result.ok) {
      handleAuthError(result.error);
      setTabError(rpcErrorMessage(result.error));
      setConflicts([]);
    } else {
      setConflicts(result.result.conflicts ?? []);
    }
    setTabBusy(false);
  }, [handleAuthError]);

  useEffect(() => {
    if (authState.kind !== "ready") return;
    if (tab === "skills") void loadSkills();
    if (tab === "proposals") void loadProposals();
    if (tab === "review") void loadConflicts();
  }, [tab, authState.kind, loadSkills, loadProposals, loadConflicts]);

  const loadConfig = useCallback(
    async (opts?: { keepMsg?: boolean }) => {
      if (authState.kind !== "ready") return;
      setConfigBusy(true);
      if (!opts?.keepMsg) setConfigMsg(null);
      setTabError(null);
      const result = await rpc.config.get();
      if (!result.ok) {
        handleAuthError(result.error);
        setTabError(rpcErrorMessage(result.error));
        setConfigState(null);
      } else {
        const loaded: ConfigFormState = {
          path: result.result.path,
          config: (result.result.config ?? {}) as Record<string, unknown>,
          apiKeyReplacement: "",
          baseline: "",
        };
        setConfigState({ ...loaded, baseline: editableFingerprint(loaded) });
      }
      setConfigBusy(false);
    },
    [authState.kind, handleAuthError],
  );

  useEffect(() => {
    if (tab === "config") void loadConfig();
  }, [tab, loadConfig]);

  /** Leaves the config tab only after confirming that unsaved edits are discarded. */
  const requestTab = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      if (
        tab === "config" &&
        isConfigDirty(configState) &&
        !confirm(format(t, "config.confirmDiscard"))
      ) {
        return;
      }
      setTab(next);
    },
    [tab, configState, t],
  );

  const reloadConfig = useCallback(() => {
    if (isConfigDirty(configState) && !confirm(format(t, "config.confirmDiscard"))) return;
    void loadConfig();
  }, [configState, loadConfig, t]);

  const onUnlock = useCallback(async (token: string) => {
    setAuthState({ kind: "unlocking" });
    const result = await login(token);
    setAuthState(result);
  }, []);

  const onLogout = useCallback(async () => {
    await logout();
    setAuthState({ kind: "locked" });
    setListState({ kind: "idle" });
    setSkills([]);
    setProposals([]);
    setConfigState(null);
  }, []);

  const onForget = useCallback(
    async (id: string) => {
      if (!confirm(format(t, "forget.confirm", { id }))) return;
      const result = await rpc.memory.forget(id);
      if (!result.ok) {
        handleAuthError(result.error);
        setTabError(rpcErrorMessage(result.error));
        return;
      }
      void loadMemories(filters);
    },
    [t, filters, loadMemories, handleAuthError],
  );

  const onApplyProposal = useCallback(
    async (id: string) => {
      const skillName = prompt(format(t, "apply.prompt"));
      if (!skillName) return;
      const result = await rpc.proposal.apply(id, skillName);
      if (!result.ok) {
        handleAuthError(result.error);
        setTabError(rpcErrorMessage(result.error));
        return;
      }
      setTab("skills");
    },
    [t, handleAuthError],
  );

  const runOps = useCallback(
    async (method: string, params: unknown) => {
      setOpsBusy(true);
      setTabError(null);
      setOpsResult(null);
      let result: RpcResult<unknown>;
      switch (method) {
        case "doctor":
          result = await rpc.ops.doctor();
          break;
        case "flush":
          result = await rpc.ops.flush(sessionId.trim() || undefined);
          break;
        case "rebuild":
          result = await rpc.ops.rebuild();
          break;
        case "consolidate":
          result = await rpc.ops.consolidate(params === true);
          break;
        case "compile":
          result = await rpc.ops.compile("dsh");
          break;
        default:
          result = { ok: false, error: { code: "internal", message: "unknown op" } };
      }
      setOpsBusy(false);
      if (!result.ok) {
        handleAuthError(result.error);
        setTabError(rpcErrorMessage(result.error));
        return;
      }
      setOpsResult(result.result);
      if (method === "consolidate" && params !== true) {
        setOpsResult({
          ...(typeof result.result === "object" && result.result != null
            ? (result.result as Record<string, unknown>)
            : { result: result.result }),
          _hint: format(t, "ops.consolidateToProposals"),
        });
        setTab("proposals");
        void loadProposals();
      }
    },
    [sessionId, handleAuthError, loadProposals, t],
  );

  const saveConfig = useCallback(async () => {
    if (!configState) return;
    if (!confirm(format(t, "config.confirmSave"))) return;
    setConfigBusy(true);
    setConfigMsg(null);
    setTabError(null);
    const put = buildConfigPutBody(configState);
    const result = await rpc.config.put(put.config, put.api_key_replacement);
    if (!result.ok) {
      setConfigBusy(false);
      handleAuthError(result.error);
      setTabError(rpcErrorMessage(result.error));
      return;
    }
    // Reload with the message kept, then report success: the reload also resets the
    // dirty baseline, so the button returns to its disabled state.
    await loadConfig({ keepMsg: true });
    setConfigMsg(format(t, "config.saved", { path: configState.path ?? "" }));
  }, [t, configState, loadConfig, handleAuthError]);

  const updateFilter = useCallback(
    (patch: Partial<ListMemoryFilters>) => setFilters((f) => nextQuery(f, patch)),
    [],
  );

  const updatePageSize = useCallback((pageSize: number) => {
    setFilters((f) => ({ ...f, pageSize: pageSize as 20 | 50 | 100, page: 1 }));
  }, []);

  const onSearch = useCallback((q: string) => setSearchInput(q), []);

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setFilters(DEFAULT_MEM_FILTERS);
  }, []);

  const currentData =
    listState.kind === "ready"
      ? listState.data
      : listState.kind === "loading"
        ? listState.keep
        : listState.kind === "error"
          ? listState.keep
          : undefined;

  const renderListItems = (
    items: unknown[],
    actions: (row: Record<string, unknown>) => React.ReactNode,
  ) => {
    if (items.length === 0) {
      return createElement(EmptyState, {
        t,
        messageKey: "list.empty",
        action: { label: "refresh.button", onClick: () => void loadMemories(filters) },
      });
    }
    return createElement(
      "div",
      { role: "feed", "aria-busy": tabBusy },
      ...items.map((raw, i) => {
        const row = raw as Record<string, unknown>;
        const id = String(row.id ?? row.name ?? i);
        const title = String(row.title ?? row.name ?? id);
        const meta = [
          row.kind ? enumLabel(t, "kind", String(row.kind)) : null,
          row.level ? enumLabel(t, "level", String(row.level)) : null,
          row.trust ? enumLabel(t, "trust", String(row.trust)) : null,
          row.status ? enumLabel(t, "status", String(row.status)) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const preview =
          row.content != null && String(row.content).trim()
            ? String(row.content).slice(0, 200)
            : row.summary != null && String(row.summary).trim()
              ? String(row.summary).slice(0, 200)
              : "";
        return createElement(
          "article",
          { key: id, style: styles.row },
          createElement(
            "div",
            { style: { minWidth: 0, flex: 1 } },
            createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: tokens.space2,
                  flexWrap: "wrap",
                },
              },
              createElement("span", { style: styles.rowTitle }, title),
              row.status ? createElement("span", { style: styles.badge }, enumLabel(t, "status", String(row.status))) : null,
            ),
            meta ? createElement("div", { style: styles.rowMeta }, meta) : null,
            preview
              ? createElement("div", { style: styles.rowPreview }, preview)
              : null,
          ),
          actions(row),
        );
      }),
    );
  };

  const renderMemories = () => {
    if (listState.kind === "idle" || (listState.kind === "loading" && !currentData)) {
      return createElement(SkeletonList, { count: 6 });
    }
    if (listState.kind === "error" && !currentData) {
      return createElement(EmptyState, {
        t,
        messageKey: "list.error",
        action: { label: "refresh.button", onClick: () => void loadMemories(filters) },
      });
    }
    const data = currentData as MemoryListResult;
    if (data.total === 0) {
      return createElement(EmptyState, {
        t,
        messageKey: "list.noResults",
        action: { label: "filter.clear", onClick: clearFilters },
      });
    }
    return createElement(
      "div",
      null,
      ...data.items.map((row) =>
        createElement(MemoryRow, {
          key: row.id,
          t,
          row,
          gateGaps: formatGateGaps(
            proposalGateGaps(
              proposalGateInputFromListRow({
                kind: row.kind,
                level: row.level,
                trust: row.trust,
                distinct_instances:
                  typeof row.distinct_instances === "number" ? row.distinct_instances : 0,
              }),
            ),
            {
              kind: format(t, "gate.kind"),
              level: format(t, "gate.level"),
              trust: format(t, "gate.trust"),
              instances: format(t, "gate.instances"),
            },
          ),
          canForget: auth.hasScope("memory:forget"),
          onForget,
        }),
      ),
      createElement(Pagination, {
        t,
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        onPage: (p) => setFilters((f) => ({ ...f, page: p })),
      }),
    );
  };

  const renderSkills = () => {
    if (tabBusy && skills.length === 0) return createElement(SkeletonList, { count: 4 });
    return renderListItems(skills, () => null);
  };

  const renderProposals = () => {
    if (tabBusy && proposals.length === 0) return createElement(SkeletonList, { count: 4 });
    const memItems = gapMemories;
    const rollupBanner =
      proposals.length === 0 && memItems.length > 0
        ? (() => {
            const rollup = rollupProposalGateGaps(
              memItems.map((row) =>
                proposalGateInputFromListRow({
                  kind: row.kind,
                  level: row.level,
                  trust: row.trust,
                  distinct_instances:
                    typeof row.distinct_instances === "number" ? row.distinct_instances : 0,
                }),
              ),
            );
            const lines = dominantGateRollup(rollup);
            return createElement(
              "div",
              {
                style: {
                  marginBottom: tokens.space3,
                  padding: tokens.space3,
                  border: `1px solid ${tokens.border}`,
                  borderRadius: tokens.radiusSm,
                  color: tokens.textMuted,
                  fontSize: 13,
                  lineHeight: 1.5,
                },
              },
              createElement("div", { style: { fontWeight: 600, marginBottom: 4 } }, format(t, "gate.rollupTitle")),
              lines.length === 0
                ? format(t, "gate.rollupEmpty")
                : lines.map(({ gate, count }) =>
                    createElement(
                      "div",
                      { key: gate },
                      format(t, "gate.rollupLine", {
                        label: format(t, `gate.${gate}` as AmemKey),
                        count,
                      }),
                    ),
                  ),
            );
          })()
        : null;
    return createElement(
      "div",
      null,
      rollupBanner,
      renderListItems(proposals, (row) =>
        auth.hasScope("proposal:apply")
          ? createElement(
              "button",
              {
                type: "button",
                onClick: () => void onApplyProposal(String(row.id)),
                style: styles.button,
              },
              format(t, "apply.button"),
            )
          : null,
      ),
    );
  };

  const onResolveConflict = useCallback(
    async (
      pair: {
        left: { id: string; updated_at: string };
        right: { id: string; updated_at: string };
      },
      action: "keep_left" | "keep_right" | "keep_both",
    ) => {
      setTabBusy(true);
      setTabError(null);
      const result = await rpc.conflict.resolve({
        leftId: pair.left.id,
        rightId: pair.right.id,
        action,
        leftUpdatedAt: pair.left.updated_at,
        rightUpdatedAt: pair.right.updated_at,
      });
      if (!result.ok) {
        handleAuthError(result.error);
        setTabError(rpcErrorMessage(result.error));
      } else {
        await loadConflicts();
      }
      setTabBusy(false);
    },
    [handleAuthError, loadConflicts],
  );

  const renderReview = () => {
    if (tabBusy && conflicts.length === 0) {
      return createElement("p", { style: { color: tokens.textMuted } }, format(t, "list.loading"));
    }
    if (conflicts.length === 0) {
      return createElement(
        "p",
        { style: { color: tokens.textMuted, lineHeight: 1.6 } },
        format(t, "review.none"),
      );
    }
    const canResolve = auth.hasScope("memory:resolve-conflict");
    return createElement(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: tokens.space3 } },
      conflicts.map((pair) =>
        createElement(
          "div",
          {
            key: `${pair.left.id}|${pair.right.id}`,
            style: {
              border: `1px solid ${tokens.border}`,
              borderRadius: tokens.radiusMd,
              padding: tokens.space3,
            },
          },
          createElement(
            "div",
            { style: { marginBottom: tokens.space2, lineHeight: 1.5 } },
            createElement("strong", null, pair.left.title),
            " ↔ ",
            createElement("strong", null, pair.right.title),
            createElement(
              "div",
              { style: { color: tokens.textMuted, fontSize: 12 } },
              `${pair.left.id} / ${pair.right.id}`,
            ),
          ),
          canResolve
            ? createElement(
                "div",
                { style: { display: "flex", flexWrap: "wrap", gap: tokens.space2 } },
                createElement(
                  "button",
                  {
                    type: "button",
                    disabled: tabBusy,
                    style: styles.button,
                    onClick: () => void onResolveConflict(pair, "keep_left"),
                  },
                  format(t, "review.keepLeft"),
                ),
                createElement(
                  "button",
                  {
                    type: "button",
                    disabled: tabBusy,
                    style: styles.button,
                    onClick: () => void onResolveConflict(pair, "keep_right"),
                  },
                  format(t, "review.keepRight"),
                ),
                createElement(
                  "button",
                  {
                    type: "button",
                    disabled: tabBusy,
                    style: mergeStyle(styles.button, styles.ghostButton),
                    onClick: () => void onResolveConflict(pair, "keep_both"),
                  },
                  format(t, "review.keepBoth"),
                ),
              )
            : createElement(
                "p",
                { style: { color: tokens.textMuted, margin: 0, fontSize: 12 } },
                format(t, "review.noResolveScope"),
              ),
        ),
      ),
    );
  };

  const renderOps = () =>
    createElement(
      "div",
      null,
      createElement("input", {
        type: "text",
        value: sessionId,
        onChange: (e: { target: { value: string } }) => setSessionId(e.target.value),
        placeholder: format(t, "ops.sessionPlaceholder"),
        disabled: opsBusy,
        style: mergeStyle(styles.searchInput, { maxWidth: 480, marginBottom: tokens.space3 }),
      }),
      createElement(
        "div",
        { style: { display: "flex", flexWrap: "wrap", gap: tokens.space2, marginBottom: tokens.space3 } },
        createElement(
          "button",
          { type: "button", disabled: opsBusy, onClick: () => void runOps("doctor", undefined), style: styles.button },
          format(t, "ops.doctor"),
        ),
        createElement(
          "button",
          { type: "button", disabled: opsBusy, onClick: () => void runOps("flush", undefined), style: styles.button },
          format(t, "ops.flush"),
        ),
        createElement(
          "button",
          { type: "button", disabled: opsBusy, onClick: () => { if (confirm(format(t, "ops.confirmRebuild"))) void runOps("rebuild", undefined); }, style: styles.button },
          format(t, "ops.rebuild"),
        ),
        createElement(
          "button",
          { type: "button", disabled: opsBusy, onClick: () => void runOps("consolidate", true), style: styles.button },
          format(t, "ops.consolidateDry"),
        ),
        createElement(
          "button",
          { type: "button", disabled: opsBusy, onClick: () => { if (confirm(format(t, "ops.confirmConsolidate"))) void runOps("consolidate", false); }, style: mergeStyle(styles.button, styles.dangerButton) },
          format(t, "ops.consolidate"),
        ),
        createElement(
          "button",
          { type: "button", disabled: opsBusy, onClick: () => { if (confirm(format(t, "ops.confirmCompile"))) void runOps("compile", undefined); }, style: styles.button },
          format(t, "ops.compile"),
        ),
      ),
      opsBusy && createElement(SkeletonList, { count: 2 }),
      opsResult != null &&
        createElement(
          "details",
          { open: false, style: styles.detailsRaw },
          createElement("summary", { style: { fontSize: 13, cursor: "pointer" } }, format(t, "ops.result")),
          createElement("pre", { style: styles.preRaw }, JSON.stringify(opsResult, null, 2)),
        ),
    );

  const renderConfig = () => {
    if (!configState) return createElement(SkeletonList, { count: 3 });
    const llm = readLlmForm(configState.config);
    const dirty = isConfigDirty(configState);
    const setLlm = (
      patch: Partial<Pick<LlmForm, "mode" | "base_url" | "model" | "api_key_env">>,
    ) =>
      setConfigState((prev) =>
        prev ? { ...prev, config: patchLlm(prev.config, patch) } : prev,
      );
    const keySourceKey: AmemKey =
      llm.api_key_source === "inline"
        ? "config.keySource.inline"
        : llm.api_key_source === "env"
          ? "config.keySource.env"
          : "config.keySource.none";
    // Label names the control explicitly; help text is only referenced by id, so screen
    // readers announce the short label instead of the whole paragraph.
    const field = (
      id: string,
      labelKey: AmemKey,
      control: React.ReactElement,
      opts?: {
        helpKey?: AmemKey;
        helpVars?: Record<string, string | number>;
        extra?: React.ReactElement | null;
      },
    ) =>
      createElement(
        "div",
        { style: styles.configField, key: id },
        createElement("label", { htmlFor: id, style: styles.configLabel }, format(t, labelKey)),
        opts?.helpKey
          ? createElement(
              "span",
              { id: `${id}-help`, style: styles.configHelp },
              format(t, opts.helpKey, opts.helpVars),
            )
          : null,
        control,
        opts?.extra ?? null,
      );
    return createElement(
      "div",
      null,
      createElement(
        "p",
        {
          style: {
            fontSize: 12,
            color: tokens.textMuted,
            marginBottom: tokens.space2,
            lineHeight: 1.5,
          },
        },
        format(t, "config.hintSummary"),
      ),
      createElement(
        "details",
        { style: { marginBottom: tokens.space3 } },
        createElement(
          "summary",
          { style: { fontSize: 12, color: tokens.textMuted, cursor: "pointer" } },
          format(t, "config.detailsTitle"),
        ),
        createElement(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: tokens.space2,
              paddingTop: tokens.space2,
            },
          },
          ...(["config.hintWave1", "config.hintSecrets", "config.hintPrivacy"] as AmemKey[]).map(
            (key) =>
              createElement(
                "p",
                { key, style: { margin: 0, fontSize: 12, color: tokens.textMuted, lineHeight: 1.5 } },
                format(t, key),
              ),
          ),
          configState.path
            ? createElement(
                "p",
                {
                  style: {
                    margin: 0,
                    fontSize: 12,
                    color: tokens.textMuted,
                    lineHeight: 1.5,
                    wordBreak: "break-all",
                  },
                },
                format(t, "config.path", { path: configState.path }),
              )
            : null,
        ),
      ),
      createElement(
        "section",
        { style: styles.configSection },
        createElement("h3", { style: { margin: 0 } }, format(t, "config.section.llm")),
        field(
          "amem-config-mode",
          "config.field.mode",
          createElement(
            "select",
            {
              id: "amem-config-mode",
              "aria-describedby": "amem-config-mode-help",
              value: llm.mode,
              disabled: configBusy,
              onChange: (e: { target: { value: string } }) => setLlm({ mode: e.target.value }),
              style: styles.select,
            },
            createElement("option", { value: "stub" }, "stub"),
            createElement("option", { value: "external" }, "external"),
            createElement("option", { value: "host" }, "host"),
          ),
          { helpKey: "config.help.mode" },
        ),
        field(
          "amem-config-base-url",
          "config.field.base_url",
          createElement("input", {
            id: "amem-config-base-url",
            "aria-describedby": "amem-config-base-url-help",
            type: "text",
            value: llm.base_url,
            disabled: configBusy,
            onChange: (e: { target: { value: string } }) => setLlm({ base_url: e.target.value }),
            style: mergeStyle(styles.searchInput, { flex: "unset" }),
          }),
          { helpKey: "config.help.base_url" },
        ),
        field(
          "amem-config-model",
          "config.field.model",
          createElement("input", {
            id: "amem-config-model",
            "aria-describedby": "amem-config-model-help",
            type: "text",
            value: llm.model,
            disabled: configBusy,
            onChange: (e: { target: { value: string } }) => setLlm({ model: e.target.value }),
            style: mergeStyle(styles.searchInput, { flex: "unset" }),
          }),
          { helpKey: "config.help.model" },
        ),
        field(
          "amem-config-api-key",
          "config.field.api_key",
          createElement("input", {
            id: "amem-config-api-key",
            "aria-describedby": "amem-config-api-key-help amem-config-key-source",
            type: "password",
            value: configState.apiKeyReplacement,
            placeholder: format(t, "config.apiKeyPlaceholder"),
            autoComplete: "off",
            disabled: configBusy,
            onChange: (e: { target: { value: string } }) =>
              setConfigState((prev) => (prev ? { ...prev, apiKeyReplacement: e.target.value } : prev)),
            style: mergeStyle(styles.searchInput, { flex: "unset" }),
          }),
          {
            helpKey: "config.help.api_key",
            extra: createElement(
              "span",
              { id: "amem-config-key-source", style: styles.configHelp },
              format(t, keySourceKey, { name: llm.api_key_env || "—" }),
            ),
          },
        ),
        configState.apiKeyReplacement.trim() && llm.api_key_env.trim()
          ? createElement(
              "span",
              { style: mergeStyle(styles.configHelp, { color: tokens.warning }) },
              format(t, "config.warnKeyOverridesEnv", { name: llm.api_key_env }),
            )
          : null,
        field(
          "amem-config-api-key-env",
          "config.field.api_key_env",
          createElement("input", {
            id: "amem-config-api-key-env",
            "aria-describedby": "amem-config-api-key-env-help",
            type: "text",
            value: llm.api_key_env,
            disabled: configBusy,
            onChange: (e: { target: { value: string } }) => setLlm({ api_key_env: e.target.value }),
            style: mergeStyle(styles.searchInput, { flex: "unset" }),
          }),
          { helpKey: "config.help.api_key_env" },
        ),
      ),
      createElement(
        "section",
        { style: styles.configSection },
        createElement("h3", { style: { margin: 0 } }, format(t, "config.section.refine")),
        createElement(
          "div",
          { style: styles.configField },
          createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: tokens.space2 } },
            createElement("input", {
              id: "amem-config-refine-proposals",
              "aria-describedby": "amem-config-refine-help",
              type: "checkbox",
              checked: readRefineProposals(configState.config),
              disabled: configBusy,
              style: { margin: 0, flex: "0 0 auto" },
              onChange: (e: { target: { checked: boolean } }) => {
                const checked = e.target.checked;
                setConfigState((prev) =>
                  prev
                    ? { ...prev, config: patchRefineProposals(prev.config, checked) }
                    : prev,
                );
              },
            }),
            createElement(
              "label",
              { htmlFor: "amem-config-refine-proposals", style: styles.configLabel },
              format(t, "config.field.refine_proposals"),
            ),
          ),
          createElement(
            "span",
            { id: "amem-config-refine-help", style: styles.configHelp },
            format(t, "config.help.refine_proposals"),
          ),
        ),
      ),
      configMsg
        ? createElement(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: tokens.space1 } },
            createElement(StatusMessage, { t, kind: "success", message: configMsg }),
            createElement(
              "span",
              { style: { fontSize: 12, color: tokens.textMuted } },
              format(t, "config.hintReload"),
            ),
          )
        : null,
      createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: tokens.space2,
            marginTop: tokens.space3,
            flexWrap: "wrap",
          },
        },
        createElement(
          "button",
          { type: "button", disabled: configBusy, onClick: reloadConfig, style: styles.button },
          format(t, "config.reload"),
        ),
        createElement(
          "button",
          {
            type: "button",
            disabled: configBusy || !dirty,
            onClick: () => void saveConfig(),
            style: mergeStyle(
              styles.button,
              styles.primaryButton,
              configBusy || !dirty ? { opacity: 0.6, cursor: "not-allowed" } : undefined,
            ),
          },
          format(t, "config.save"),
        ),
        dirty
          ? createElement(
              "span",
              { style: { fontSize: 12, color: tokens.textMuted } },
              format(t, "config.dirtyHint"),
            )
          : null,
      ),
    );
  };

  const helpSections: { title: AmemKey; body: AmemKey }[] = [
    { title: "help.layersTitle", body: "help.layersBody" },
    { title: "help.flowTitle", body: "help.flowBody" },
    { title: "help.tabsTitle", body: "help.tabsBody" },
    { title: "help.cliTitle", body: "help.cliBody" },
    { title: "help.gateTitle", body: "help.gateBody" },
    { title: "help.accelerateTitle", body: "help.accelerateBody" },
  ];

  const renderHelp = () =>
    createElement(
      "div",
      null,
      ...helpSections.map(({ title, body }) =>
        createElement(
          "section",
          { key: title, style: { marginBottom: tokens.space4 } },
          createElement("h3", { style: { margin: `0 0 ${tokens.space2}` } }, format(t, title)),
          createElement("p", { style: { margin: 0, lineHeight: 1.6, color: tokens.text } }, format(t, body)),
        ),
      ),
    );

  const renderContent = () => {
    switch (tab) {
      case "memories":
        return renderMemories();
      case "skills":
        return renderSkills();
      case "proposals":
        return renderProposals();
      case "review":
        return renderReview();
      case "ops":
        return renderOps();
      case "config":
        return renderConfig();
      case "help":
        return renderHelp();
      default:
        return null;
    }
  };

  const renderWorkbench = () => {
    const summaryCounts = {
      memories: currentData?.total ?? 0,
      conflicts: conflicts.length,
      proposals: proposals.length,
    };
    return createElement(
      "div",
      { style: styles.panel },
      createElement(
        "header",
        { style: styles.header },
        createElement("h2", { style: styles.headerTitle }, format(t, "title")),
        createElement(
          "div",
          { style: styles.headerMeta },
          format(t, "header.summary", summaryCounts),
        ),
      ),
      narrow
        ? createElement(TopNav, { t, activeId: tab, onChange: (id) => requestTab(id as Tab) })
        : null,
      createElement(
        "div",
        { style: styles.layout },
        !narrow
          ? createElement(SideNav, { t, activeId: tab, onChange: (id) => requestTab(id as Tab) })
          : null,
        createElement(
          "main",
          { style: styles.content },
          authState.kind === "ready" &&
          authState.authEnabled &&
            createElement(
              "div",
              { style: { display: "flex", justifyContent: "flex-end", padding: tokens.space2 } },
              createElement(
                "button",
                {
                  type: "button",
                  onClick: onLogout,
                  style: mergeStyle(styles.button, styles.ghostButton, { fontSize: 12 }),
                },
                format(t, "unlock.logout"),
              ),
            ),
          tabError
            ? createElement(StatusMessage, {
                t,
                kind: "error",
                message: tabError,
              })
            : null,
          tab === "memories" &&
            createElement(FilterBar, {
              t,
              filters: { ...filters, pageSize: filters.pageSize },
              searchValue: searchInput,
              facets: currentData?.facets,
              busy: listState.kind === "loading" || tabBusy,
              onSearch,
              onFilter: updateFilter,
              onPageSize: updatePageSize,
              onRefresh: () => void loadMemories(filters),
              onClear: clearFilters,
              narrow,
            }),
          createElement(
            "div",
            { style: styles.scrollArea },
            renderContent(),
          ),
        ),
      ),
    );
  };

  if (authState.kind === "unavailable") {
    return createElement(
      "div",
      { style: { padding: tokens.space4 } },
      createElement(StatusMessage, {
        t,
        kind: "error",
        message: authState.message,
      }),
      createElement(
        "button",
        {
          type: "button",
          style: styles.button,
          onClick: () => {
            setAuthState({ kind: "unlocking" });
            void getAuthStatus().then(setAuthState);
          },
        },
        format(t, "refresh.button"),
      ),
    );
  }

  if (authState.kind === "locked" || authState.kind === "error") {
    return createElement(UnlockView, {
      t,
      busy: false,
      error: authState.kind === "error" ? authState.message : null,
      onUnlock,
    });
  }

  if (authState.kind === "unlocking") {
    return createElement(UnlockView, {
      t,
      busy: true,
      error: null,
      onUnlock,
    });
  }

  return renderWorkbench();
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
