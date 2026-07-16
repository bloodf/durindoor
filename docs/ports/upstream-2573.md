# Port log: upstream 9router PR #2573

- **Source:** https://github.com/decolua/9router/pull/2573
- **Source title:** `fix(byteplus): use standard ModelArk endpoint, not Coding Plan endpoint`
- **Source head SHA:** `7824ebb211141cf57cd5e26e97bc94a2ac3e7529`
- **Port branch:** `port/upstream-2573`

## Phase-0 preflight

Source diff (`gh pr diff 2573 -R decolua/9router`) is a one-line change to
`open-sse/providers/registry/byteplus.js`:

```diff
-    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions",
+    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions",
```

`origin/dev` (start SHA `397d54b6a42c4056d7f375cc51c0567c5a4b71ff`) still had
`transport.baseUrl = "https://ark.ap-southeast.bytepluses.com/api/coding/v3/chat/completions"`
in `open-sse/providers/registry/byteplus.js` — change absent, so the port proceeds.

## Behavior ported

The BytePlus ModelArk free-tier provider now targets the standard ModelArk
endpoint `/api/v3/chat/completions` instead of the Coding Plan endpoint
`/api/coding/v3/chat/completions`. Ported exactly as the upstream one-line
`baseUrl` replacement; no other registry fields touched.

## Files (4)

- `open-sse/providers/registry/byteplus.js`
- `tests/unit/port-2573-byteplus-modelark-endpoint.test.js`
- `docs/ports/upstream-2573.md`
- `open-sse/AGENT-INDEX.md` (regenerated via `npm run gen:agent-index`)

## Verification

```text
cd tests && node node_modules/vitest/vitest.mjs run unit/port-2573-byteplus-modelark-endpoint.test.js
Test Files  1 passed (1)
Tests       1 passed (1)
```

Red-green check: with the registry change stashed, the focused test fails
(1 failed); with the change applied, it passes (1 passed).

Gates and formatters not run, per assignment.
