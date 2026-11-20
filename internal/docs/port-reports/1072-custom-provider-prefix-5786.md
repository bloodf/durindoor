# 9router PR #5786 — publish and resolve existing custom-provider prefixes (port report)

- **Issue**: bloodf/durindoor#1072 (source inventory of 9router PRs, issues and port dispositions)
- **Upstream source**: https://github.com/decolua/9router/pull/5786 — "fix(custom-provider): publish the configured prefix, not the node id", **open**, 1 commit `efbe45057816b197220135bcaf71cd1dc52c9523`, 9 files, +440/−9. Upstream states it fixes decolua/9router#5763.
- **Pinned source**: `decolua/9router@efbe45057816b197220135bcaf71cd1dc52c9523`
- **Port branch**: `orq/tornf6/port9r-custom-provider-prefix-5786-a1`
- **Disposition**: **ported (behavior, adapted)** — the publication half of the upstream change is already present in this fork on three surfaces and needed no work; the Playground (which displayed the node id) and the request log line were ported to show the configured prefix, plus the capability lookup that could not resolve the published prefix. The Playground keeps addressing requests by the stable node id, including for namespaced live model ids; the prefix is its display label only. Upstream's shared resolver was kept, but its registry-alias fallback was replaced by the fork's provider-id fallback so no built-in provider changes what it publishes. No upstream file was taken verbatim.
- **Date**: 2026-11-20
- **Blocker**: none. No provider request, credential, browser session or paid API was used. Every claim below comes from reading the local tree and from offline fixtures.

## Scope

A custom provider (OpenAI-/Anthropic-compatible, custom embedding, System One) is a provider node whose id is a UUID-bearing string such as `openai-compatible-chat-330c58ab-a28a-46ed-9baa-0e1c8510562c`. The operator configures a short prefix on the node (`mirai`), and that prefix is what the UI advertises as "the provider prefix for model IDs". The id a user copies out of the dashboard has to be the prefix, and it has to route back to the same node.

The work order for this port names four surfaces — local compatible model listing, selectors, capability lookup and native chat routing — and requires that the published prefix resolves to the intended existing node and supported model, without breaking the legacy id, custom names, saved combos and aliases, the selected account, per-key allowed models, and the collision and ordering contracts.

## Upstream change, as read

Upstream's PR body states the cause precisely: `getProviderAlias()` returns `provider.alias || providerId`, and a custom node is not a registry entry, so its "alias" is the raw node id — every surface that derives the published model id from it leaks the id. Upstream added `src/shared/utils/providerPrefix.js` with the precedence `providerSpecificData.prefix` → `node.prefix` → `getProviderAlias(providerId)`, and applied it to four surfaces: `/api/models`, Basic Chat's request model id, the request log line, and the model picker's two duplicated inline expressions. Upstream also added `storageFullModel` to `/api/models` so the dashboard's capability lookup keeps resolving the storage form after the published form changed, and `useModelCaps` was taught to index it.

Upstream explicitly left alone: routing resolution (already resolves a prefix back to the node id), the bare upstream model id, and the storage keys for model aliases and custom-model rows.

## Local behavior evidence (before this port)

Every row below was read in this tree at `48f23b85a`.

| Surface | Local source | Published / sent form | Verdict |
| --- | --- | --- | --- |
| `GET /v1/models` | `src/app/api/v1/models/buildModelsList.js:1007-1013` — `outputAlias` = `conn.providerSpecificData.prefix` → `getProviderAlias(providerId)` → `staticAlias` | `<prefix>/<model>` | **already correct** — the prefix wins, and a node without a prefix falls through to its node id |
| Dashboard model picker | `src/shared/components/ModelSelectModal.js:499` — `connection?.providerSpecificData?.prefix \|\| matchedNode?.prefix \|\| providerId` | `<prefix>/<model>` | **already correct for provider nodes**; a stray `prefix` on a *built-in* connection would still remap it (upstream calls this out and guards it) |
| Provider detail page | `src/app/(dashboard)/dashboard/providers/[id]/page.js:341-343` — `providerDisplayAlias` | `<prefix>/<model>` | **already correct** |
| CLI-tools client config | `src/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient.js:67-76` | `<prefix>/<model>` | **already correct** |
| `GET /api/models` | `src/app/api/models/route.js:16-21` — provider ids come only from the static registry and synced catalogues | compatible nodes are **not listed at all** | **upstream's target surface does not exist here**; upstream's `/api/models` hunk has no local counterpart |
| **Dashboard Playground** (the local "Basic Chat") | `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js` — `normalizeStaticModel` / `normalizeLiveModel` built the request id from `connection.provider`, which for a compatible node **is** the node id | request `<node-id>/<model>`; displayed `<node-id>/<model>` | **gap — the Playground displayed the node id while the picker published the prefix.** The request id itself (the node id) was already stable and correct. |
| **Request log line** | `open-sse/handlers/chatCore.js:866` — `POST ${clientModel} → ${provider}/${cleanModel}`, where `provider` is the resolved node id | `<node-id>/<model>` | **gap — the log echoed the unusable id** |
| **Dashboard capability lookup** | `src/shared/hooks/useModelCaps.js` — the alias map was built from `PROVIDER_ID_TO_ALIAS` only, so a combo member `<prefix>/<model>` never resolved to its node | — | **gap — the dashboard derived different combo capabilities than the server publishes for `/v1/models`** |

Two further asymmetries were found in neighbouring surfaces (an exact-list per-key allowlist and a model-info lookup). They are outside the four surfaces in scope, were left unchanged, and are summarised under Known limits.

Resolution was already sound and was left alone: `src/sse/services/model.js:294-336` resolves both `<prefix>/<model>` and `<node-id>/<model>` to the same node for the openai-, anthropic- and systemone-compatible families, `stripRedundantNodePrefix` normalises `<node-id>/<prefix>/<model>`, and `RESERVED_PROVIDER_PREFIXES` keeps a built-in alias authoritative over a colliding node prefix.

## Local port

| File | Change |
| --- | --- |
| `src/shared/utils/providerPrefix.js` | **New.** Its comments distinguish the prefix (an editable label) from the node id (the stable request id). `resolveProviderPrefix({ providerId, providerSpecificData, node })` and `isCustomProviderId(providerId)`. The single resolver: connection prefix → node prefix → provider id. Scoped to provider nodes — the four custom id families plus the bare-UUID shape a node installed before the prefix scheme carries — so a built-in provider keeps its own id. |
| `src/app/(dashboard)/dashboard/playground/playgroundHelpers.js` | `normalizeStaticModel` and `normalizeLiveModel` moved here from the client. Each row keeps the stable request address — `requestModel` and `id` stay `<provider id>/<model>`, which for a compatible node is the node id — and gains `displayModel` (`<prefix>/<model>`) and `prefix` as separate display fields. The configured prefix is never sent as the request id. A live compatible-node model id is bound to the node whole, so a namespaced upstream id keeps its namespace (`<node id>/<namespace>/<model>`); rows also carry `aliases` (the display label and, for a namespaced live id, the raw upstream id) for legacy saved selections. `buildModelIndex` and `resolveSavedModel` resolve those aliases only through provider identity. `resolveConnectionPrefix` and `getProviderLabel` are exported here. |
| `src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js` | Uses the shared helpers; the picker and the model sub-label show `displayModel`, the request body sends `requestModel`, and a saved selection resolves through `resolveSavedModel`: a canonical id first, then a legacy alias only when exactly one row (matching the saved provider where known) owns it. An ambiguous alias is left unresolved, never guessed. |
| `open-sse/handlers/chatCore.js` | The request log line shows the configured prefix (`→ mirai/model`) instead of the node id. Display only — routing and upstream dispatch still use the provider id. |
| `src/shared/components/ModelSelectModal.js` | The two inline prefix expressions are replaced by the shared resolver. A built-in provider is no longer remapped by a stray `prefix` field. |
| `src/shared/hooks/useModelCaps.js` | The capability index build moved into an exported pure `buildDashboardCapsIndex()`. The node prefix now maps back to the node, so a combo member keyed by the prefix derives the same capabilities the server publishes, and a custom override stored under the node id stays reachable under the published prefix. The hook additionally reads `/api/provider-nodes`. |
| `tests/unit/port9r-custom-provider-prefix-5786.test.js` | **New.** Offline acceptance tests (see below). |

## Per-source disposition

| Upstream file (PR #5786) | Disposition | Local equivalent | Evidence |
| --- | --- | --- | --- |
| `src/shared/utils/providerPrefix.js` (new) | **ported, adapted** | `src/shared/utils/providerPrefix.js` | Same precedence and the same three inputs. Upstream's third fallback is `getProviderAlias(providerId)`, which for a built-in provider would republish the registry alias instead of the provider id — this fork's picker and Playground publish the provider id for built-ins, so the fallback is the provider id. A custom node without a prefix therefore keeps its node id as the stable legacy label, exactly as it does today. Upstream's helper is not scoped to provider nodes; the local one is, so a stray `prefix` on a built-in connection can no longer rename that provider's models. |
| `src/app/api/models/route.js` | **not applicable** | `src/app/api/v1/models/buildModelsList.js` (unchanged) | The local `/api/models` route is a cache-only registry list: its provider ids come from `PROVIDER_MODELS` and the synced catalogues, so a compatible node is never listed and the node id is never published there. The local surface that publishes compatible models is `/v1/models`, and it already published the configured prefix before this port (`outputAlias` prefers `providerSpecificData.prefix`). |
| `src/app/(dashboard)/dashboard/basic-chat/BasicChatPageClient.js` | **ported, adapted** | `src/app/(dashboard)/dashboard/playground/playgroundHelpers.js` + `PlaygroundPageClient.js` | The local Basic Chat equivalent is the Playground. Its `normalizeStaticModel` / `normalizeLiveModel` built the request id from `connection.provider`, i.e. the node id. The Playground now *displays* the configured prefix like the picker, but keeps addressing requests by the stable node id: upstream's Basic Chat sends the prefix, which this port deliberately did not adopt, because a prefix is an operator-editable label that is not guaranteed unique per node while the node id is. The two helpers moved into the colocated `playgroundHelpers.js` so the behaviour is unit-testable without a DOM. Every live model of an ordinary compatible node, namespaced or not, is addressed `<node id>/<upstream id>`, so the request stays bound to the selected node and the upstream name and namespace are preserved. A raw upstream id passed through verbatim is correct only where it is already a gateway address (a built-in provider), so that path is unchanged. A selection saved under the prefix form, or under a raw namespaced upstream id from before node binding, resolves by provider identity when unambiguous. |
| `open-sse/handlers/chatCore.js` | **ported, adapted** | same file | Upstream reads `credentials?.providerSpecificData?.prefix` directly; the local line resolves through the shared resolver, so a built-in provider is not renamed by a stray `prefix` on its connection. Both keep the client string (`clientModel`) verbatim and both change nothing about routing or upstream dispatch. |
| `src/shared/components/ModelSelectModal.js` | **ported, adapted** | same file | Upstream replaced two duplicated inline expressions with the shared helper; the local picker had one such expression and now calls the shared resolver. The published value is unchanged for a provider node. |
| `src/shared/hooks/useModelCaps.js` | **ported, adapted** | same file | Upstream added `storageFullModel` to `/api/models` and taught `useModelCaps` to index it. The local `/api/models` does not publish compatible rows, so there is no `storageFullModel` field to add; the equivalent is the custom-override map, which is keyed by the stored provider alias (the node id). The local port indexes the published prefix form alongside it, and additionally maps the node prefix back to the node in the alias map — the part that makes a prefix-keyed combo member resolve, and the part the server already does in `buildModelsList.js:742-750`. |
| `src/shared/utils/selectableModels.js` | **not applicable** | `src/shared/components/ModelSelectModal.js` | This fork has no `selectableModels.js`; the picker builds its groups inline in the component. The equivalent expression was ported there. |
| `tests/unit/custom-provider-prefix.test.js`, `tests/unit/custom-provider-prefix-log.test.js` | **replaced** | `tests/unit/port9r-custom-provider-prefix-5786.test.js` | Upstream's two files are replaced by one scoped file in this fork's naming scheme. It covers the same ground plus the fork-specific contracts (legacy label, built-in provider, collision, ordering). The upstream fixtures are not imported: this fork's node/connection fixtures live in the local database and the upstream file's `createProviderNode` / `addCustomModel` calls do not match the local repo API. |

## Repair of the first port (full gate at `ad0a87b4f432`)

The first version of this port made the Playground send `<prefix>/<model>`. That changed its request addressing from the stable node id to an operator-editable label, which is not the contract the Playground needs for compatible providers. This repair restores the node id as the canonical request id (`requestModel`, and the row `id` saved selections already use) and keeps the prefix as a separate display field (`displayModel`, `prefix`). Nothing else in the port changed: the shared resolver, the request log line, the picker and the capability lookup are as described above. Routing, built-in precedence, capability lookup, custom names, saved selections, auto-account selection and explicit account pins are untouched.

Test expectations were adapted only where they encoded the old request-ID contract (the Playground model-id block and the matching group/ordering fixture). The acceptance check is a pure offline helper fixture: it asserts the canonical request ID of an ordinary compatible model and its separately displayed prefix. No provider, credential, browser or live traffic is involved.

The gate also found a stale Storybook source census. `tests/e2e/storybook-surfaces.json` was reconciled with `scripts/sync-storybook-inventory.mjs --write` after a static `storybook:build` (no browser, no e2e). The built index hash is unchanged. Only rows whose production source hash actually changed were touched: `PlaygroundPageClient.js` and `playgroundHelpers.js` moved from approved to pending with their prior approval archived under `historicalSourceApprovals`, and the already-pending `ModelSelectModal.js` row and its five scenarios received current source hashes. Source review and runtime qualification remain pending for all three.

## Repair of namespaced live model ids

The first repair still passed a live model id that contained a slash through unchanged, on the assumption that it was already a gateway address. On a compatible node it is not: it is the upstream's own model name, and sending it bare lets the gateway read its first segment as a provider rather than as part of the model. This repair binds every live model of an ordinary OpenAI- or Anthropic-compatible node to that node, `<node id>/<upstream id>`, and keeps the whole upstream id, namespace included. The server parser already splits only at the first slash and accepts the node id there, so no server code changed. Built-in providers and combos are untouched: a live id on those paths is still sent as returned.

Legacy saved selections are handled by provider identity. A canonical id wins. A saved display label or raw upstream id resolves only when exactly one row owns it, and, when the saved provider is known, only a row of that provider. Otherwise the selection is left unresolved instead of being guessed (see the next section for what the Playground then does). Canonical saved ids, built-in provider precedence and explicit account pins are unchanged.

Verification is a pure offline adapter fixture of ordinary namespaced compatible-provider ids, plus a separate check that the prefix label stays a display field. No request was sent to any provider.

The Storybook inventory was refreshed after a static `storybook:build` with `scripts/sync-storybook-inventory.mjs --write`. Only the source hashes of the two touched tracked Playground sources changed; the rows were already pending, so no new approval was archived and the earlier historical approvals are preserved. Source review and runtime qualification remain pending.

## Repair of saved-selection provider binding

A saved Playground selection that names a provider now resolves only to that provider. The provider is checked first, even for a direct canonical match: an id that is canonical for another provider is not that provider's model. A raw upstream id saved before node binding still resolves for its own node when its text also equals another provider's canonical id, because the legacy aliases are now indexed alongside canonical ids. The same id listed by two providers resolves to the saved provider's row, and with no provider identity it is left unresolved rather than guessed.

A saved chat whose model can no longer be resolved no longer falls back to the first model. The picker shows "Select model", the input says to select a model, and Send stays disabled until the user picks one. An explicit selection rebinds that chat in place, so its history goes only to the model chosen. New-chat defaults, normal model switches, canonical node addressing and account pins are unchanged, and the ordinary compatible-node ids are still recognised. The server namespace normalisation is untouched.

Verification is a pure offline fixture of ordinary model/provider rows. It asserts that the provider is preserved and that a missing, removed or ambiguous saved selection is unresolved. No request was sent to any provider.

The Storybook inventory was refreshed after a static `storybook:build` with `scripts/sync-storybook-inventory.mjs --write`. Only the source hashes of the two touched Playground sources changed (the census hash follows). The rows were already pending, so no new approval was archived and the earlier historical approvals are preserved. Source review and runtime qualification remain pending.

## Preserved contracts

- **Legacy ids.** `<node-id>/<model>` still routes to the same node; it is the Playground's canonical request id and row `id`. The prefix form, and a raw namespaced upstream id saved earlier, are accepted as aliases only when they identify a single row for the saved provider.
- **Optional / missing prefixes.** A node without a configured prefix publishes its node id, and that id still routes. The node prefix is required at creation and at edit (`src/app/api/provider-nodes/route.js:51-53`, `src/app/api/provider-nodes/[id]/route.js:29-31`), but a node row written without one keeps working.
- **Custom names.** The node's `name` still labels the provider everywhere; the prefix never replaces it.
- **Saved combos and aliases.** Combo members and model aliases are stored under the node id (`providerStorageAlias` on the provider page) and were not migrated. A member written in either form still resolves through `getModelInfo`.
- **Selected account identity.** The prefix identifies the *node*; the account inside the node is still selected at dispatch time (`x-connection-id` pinning, `src/sse/handlers/chat.js:986-1008`). Every connection of a node carries the node-owned prefix (`src/lib/providers/compatibleNodeIdentity.js:70-84`, mirrored on edit at `src/app/api/provider-nodes/[id]/route.js:98-109`), so the published prefix is unambiguous per node. The Playground sends the same node-id request address it sent before this port, so its `x-connection-id` pin and the auto-account choice are unaffected.
- **Per-key allowed models.** The exact-list allowlist keeps its current key form: the policy catalogue stores the resolved identity (`src/app/api/keys/policy-catalog/route.js` resolves the published id through `getModelInfo`), and the pattern rules already bridge prefix ↔ node id (`src/sse/services/modelAccess.js:39-61`). Nothing in this port changes either.
- **Collision and order contracts.** A prefix that collides with a built-in alias still loses to the built-in provider at resolve time (`RESERVED_PROVIDER_PREFIXES`); the Playground's grouping, dedupe and name ordering are unchanged (`groupModelsByProvider` still sorts by model name); the alias map still keeps the node id authoritative for a colliding prefix.

## Security review

- **Display only.** The prefix is operator-supplied free text stored on the provider node. It never selects an upstream credential and never builds an upstream URL: `getModelInfo` still resolves the prefix to the node id through the provider-nodes lookup, and the executor still receives the node id. The change touches publication and display surfaces only.
- **No secret rewriting.** No credential, key, connection payload or stored alias was rewritten. The stored storage keys (`customModels.providerAlias`, `modelAliases` values, disabled/enabled model lists) stay on the node id.
- **No new surface.** No new endpoint, no new auth path, no new query parameter, no provider request. `GET /api/provider-nodes` is an existing dashboard endpoint that the model picker already reads.
- **No secret in output.** The test fixtures use a synthetic node id and a `sk-test` placeholder; no real provider id, account id or credential is written to the report or to the test.

## Evidence

Commands run on this branch (2026-11-20):

```bash
# the prescribed acceptance command
test -s internal/docs/port-reports/1072-custom-provider-prefix-5786.md && \
  (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
    unit/port9r-custom-provider-prefix-5786.test.js)
# → 1 file passed, 28 tests passed (with unit/1300-v5-storybook-inventory.test.js: 2 files, 31 tests)

# the surfaces this port touches, plus the prefix/allowlist contracts they share
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/model-select-modal-media-kind.test.js \
  unit/model-select-modal-inactive-connections.test.js \
  unit/model-select-modal-null-alias.test.js \
  unit/model-select-modal-noauth-freetier.test.js \
  unit/g2-modelselect-dialog.test.js \
  unit/ui-production-playground.test.js \
  unit/openai-dashboard-capabilities.test.js \
  unit/custom-provider-combo-models.test.js \
  unit/build-models-list-compatible-allowlist.test.js \
  unit/buildModelsList-static-alias-map.test.js \
  unit/model-connid-prefix-normalization.test.js \
  unit/model-routing.test.js \
  unit/translator-custom-prefix.test.js \
  unit/network-node-routing-combo.test.js \
  unit/api-key-model-access.test.js \
  unit/api-key-policy-identity.test.js \
  unit/disabled-models-routing-4318.test.js \
  unit/combo-prefix-resolve.test.js \
  unit/custom-model-capabilities.test.js \
  unit/provider-node-identity-15987.test.js \
  unit/compatible-provider-connections.test.js
# → 21 files passed, 130 tests passed

npx eslint src/shared/utils/providerPrefix.js src/shared/hooks/useModelCaps.js \
  src/shared/components/ModelSelectModal.js \
  "src/app/(dashboard)/dashboard/playground/playgroundHelpers.js" \
  "src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js"
# → 0 errors (13 pre-existing react-hooks warnings in ModelSelectModal, unchanged)
```

New test coverage (all offline, no provider contacted):

- **Resolver**: connection prefix beats node prefix; node prefix is the fallback; a blank prefix is ignored; a node without a prefix keeps its node id; a built-in provider is never remapped by a stray `prefix`; the custom provider families and the bare-UUID node id are recognised, and a bare-UUID node still publishes its prefix.
- **Selectors**: for an ordinary live and static compatible model the Playground's canonical request id is `<node-id>/<model>` and the prefix is a separately displayed field (`displayModel` = `mirai/<model>`, `prefix` = `mirai`); a namespaced live id on an OpenAI- or Anthropic-compatible node becomes `<node-id>/<namespace>/<model>` with the namespace intact, and its label is checked separately; two nodes sharing a prefix or the same namespaced id keep distinct request ids; legacy aliases resolve through provider identity and an ambiguous one is not resolved; a live id with a provider segment is kept verbatim only on a built-in provider; a node without a prefix displays the node id; a built-in provider keeps its own id and is not renamed by a stray `prefix`; grouping, dedupe and name ordering are unchanged. The fixture is a pure offline helper test.
- **Native chat routing**: the request log line shows `→ mirai/<model>` and never the node id; it matches the id the client sent when the client used the prefix; it falls back to the node id when no prefix is configured; a built-in provider is left on its own id.
- **Capability lookup**: the published prefix resolves to the custom override stored under the node id, and the storage form stays resolvable; a prefix-keyed combo member derives the same capabilities the server publishes; another provider's combo member is unaffected.
- **Route selection** (temporary `DATA_DIR`, real local database): `mirai/<model>` and `<node-id>/<model>` resolve to the same node; a node without a configured prefix still routes by its node id; a prefix colliding with a built-in alias still loses to the built-in provider.

## Known limits

1. **Neighbouring surfaces are unchanged.** Two surfaces next to the ones in scope, an exact-list per-key allowlist and a model-info lookup, do not yet treat every published form the same way. They were not changed here and are tracked separately.
2. **Prefix validation is not uniform across provider families.** The scope of the creation rules was not changed by this port.
3. **A namespace equal to the node's own prefix.** The server removes one redundant leading prefix segment, so such a model keeps only its remainder. The parser was deliberately not changed.
4. **The upstream PR is still open upstream.** Its third precedence step was not adopted, so the published form for built-in providers is unchanged.
5. **A colocated Playground test file is outside the CI discovery scope** and was not run as part of the gate.
