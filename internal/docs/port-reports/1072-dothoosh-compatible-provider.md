# 9router PR #5039 — DotHoosh compatible provider (port report)

- **Issue**: bloodf/durindoor#1072 (source inventory of 9router PRs and port dispositions)
- **Upstream source**: https://github.com/decolua/9router/pull/5039 — "feat(providers): add DotHoosh provider", open, 2 commits (`d53726b` shared suggested-models refactor, `0ce8c0d` the provider), 22 files, +2000/−7. Upstream base: `decolua/9router:master` (v0.5.119 at the last force-push).
- **Port branch**: `orq/tornf6/port9r-dothoosh-compatible-provider-a1`
- **Disposition**: **ported (behavior)** — the API-key provider is complete on the local plumbing. Two upstream subsystems (live lane table, background catalog job) are deliberately **not ported**; the reasons and the resulting limit are recorded below.
- **Date**: 2026-11-20
- **Blocker**: none for the port itself. Authenticated calls to `gateway.dothoosh.com` were not made (no credentials in this environment, and the work order forbids live provider calls), so every request-shape claim below rests on the provider's own documentation plus keyless catalogue probes.

## Scope

The smallest complete local API-key provider port:

- a registry entry with the three documented transports and their auth schemes,
- a live model catalogue read per key through the existing discovery helpers,
- lane selection for a catalogue that has no static model list,
- no new sign-in flow, no startup polling, no live quota calls, no deployment setup.

## Verified protocol (first-party documentation)

Endpoints, auth schemes and catalogue behaviour were taken from the provider's own documentation, not from the upstream PR description:

| Claim | Source |
| --- | --- |
| OpenAI base URL `https://gateway.dothoosh.com/v1`, auth `Authorization: Bearer dh_…` | https://gateway.dothoosh.com/docs and https://gateway.dothoosh.com/docs/openai |
| Anthropic base URL `https://gateway.dothoosh.com/anthropic`, auth `x-api-key` only, `anthropic-version: 2023-06-01` mandatory and pinned (any other value → `unsupported_parameter`) | https://gateway.dothoosh.com/docs/anthropic |
| Sending `Authorization` next to `x-api-key` on the Anthropic path is rejected (`api_key_malformed`) | https://gateway.dothoosh.com/docs/anthropic |
| Active paths: `POST /v1/chat/completions`, `POST /v1/responses`, `GET /v1/models`. `POST /v1/images/generations` is disabled (`unsupported_capability`); embeddings/audio/fine-tuning/assistants are not proxied | https://gateway.dothoosh.com/docs/openai |
| `POST /anthropic/v1/messages` is the native Anthropic path; a model must come from `GET /anthropic/v1/models` | https://gateway.dothoosh.com/docs/anthropic |
| `GET /v1/models` answers **without** any auth header (public list, `Cache-Control: public, max-age=60`); with an auth header it narrows to that key's models, and an invalid key gets an auth error | https://gateway.dothoosh.com/docs/models |
| A model is served only on the protocols it is verified for; `protocols[]` carries `openai-chat-completions`, `openai-responses` and `anthropic-messages` with `conformance_status: "verified"` | https://gateway.dothoosh.com/docs/models |
| A model appears only in the listing of a path it is served on — Claude-only models are absent from `/v1/models` | https://gateway.dothoosh.com/docs/models |
| A capability the path did not verify is rejected with `unsupported_capability`; unknown fields are rejected with `unsupported_parameter` | https://gateway.dothoosh.com/docs/models, /docs/openai, /docs/anthropic |
| Row shape: `id`, `name`, `context_window`/`context_length`, `max_output_tokens`, `architecture.input_modalities`, `top_provider.{context_length,max_completion_tokens}`, `protocols[]`; the Anthropic listing uses the Anthropic row shape (`type`, `id`, `display_name`, `created_at`) plus the same added fields | https://gateway.dothoosh.com/docs/models |

Keyless probes from this machine on 2026-11-20 (public catalogue only, no credentials sent):

| Request | Result |
| --- | --- |
| `GET https://gateway.dothoosh.com/v1/models` | 200, 28 086 bytes, `{object:"list",data:[…]}`, 16 models |
| `GET https://gateway.dothoosh.com/anthropic/v1/models` | 200, 4 735 bytes, 7 models |
| `GET https://www.dothoosh.com/gateway/v1/models` (upstream's worldwide mirror) | 200 |
| `GET https://gateway.dothoosh.com/api-keys` | 307 (redirect) — the registry notice therefore links to `/signin`, which answers 200 |

The observed protocol split at that time: `deepseek-*` on Chat Completions **and** Anthropic Messages; `gpt-*` on Chat Completions and/or Responses (one id on Responses only); `gemini-*` and `kimi-*` on Chat Completions only; the five `claude-*` ids on the Anthropic path only. This is the shape the local family table encodes.

## Local port

| File | Change |
| --- | --- |
| `open-sse/providers/registry/dothoosh.js` | New registry entry: id `dothoosh`, alias `dh`, category `apikey`, three transports (Chat Completions, Anthropic Messages, Responses) with the documented auth descriptors, `passthroughModels: true`, no static model list, `modelsFetcher` on the provider's own listing. |
| `open-sse/providers/dothooshCatalog.js` | New provider module: the five provider URLs, the per-listing auth headers, the listing merge (id, name, live limits, vision, lanes) and the name-based family table. Isomorphic — no node imports. |
| `open-sse/config/providerModels.js` | `getModelTargetFormat` / `getModelSupportedFormats` resolve DotHoosh lanes from the family table (provider id and alias). |
| `src/app/api/providers/[id]/models/modelsConfig.js` | `PROVIDER_MODELS_CONFIG.dothoosh`: a custom resolver that reads **both** provider listings with the connection's key and merges them, so a Claude-only model is listed too. |
| `src/lib/providerRouteHandlers.js` | `canDiscoverModels`: the resolver precondition for DotHoosh (a key is required), matching the other custom-resolver providers. |
| `open-sse/providers/registry/index.js`, `open-sse/AGENT-INDEX.md`, `docs/providers/catalog.mdx` | Regenerated with `node scripts/gen-registry-index.mjs`, `node scripts/gen-agent-index.mjs`, `node scripts/gen-provider-catalog.mjs` — not hand-edited. |
| `src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx` | The review story fixture names every provider whose model list the dashboard may sync; `unit/v5-login-provider-redesign.test.js` pins it against the keys of `PROVIDER_MODELS_CONFIG`. DotHoosh added. |
| `tests/e2e/storybook-surfaces.json` | Story surface inventory regenerated after the story change: `node scripts/gen-v5-stories.mjs` (no diff — the generated CSF re-exports the source), `npm run storybook:build` (built index), `node scripts/sync-storybook-inventory.mjs --write` (13 recorded source hashes). |
| `tests/unit/dothoosh-compat-1072.test.js`, `tests/unit/fixtures/dothoosh-listings.json` | New fixture-backed listing and dispatch tests (synthetic rows in the documented shapes). |

## Per-source disposition

| Upstream file (PR #5039) | Disposition | Local equivalent | Evidence |
| --- | --- | --- | --- |
| `open-sse/providers/registry/dothoosh.js` | **ported, adapted** | `open-sse/providers/registry/dothoosh.js` | URLs and auth descriptors match the provider documentation (table above). The upstream entry declared `modelsFetcher` as a *list* of two sources; the local fetcher and its SSRF allowlist accept a single listing, so the local entry declares the OpenAI listing and the merge moved into the keyed import. Upstream's `notice.apiKeyUrl` (`/api-keys`) answers 307; the local notice uses `/signin` (200). Upstream's `icon: "lightbulb"` is not used anywhere in this repo; the local entry uses `"hub"`. |
| `open-sse/providers/registry/index.js` | **regenerated** | same file | `node scripts/gen-registry-index.mjs` — the barrel now carries `dothoosh` and the `pN` numbering shifted accordingly. |
| `open-sse/providers/models/dothooshLive.js` | **not ported** | `open-sse/providers/dothooshCatalog.js` (merge + family table) | Upstream keeps a global lane table refreshed by a background job. The work order forbids startup polling, so the live table was dropped. The merge logic upstream needed for its own table is kept (it produces the imported catalogue rows); the lane table itself is replaced by the family table. |
| `open-sse/providers/models/helpers.js` | **ported, relocated** | `open-sse/providers/dothooshCatalog.js` (`dothooshFamilyFormats`) | The local `helpers.js` has no family-table module (there is no local `opencodeFamilyFormats`), so the DotHoosh table sits with the rest of the provider logic. Same families as upstream: `claude-*` → Anthropic lane, `gpt-*` → Chat Completions + Responses, `deepseek-*` → Chat Completions + Anthropic, anything else → Chat Completions. |
| `open-sse/config/providerModels.js` | **ported** | same file | Upstream added `isDotHooshAlias` + `dothooshFamilyFormats` lookups; the local version uses a `Set` of the provider id and its alias. |
| `open-sse/providers/capabilities.js` | **not needed** | existing local precedence | Upstream overrode the static capability tables with the live listing values. DurinDoor already gives the synced catalogue precedence over the static tables (`materializeRequestModel` merges `enriched.capabilities` and takes `contextWindow`/`maxOutput` from it), so the imported listing's live limits win without a provider-specific override. The static tables still resolve per model id for a provider that has not synced yet (`getCapabilitiesForModel("dothoosh", "claude-opus-5-5")` → `claude-adaptive`, `gpt-6.1-sol` → `openai`, an unknown id → no capabilities). |
| `src/app/api/providers/[id]/models/route.js` | **ported with a different mechanism** | `src/app/api/providers/[id]/models/modelsConfig.js` | Upstream added `dothoosh: createOpenAIModelsConfig("https://gateway.dothoosh.com/v1/models")` — the OpenAI listing only, so Claude-only models were missing from the catalogue. The local entry is a custom resolver that reads both listings and merges them, which is what upstream's shared commit did for its two-source fetcher. |
| `src/app/api/providers/[id]/test/testUtils.js` | **not needed** | existing local probe | The local connection test falls through to `probeRegistryProvider`, which honours the registry `validateUrl` (`https://gateway.dothoosh.com/v1/models`) with the bearer scheme and treats a non-2xx as an invalid key — the provider answers an invalid key with an auth error. No provider-specific case is required. |
| `src/app/api/providers/suggested-models/filters.js` | **not needed** | existing local `FILTERS.openai` | The local filter set already has an `openai` filter, so the upstream shared commit's `openai` filter was already present here. The upstream `anthropic` filter is not needed: the Anthropic listing is merged by the keyed import, not by the keyless suggestion route. |
| `src/shared/utils/providerModelsFetcher.js` (upstream: `modelsFetcher` may be a list) | **not ported** | `open-sse/providers/dothooshCatalog.js` | The local fetcher, its cache key and the `/api/providers/suggested-models` allowlist all take one `{url, type}` per provider. Changing that shared contract was out of scope for a provider port; the merge lives in the provider-scoped import instead. |
| `src/lib/modelCatalog/dothoosh.js` + `src/instrumentation.js` | **not ported (by instruction)** | — | This is upstream's startup polling: a 45-second delayed first refresh and a 15-minute interval against two mirror URLs. The work order forbids startup polling, so no new job, timer or instrumentation hook was added. The existing model auto-sync service already covers this provider (`isModelAutoSyncEligible("dothoosh")` → true) and uses the same `fetchConnectionModels` path. |
| `public/providers/dothoosh.png` | **not ported** | — | The brand-asset policy states that adding a registry entry does not add a logo file; the dashboard renders the Material Symbol icon or the letter tile. Adding a vendor mark would also need its own provenance record. |
| `tests/__baseline__/*` (alias + provider baselines) | **not imported** | — | Upstream regenerated its alias and provider baselines. DurinDoor's equivalents (`tests/__baseline__/alias-baseline.json`, `providers-baseline.json`) are standalone snapshot scripts that no test in the suite reads, and the work order forbids baseline changes, so they were left untouched. Re-running `node tests/__baseline__/verify-alias.mjs` will report `idToAlias changed` until the snapshot is regenerated by whoever owns the baseline. |
| `tests/translator/__snapshots__/golden-url-header.test.js.snap` | **not applicable** | — | Upstream added a new golden file for the provider's URLs. This repository has no `golden-url-header` test; the equivalent coverage is the new provider test. |
| `tests/unit/dothoosh-provider.test.js`, `tests/unit/dothoosh-live.test.js`, `tests/unit/suggested-models.test.js` (upstream) | **replaced** | `tests/unit/dothoosh-compat-1072.test.js` + `tests/unit/fixtures/dothoosh-listings.json` | The upstream tests run against the real public listings and the global lane table. The local test is fixture-backed (synthetic rows in the documented shapes) and covers the registry shape, the listing merge, the import path and the dispatch, per the work order's fixture requirement. |

## Security review

- **Credential confinement.** Every URL the provider can use — the three transport URLs and both listing URLs — is on `https://gateway.dothoosh.com`. The upstream mirror `www.dothoosh.com` is **not** used, so no key can reach a second host. The test asserts that every request the import makes carries the key and that every request target is the provider origin.
- **Per-path auth scheme.** The OpenAI lanes send `Authorization: Bearer <key>`; the Anthropic lane sends `x-api-key` plus `anthropic-version: 2023-06-01` and **no** `Authorization` header, because the provider rejects a request that carries both. The test pins the exact header set through `DefaultExecutor.buildHeaders`.
- **No new auth surface.** No sign-in flow, no token exchange, no credential storage, no header-forwarding change: the provider uses the existing `DefaultExecutor` auth descriptors, the existing `PROVIDER_MODELS_CONFIG` discovery path and the existing probe.
- **No request-data-derived URLs.** All URLs are constants in `open-sse/providers/dothooshCatalog.js`; nothing in a request body or a stored connection can redirect them.

## Evidence

Commands run on this branch (2026-11-20):

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/dothoosh-compat-1072.test.js unit/provider-model-listing.test.js unit/provider-can-discover-models.test.js
# → 3 files passed, 50 tests passed

npm run lint          # eslint src + anti-slop: 0 errors, anti-slop gate OK (0 diagnostics across 2671 files)
```

Provider-surface regression checks (same tree): `unit/api-providers-id-models-registry-union`, `unit/api-providers-id-models`, `unit/provider-connection-payloads`, `unit/provider-model-cache`, `unit/provider-filters`, `unit/provider-validate-anthropic-v1`, `unit/provider-client-sanitize`, `unit/catalog-audit-2026-08`, `unit/model-catalog-consistency`, `unit/provider-test-utils`, `unit/tier-a-apikey-providers`, `unit/api-key-policy-catalog`, `unit/storybook-provider-metadata`, `unit/provider-display-split`, `unit/provider-detail-icon-paths` — 94 tests passed, no failure. The full suite stays with the integration gate.

### Gate rejection and its correction

The integration gate ran the full suite on the first head and rejected it: `unit/v5-login-provider-redesign.test.js` pins the review story fixture's provider list against the keys of `PROVIDER_MODELS_CONFIG`, and the new provider was missing from the story fixture (the suite otherwise passed: 18 055 passed, 1 failed).

The correction, on the follow-up commit:

- `src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx`: `dothoosh` added to `REVIEW_MODEL_LIST_PROVIDERS`, so the story fixture and the model-list configuration name the same providers again;
- `tests/e2e/storybook-surfaces.json`: regenerated with the repository's own tooling — `node scripts/gen-v5-stories.mjs` (no diff; the generated CSF re-exports the source), `npm run storybook:build` for the built index, `node scripts/sync-storybook-inventory.mjs --write`. The regeneration moved exactly 13 recorded source hashes, the ones for the edited story source; no row was demoted, because every affected row was already `pending` and carries no approval to archive.

Verification after the correction:

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/v5-login-provider-redesign.test.js unit/1300-v5-storybook-inventory.test.js \
  unit/storybook-coverage.test.js unit/storybook-inventory-sync.test.js \
  unit/storybook-provider-metadata.test.js unit/dothoosh-compat-1072.test.js \
  unit/provider-model-listing.test.js unit/provider-can-discover-models.test.js
# → 8 files passed, 168 tests passed

node scripts/check-storybook-coverage.mjs --manifest tests/e2e/storybook-surfaces.json \
  --index storybook-static/index.json --mode inventory
# → Storybook inventory valid; pending rows remain unapproved and no coverage is claimed.
```


New test coverage (all offline, fixture-backed):

- registry shape, alias, no static model list, `passthroughModels`, catalogue declaration, and that the dashboard's keyless suggestion route accepts the declared fetcher;
- `canDiscoverModels` true with a key and false without one, and `isModelAutoSyncEligible` true (the existing sync service covers the catalogue);
- the three transports and their auth descriptors, plus the exact header set of the Anthropic lane (no `Authorization`, no beta headers);
- the listing merge: Claude-only model listed, a model on both paths merged, lanes read from `protocols[]`, live limits and the vision flag, unusable rows dropped, empty listings survivable;
- the keyed import: both listings read, merged catalogue returned, a rejected key reported as `Invalid API key` (401);
- credential confinement: every import request targets the provider origin and carries the key, with the scheme of each listing;
- dispatch: Claude model on the Anthropic lane for both Anthropic and OpenAI clients, GPT model on Chat Completions for an OpenAI client and on Responses for a Responses client, DeepSeek model on both of its lanes, unknown model on Chat Completions, and the family table for ids the catalogue does not carry.

## Known limits

1. **Lanes come from the model family, not from a live table.** Upstream refreshes a lane table in the background and prefers the Responses path for any model that offers it; the local port has no background job, so a model whose verified protocol set is narrower than its family (a Responses-only `gpt-*` id, for instance) is dispatched by the family table, while the authoritative `protocols[]` is visible in the imported catalogue. A Responses client still reaches the Responses lane for every `gpt-*` id.
2. **The live limits reach the dashboard only after a sync.** The static capability tables are the floor until the catalogue is synced (by the operator's "Sync models" action or the existing auto-sync service); after the sync the listing's limits win, as the local precedence already provides.
3. **No authenticated verification.** No request was made with a key, so the request shapes are documented behaviour, not observed behaviour. The upstream PR states the same limit for its own Anthropic and Responses lanes.
4. **Upstream's mirror was not adopted.** Upstream routes its keyless suggestions through `www.dothoosh.com/gateway/…` because the Iran-hosted API is said to be unreachable outside Iran. From this machine both listings on `gateway.dothoosh.com` answered 200 keyless on 2026-11-20, so the provider host is used directly and the key never leaves it. A network that cannot reach `gateway.dothoosh.com` cannot use the provider at all (chat and catalogue alike); the mirror would only have populated the keyless suggestion list.
5. **Baseline snapshots are stale for the new provider.** `tests/__baseline__/alias-baseline.json` and `providers-baseline.json` still describe the registry without `dothoosh`. They are not read by the suite, and the work order forbids baseline changes; regenerate them with `node tests/__baseline__/snapshot-providers.mjs` and `node tests/__baseline__/verify-alias.mjs --snapshot` in a separate, owner-approved change.
