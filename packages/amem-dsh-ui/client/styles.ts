/**
 * DSH workbench design tokens.
 *
 * Colours prefer host-provided CSS variables and fall back to a system-aware
 * palette (light/dark via `prefers-color-scheme`).  No gradients, heavy
 * shadows or card walls.
 */

export const tokens = {
  surface: "var(--amem-surface, var(--dsh-surface, #ffffff))",
  surfaceRaised: "var(--amem-surface-raised, var(--dsh-surface-raised, #f7f7f7))",
  text: "var(--amem-text, var(--dsh-text, #1a1a1a))",
  textMuted: "var(--amem-text-muted, var(--dsh-text-muted, #666666))",
  border: "var(--amem-border, var(--dsh-border, #d9d9d9))",
  accent: "var(--amem-accent, var(--dsh-accent, #2563eb))",
  danger: "var(--amem-danger, var(--dsh-danger, #dc2626))",
  warning: "var(--amem-warning, var(--dsh-warning, #d97706))",
  success: "var(--amem-success, var(--dsh-success, #16a34a))",
  radiusSm: "var(--amem-radius-sm, 4px)",
  radiusMd: "var(--amem-radius-md, 6px)",
  space1: "var(--amem-space-1, 4px)",
  space2: "var(--amem-space-2, 8px)",
  space3: "var(--amem-space-3, 12px)",
  space4: "var(--amem-space-4, 16px)",
  space5: "var(--amem-space-5, 20px)",
  space6: "var(--amem-space-6, 24px)",
  fontStack: "var(--amem-font, var(--dsh-font, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif))",
  monoFont: "var(--amem-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
  focusRing: "0 0 0 2px var(--amem-accent, var(--dsh-accent, #2563eb))",
  shadowSm: "0 1px 2px rgba(0, 0, 0, 0.06)",
} as const;

/** Breakpoint for narrow layout (matches design §8). */
export const NARROW_BREAKPOINT = 720;

/** Shared style objects used by components. */
export const styles = {
  panel: {
    fontFamily: tokens.fontStack,
    color: tokens.text,
    background: tokens.surface,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } as React.CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
    padding: `${tokens.space3} ${tokens.space4}`,
    borderBottom: `1px solid ${tokens.border}`,
    flexShrink: 0,
  } as React.CSSProperties,

  headerTitle: {
    fontSize: 16,
    fontWeight: 700,
    margin: 0,
  } as React.CSSProperties,

  headerMeta: {
    fontSize: 12,
    color: tokens.textMuted,
  } as React.CSSProperties,

  layout: {
    display: "flex",
    flex: 1,
    minHeight: 0,
  } as React.CSSProperties,

  sideNav: {
    width: 160,
    flexShrink: 0,
    borderRight: `1px solid ${tokens.border}`,
    padding: `${tokens.space3} 0`,
    overflowY: "auto",
  } as React.CSSProperties,

  topNav: {
    display: "flex",
    gap: tokens.space1,
    padding: `${tokens.space2} ${tokens.space3}`,
    borderBottom: `1px solid ${tokens.border}`,
    overflowX: "auto",
    flexShrink: 0,
  } as React.CSSProperties,

  navGroup: {
    marginBottom: tokens.space3,
  } as React.CSSProperties,

  navGroupLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: tokens.textMuted,
    padding: `${tokens.space2} ${tokens.space3}`,
    margin: 0,
  } as React.CSSProperties,

  navButton: {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding: `${tokens.space2} ${tokens.space3}`,
    fontSize: 13,
    background: "transparent",
    border: "none",
    borderLeft: "3px solid transparent",
    cursor: "pointer",
    color: tokens.text,
  } as React.CSSProperties,

  navButtonActive: {
    background: tokens.surfaceRaised,
    borderLeftColor: tokens.accent,
    fontWeight: 600,
  } as React.CSSProperties,

  topNavButton: {
    flex: "0 0 auto",
    padding: `${tokens.space2} ${tokens.space3}`,
    fontSize: 13,
    background: "transparent",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    cursor: "pointer",
    color: tokens.text,
  } as React.CSSProperties,

  topNavButtonActive: {
    background: tokens.surfaceRaised,
    borderColor: tokens.accent,
    fontWeight: 600,
  } as React.CSSProperties,

  content: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } as React.CSSProperties,

  scrollArea: {
    flex: 1,
    overflow: "auto",
    padding: tokens.space4,
  } as React.CSSProperties,

  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: tokens.space2,
    paddingBottom: tokens.space3,
    borderBottom: `1px solid ${tokens.border}`,
    marginBottom: tokens.space3,
  } as React.CSSProperties,

  toolbarNarrow: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space2,
    paddingBottom: tokens.space3,
    borderBottom: `1px solid ${tokens.border}`,
    marginBottom: tokens.space3,
    overflowX: "auto",
    flexWrap: "nowrap",
  } as React.CSSProperties,

  searchInput: {
    flex: "1 1 180px",
    minWidth: 140,
    padding: tokens.space2,
    fontSize: 13,
    fontFamily: "inherit",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    background: tokens.surface,
    color: tokens.text,
  } as React.CSSProperties,

  select: {
    padding: `${tokens.space2} ${tokens.space3} ${tokens.space2} ${tokens.space2}`,
    fontSize: 13,
    fontFamily: "inherit",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    background: tokens.surface,
    color: tokens.text,
    minWidth: 100,
  } as React.CSSProperties,

  button: {
    padding: `${tokens.space2} ${tokens.space3}`,
    fontSize: 13,
    fontFamily: "inherit",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    background: tokens.surfaceRaised,
    color: tokens.text,
    cursor: "pointer",
  } as React.CSSProperties,

  primaryButton: {
    background: tokens.accent,
    color: "#fff",
    borderColor: tokens.accent,
  } as React.CSSProperties,

  dangerButton: {
    color: tokens.danger,
    borderColor: tokens.danger,
  } as React.CSSProperties,

  ghostButton: {
    background: "transparent",
    borderColor: "transparent",
  } as React.CSSProperties,

  disabledButton: {
    opacity: 0.55,
    cursor: "not-allowed",
  } as React.CSSProperties,

  badge: {
    display: "inline-block",
    fontSize: 11,
    fontWeight: 600,
    padding: `2px 6px`,
    borderRadius: tokens.radiusSm,
    border: `1px solid ${tokens.border}`,
    background: tokens.surfaceRaised,
    textTransform: "capitalize",
  } as React.CSSProperties,

  row: {
    borderBottom: `1px solid ${tokens.border}`,
    padding: `${tokens.space3} 0`,
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.space3,
  } as React.CSSProperties,

  rowTitle: {
    fontWeight: 600,
    fontSize: 14,
  } as React.CSSProperties,

  rowMeta: {
    fontSize: 12,
    color: tokens.textMuted,
    marginTop: tokens.space1,
  } as React.CSSProperties,

  rowPreview: {
    fontSize: 12,
    color: tokens.text,
    opacity: 0.9,
    marginTop: tokens.space2,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  } as React.CSSProperties,

  pagination: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: tokens.space3,
    paddingTop: tokens.space3,
    borderTop: `1px solid ${tokens.border}`,
    marginTop: "auto",
    flexWrap: "wrap",
  } as React.CSSProperties,

  pageInfo: {
    fontSize: 13,
    color: tokens.textMuted,
  } as React.CSSProperties,

  pageControls: {
    display: "flex",
    alignItems: "center",
    gap: tokens.space2,
  } as React.CSSProperties,

  statusBox: {
    padding: tokens.space3,
    borderRadius: tokens.radiusMd,
    border: `1px solid ${tokens.border}`,
    background: tokens.surfaceRaised,
    fontSize: 13,
  } as React.CSSProperties,

  errorBox: {
    borderColor: tokens.danger,
    color: tokens.danger,
    background: "rgba(220, 38, 38, 0.06)",
  } as React.CSSProperties,

  warningBox: {
    borderColor: tokens.warning,
    color: tokens.warning,
    background: "rgba(217, 119, 6, 0.06)",
  } as React.CSSProperties,

  successBox: {
    borderColor: tokens.success,
    color: tokens.success,
    background: "rgba(22, 163, 74, 0.06)",
  } as React.CSSProperties,

  skeleton: {
    height: 56,
    borderRadius: tokens.radiusSm,
    background: tokens.surfaceRaised,
    marginBottom: tokens.space2,
  } as React.CSSProperties,

  unlockCard: {
    maxWidth: 420,
    margin: "auto",
    padding: tokens.space5,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusMd,
    background: tokens.surfaceRaised,
    boxShadow: tokens.shadowSm,
  } as React.CSSProperties,

  unlockInput: {
    width: "100%",
    padding: tokens.space2,
    fontSize: 13,
    fontFamily: "inherit",
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
    background: tokens.surface,
    color: tokens.text,
    boxSizing: "border-box",
  } as React.CSSProperties,

  configSection: {
    marginBottom: tokens.space4,
    display: "flex",
    flexDirection: "column",
    gap: tokens.space2,
  } as React.CSSProperties,

  configFieldRow: {
    display: "flex",
    gap: tokens.space2,
    flexWrap: "wrap",
  } as React.CSSProperties,

  configField: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.space1,
    flex: "1 1 220px",
    minWidth: 200,
  } as React.CSSProperties,

  configLabel: {
    fontSize: 13,
    fontWeight: 600,
  } as React.CSSProperties,

  configHelp: {
    fontSize: 12,
    color: tokens.textMuted,
    lineHeight: 1.4,
  } as React.CSSProperties,

  detailsRaw: {
    marginTop: tokens.space2,
    padding: tokens.space3,
    background: tokens.surfaceRaised,
    border: `1px solid ${tokens.border}`,
    borderRadius: tokens.radiusSm,
  } as React.CSSProperties,

  preRaw: {
    margin: 0,
    fontSize: 12,
    fontFamily: tokens.monoFont,
    overflow: "auto",
    maxHeight: 360,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  } as React.CSSProperties,
} as const;
