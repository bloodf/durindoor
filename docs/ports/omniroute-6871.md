# Port log: OmniRoute PR #6871

- **Source:** https://github.com/diegosouzapw/OmniRoute/pull/6871
- **Port branch:** `port/omniroute-6871`
- **`origin/dev` SHA at preflight:** `397d54b6a42c4056d7f375cc51c0567c5a4b71ff`

## Behavior ported

Mutating API routes must return 400 (not 500) on a malformed JSON request body. A JSON body is now parsed at the trust boundary, OUTSIDE the route's broad `try/catch`, so an unparseable (or non-object) body is a clean client-error 400 instead of falling into the generic-500 handler. Downstream (non-parse) failures keep their pre-existing status.

## DurinDoor adaptation

OmniRoute's exact endpoints (`model-combo-mappings`, `plugins/[name]/config`) do not exist on DurinDoor. The same broad-try parse defect lived in the combo-management API, so the boundary is applied there:

- New shared parser `src/shared/utils/parseJsonBody.js` — `parseJsonBody(request)` returns `{ ok: true, body }` or `{ ok: false, response }` with a 400 `{ error: "Invalid JSON body" }`. Matches the local `/api/*` error contract (sibling `/api/keys` uses the same shape). Rejects unparseable JSON AND parseable-but-non-object bodies (null/array/scalar) that would otherwise crash destructuring downstream.
- `POST /api/combos` and `PUT /api/combos/[id]` call `parseJsonBody` first; destructuring / `params` / DB work stay inside the existing `try`, preserving prior catch coverage and the generic-500 path for downstream errors.

## Files (5)

- `src/shared/utils/parseJsonBody.js`
- `src/app/api/combos/route.js`
- `src/app/api/combos/[id]/route.js`
- `tests/unit/api-combos-malformed-json.test.js`
- `docs/ports/omniroute-6871.md`

## Controls tested

- malformed JSON body → 400 (POST and PUT), no DB work attempted.
- well-formed but non-object JSON body (`["a"]`, `null`) → 400.
- valid body → success (201 create / 200 update), happy path unregressed.
- handler-error control: valid body whose downstream DB step rejects → still 500 (`Failed to create/update combo`), proving the boundary does not flatten server errors to 400.

## Verification

```text
cd tests && ~/.local/node20/bin/node node_modules/vitest/vitest.mjs run --config vitest.config.js unit/api-combos-malformed-json.test.js
Test Files  1 passed (1)
Tests       8 passed (8)
```
