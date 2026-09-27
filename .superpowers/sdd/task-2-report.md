# Task 2 Report: Admin getConfig / putConfig

## Status

**Complete.** `createAdmin(home)` exposes `getConfig()` and `putConfig(body)` per brief.

## Changes

| File | Action |
|------|--------|
| `packages/adapter-dsh/src/admin-config.test.ts` | Created (5 cases from brief; embedding test uses explicit `defaultConfig` write instead of fragile triple-`replace`) |
| `packages/adapter-dsh/src/admin.ts` | Added imports from `@amem/core` + `readFileSync`; implemented `getConfig` / `putConfig` |

## TDD

1. Tests added first → 5 failures (`getConfig` / `putConfig` missing).
2. Implementation added → initially 4 failures until `@amem/core` was rebuilt (stale `dist` lacked Task 1 exports).
3. Final: **5/5 pass** (`pnpm test -- src/admin-config.test.ts`).

## Behavior (putConfig)

- `extractEditableConfigPatch` → 400 on shape errors.
- `validateEditableConfigPatch` → 400 on invalid fields (e.g. `llm.mode: "nope"`).
- `loadConfig` as base → `mergeConfigOverlay` → force `embedding` + `privacy` from base → `writeAmemConfigFile(home, merged, disk)` for privacy TOML preservation.
- Uncaught exceptions → 500 `{ error: "internal", ... }`.
- Accepts `{ config: AmemConfig }` or top-level `AmemConfig`.

## getConfig

Returns `{ ok: true, data: { path, config: loadConfig(home) } }`.

## Self-review

- Matches brief sketches; no duplicate core logic.
- Aligns with existing `AdminResult` pattern (`ok` / `status` on errors).
- Defense-in-depth: embedding/privacy forced from disk-loaded base after merge (body cannot alter them).
- **Note:** Local dev requires `@amem/core` build after Task 1 so exports exist in `dist` (workspace resolves to `main`).
- **Out of scope (Task 3):** HTTP route JSON.parse errors; brief defers to routing layer.

## Commits

None (per user constraint).

## Verification commands

```bash
cd packages/core && pnpm build   # if Task 1 APIs not in dist yet
cd packages/adapter-dsh && pnpm test -- src/admin-config.test.ts
cd packages/adapter-dsh && pnpm build
```
