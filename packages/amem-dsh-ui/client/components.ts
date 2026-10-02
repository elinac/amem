import { createElement, type ReactNode } from "react";
import { styles, tokens } from "./styles.js";
import type {
  ListMemoryFilters,
  MemoryFacets,
  MemoryKind,
  MemoryListItem,
  MemoryStatus,
  ScopeLevel,
  Trust,
} from "./api.js";
import {
  MEMORY_KINDS,
  MEMORY_STATUSES,
  PAGE_SIZES,
  SCOPE_LEVELS,
  TRUSTS,
} from "./api.js";
import type { AmemKey } from "./locales.js";

export type Translate = (
  key: AmemKey | string,
  params?: Record<string, string | number>,
) => string;

export function format(
  t: Translate,
  key: AmemKey | string,
  params?: Record<string, string | number>,
): string {
  const raw = t(key, params);
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] !== null && params[name] !== undefined
      ? String(params[name])
      : `{${name}}`,
  );
}

type NavItem = {
  id: string;
  label: string;
  group: "assets" | "system";
};

const NAV_ITEMS: NavItem[] = [
  { id: "memories", label: "tab.memories", group: "assets" },
  { id: "proposals", label: "tab.proposals", group: "assets" },
  { id: "skills", label: "tab.skills", group: "assets" },
  { id: "review", label: "tab.review", group: "assets" },
  { id: "ops", label: "tab.ops", group: "system" },
  { id: "config", label: "tab.config", group: "system" },
  { id: "help", label: "tab.help", group: "system" },
];

export function mergeStyle(
  base: React.CSSProperties,
  ...overrides: (React.CSSProperties | undefined)[]
): React.CSSProperties {
  let out = base;
  for (const override of overrides) {
    if (!override) continue;
    out = { ...out, ...override };
  }
  return out;
}

export function UnlockView(props: {
  t: Translate;
  busy: boolean;
  error: string | null;
  onUnlock: (token: string) => void;
}): React.ReactElement {
  const { t, busy, error, onUnlock } = props;
  const inputRef = { current: null as HTMLInputElement | null };

  const submit = () => {
    const el = inputRef.current;
    const token = (el?.value ?? "").trim();
    if (el) el.value = "";
    if (token) onUnlock(token);
  };

  return createElement(
    "div",
    { style: styles.panel },
    createElement(
      "div",
      { style: styles.unlockCard },
      createElement("h2", { style: { marginTop: 0 } }, format(t, "unlock.title")),
      createElement(
        "p",
        { style: { fontSize: 13, color: tokens.textMuted, lineHeight: 1.5 } },
        format(t, "unlock.hint"),
      ),
      createElement("input", {
        type: "password",
        "aria-label": format(t, "unlock.inputLabel"),
        placeholder: format(t, "unlock.placeholder"),
        disabled: busy,
        autoFocus: true,
        autoComplete: "off",
        ref: (node: HTMLInputElement | null) => {
          inputRef.current = node;
        },
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        },
        style: styles.unlockInput,
      }),
      error
        ? createElement(
            "p",
            {
              role: "alert",
              "aria-live": "polite",
              style: { color: tokens.danger, fontSize: 13, margin: `${tokens.space2} 0 0` },
            },
            error,
          )
        : null,
      createElement(
        "button",
        {
          type: "button",
          disabled: busy,
          onClick: submit,
          style: mergeStyle(styles.button, styles.primaryButton, {
            marginTop: tokens.space3,
            width: "100%",
          }),
        },
        busy ? format(t, "unlock.unlocking") : format(t, "unlock.button"),
      ),
    ),
  );
}

function SideNavGroup(props: {
  t: Translate;
  titleKey: string;
  items: NavItem[];
  activeId: string;
  onChange: (id: string) => void;
}): React.ReactElement | null {
  const { t, titleKey, items, activeId, onChange } = props;
  if (items.length === 0) return null;
  return createElement(
    "div",
    { style: styles.navGroup },
    createElement("h3", { style: styles.navGroupLabel }, format(t, titleKey)),
    ...items.map((item) =>
      createElement(
        "button",
        {
          key: item.id,
          type: "button",
          onClick: () => onChange(item.id),
          "aria-current": activeId === item.id ? "page" : undefined,
          style: mergeStyle(
            styles.navButton,
            activeId === item.id ? styles.navButtonActive : undefined,
          ),
        },
        format(t, item.label),
      ),
    ),
  );
}

export function SideNav(props: {
  t: Translate;
  activeId: string;
  onChange: (id: string) => void;
}): React.ReactElement {
  const { t, activeId, onChange } = props;
  const assets = NAV_ITEMS.filter((i) => i.group === "assets");
  const system = NAV_ITEMS.filter((i) => i.group === "system");
  return createElement(
    "nav",
    { style: styles.sideNav, "aria-label": format(t, "nav.label") },
    SideNavGroup({ t, titleKey: "nav.assets", items: assets, activeId, onChange }),
    SideNavGroup({ t, titleKey: "nav.system", items: system, activeId, onChange }),
  );
}

export function TopNav(props: {
  t: Translate;
  activeId: string;
  onChange: (id: string) => void;
}): React.ReactElement {
  const { t, activeId, onChange } = props;
  return createElement(
    "nav",
    {
      style: styles.topNav,
      "aria-label": format(t, "nav.label"),
      role: "tablist",
    },
    ...NAV_ITEMS.map((item) =>
      createElement(
        "button",
        {
          key: item.id,
          type: "button",
          role: "tab",
          "aria-selected": activeId === item.id,
          onClick: () => onChange(item.id),
          style: mergeStyle(
            styles.topNavButton,
            activeId === item.id ? styles.topNavButtonActive : undefined,
          ),
        },
        format(t, item.label),
      ),
    ),
  );
}


export function enumLabel(
  t: Translate,
  prefix: "kind" | "level" | "trust" | "status",
  value: string,
): string {
  const key = `${prefix}.${value}` as AmemKey;
  const labeled = format(t, key);
  return labeled === key ? value : labeled;
}

function FilterSelect<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  counts: Record<T, number> | undefined;
  onChange: (value: T | undefined) => void;
  labelOf: (value: T) => string;
  "aria-label"?: string;
}): React.ReactElement {
  const { label, value, options, counts, onChange, labelOf } = props;
  return createElement(
    "label",
    { style: { display: "flex", alignItems: "center", gap: tokens.space1, fontSize: 13 } },
    createElement("span", null, label),
    createElement(
      "select",
      {
        value: value ?? "",
        onChange: (e: { target: { value: string } }) => {
          const v = e.target.value;
          onChange((v || undefined) as T | undefined);
        },
        "aria-label": props["aria-label"] ?? label,
        style: styles.select,
      },
      createElement("option", { value: "" }, `${label}: 全部`),
      ...options.map((opt) => {
        const count = counts?.[opt] ?? 0;
        return createElement(
          "option",
          { key: opt, value: opt, disabled: count === 0 },
          `${labelOf(opt)} (${count})`,
        );
      }),
    ),
  );
}

export function FilterBar(props: {
  t: Translate;
  filters: ListMemoryFilters & { pageSize: number };
  searchValue: string;
  facets: MemoryFacets | undefined;
  busy: boolean;
  onSearch: (q: string) => void;
  onFilter: (patch: Partial<ListMemoryFilters>) => void;
  onPageSize: (pageSize: number) => void;
  onRefresh: () => void;
  onClear: () => void;
  narrow: boolean;
}): React.ReactElement {
  const {
    t,
    filters,
    searchValue,
    facets,
    busy,
    onSearch,
    onFilter,
    onPageSize,
    onRefresh,
    onClear,
    narrow,
  } = props;

  const pageSize = filters.pageSize;

  const searchInput = createElement("input", {
    type: "search",
    value: searchValue,
    placeholder: format(t, "search.placeholder"),
    "aria-label": format(t, "search.placeholder"),
    disabled: busy,
    onChange: (e: { target: { value: string } }) => {
      onSearch(e.target.value);
    },
    style: mergeStyle(styles.searchInput, { flex: narrow ? "1 0 140px" : undefined }),
  });

  const children: ReactNode[] = [
    searchInput,
    FilterSelect<MemoryKind>({
      label: format(t, "filter.kind"),
      value: filters.kind,
      options: MEMORY_KINDS,
      counts: facets?.kind,
      labelOf: (v) => enumLabel(t, "kind", v),
      onChange: (v) => onFilter({ kind: v }),
      "aria-label": format(t, "filter.kind"),
    }),
    FilterSelect<ScopeLevel>({
      label: format(t, "filter.level"),
      value: filters.level,
      options: SCOPE_LEVELS,
      counts: facets?.level,
      labelOf: (v) => enumLabel(t, "level", v),
      onChange: (v) => onFilter({ level: v }),
    }),
    FilterSelect<Trust>({
      label: format(t, "filter.trust"),
      value: filters.trust,
      options: TRUSTS,
      counts: facets?.trust,
      labelOf: (v) => enumLabel(t, "trust", v),
      onChange: (v) => onFilter({ trust: v }),
    }),
    FilterSelect<MemoryStatus>({
      label: format(t, "filter.status"),
      value: filters.status,
      options: MEMORY_STATUSES,
      counts: facets?.status,
      labelOf: (v) => enumLabel(t, "status", v),
      onChange: (v) => onFilter({ status: v }),
    }),
    createElement(
      "select",
      {
        value: pageSize,
        onChange: (e: { target: { value: string } }) => onPageSize(Number(e.target.value)),
        "aria-label": format(t, "pagination.pageSize"),
        style: styles.select,
      },
      ...PAGE_SIZES.map((n) => createElement("option", { key: n, value: n }, `${n}/页`)),
    ),
    createElement(
      "button",
      {
        type: "button",
        disabled: busy,
        onClick: onRefresh,
        style: styles.button,
      },
      format(t, "refresh.button"),
    ),
    createElement(
      "button",
      {
        type: "button",
        disabled: busy,
        onClick: onClear,
        style: mergeStyle(styles.button, styles.ghostButton),
      },
      format(t, "filter.clear"),
    ),
  ];

  return createElement(
    "div",
    { style: narrow ? styles.toolbarNarrow : styles.toolbar, role: "search" },
    ...children,
  );
}

export function MemoryRow(props: {
  t: Translate;
  row: MemoryListItem;
  onForget: (id: string) => void;
  canForget: boolean;
  gateGaps?: string;
}): React.ReactElement {
  const { t, row, onForget, canForget, gateGaps } = props;
  const meta = [
    enumLabel(t, "kind", row.kind),
    enumLabel(t, "level", row.level),
    enumLabel(t, "trust", row.trust),
    enumLabel(t, "status", row.status),
    format(t, "meta.helpful", { helpful: row.helpful, harmful: row.harmful }),
  ].join(" · ");

  return createElement(
    "article",
    {
      style: styles.row,
      "aria-label": `${row.title} ${row.id}`,
    },
    createElement(
      "div",
      { style: { minWidth: 0, flex: 1 } },
      createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: tokens.space2, flexWrap: "wrap" } },
        createElement("span", { style: styles.rowTitle }, row.title),
        createElement("span", { style: styles.badge }, enumLabel(t, "status", row.status)),
      ),
      createElement("div", { style: styles.rowMeta }, meta),
      gateGaps
        ? createElement(
            "div",
            { style: { ...styles.rowMeta, color: tokens.danger } },
            `${format(t, "gate.rowPrefix")}: ${gateGaps}`,
          )
        : null,
      row.applies_when
        ? createElement("div", { style: styles.rowMeta }, row.applies_when)
        : null,
      row.content
        ? createElement("div", { style: styles.rowPreview }, row.content)
        : null,
      createElement(
        "div",
        { style: { ...styles.rowMeta, fontFamily: tokens.monoFont, marginTop: tokens.space1 } },
        `${row.id} · ${row.updated_at}`,
      ),
    ),
    canForget
      ? createElement(
          "button",
          {
            type: "button",
            onClick: () => onForget(row.id),
            style: mergeStyle(styles.button, styles.dangerButton),
          },
          format(t, "forget.button"),
        )
      : null,
  );
}

export function Pagination(props: {
  t: Translate;
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}): React.ReactElement {
  const { t, page, pageSize, total, onPage } = props;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return createElement(
    "div",
    { style: styles.pagination },
    createElement(
      "span",
      { style: styles.pageInfo },
      format(t, "pagination.info", { start, end, total }),
    ),
    createElement(
      "div",
      { style: styles.pageControls },
      createElement(
        "button",
        {
          type: "button",
          disabled: page <= 1,
          onClick: () => onPage(page - 1),
          style: styles.button,
        },
        format(t, "pagination.prev"),
      ),
      createElement(
        "span",
        { style: { fontSize: 13 } },
        format(t, "pagination.page", { page, maxPage }),
      ),
      createElement(
        "button",
        {
          type: "button",
          disabled: page >= maxPage || total === 0,
          onClick: () => onPage(page + 1),
          style: styles.button,
        },
        format(t, "pagination.next"),
      ),
    ),
  );
}

export function StatusMessage(props: {
  t: Translate;
  kind: "info" | "error" | "warning" | "success";
  message: string;
}): React.ReactElement {
  const { kind, message } = props;
  const variant =
    kind === "error"
      ? styles.errorBox
      : kind === "warning"
        ? styles.warningBox
        : kind === "success"
          ? styles.successBox
          : styles.statusBox;
  return createElement(
    "div",
    {
      role: kind === "error" ? "alert" : "status",
      "aria-live": "polite",
      style: mergeStyle(styles.statusBox, variant),
    },
    message,
  );
}

export function SkeletonList(props: { count?: number }): React.ReactElement {
  const count = props.count ?? 6;
  return createElement(
    "div",
    { "aria-busy": true, "aria-label": "loading" },
    ...Array.from({ length: count }, (_, i) =>
      createElement("div", { key: i, style: styles.skeleton }),
    ),
  );
}

export function EmptyState(props: {
  t: Translate;
  messageKey: AmemKey;
  action?: { label: AmemKey; onClick: () => void };
}): React.ReactElement {
  const { t, messageKey, action } = props;
  return createElement(
    "div",
    { style: { textAlign: "center", padding: tokens.space5, color: tokens.textMuted } },
    createElement("p", null, format(t, messageKey)),
    action
      ? createElement(
          "button",
          { type: "button", onClick: action.onClick, style: styles.button },
          format(t, action.label),
        )
      : null,
  );
}
