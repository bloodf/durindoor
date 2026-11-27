# 1073: Kiro discovery context limits

- Inventory: https://github.com/bloodf/durindoor/issues/1073
- Source: https://github.com/cheaper-inference/OmniRoute/pull/15413, merged at https://github.com/cheaper-inference/OmniRoute/commit/204de62b8dd1396bb54f754a5f21309c8aae8f5f (parent `350cbac1affe999c46f9f175d2720e4e28229438`).
- Local base: `08a9173a0fc2e8ecec4597a09c836bb45b1db131`.

Disposition: ported the discovery behavior in `open-sse/services/catalogs/kiroModels.js`. Each variant now carries a context length only when the upstream input limit converts to a finite positive number. This preserves positive numeric strings as well as numbers and excludes missing, zero, negative, nonnumeric and non-finite values. Output limits and sign-in are outside this change.

In this fork, `src/app/api/providers/[id]/models/modelsConfig.js` maps the missing field to `undefined`. `src/lib/modelAutoSync/runner.js` passes the rows through `normalizeSyncedModels` and `mergeSyncedCatalog` in `src/lib/modelAutoSync/catalog.js` before `saveSyncedModelCatalog`. Normalization omits an absent discovery capability; effective catalog materialization can therefore retain a separately documented catalog or shared capability. This differs from the upstream persistence implementation described in the PR. A previously stored discovery value is replaced on the next successful sync, not retroactively changed by this port.

Offline evidence: `tests/unit/omni-kiro-discovery-context-window.test.js` exercises the real resolver with a mocked fetch, its variants, the normalization and stored catalog shape, and catalog capability materialization. No live provider call is needed.
