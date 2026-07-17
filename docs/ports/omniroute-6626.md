# Port: OmniRoute #6626 (upstream issue #6562) — provider edit "Invalid request" fix

## Source

- PR: `diegosouzapw/OmniRoute#6626` (live diff)
- Files upstream: `src/shared/validation/schemas/provider.ts`, `tests/unit/codex-connection-edit-6562.test.ts`

## Behavior

`priority` auto-increments unbounded on connection creation (`MAX(priority)+1`
per provider; durindoor's `src/lib/db/repos/connectionsRepo.js` does the same),
and the dashboard edit modal always round-trips the connection's current
`priority` unchanged. Bulk OAuth account rotation (e.g. Codex import-bulk)
routinely exceeds 100 connections per provider, so a UI-only `max(100)` ceiling
in the update schema rejected every re-save of an already-valid persisted
priority with a 400 "Invalid request" — the edit could never be saved.

Fix (faithful port): the update ceiling is `max(100_000)` on both `priority`
and `globalPriority` — still bounded, wide enough to accept any priority the
app itself produces. Body validation runs **before** the connection lookup /
any DB write, exactly as in the source route.

## Adaptations (TS/Zod → JS)

- durindoor has no Zod. The source schema
  `z.coerce.number().int().min(1).max(100_000)` is reproduced as a
  `coerceConnectionPriority()` helper (accepts numeric strings, coerces to
  integer, enforces `[1, 100_000]`); the coerced value — not the raw input — is
  what gets persisted.
- The source's `validateBody` failure envelope
  `{ error: { message: "Invalid request", details: [{ field, message }] } }` is
  reproduced by hand as `invalidRequest()`. The upstream regression asserts
  only `body?.error?.message === "Invalid request"`; the per-issue `details`
  text is Zod-generated upstream and is **not** imitated (durindoor emits a
  plain "Invalid value"). Tests assert the upstream `error.message` contract
  plus the local field mapping (`details[0].field`).

## Changes

- `src/app/api/providers/[id]/route.js` — `MAX_CONNECTION_PRIORITY`,
  `coerceConnectionPriority()`, `invalidRequest()`; validate `priority` /
  non-null `globalPriority` before `getProviderConnectionById`; persist coerced
  values.
- `src/app/(dashboard)/dashboard/providers/[id]/page.js` and
  `.../components/ConnectionsCard.js` — priority swap payloads made 1-based
  (`index + 1`) to match the DB's 1-based ordering and the `min(1)` floor, so
  moving a connection from position 0 no longer 400s.

## Test

`tests/unit/api-providers-id-priority-6626.test.js` — mirrors the upstream
regression with two focused cases: a round-tripped priority of `142` (past the
old 100 cap) validates and persists; a `500_000` priority 400s with
`error.message === "Invalid request"` and performs no connection lookup or DB
write (the source route validates the body first).
