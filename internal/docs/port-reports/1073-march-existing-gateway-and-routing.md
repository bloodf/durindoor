# #1073 — March OmniRoute existing gateway and routing behavior

Reviewed 2026-11-20 against DurinDoor `d6c547e2e9501520544f7d6f9b2588568741edef`. This is a static comparison of the **4 rows** that [the March recovered inventory](1073-march-recovered-dispositions.md) left UNRESOLVED, because path names alone do not establish parity:

- [#367](https://github.com/cheaper-inference/OmniRoute/pull/367) `c009c993c3bef5570ddd1f3593a4e83be0a50b05` / `27d66e4b3e83965bc885198bcbe53f636b13ef73`
- [#453](https://github.com/cheaper-inference/OmniRoute/pull/453) `81c43b45fb0470fc5a8aa7d6c91fae36ba6a231f` / `9d5ec523be55c0814dcd2c12b1b1b90558efc855`
- [#599](https://github.com/cheaper-inference/OmniRoute/pull/599) `a15b0ef0600ba5706e3ad9019191f28f3354152c` / `df774892c8d079f5d86d784818cf6728d886f889`
- [#646](https://github.com/cheaper-inference/OmniRoute/pull/646) `a6e78cd5dcf4b6864becb1270ab3f907837e44e9` / `57000443934d2105618128d34e83f5424512ed6e`

Upstream patches were read as public diffs at those merge commits, plus the upstream catalog source at the two catalog pins. The local implementation, its offline fixtures and the local provider/capability registries were read at this head. Nothing was executed: no provider or live service was called, no upstream checkout was made, and the local `tests/` package has no installed dependencies in this tree, so the cited fixtures were read, not run. Provider additions, authentication and sign-in flows, new integrations and CI are outside this comparison. No product edit, no credentials and no provider traffic are involved here.

## Codex request tier

### [#367](https://github.com/cheaper-inference/OmniRoute/pull/367) — client tier mapping: covered

Upstream merge `27d66e4b3e83965bc885198bcbe53f636b13ef73` (`feat(codex): add fast tier settings toggle`) adds `normalizeServiceTierValue()` to `open-sse/executors/codex.ts`: a request tier of `fast` becomes the Codex wire value `priority`, and the value is trimmed and lowercased first. The same PR adds `service_tier` to the field pass-through of `openaiToOpenAIResponsesRequest` in `open-sse/translator/request/openai-responses.ts`.

Both behaviors exist locally:

- `open-sse/executors/codex.js:1103` maps a request tier of `fast` to `priority` on the Codex wire.
- `open-sse/translator/request/openai-responses.js:1003` forwards `service_tier` inside `openaiToOpenAIResponsesRequest` (`open-sse/translator/request/openai-responses.js:835`), which is the Chat Completions → Responses hop upstream #367 patches.

Local behavior is a superset with three documented differences, none of which is an omission:

- A long-context demotion precedes the tier decision (`open-sse/executors/codex.js:1104-1112`), and a tier value other than `priority`/`ultrafast` is dropped (`open-sse/executors/codex.js:1113`). Both come from the upstream #2452 port, whose fixture is `tests/unit/port-2452-codex-fast-tier.test.js`.
- The tier can also be selected by a model suffix, parsed case-insensitively (`open-sse/translator/concerns/thinkingSuffix.js:64-77`) and applied only for providers that accept the field (`open-sse/handlers/chatCore.js:856-858`, scoped by `open-sse/config/serviceTier.js:16`). The fixture is `tests/unit/model-service-tier.test.js`.
- Upstream's normalizer lowercases the raw request field; the local body-field path matches the exact string `fast`, while the suffix path lowercases its token. A client that sends a differently-cased `service_tier` in the request body therefore reaches the local "not priority" branch and is dropped, where upstream #367 would have forwarded `priority`.

### [#367](https://github.com/cheaper-inference/OmniRoute/pull/367) — settings-driven default tier: unresolved, in scope

Upstream merge `27d66e4b3e83965bc885198bcbe53f636b13ef73` also adds a second, distinct behavior: when the client leaves `service_tier` unset, the Codex executor injects the default tier itself. Upstream holds that default in a module-level flag, fills it from a persisted setting, and exposes it through a dashboard toggle, a dedicated settings API route, a new validation schema and a startup restore.

No local equivalent exists:

- There is no default-tier setting in the local settings store or API (`src/lib/db/repos/settingsRepo.js`, `src/app/api/settings/route.js`), no executor-side default (the only tier injection that is not client-driven is `open-sse/executors/codex.js:1100-1102`, a per-connection opt-in that applies to one model family and injects a different tier value; its dashboard control is `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js:1033-1036`, fixture `tests/unit/codex-ultrafast-port.test.js`).
- Upstream's default never overrides an explicit client tier. Local has no default at all, so a Codex request without a tier reaches the provider with no tier.

Existing behavior requiring a focused port: an operator-configurable default Codex request tier, applied by the Codex path only when the client sends no tier, never overriding a client-supplied tier, using the same tier vocabulary as the client path (`fast` → `priority`), and restored across restarts. The boot-time restore point already exists — `src/instrumentation.node.js:30-31` reads settings during the nodejs bootstrap — and the persisted settings surface is `src/lib/db/repos/settingsRepo.js`.

Mixed-change note: upstream #367 is two changes in one merge. The executor/translator work is gateway request shaping; the dashboard tab, the dedicated settings API route, the validation schema and the startup restore are operator settings plumbing and need separate treatment from the gateway contract. Only the gateway behavior is recorded as a port candidate here; the settings surface is not proposed by this report, and product work stays on hold per `AGENTS.md`.

## Responses route and packaging

### [#453](https://github.com/cheaper-inference/OmniRoute/pull/453) — translator bootstrap in the route handler: covered by a different contract

Upstream merge `9d5ec523be55c0814dcd2c12b1b1b90558efc855` (`fix: pino Docker crash + Codex /v1/responses worker exit + package-lock sync`) removes the `initTranslators()` call from `src/app/api/v1/responses/route.ts`, because the dynamic import inside that bootstrap ran in a Next.js server worker and produced a "the worker has exited" crash on Codex CLI requests (upstream #450).

The local route still calls it (`src/app/api/v1/responses/route.js:3`, `src/app/api/v1/responses/route.js:8-13`, `src/app/api/v1/responses/route.js:31`), but the crash mechanism does not exist in this tree:

- `open-sse/translator/index.js:40` makes `ensureInitialized()` an empty function, and `initTranslators` (`open-sse/translator/index.js:555`) only calls it.
- Translator modules self-register through static side-effect imports at the bottom of `open-sse/translator/index.js`; that file contains no dynamic import.

So the local call is a no-op and the upstream failure mode cannot be reproduced by it. The same call pattern is present in the sibling routes (`src/app/api/v1/chat/completions/route.js`, `src/app/api/v1/messages/route.js`, `src/app/api/v1/responses/compact/route.js`, `src/app/api/v1/completions/route.js`, `src/app/api/v1/api/chat/route.js`, `src/app/api/v1beta/models/[...path]/route.js`), which makes it a repo-wide local convention rather than a leftover in one handler. Removing the local call would change no observable behavior. The local route additionally carries the early-stream keepalive behavior that upstream's route does not have; that is a local addition, not a parity gap.

### [#453](https://github.com/cheaper-inference/OmniRoute/pull/453) — Docker image pino transport copy: excluded

The same upstream merge copies `pino-abstract-transport` and `pino-pretty` into the standalone image because the pino transport worker is not captured by the Next.js standalone trace (upstream #449). This is image packaging, not gateway or routing behavior, and it has no local counterpart: the local tree has no pino dependency (`package.json`, `pnpm-lock.yaml`), and the local image materializes the runtime dependency closure through `scripts/build-app.mjs` instead of hand-copied module directories (`Dockerfile`, runner stage comments). There is no pino transport worker to trace here.

### [#453](https://github.com/cheaper-inference/OmniRoute/pull/453) — lockfile version sync: excluded

The remaining hunk moves the upstream lockfile version from `2.7.0` to `2.7.2`. That is upstream release bookkeeping on a different package (`omniroute`); the local package is `durindoor` at `4.11.0` (`package.json`), and its lockfile version is not a port target.

## Media model visibility

### [#599](https://github.com/cheaper-inference/OmniRoute/pull/599) — upstream subject and rule

Upstream merge `df774892c8d079f5d86d784818cf6728d886f889` (`fix: hide comfyui/sdwebui models when no provider configured`) changes `src/app/api/v1/models/catalog.ts`: the video and music catalog loops previously exempted providers whose registry entry has `authType === "none"` from the provider-activity filter, and after this change every video and music row is published only when its provider has an active connection. The upstream video registry at this merge lists `comfyui` and `sdwebui` with `authType: "none"` — the local-install providers named in the PR title.

Local status, per part:

- **The upstream subject does not exist locally.** `open-sse/providers/registry/sdwebui.js` and `open-sse/providers/registry/comfyui.js` are `category: "apikey"` providers whose models are image-kind only (`serviceKinds: ["image"]`); local publishes no video row for either provider, so upstream's specific "hide comfyui/sdwebui video models" behavior is structurally absent rather than missing.
- **Credentialed media providers already satisfy the upstream rule.** Video and music rows for `minimax`, `minimax-cn`, `suno`, `udio`, `together`, `orcarouter` and `xai` are produced only for providers that hold an active saved connection (`src/app/api/v1/models/buildModelsList.js:707-713` and `src/app/api/v1/models/buildModelsList.js:1005-1016`).
- **One media provider does not.** The free no-auth provider `veo-free` (`open-sse/providers/registry/veoaifree-web.js`: `category: "free"`, `noAuth: true`, transport `authType: "none"`, `serviceKinds: ["video"]`, two video rows) publishes those rows through the keyless fallback at `src/app/api/v1/models/buildModelsList.js:1331-1336`, which runs for every no-auth provider that has no active connection. Because inactive connections are dropped from the connection set first (`src/app/api/v1/models/buildModelsList.js:610`), the same rows are published when a saved connection for that provider exists but is disabled. Upstream #599 removed exactly this exemption for video and music.

Existing behavior requiring a focused port: video and music catalog rows must be published only when the media provider has a usable connection, instead of being published for an unconfigured (or disabled-connection) free no-auth media provider. The keyless fallback that keeps the LLM and image catalogs visible without credentials is fixture-backed local intent (`tests/unit/build-models-list-noauth.test.js`, including the "zero connections" case) and must not be narrowed by this port; the operator control for free no-auth providers stays where it is (`disabledFreeProviders` in `src/lib/db/repos/settingsRepo.js:157`, applied through `src/sse/services/freeProviderGate.js`).

Mixed-change note: upstream #599 edits only the video and music loops. The broader upstream rule in `isProviderActive` — "no active connections at all ⇒ publish nothing" — is not part of this PR and is deliberately not matched here; the local zero-connection keyless catalog is asserted by the local fixture named above.

## Vision metadata in the model catalog

### [#646](https://github.com/cheaper-inference/OmniRoute/pull/646) — covered by a different mechanism

Upstream merge `57000443934d2105618128d34e83f5424512ed6e` (`feat: add vision capability metadata to /v1/models response`) adds vision fields to `src/app/api/v1/models/catalog.ts`: chat-model rows gain `capabilities: { vision: true }`, `input_modalities: ["text","image"]` and `output_modalities: ["text"]`. The decision is made by a hardcoded keyword list (`VISION_MODEL_KEYWORDS`) matched against the alias id, the provider-prefixed id and the bare model id, on the provider-model rows and on the custom-model rows alike.

Local already publishes the same response fields, from provider evidence rather than a name keyword list:

- The public OpenAI envelope is produced by `projectDiscoveryMetadata` (`open-sse/services/modelMetadata.js:178-219`, applied in `src/app/api/v1/models/_shared.js:104`), which always emits `input_modalities`, `output_modalities`, `input`, `output` and a `capabilities` object.
- `vision` is set from the provider's declared capability or from the live catalog's declared input modalities (`open-sse/services/modelMetadata.js:102-125`), and the curated pattern table in `open-sse/providers/capabilities.js` supplies vision for the families the local catalog ships.
- The Anthropic envelope exposes the same fact as `capabilities.image_input.supported` (`src/app/api/v1/models/_shared.js:42`); the Codex envelope carries its own metadata projection (`src/app/api/v1/models/_shared.js:16-32`).

The residual difference is the fallback source, not the response contract: upstream's keyword list additionally names retired or self-hosted families (llava, pixtral, bakllava, qvq, mistral-pixtral) that the local pattern table does not list. A self-hosted model that declares its modalities in its own provider catalog is still marked locally, so importing the name-keyword list would add names the local capability source omits and would mark models vision-capable without provider evidence. No port candidate is recorded for this row.

## Limits

The count is exactly four rows, not an estimate of the March inventory. **The remaining March rows stay outside this comparison**, including every row already dispositioned elsewhere in [the March recovered inventory](1073-march-recovered-dispositions.md) and every row whose subject is a provider addition, an authentication or sign-in flow, a new integration or CI work. Two rows are recorded as confirmed in-scope gaps: the Codex default request tier from [#367](https://github.com/cheaper-inference/OmniRoute/pull/367) and the media-row provider-activity gate from [#599](https://github.com/cheaper-inference/OmniRoute/pull/599); both are described as existing behavior only, and no implementation is proposed. Static inspection does not establish live provider behavior, upstream runtime behavior beyond the published patches, or the result of running the cited fixtures. The two source pins per row are preserved exactly as supplied.

Refs #1073
