# Task 3 Report: GET/PUT `/amem-api/config`

## Status

**Complete**

## Changes

- `packages/adapter-dsh/src/plugin.ts`: Added `GET /config` and `PUT /config` handlers after `/compile`, before 404. Mirrors `/doctor` response shaping via `sendJson`. PUT wraps `JSON.parse` in try/catch and returns `{ error: "bad_request", message: "invalid JSON" }` with status 400 on parse failure.
- `packages/adapter-dsh/src/plugin.test.ts`: Two route tests — `GET /config` returns 200 with `path` and `config`; `PUT /config` with malformed body returns 400.

## Build / test

| Command | Result |
|---------|--------|
| `cd packages/adapter-dsh && pnpm build` | exit 0 |
| `pnpm test` (adapter-dsh) | 25 passed (4 files) |

## Notes

- Admin logic unchanged; routes delegate to existing `createAdmin().getConfig()` / `putConfig(body)`.
- No git commit (per task constraints).

## Concerns

None.
