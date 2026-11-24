# OmniRoute c40aaac6: scoped auto-combo candidates and read errors

**Status: verified gap, ported in the linked PR.** This report follows up item 9 of [the row 91 report](1073-nov24-row-91-complete.md). That report's 2026-11-24 correction changed `c40aaac6` from not applicable to a verified gap pending port. The port is claimed only with the PR link recorded under [Pull request](#pull-request).

## Upstream change

- Commit: [`c40aaac629ef027b53b6fd50a1bbd8eb6e9fd02f`](https://github.com/cheaper-inference/OmniRoute/commit/c40aaac629ef027b53b6fd50a1bbd8eb6e9fd02f) `fix(combo): keep scoped auto candidates when the connection read fails` (cherry-pick of `6a90e774`, finding F-C4-11, part of #20229). The object was already in the local `omniroute-upstream` object store, so nothing was fetched.
- Full diff: three files. `open-sse/services/combo.ts` (+16/−3), `tests/unit/combo-auto-scope-read-error.test.ts` (new, 77 lines) and `changelog.d/fixes/scoped-auto-read-error.md` (one line).
- Behaviour: in `buildAutoCandidates`, the branch for an API key with a connection allowlist used to replace the expansion targets with `[]` when the active-connection read threw. No candidate was scored and nothing was logged. After the fix, the branch keeps the targets and logs a `COMBO_AUTO` warning with `scopeSize` and a sanitized error. Upstream accepts this because `expandAutoComboCandidatePool` had already bound the targets to permitted connections, and credential selection checks the allowlist again at dispatch.

## DurinDoor before this change

Compared on `origin/main` `560527cfe9c3d7ff333b5f36ae57bf2a687733a3`. The branch base `da0a51c6fe` has no differences from it in any path below.

- `auto/<family>` (for example `auto/glm`) resolves in `getComboModels` (`src/sse/services/model.js`). That call runs `resolveAutoCombo(family, catalog)` and then filters by disabled models, the paid-model toggle and model exposure. It never reads the caller key's `apiKeyProviderConnections` rows.
- `dispatchChat` and `dispatchNestedCombo` (`src/sse/handlers/chat/combo.js`) pass that pool to `handleComboChat`. The quota and lock rankers narrow connections only by the combo's own `allowedConnectionIds` (`comboRouting`), not by the key's scope.
- Authorization was still enforced at dispatch. `getProviderCredentials` (`src/sse/services/auth.js`) intersects the key's relation rows with the combo allowlist. With a restricted scope it never uses a public no-auth credential, and a failed relation read throws, so no request is sent. The `auto`/`best`/`fast`/`cheap` selectors were already scoped through `getRequestModelDiscoveryOptions`.
- **Gap:** a restricted key's `auto/<family>` pool still listed models on providers the key cannot use. Ranking and fallback spent attempts on them. DurinDoor also had no defined behaviour for a failed scope read, or for a failed connection read, while building the pool. Upstream's scoped pool and its read-error rule were missing functionality.

## Change

The layer responsible for this is the chat combo dispatch boundary, where the `auto/<family>` pool is built before ranking.

- New `scopeAutoComboModels(modelStr, models, apiKeyId)` in `src/sse/services/autoComboScope.js`:
  - It applies only to `auto/<family>` ids with a caller `apiKeyId`. Saved combos, unscoped callers and non-array pools are returned unchanged.
  - A key with zero relation rows stays unrestricted, so the pool is unchanged.
  - Otherwise it keeps a model only when `getModelInfo` resolves it to a provider with at least one **active** connection in the key's scope. This matches dispatch, where a restricted key never falls back to a public no-auth credential.
  - **Scope read error** (the relation rows cannot be read): no candidate is kept, so the request fails closed with the combo's controlled empty-pool 503. A sanitized `COMBO_AUTO` warning is logged. Dispatch would also fail closed here, because selection re-reads the same rows. Upstream has no equivalent read in this function.
  - **Active-connection read error** while the scope is known: the pool is kept, and a `COMBO_AUTO` warning with `scopeSize` and `sanitizeErrorMessage(...)` is logged. This is the upstream behaviour. The local pool is not pre-bound to connections the way upstream's is, so authorization here depends on dispatch-time enforcement in `getProviderCredentials`, which fails closed. This change never widens access.
- `dispatchChat` and `dispatchNestedCombo` wrap `getComboModels` with the helper. The ranker, `comboRouting` and saved-combo paths are unchanged.
- Out of scope: auto combos on image, TTS, search and fetch handlers. Upstream's fix is in the chat combo engine. Those handlers still enforce key scope at credential selection. This is recorded in the operator docs.
- Nothing reads, logs or rewrites a stored credential. The helper reads only `id`, `provider` and `isActive` from connection rows.

## Tests

Synthetic key ids (`test-key-*`) and connection ids (`conn-test-*`) only. The DB modules are mocked, and each run used a private `DATA_DIR` under the session scratch directory.

- `tests/unit/auto-combo-key-connection-scope.test.js` (8 tests) covers these cases. Allowed: only the permitted provider remains. Denied: an unknown scope id, or an inactive permitted connection, gives an empty pool. Empty scope: the pool is unchanged and the connection list is not read. Unscoped callers and saved combos are unchanged. Scope read error: an empty pool and one sanitized warning. Connection read error: the pool is kept and the warning includes `scopeSize`. A synthetic bearer token in an error message is not logged.
- `tests/unit/auto-combo-key-connection-scope-dispatch.test.js` (7 tests) checks the pool that reaches `handleComboChat` through `dispatchChat` and `dispatchNestedCombo`. It covers the allowed, denied, empty, scope-read-error, connection-read-error, saved-combo and nested auto paths.
- RED check: with `src/sse/handlers/chat/combo.js` reset to `HEAD`, the dispatch file fails 4 of its 7 tests: allowed, denied, scope read error and nested. The other 3 cases are unchanged by design. With the change, all 7 pass.
- Regression runs from `tests/`, each under five minutes: `npx vitest run combo` passed 86 files and 762 tests. `npx vitest run chat- api-key auto-model autoModel` passed 90 files and 866 tests. `tests/__baseline__/known-fails.txt` was not touched.
- `node scripts/check-docs.mjs` reports 4 errors, all in `docs/operations/stream-status-colors.mdx`, which this change does not touch. They are not caused by this change. ESLint could not run in this checkout because `next/dist/compiled/babel/eslint-parser` is missing after the `--ignore-scripts` install. Lint is left to CI.

## Docs

`docs/operations/api-key-scoping.mdx` has a new section, "Auto combos with a restricted key". It covers the scoped pool, the empty-pool 503, both read-error behaviours and the paths that are out of scope.

## Pull request

[bloodf/durindoor#2496](https://github.com/bloodf/durindoor/pull/2496), opened as a draft against `main` from `orq/tows9a/port-omni-auto-scope-clean`. The effect counts as ported only after that PR merges.
