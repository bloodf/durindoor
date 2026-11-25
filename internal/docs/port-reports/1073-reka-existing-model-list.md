# Reka model listing through the provider model route (#1073)

Source: https://github.com/cheaper-inference/OmniRoute/pull/1956 ("chore(provider): Add reka models list"), head `b4a3324898d32442c987eb492f0d0e43b828ffcf`, merge `4dc959c1f2b4d2c63032e361ff65bba004172e7e`, base `c74657f29a64a85f33560ad65fa0e42534b4ba37`. The PR body is "Working..." and was merged upstream on 2026-05-04. This row was previously left unresolved in `internal/docs/port-reports/1073-may-recovered-1-dispositions.md` (line 56); this report is its resolution.

## What upstream changed, read at the pinned merge

The pinned head changes seven files. Only one of them is a behavior this fork can adopt without adding a model, a provider, an endpoint, an external fetch or a credential behavior.

| Upstream file (at `4dc959c1f2b4d2c63032e361ff65bba004172e7e`) | Change |
| --- | --- |
| `src/app/api/providers/[id]/models/route.ts` | +5 lines: `if (provider === "reka") { const localCatalog = buildLocalCatalogResponse(); if (localCatalog) return localCatalog; }`, placed **before** the OpenAI-compatible branch. `buildLocalCatalogResponse()` answers `{provider, connectionId, models: [{id, name, apiFormat?, supportedEndpoints?, owned_by?}], source: "local_catalog"}`, where the rows come from `mergeLocalCatalogModels(registryCatalogModels, specialtyCatalogModels)` and `owned_by` is the provider id. |
| `open-sse/config/providerRegistry.ts` | Adds the `reka` registry entry with the models `reka-flash-3` and `reka-edge-2603`. |
| `src/app/api/v1/models/catalog.ts` | Skips `reka` in the synced-models loop (line 393) and in the custom-models loop (line 641). |
| `src/lib/providers/validation.ts` | Changes the validation default model `reka-flash` → `reka-flash-3`. |
| `src/shared/constants/providers.ts` | Removes `passthroughModels: true` from the reka entry. |
| two test files | Upstream's own coverage for the branch and the registry entry. |

Upstream's Reka is a named OpenAI-style provider, so upstream can still list Reka live (with `X-Api-Key` next to the bearer); the upstream branch above is a *precedence* choice — the local catalog answers first, the live listing stays behind it.

## Local state before this port

- `open-sse/providers/registry/reka.js` already exists: id and alias `reka`, category `freeTier`, chat base URL `https://api.reka.ai/v1/chat/completions`, validation URL `https://api.reka.ai/v1/models`, combined auth (bearer `Authorization` plus `X-Api-Key`), and a curated catalog of three models in registry order: `reka-flash-3`, `reka-flash`, `reka-edge-2603`.
- Reka has **no** `modelsFetcher` on its registry entry, **no** `PROVIDER_MODELS_CONFIG["reka"]` entry, and is neither `openai-compatible-` nor `anthropic-compatible-` prefixed. `fetchConnectionModels` therefore fell through every branch to the final fallback and answered `{error: "Provider reka does not support models listing", status: 400}`, and `canDiscoverModels({provider: "reka"})` was `false`.
- The local `/v1/models` surface already publishes Reka from the registry catalog: `addStaticProviderModels` emits `${alias}/${model.id}` with `owned_by: alias` and resolves capabilities through `getCapabilitiesForModel(providerId, model.id)`.
- `open-sse/providers/capabilities.js` already declares `reka: { "reka-edge-2603": { vision: true } }`, and `open-sse/config/freeModelCatalog.data.js` already lists `reka/reka-flash-3` and `reka/reka-edge-2603`.

**Applicability: the port is applicable.** The local integration had no equivalent of the upstream route branch: the curated catalog existed, but the provider-specific model route could not serve it, so Reka discovery failed while the catalog was already published elsewhere.

## The local port

| File | Change |
| --- | --- |
| `src/app/api/providers/[id]/models/fetchConnectionModels.js` | New Reka branch, placed with the other curated local catalog branches. It answers the registry catalog through the existing listing helper `getProviderModels("reka")` (the same helper the `t3-web` / `adapta-web` branches use), preserves registry order, returns `{id, name, owned_by}` rows plus `source: "local_catalog"`, and reads no credential and issues no request. |
| `src/lib/providerRouteHandlers.js` | `canDiscoverModels` returns `true` for Reka, mirroring the `t3-web` / `adapta-web` curated-catalog precedent, so the flag keeps matching the route branch-for-branch as its own comment requires. |
| `docs/reference/management-api.mdx` | The `GET /api/providers/{id}/models` row now states that providers whose catalog is bundled (T3 Chat, Adapta, Reka) answer from the bundled catalog without contacting the provider. |
| `tests/unit/omni-reka-existing-model-list.test.js` | **New.** Focused offline coverage (see below). |

### Deliberately not ported

- **Upstream's registry entry.** The local registry already curates Reka, with three models rather than upstream's two: the local catalog keeps `reka-flash` between `reka-flash-3` and `reka-edge-2603`. Adding upstream's list verbatim would add and remove models, so the local catalog is exposed as it stands.
- **Upstream's validation default-model change** (`reka-flash` → `reka-flash-3`). Locally the registry head is already `reka-flash-3` (`getDefaultModel("reka")` returns it), so the fallback probe already posts with that model, and the local connection validation probes the registry `validateUrl` rather than a hard-coded model string. There is no local default-model string to change.
- **Upstream's removal of `passthroughModels`.** The local Reka entry never had `passthroughModels`.
- **Upstream's `/v1/models` catalog skips.** Those two loops are upstream's unified-catalog mechanics for synced and custom models; the local `/v1/models` publishes Reka from the registry catalog, and no synced or custom Reka model exists.
- **Upstream's live Reka listing.** Locally Reka declares no `modelsFetcher` and no compatible prefix, so a live listing would mean a new external fetch and a new credential use — explicitly out of scope for this port.

## Preserved behavior

- **API key selection.** Unchanged. The new branch reads no credential and sends none: the connection's stored key is still selected and validated exactly as before by the provider validation and probe paths, and the route response carries no credential material (asserted by the test). No key is written, rewritten or moved.
- **Model capability.** Unchanged. `open-sse/providers/capabilities.js` still declares the Reka vision capability, and `/v1/models` still resolves Reka capabilities through `getCapabilitiesForModel`.
- **Namespacing.** Unchanged. `/v1/models` still publishes `reka/<model-id>` with `owned_by: reka`. The provider route keeps the raw model ids, exactly like the existing curated local catalog branches (`t3-web`, `adapta-web`); the dashboard's suggested-model list matches those raw ids against the registry, so namespacing them in this response would misfile already-known models as new suggestions.
- **Ordering.** The response order is the registry order (`reka-flash-3`, `reka-flash`, `reka-edge-2603`).
- **Existing discovery failures.** A provider without any catalog still fails with `400` and `Provider <id> does not support models listing`; only Reka's own failure is replaced, which is the upstream intent of this PR.

## Verification

All checks below are offline. No provider traffic, no key, no browser, no Docker, no paid API and no test weakening were involved, and `tests/__baseline__/**` was not touched.

- Focused test: `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-reka-existing-model-list.test.js` → 5 tests passed. The route is exercised through the Next route handler with a mocked connection; the outbound seam (`proxyAwareFetch`) and the connection-proxy resolver are spies that must stay untouched, and the response is asserted not to contain the stored key.
- The test also pins the premise (Reka has no `PROVIDER_MODELS_CONFIG` entry and no registry `modelsFetcher`), the curated catalog and its order, the unknown-provider failure, `canDiscoverModels` for Reka and for an unknown provider, and the untouched alias and capability facts.
- Neighbouring suites: `unit/provider-model-listing.test.js`, `unit/api-providers-id-models.test.js`, `unit/api-providers-id-models-registry-union.test.js` and `unit/omniroute-simple-e-providers.test.js` → 32 tests passed.
- Generators: `gen:registry-index`, `gen:agent-index` and `gen:provider-catalog` report no drift; the Reka row in `docs/providers/catalog.mdx` is unchanged because the model count is still 3.
- Lint: `eslint` on the two changed source files is clean, and `node scripts/check-docs.mjs` passes.
- Evidence command: `rg -q -F b4a3324898d32442c987eb492f0d0e43b828ffcf internal/docs/port-reports/1073-reka-existing-model-list.md && rg -q -F 4dc959c1f2b4d2c63032e361ff65bba004172e7e internal/docs/port-reports/1073-reka-existing-model-list.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-reka-existing-model-list.test.js)`.

## Verification limits

- Nothing was sent to `api.reka.ai`. This port does not claim that the Reka host answers a model list for any key; it only serves the catalog that is already bundled in this tree.
- The full test suite was not run, by scope, and no snapshot or baseline file was changed.
- The route was verified through the Next route handler, not through a browser rendering.

## Known limits

- The dashboard's **Sync models** button stays gated on a registry `modelsFetcher`, so it is still not shown for Reka. The exposed surface is the provider model route itself; showing the button for Reka would need a UI-gate change that is outside this port.
- The Playground lists live Reka rows with their raw ids while its static rows are namespaced (`reka/<id>`), so a Reka model can appear twice in the Playground picker. That is the same shape the existing curated local catalog branches already produce, and the Playground merge was left unchanged.
