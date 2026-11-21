# Current provider identity dispositions (#2034)

This file reconciles the provider identities that the merged OmniRoute inventory
recorded as missing against what DurinDoor actually ships now. It is the current
disposition record for work order #2034; the earlier inventories stay in place as
the audit trail for the snapshots they were written against.

- Bulk inventory and the 69 unmatched exact IDs:
  [`provider-parity-omniroute.md`](./provider-parity-omniroute.md)
- Key/local contract qualification: [`provider-parity-omni-keys.md`](./provider-parity-omni-keys.md)
- Sign-in contract verification:
  [`provider-parity-omni-sessions-verified.md`](./provider-parity-omni-sessions-verified.md)
- Closed-ticket qualification:
  [`provider-parity-closed-omniroute.md`](./provider-parity-closed-omniroute.md)
- Vendor endpoint gaps: [`provider-parity-omni-vendor-gaps.md`](./provider-parity-omni-vendor-gaps.md)
- Open-ticket qualification:
  [`provider-parity-open-durindoor.md`](./provider-parity-open-durindoor.md)
- CLIProxyAPI inventory: [`provider-parity-cliproxyapi.md`](./provider-parity-cliproxyapi.md)
- EasyCLIProxyAPI inventory:
  [`provider-parity-easycliproxyapi.md`](./provider-parity-easycliproxyapi.md)
- OmniRoute release delta:
  [`provider-parity-omni-release-delta.md`](./provider-parity-omni-release-delta.md)

Docs only. No provider service was called, no credential was used, no browser,
container, end-to-end or deployment surface was exercised, and no test file was
changed.

## Revisions

| Side | Revision | How it was resolved |
| --- | --- | --- |
| OmniRoute `release/v3.8.55` | `b748429cf5b3aeb142a708fd3e8751b6918b9dc8` | `git ls-remote https://github.com/cheaper-inference/OmniRoute.git refs/heads/release/v3.8.55`. Commit subject: `Merge pull request #20839 from cheaper-inference/fix/qg-v3855-codeql-parsers-186db2-20261120`. |
| CLIProxyAPI `main` | `f5c5681a8361c9da53e93c60b6507816eee7468b` | `git ls-remote https://github.com/router-for-me/CLIProxyAPI.git refs/heads/main`. Commit subject: `fix(auth): capture per-attempt access token on streaming failure results`. |
| EasyCLIProxyAPI `main` | `e4223d5eefa22a3301ca7e2a28d05897432b07f9` | `git ls-remote https://github.com/router-for-me/EasyCLIProxyAPI.git refs/heads/main`. |
| DurinDoor assigned integration | `26ce7ee4c38142c3276410a3186cc8adef59c74c` | Branch `orq/toruzq/integration`, subject `Merge commit 'a8a913705d9dcc43adfabecb29f9849265adce22' into orq/toruzq/integration`. Local `git rev-parse`. |

Upstream source was read from a blob-filtered, read-only clone outside the
repository. Upstream links below are pinned to `b748429cf5b3aeb142a708fd3e8751b6918b9dc8`
so they stay valid as the release branch moves. DurinDoor links point at the
assigned integration SHA.

Two facts make the upstream side stable enough to reason about:

- All 69 identities still exist upstream at `b748429cf5b3aeb142a708fd3e8751b6918b9dc8`.
  Every one of them resolves to a live registry entry, so none of the rows below
  is a "upstream removed it" case.
- Between the earlier OmniRoute snapshot `4624250231f49ed118fb4522a9d735e4894322c6`
  (the pin the shipped DurinDoor port comments cite) and the current tip, the
  upstream provider registry changed in exactly one file,
  `open-sse/config/providers/registry/cursor/grok47.ts`, which alters a Cursor
  synthetic-model id and no registry identity. No identity was added, removed or
  re-pointed in that range, so the contracts recorded for the 69 identities are
  the same contracts the shipped ports were written against.

## Method

The bulk inventory compared file names and exact IDs. That is not enough to decide
a disposition, so every row below was re-checked against composition and
dispatch:

1. The DurinDoor catalog was enumerated by importing the generated barrel
   [`open-sse/providers/registry/index.js`](../../open-sse/providers/registry/index.js),
   which composes 376 entries at the assigned integration
   (`apikey` 288, `freeTier` 26, `oauth` 31, `webCookie` 14, `free` 14,
   `system` 1, `hidden` 1, one without a category). An identity counts as shipped
   only when it is composed there.
2. Dispatch was checked in [`open-sse/executors/index.js`](../../open-sse/executors/index.js)
   and the per-provider executors, and credential handling in
   [`open-sse/providers/schema.js`](../../open-sse/providers/schema.js),
   [`open-sse/services/tokenRefresh/providers.js`](../../open-sse/services/tokenRefresh/providers.js)
   and [`src/lib/oauth/`](../../src/lib/oauth). A registry entry with no executor
   or credential path is metadata, not a runnable route.
3. The upstream side was read at the pinned SHA in
   `open-sse/config/providers/registry/`, `open-sse/executors/`,
   `src/lib/oauth/providers/` and `open-sse/services/tokenRefresh/providers/`.
4. Authorization was taken from first-party operator documentation and from the
   dated `bloodf/durindoor` issue comments. Closure state alone was not treated
   as a decision; the reason recorded in the comment is the evidence.

An identity whose local id equals an upstream id is not treated as parity on
that basis. Two examples in this pass: the local `arcee-ai` entry points at
Arcee Conductor, not at the upstream `arcee-ai` platform endpoint, and the local
`opencode-server` entry speaks a stateless text contract, not the upstream
session protocol.

### Disposition vocabulary

| Disposition | Meaning |
| --- | --- |
| Shipped equivalent | The upstream contract's observable surface (provider, endpoint, credential class, discovery and dispatch) is already served by a composed DurinDoor route. The local identity may differ from the upstream id. |
| Distinct queued implementation | DurinDoor ships, or has queued on a branch, a deliberately different contract for the same provider surface. The upstream variant stays a separate candidate and is not an equivalence claim. |
| Conclusively retired upstream contract | A dated issue disposition or first-party evidence retires the upstream candidate for DurinDoor: consumer-session scraping, client impersonation, a prohibited reverse-engineered protocol, a reseller with no named operator or terms, or a dead origin. |
| Supported still-missing gateway contract | The upstream contract is a documented, publicly supported provider surface that DurinDoor does not ship and could ship without scraping or impersonation. |
| Still-unverified flow | Neither a shipped equivalent nor a retirement can be established from source and first-party documentation. The runtime or the authorization is unproven, and no live call was made to find out. |

### Evidence, authorization and mock coverage

Every row records three things, and they are not interchangeable:

- **Evidence** is the pinned source path on each side of the comparison.
- **Supported authorization** is the first-party operator documentation, the
  operator's terms, or the dated issue comment that permits or forbids the
  contract. Where it is absent, the row says so.
- **Mock coverage** is the offline deterministic check that pins the contract
  without touching a provider. A row with no shipped route carries the mock
  acceptance outline that a later authorized implementation would have to
  satisfy.

No mock in this repository proves that a provider accepts a credential or serves
a model. The offline fleet tests for the retired candidates
(`tests/unit/fleet-provider-*.test.js`) are boundary tests: they keep the
candidate's capabilities unavailable and prove the identity is not composed.

### Scope exclusions

Three classes of upstream surface are not inference providers and are not
counted here:

- External applications that connect to the proxy as clients. OmniRoute's
  `bin/cli/commands/setup.mjs` and `docs/guides/` describe client-side endpoint
  and model settings for OpenCode, Cursor, Claude Code, Codex and Cline. Those
  are inbound-client setup, not outbound provider contracts.
- Network-provider work owned elsewhere. LAN discovery, network Ollama and
  OpenAI-compatible node routing are a separate feature surface with their own
  owner and their own work items, so `ollama-local` and the network node system
  are read as local transports rather than as provider identity candidates.
- An MCP service for a separate product. An MCP server exposed by another
  product is not an outbound inference provider, and it is not counted as one
  even when it appears next to provider registries.

## Per-identity dispositions

The 69 identities from the merged inventory are reconciled below. Counts:
25 shipped equivalents, 4 distinct queued implementations, 36 conclusively
retired upstream contracts, 1 supported still-missing gateway contract and 3
still-unverified flows. 25 + 4 + 36 + 1 + 3 = 69.

### Shipped equivalents (25)

| Upstream identity and pinned contract | DurinDoor disposition and contract paths | Authorization evidence | Mock coverage |
| --- | --- | --- | --- |
| `arcee-ai` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/arcee-ai/index.ts): `https://api.arcee.ai/api/v1/chat/completions`, OpenAI-compatible builder, passthrough models. | Shipped under the local id `arcee-platform`: [`open-sse/providers/registry/arcee-platform.js`](../../open-sse/providers/registry/arcee-platform.js) with the same chat base URL, `/api/v1/models` discovery and passthrough models. The local `arcee-ai` id in [`open-sse/providers/registry/omniroute-api-cloud.js`](../../open-sse/providers/registry/omniroute-api-cloud.js) is a different surface, `https://conductor.arcee.ai/v1/chat/completions` (Arcee Conductor), and the two must not be conflated. | Operator platform and key page recorded in the entry notice. Both local ids are operator-scoped API-key contracts; the Conductor surface is a separate vendor product. | `tests/unit/arcee-ai-provider.test.js`. |
| `cerebrium` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/cerebrium/index.ts): `https://api.cerebrium.ai/v4`, `executor: cerebrium`, bearer. | Shipped: [`open-sse/providers/registry/cerebrium.js`](../../open-sse/providers/registry/cerebrium.js) (per-connection deployment data, redirect rejection) and [`open-sse/executors/cerebrium.js`](../../open-sse/executors/cerebrium.js), dispatched at [`open-sse/executors/index.js`](../../open-sse/executors/index.js). Retained difference: upstream seeds a static catalog, the local entry passes models through. | Deployment-scoped API key; no scraping or impersonation involved. | `tests/unit/cerebrium-provider.test.js`. |
| `daoxe` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/daoxe/index.ts): `https://api.daoxe.com/v1/chat/completions` plus `/v1/models`. | Shipped: [`open-sse/providers/registry/daoxe.js`](../../open-sse/providers/registry/daoxe.js), same chat URL and `/v1/models` discovery, seeded catalog plus passthrough. | Operator API key; the local entry records the key page. | `tests/unit/daoxe-provider.test.js`. |
| `demonroute` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/demonroute/index.ts): `https://api.demonroute.com/v1/chat/completions` plus `/v1/models`. | Shipped: [`open-sse/providers/registry/demonroute.js`](../../open-sse/providers/registry/demonroute.js), same chat URL and discovery. | Operator API key. | `tests/unit/demonroute-provider.test.js`. |
| `devin-cli-agentic` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/devin-cli-agentic/index.ts): `format: claude`, `executor: devin-cli-agentic`, `devin://acp/stdio`, `authType: none`. | Shipped as a genuinely distinct local runtime identity: [`open-sse/providers/registry/devin-cli-agentic.js`](../../open-sse/providers/registry/devin-cli-agentic.js) with the same ACP stdio target and no credential, alongside the OAuth `devin-cli` route on the same path. | No credential is requested or persisted, because the route drives a local ACP agent rather than a hosted vendor API. | `tests/unit/devin-cli-agentic-provider.test.js`, `tests/unit/fleet-provider-devin-cli-agentic-acceptance.test.js`. |
| `empiriolabs` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/empiriolabs/index.ts): `https://api.empiriolabs.ai/v1/chat/completions`. | Shipped: [`open-sse/providers/registry/empiriolabs.js`](../../open-sse/providers/registry/empiriolabs.js), same chat URL, seeded catalog plus passthrough. | Operator API key with account scope, recorded in the entry notice. | `tests/unit/empiriolabs-provider.test.js`. |
| `gisoo` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/gisoo/index.ts): `https://gisoo.pro/api/v1/chat/completions` plus `/api/v1/models`. | Shipped: [`open-sse/providers/registry/gisoo.js`](../../open-sse/providers/registry/gisoo.js), same chat URL and discovery. | Operator API key; prepaid relay with a named operator. | `tests/unit/gisoo-provider.test.js`. |
| `grokified` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/grokified/index.ts): `https://api.grokified.com/v1/chat/completions`, bearer. | Shipped: [`open-sse/providers/registry/grokified.js`](../../open-sse/providers/registry/grokified.js), same host and path, chat completions only. | First-party operator contract recorded in the entry header and in [`grokified-provider-2034.md`](./grokified-provider-2034.md): docs, error reference and model pages. | `tests/unit/grokified-provider.test.js`. |
| `hetzner` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/hetzner/index.ts): `https://inference.hetzner.com/api/v1/chat/completions` plus `/api/v1/models`. | Shipped: [`open-sse/providers/registry/hetzner.js`](../../open-sse/providers/registry/hetzner.js), same chat URL and discovery, passthrough catalog. | Operator API token, recorded in the entry notice; the entry marks the service experimental. | `tests/unit/hetzner-provider.test.js`. |
| `nan` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/nan/index.ts): `https://api.nan.builders/v1/chat/completions` plus `/v1/models`. | Shipped and extended: [`open-sse/providers/registry/nan.js`](../../open-sse/providers/registry/nan.js) keeps the chat URL and discovery and adds embedding, speech, image and rerank service kinds that upstream does not declare for this identity. The additive surfaces are not a parity claim. | Operator API key, recorded in the entry notice. | `tests/unit/nan-provider.test.js`, `tests/unit/nan-provider-parity.test.js`. |
| `nlpcloud` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/nlpcloud/index.ts): `https://api.nlpcloud.io/v1/gpu`, bearer, and an executor-map override to `NlpCloudExecutor`. | Shipped with the same specialized executor, not just the same endpoint: [`open-sse/providers/registry/nlpcloud.js`](../../open-sse/providers/registry/nlpcloud.js) and [`open-sse/executors/nlpcloud.js`](../../open-sse/executors/nlpcloud.js), dispatched at [`open-sse/executors/index.js`](../../open-sse/executors/index.js). | First-party contract cited in the entry header: the NLP Cloud chatbot documentation. | `tests/unit/nlpcloud-provider.test.js`. |
| `openference` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/openference/index.ts): OAuth, `https://api.openference.com/v1/chat/completions`, passthrough catalog. | Shipped as a distinct OAuth identity, kept separate from the API-key sibling `openference-api`: [`open-sse/providers/registry/openference.js`](../../open-sse/providers/registry/openference.js) with authorize and token endpoints, `model:invoke` scope and S256 PKCE. | The entry notice states that an operator-configured Openference client is required and that live account verification is pending. | `tests/unit/openference-provider.test.js`. Issue [#1220](https://github.com/bloodf/durindoor/issues/1220) was closed on the grounds that the OAuth identity is distinct from the API-key sibling; the OAuth route shipped separately. |
| `paraloncloud` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/paraloncloud/index.ts): `https://paraloncloud.com/v1/chat/completions` plus `/v1/models`. | Shipped: [`open-sse/providers/registry/paraloncloud.js`](../../open-sse/providers/registry/paraloncloud.js), same chat URL and discovery. | Operator API key. | `tests/unit/paraloncloud-provider.test.js`, `tests/unit/paraloncloud-provider-parity.test.js`. |
| `poe` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/poe/index.ts): API key, `https://api.poe.com/v1/chat/completions`, with `responsesBaseUrl` and `messagesUrl` variants and a curated catalog whose Claude entries carry `targetFormat: claude`. | Shipped for the API-key chat contract: [`open-sse/providers/registry/omniroute-api-cloud.js`](../../open-sse/providers/registry/omniroute-api-cloud.js) registers `poe` at the same chat URL, and [`open-sse/translator/concerns/poeImageOnlyUserTurn.js`](../../open-sse/translator/concerns/poeImageOnlyUserTurn.js) carries a Poe-specific request rule. Retained difference: the Responses (`/v1/responses`) and Anthropic Messages (`/v1/messages`) sub-routes and the curated Claude-eligible catalog are not composed locally. | Poe documents the API-key surface for external applications; the upstream source comment cites the Anthropic-compatible API page. | `tests/unit/translator-poe-image-only-user-turn.test.js`. The Responses and Messages sub-routes have no local coverage and no local route. |
| `replicate` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/replicate/index.ts): `https://api.replicate.com/v1`, bearer, `executor: replicate`. | Shipped with the same specialized executor: [`open-sse/providers/registry/replicate.js`](../../open-sse/providers/registry/replicate.js) and [`open-sse/executors/replicate.js`](../../open-sse/executors/replicate.js), dispatched at [`open-sse/executors/index.js`](../../open-sse/executors/index.js). | Operator API token, recorded in the entry notice. | `tests/unit/replicate-provider.test.js`. |
| `runcrate` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/runcrate/index.ts): `https://api.runcrate.ai/v1/chat/completions`, bearer. | Shipped: [`open-sse/providers/registry/runcrate.js`](../../open-sse/providers/registry/runcrate.js), same chat URL. | First-party contract cited in the entry header: the Runcrate chat API page. Only the documented chat API is ported; instance creation and GPU provisioning stay out. | `tests/unit/runcrate-provider.test.js`, [`runcrate-provider-contract.md`](./runcrate-provider-contract.md). |
| `tokenharbor` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/tokenharbor/index.ts): `https://tokenharbor.ai/v1/chat/completions` plus `/v1/models`. | Shipped: [`open-sse/providers/registry/tokenharbor.js`](../../open-sse/providers/registry/tokenharbor.js), same chat URL and discovery, passthrough catalog. | Operator Universal Key, recorded in the entry notice. | `tests/unit/tokenharbor-provider.test.js`, `tests/unit/tokenharbor-model-list.test.js`. |
| `xkiro` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/xkiro/index.ts): `https://api.xkiro.com/v1/chat/completions`, OpenAI-compatible builder. | Shipped: [`open-sse/providers/registry/xkiro.js`](../../open-sse/providers/registry/xkiro.js), same chat URL and model passthrough. The local Kiro OAuth route is a different provider contract and is not an equivalent. | Operator API key. | `tests/unit/xkiro-provider.test.js`, `tests/unit/fleet-provider-xkiro-acceptance.test.js`. Issue [#1248](https://github.com/bloodf/durindoor/issues/1248) was closed as an equivalent local implementation. |
| `y-api` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/y-api/index.ts): `https://api.y-api.bestvirtualgoods.com/v1/chat/completions` plus `/v1/models`. | Shipped: [`open-sse/providers/registry/y-api.js`](../../open-sse/providers/registry/y-api.js), same chat URL and discovery. The local entry adds an Anthropic Messages transport taken from the operator's own OpenAPI document, which upstream does not declare. | First-party operator contract recorded in the entry header: integration guide, error reference, OpenAPI 3.1 document and terms of service. | `tests/unit/y-api-provider.test.js`. Issue [#1249](https://github.com/bloodf/durindoor/issues/1249) was closed against the earlier reseller candidate; the shipped entry rests on the operator's own published terms and OpenAPI document instead. |
| `moonshot` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/moonshot/index.ts): `https://api.moonshot.ai/v1/chat/completions`, bearer, `executor: moonshot`, with a curated Kimi catalog. | Shipped under the `kimi` identity as an alternate transport: [`open-sse/providers/registry/kimi.js`](../../open-sse/providers/registry/kimi.js) carries an OpenAI-format transport on `https://api.moonshot.ai/v1/chat/completions` beside the Claude-format transport, and [`open-sse/executors/default.js`](../../open-sse/executors/default.js) applies the Moonshot request shaping upstream performs in its own executor, the `max_tokens` to `max_completion_tokens` rename and the fixed-sampling strip for the K2.6, K2.7 Code and K3 families. | Operator platform key; the platform key authenticates both documented endpoints. | `tests/unit/moonshot-provider.test.js`, `tests/unit/kimi-platform-catalog-1359.test.js`. |
| `naga-ai` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/naga-ai/index.ts): `https://api.naga.ac/v1/chat/completions` plus `/v1/models`. | Shipped under the sibling identity `naga-ac` (alias `naga`): [`open-sse/providers/registry/naga-ac.js`](../../open-sse/providers/registry/naga-ac.js), same chat URL, same `/v1/models` discovery, same bearer and optional-key handling. | Third-party gateway; the entry notice asks operators to review the provider's terms. | Issue [#1210](https://github.com/bloodf/durindoor/issues/1210) was closed as a duplicate of `naga-ac`, which shipped with the `naga` alias. The shipped entry has no dedicated mock; the shared OpenAI-compatible path is covered by the generic provider tests. |
| `ollama-cloud` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/ollama-cloud/index.ts): `https://ollama.com/v1/chat/completions`, bearer, catalog at `https://ollama.com/api/tags`. | Shipped as the `ollama` cloud identity: [`open-sse/providers/registry/ollama.js`](../../open-sse/providers/registry/ollama.js) uses the same hosted host, the same API-key auth and the same `/api/tags` catalog. Retained difference: the local entry speaks the native Ollama chat wire format and a Claude transport, not an OpenAI-format `/v1/chat/completions` transport. The separate `ollama-local` entry is a localhost target and is not an equivalent. | Operator API key from the Ollama key page, recorded in the entry notice. | `tests/unit/ollama-catalog.test.js`, `tests/unit/ollama-claude-block-fidelity.test.js`. |
| `mlx-gemma` and `mlx-qwen` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/mlx/index.ts): two local lanes on ports 11435 and 11436 with static model catalogs. | Shipped as one operator-configured local runtime identity: [`open-sse/providers/registry/mlx.js`](../../open-sse/providers/registry/mlx.js) with a per-connection base URL and passthrough models. The entry header states that the Gemma and Qwen ids are model hints, not separate providers. Retained difference: the local entry does not seed the two upstream static catalogs and does not bind two fixed ports. | No credential, because the route targets a local MLX server. | `tests/unit/mlx-provider-parity.test.js`, `tests/unit/mlx-gateway-parity.test.js`. Issues [#1205](https://github.com/bloodf/durindoor/issues/1205) and [#1206](https://github.com/bloodf/durindoor/issues/1206) were closed on the collapsed-local-runtime basis. |
| `xai-oauth` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/xai/index.ts): a second variant of the `xai` module with `authType: oauth`, its own `xai-oauth` executor and the shared endpoint and catalog. | Shipped as an auth mode of the `xai` identity: [`open-sse/providers/registry/xai.js`](../../open-sse/providers/registry/xai.js) declares `authModes: ["oauth", "apikey"]`, an `openai-responses-oauth` transport on `https://api.x.ai/v1/responses`, and the OAuth token and refresh endpoints. | xAI's own OAuth endpoints, recorded in the transport block. | `tests/unit/xai-oauth-responses.test.js`, `tests/unit/xai-oauth-service.test.js`, `tests/unit/fleet-provider-xai-oauth-acceptance.test.js`. Issue [#1247](https://github.com/bloodf/durindoor/issues/1247) was closed on the equivalent-OAuth-mode basis. |

### Distinct queued implementations (4)

| Upstream identity and pinned contract | DurinDoor disposition and contract paths | Authorization evidence | Mock coverage |
| --- | --- | --- | --- |
| `codebuddy-intl` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/codebuddy-intl/index.ts): OAuth bearer on `https://www.codebuddy.ai/v2/chat/completions` with IDE headers and forced streaming. | The provider surface is shipped under a different credential contract: [`open-sse/providers/registry/codebuddy-intl.js`](../../open-sse/providers/registry/codebuddy-intl.js) uses the same host, path, IDE headers and forced streaming with an International API key, and keeps a curated catalog with passthrough models. The upstream OAuth identity is not replicated and stays a separate candidate. | The entry header records the boundary: Tencent documents `X-Api-Key` for International keys, and no public International OAuth client or account model-list endpoint is specified, so the upstream OAuth variant cannot be reproduced from first-party evidence. | `tests/unit/codebuddy-intl-provider.test.js`, `tests/unit/codebuddy-channel-headers.test.js`. |
| `megabrain` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/megabrain/index.ts): device-code OAuth on `https://api.getmegabrain.com/api/openrouter/chat/completions`. | Shipped as a distinct contract on the public external-client gateway: [`open-sse/providers/registry/megabrain.js`](../../open-sse/providers/registry/megabrain.js) uses an API key on `https://getmegabrain.com/api/gateway/v1/chat/completions` with `/api/gateway/v1/models` discovery. The entry header records that the older OAuth contract is unverified, so the upstream OAuth identity is not replicated. | Operator key page recorded in the entry notice. The upstream device-code OAuth path has no local authorization evidence. | `tests/unit/megabrain-provider.test.js`. |
| `opencode-server` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/opencode-server/index.ts): the local `opencode serve` server, `POST /session` plus `POST /session/:id/message` with `GET /event` SSE, bearer auth, catalog at `/config/providers`. | Shipped as a deliberately different local contract on the same id: [`open-sse/providers/registry/opencode-server.js`](../../open-sse/providers/registry/opencode-server.js) and [`open-sse/executors/opencode-server.js`](../../open-sse/executors/opencode-server.js) drive an operator-managed server over a stateless text endpoint, with HTTP Basic credentials and non-streaming dispatch. The upstream session and parts protocol is not composed. | Operator-managed server; the executor rejects tool, session and store features explicitly, so no upstream session contract is implied. | `tests/unit/opencode-server-provider.test.js`. |
| `mnn-ai` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/mnn-ai/index.ts): `https://api.mnnai.ru/v1/chat/completions` plus `/v1/models`, passthrough models. | Not yet on the assigned integration. A queued implementation exists on branch `orq/toruzq/add-mnn-ai-a1-l2` at commit `2296e7d9c2` (`port(omniroute): add the MNN AI chat provider`), which adds `open-sse/providers/registry/mnn-ai.js`. That queued entry is deliberately narrower than the operator's wider surface: chat completions only, with the Anthropic-compatible, Responses, media, embedding, moderation and web-search surfaces excluded. The upstream registry entry carries the chat contract only, so the queued entry covers the pinned upstream contract. | First-party contract cited by the queued entry: `https://mnnai.ru/docs`, with published terms of service naming the operator and a privacy policy. That is stronger evidence than the anonymous-operator reading behind the earlier closure. | Issue [#1207](https://github.com/bloodf/durindoor/issues/1207) was closed against an earlier anonymous-operator review and later reopened; the queued entry is what that reopened item now rests on. The queued entry has no test yet. |

### Conclusively retired upstream contracts (36)

Each row below is retired for DurinDoor by a dated issue disposition or by
first-party evidence, not by the absence of a local file. The listed mock is the
offline boundary test that keeps the candidate unavailable.

| Upstream identity and pinned contract | Retirement evidence | Mock coverage |
| --- | --- | --- |
| `blackbox-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/blackbox/web/index.ts): `https://app.blackbox.ai/api/chat`, cookie auth. | Issue [#1159](https://github.com/bloodf/durindoor/issues/1159), closed not planned after the 2026-11-01 evaluation: consumer-session scraping rather than a public API. | `tests/unit/fleet-provider-*` coverage is not present for this id; the boundary is the absence of a `blackbox-web` registry entry. |
| `chat-oripe` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/chat-oripe/index.ts): `https://api.oriper.com/v1/chat/completions`. | Issue [#1160](https://github.com/bloodf/durindoor/issues/1160), closed not planned: the 2026-11-03 review found a down origin and an ambiguous identity. | No local route and no mock; the candidate stays unavailable. |
| `chatgpt-web-codex` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/chatgpt-web-codex/index.ts): `https://chatgpt.com`, `format: openai-responses`, cookie auth, its own executor. | Issue [#1162](https://github.com/bloodf/durindoor/issues/1162), closed not planned: consumer-session scraping of a Responses-shaped web route. | `tests/unit/fleet-provider-chatgpt-web-codex-acceptance.test.js` proves the cookie-session `chatgpt-web` identity and the OAuth `codex` identity are not the same and that no OAuth fallback exists. |
| `chatplayground` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/chatplayground/index.ts): `https://app.chatplayground.ai/api/chat`, cookie auth. | Issue [#1163](https://github.com/bloodf/durindoor/issues/1163), closed not planned: cookie-based scraping of a multi-model consumer UI, with resale and terms risk. | No local route and no mock. |
| `claude-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/claude/web/index.ts): `https://claude.ai/api/organizations`, cookie auth. | Issue [#1165](https://github.com/bloodf/durindoor/issues/1165), closed not planned: consumer-session scraping of the Claude web session. | No local route and no mock. The documented alternative is Anthropic's own API, which DurinDoor ships as `anthropic`. |
| `cloudflare-playground` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/cloudflare-playground/index.ts): `https://playground.ai.cloudflare.com`, `authType: none`. | Issue [#1167](https://github.com/bloodf/durindoor/issues/1167), closed not planned: an unauthenticated demo playground, not a public API. Documented replacement is Cloudflare Workers AI, which DurinDoor ships as `cloudflare-ai`. | No local route and no mock. |
| `conol-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/conol-web/index.ts): `https://conol.ai/api/sessions`, cookie auth. | Issue [#1169](https://github.com/bloodf/durindoor/issues/1169), closed not planned: web UI session scraping with no supported API found. | No local route and no mock. |
| `cursor-api` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/cursor/index.ts): an API-key variant of the Cursor identity exchanging a `crsr_` key for a session token. | Issue [#1170](https://github.com/bloodf/durindoor/issues/1170), closed not planned with a specific reason: the protocol is reverse-engineered and the service terms prohibit reverse engineering. | `tests/unit/fleet-provider-cursor-api-acceptance.test.js`. The local `cursor` route is OAuth only; the API-key variant is not composed. |
| `deepseek-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/deepseek/web/index.ts): `https://chat.deepseek.com/api/v0/chat/completion`, bearer. | Issue [#1173](https://github.com/bloodf/durindoor/issues/1173), closed not planned: consumer-session scraping of the web chat. The documented alternative is DeepSeek's own API, which DurinDoor ships as `deepseek`. | No local route and no mock. |
| `devin-desktop` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/devin-desktop/index.ts): `https://server.codeium.com`, OAuth. | Issue [#1175](https://github.com/bloodf/durindoor/issues/1175), closed not planned: an unofficial desktop-client protocol rather than a supported developer API. | `tests/unit/fleet-provider-devin-desktop-acceptance.test.js`. |
| `doubao-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/doubao/web/index.ts): `https://www.dola.com/chat/completion`, cookie auth. | Issue [#1176](https://github.com/bloodf/durindoor/issues/1176), closed not planned: consumer-session scraping. The documented alternative is the Volcengine Ark API, which DurinDoor ships as `doubao`. | No local route and no mock. |
| `g4f-gemini` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/g4f-gemini/index.ts): `https://g4f.space/api/gemini/v1/chat/completions`, optional bearer. | Issue [#1185](https://github.com/bloodf/durindoor/issues/1185), closed not planned: a public anonymous gateway front, not a vendor API. | `tests/unit/fleet-provider-g4f-gemini-acceptance.test.js`. |
| `g4f-groq` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/g4f-groq/index.ts): `https://g4f.space/api/groq/v1/chat/completions`, optional bearer. | Issue [#1186](https://github.com/bloodf/durindoor/issues/1186), closed not planned, same basis as the other G4F gateways. | `tests/unit/fleet-provider-g4f-groq-acceptance.test.js`. |
| `g4f-nvidia` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/g4f-nvidia/index.ts): `https://g4f.space/api/nvidia/v1/chat/completions`, optional bearer. | Issue [#1187](https://github.com/bloodf/durindoor/issues/1187), closed not planned, same basis. | `tests/unit/fleet-provider-g4f-nvidia-acceptance.test.js`. |
| `g4f-ollama` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/g4f-ollama/index.ts): `https://g4f.space/api/ollama/v1/chat/completions`, optional bearer. | Issue [#1188](https://github.com/bloodf/durindoor/issues/1188), closed not planned. The local `ollama-local` entry is a localhost target and `ollama` is Ollama Cloud; neither is this gateway. | `tests/unit/fleet-provider-g4f-ollama-acceptance.test.js`. |
| `g4f-pollinations` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/g4f-pollinations/index.ts): `https://g4f.space/api/pollinations/v1/chat/completions`, optional bearer. | Issue [#1189](https://github.com/bloodf/durindoor/issues/1189), closed not planned, same basis. The local Pollinations identity is a different endpoint and does not establish this gateway. | `tests/unit/fleet-provider-g4f-pollinations-acceptance.test.js`. |
| `gemini-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/gemini/web/index.ts): `https://gemini.google.com/app`, cookie auth. | Issue [#1190](https://github.com/bloodf/durindoor/issues/1190), closed not planned: consumer-session scraping. The documented alternatives are the Gemini API, AI Studio Build and Vertex, all shipped. | `tests/unit/fleet-provider-gemini-web-acceptance.test.js`. |
| `helyxai` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/helyxai/index.ts): `https://helyxai.space/v1/chat/completions`. | Issue [#1193](https://github.com/bloodf/durindoor/issues/1193), closed not planned with a specific reason: a reseller with no named operator whose `/v1/models` returns 404. | No local route and no mock. |
| `hyperagent` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/hyperagent/index.ts): `https://hyperagent.com/api/threads`, cookie auth, custom thread executor. | Issue [#1194](https://github.com/bloodf/durindoor/issues/1194), closed not planned: the upstream entry itself labels the route an unofficial reverse-engineered web session. | No local route and no mock. |
| `lmarena` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/lmarena/index.ts): `https://arena.ai/nextjs-api/stream/create-evaluation`, cookie auth. | Issue [#1198](https://github.com/bloodf/durindoor/issues/1198), closed not planned: browser-cookie scraping of an arena evaluation endpoint, not a public API. | No local route and no mock. |
| `maxai` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/maxai/index.ts): `https://api.maxai.me`, browser-minted token and signed `X-Authorization` request. | Issue [#1202](https://github.com/bloodf/durindoor/issues/1202), closed not planned: web-app scraping with brittle browser-dependent authentication. | No local route and no mock. |
| `monsterapi` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/monsterapi/index.ts): `https://api.monsterapi.ai/v1/chat/completions`, bearer. | Issue [#1208](https://github.com/bloodf/durindoor/issues/1208), closed not planned: the service hosts failed DNS resolution and the free-model catalog was already marked terms-ambiguous. | No local route and no mock. |
| `notion-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/notion-web/index.ts): `https://app.notion.com/api/v3/runInferenceTranscript`, cookie auth. | Issue [#1214](https://github.com/bloodf/durindoor/issues/1214), closed not planned: consumer-session scraping of a workspace transcript endpoint. | No local route and no mock. |
| `notrack-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/notrack-web/index.ts): `https://notrack.ai/api/dispatch`, cookie auth. | Issue [#1215](https://github.com/bloodf/durindoor/issues/1215), closed not planned: the consumer dispatch route is scraped. The local `notrack` identity is the separately documented developer API, which is a different contract, see [`notrack-2034.md`](./notrack-2034.md). | The shipped developer API is covered by `tests/unit/notrack-provider.test.js`; the web dispatch route has none. |
| `predibase` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/predibase/index.ts): `https://serving.app.predibase.com/v1/chat/completions`, bearer. | Issue [#1227](https://github.com/bloodf/durindoor/issues/1227), closed not planned: the documented host did not resolve, so there is no live contract to adopt. | No local route and no mock. |
| `promptql` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/promptql/index.ts): a GraphQL playground endpoint with a custom executor. | Issue [#1228](https://github.com/bloodf/durindoor/issues/1228), closed not planned: an unofficial reverse-engineered playground session, not a chat-completions API. | No local route and no mock. |
| `seekai` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/seekai/index.ts): `https://seekai.cc/v1/chat/completions`. | Issue [#1232](https://github.com/bloodf/durindoor/issues/1232), closed not planned: the 2026-11-03 review found the site offline with an invalid origin certificate and no API documentation. | No local route and no mock. |
| `syntx` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/syntx/index.ts): `https://api.syntx.ai/api/v1`, bearer, custom executor. | Issue [#1234](https://github.com/bloodf/durindoor/issues/1234), closed not planned: a subscription service reselling other vendors' models with no public API documentation and no named operator. | No local route and no mock. |
| `tabitoken` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/tabitoken/index.ts): Claude `/v1/messages` with `x-api-key` plus an OpenAI alternate. | Issue [#1235](https://github.com/bloodf/durindoor/issues/1235), closed not planned: a Claude reseller with no named operator, terms or pricing. Anthropic's own API is the documented alternative and is shipped. | No local route and no mock. |
| `tencent-aistudio-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/tencent-aistudio-web/index.ts): `https://aistudio.tencent.ai/api/chat`, cookie auth. | Issue [#1236](https://github.com/bloodf/durindoor/issues/1236), closed not planned: a web account session rather than a developer API. The documented alternative is the Tencent cloud API, shipped as `tencent`. | No local route and no mock. |
| `tinycms-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/tinycms/index.ts): `https://gov.freegpt.win/api/openai/oneapi/v1/chat/completions`, uuid auth. | Issue [#1237](https://github.com/bloodf/durindoor/issues/1237), closed not planned: a consumer web session front, not a supported vendor API. | No local route and no mock. |
| `twinmind` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/twinmind/index.ts): `https://api2.twinmind.com/api/v3`, bearer, custom executor. | Issue [#1240](https://github.com/bloodf/durindoor/issues/1240), closed not planned: no public API, and the terms ban bots, reverse engineering and resale. | No local route and no mock. |
| `uc` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/uc/index.ts): a consumer-app persona WebSocket with session auth minted from app cookies. | Issue [#1241](https://github.com/bloodf/durindoor/issues/1241), closed not planned: consumer-app scraping. Documented replacement is the metered developer API `uc-direct`, which DurinDoor ships, see issue [#1242](https://github.com/bloodf/durindoor/issues/1242). | No local route for `uc`; `uc-direct` has its own coverage. |
| `workbuddy` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/workbuddy/index.ts): `https://www.workbuddy.ai/v2/chat/completions`, OAuth. | Issue [#1246](https://github.com/bloodf/durindoor/issues/1246), closed not planned with a specific reason: the integration depends on presenting itself as a different, approved client to pass a channel check, which this project does not do. | No local route and no mock. |
| `zai-web` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/zai-web/index.ts): `https://chat.z.ai`, bearer. | Issue [#1251](https://github.com/bloodf/durindoor/issues/1251), closed not planned: consumer-session scraping of the web chat. The documented alternative is Z.ai's API, which DurinDoor ships as `zai`. | `tests/unit/fleet-provider-zai-web-acceptance.test.js`. |
| `zcode` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/zcode/index.ts): `zcode://app-server/stdio`, `authType: none`. | Issue [#1252](https://github.com/bloodf/durindoor/issues/1252), closed not planned: the contract is a local app-server bound to the user's own `builtin:zai-coding-plan` profile, overlapping the local `glm` and `zai` routes, not a network gateway. | No local route and no mock. The local-runtime shape is covered by the `devin-cli-agentic` and `codex-app-server` tests. |

### Supported still-missing gateway contract (1)

One identity in this set is a documented, publicly supported provider surface that
DurinDoor does not ship and could ship without scraping or impersonation.

#### `chatgpt` — OpenAI "Sign in with ChatGPT" plan-usage contract

- **Upstream contract at the pin.** [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/chatgpt/index.ts):
  `id: chatgpt`, `format: openai-responses`, `executor: chatgpt`,
  `baseUrl: https://api.openai.com/v1/responses`, `modelsUrl: https://api.openai.com/v1/models`,
  `authType: oauth`, `forceStream`, `reasoningTransport: opaque`,
  `passthroughModels: true`, no seeded catalog.
- **Supporting upstream sources.** The sign-in protocol lives in
  `src/lib/oauth/chatgptProtocol.ts` (authorization code with PKCE, a
  dynamically issued `oaiapp_` client id, an `ext_agent_host_id`, ID-token
  verification against the OpenAI JWKS pinned to `https://auth.openai.com`), the
  scope and resource constants in `open-sse/config/chatgpt.ts`
  (`chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`), the token
  exchange and refresh in `open-sse/services/tokenRefresh/providers/chatgpt.ts`,
  and the executor in `open-sse/executors/chatgpt.ts`.
- **DurinDoor state.** Not composed. The local `codex` entry
  ([`open-sse/providers/registry/codex.js`](../../open-sse/providers/registry/codex.js))
  uses the same issuer and the same token endpoint but requests only
  `openid profile email offline_access`, without the plan scope or the
  `resource.invoke` grant, and dispatches to
  `https://chatgpt.com/backend-api/codex/responses` rather than the platform
  Responses endpoint. The local `openai` entry is API-key only. So a ChatGPT
  subscription cannot currently reach `https://api.openai.com/v1/responses`
  through DurinDoor. The local Codex executor already strips several of the
  request fields the upstream ChatGPT executor omits from a Responses body,
  among them `max_output_tokens`, `prompt_cache_retention`, `safety_identifier`,
  `previous_response_id` and `metadata`
  ([`open-sse/executors/codex.js`](../../open-sse/executors/codex.js)), so the
  request-shaping half of the contract is close to covered and the credential
  half is not.
- **Issue.** [#2034](https://github.com/bloodf/durindoor/issues/2034), the open
  work order for provider sign-in parity. No dedicated candidate ticket exists
  for this identity yet.
- **Supported authorization.** OpenAI publishes the flow for open-source
  applications: [Sign in with ChatGPT, overview](https://developers.openai.com/siwc/token-sharing-open-source),
  [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in),
  [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions),
  [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
  and the [token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference).
  Those pages document dynamic client registration, the refresh call with
  `resource=https://api.openai.com/v1`, ID-token validation, per-application
  usage limits and the ChatGPT-plan usage model. The upstream source comment
  cites the same pages. No live account was used to confirm any of it here.

**Deterministic mock acceptance matrix.** Every row is offline. The suite
replaces the authorization endpoint, the token endpoint and the Responses
endpoint with fixtures, and asserts that no outbound request leaves the mocks.

| # | Case | Assertion |
| --- | --- | --- |
| 1 | Sign-in start | The authorize URL carries the plan scope `chatgpt.tokens.use.direct`, the resource `https://api.openai.com/v1`, `response_type=code`, a S256 challenge, the issued `client_id` and a stable `ext_agent_host_id`, and the redirect URI is the local callback. |
| 2 | Client id handling | A client id that does not match `oaiapp_*` is rejected before any token exchange; a returned client id that differs from the one in the attempt is rejected. |
| 3 | ID-token validation | The ID token is verified against the pinned OpenAI JWKS with RS256 only, the issuer, audience, `sub`, `exp`, `iat` and `nonce` claims are required, and a nonce or audience mismatch fails the attempt. |
| 4 | Token exchange | The form-encoded exchange sends `grant_type=authorization_code`, the issued `client_id` and the code, and the stored credential keeps access, refresh and ID tokens separated per registration. |
| 5 | Refresh | The refresh call sends `grant_type=refresh_token` with the saved `client_id` and `resource=https://api.openai.com/v1` and omits `scope`; concurrent refreshes for one session are serialized and the newest token set replaces the older one. |
| 6 | Revocation | Sign-out posts `token=<refresh_token>` and `token_type_hint=refresh_token` with the issued `client_id` to the revocation endpoint from the OpenAI discovery document, treats an empty 200 as success, and clears local tokens only after the attempt. |
| 7 | Dispatch | A request to the composed `chatgpt` identity reaches `https://api.openai.com/v1/responses` with the bearer access token and the Responses body, and the streamed response is normalized to the client format. |
| 8 | Request shaping | The fields the upstream executor omits are absent from the outbound body, including `max_output_tokens`, `prompt_cache_retention`, `safety_identifier`, `previous_response_id` and `metadata`. |
| 9 | Model discovery | The catalog is discovered from `https://api.openai.com/v1/models` with the same bearer, no model is seeded, and an unknown id is passed through rather than rejected. |
| 10 | Isolation | The `codex` identity keeps its own scope set and its own endpoint, and the `openai` identity keeps its API-key path; the three never share a credential slot. |
| 11 | Failure mapping | An expired or rejected token produces a refresh attempt and then a provider error, a revoked registration produces a re-authentication prompt, and no error body is echoed with the token. |
| 12 | No outbound escape | Every case asserts that no request reaches a host other than the mocked authorization, token, revocation, JWKS and Responses endpoints. |

### Still-unverified flows (3)

| Upstream identity and pinned contract | Why it stays unverified | Mock acceptance outline |
| --- | --- | --- |
| `freebuff` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/freebuff/index.ts): `https://www.codebuff.com/api/v1`, bearer, `executor: freebuff` with a model-to-agent map. The executor posts a session to `/api/v1/freebuff/session`, starts an agent run at `/api/v1/agent-runs`, then posts to `/api/v1/chat/completions`. | Not composed in DurinDoor, and not conclusively retired either. Issue [#1182](https://github.com/bloodf/durindoor/issues/1182) is still open and is a planning ticket whose subtasks are unchecked. The upstream contract's HTTP surface does not appear in Codebuff's public documentation, which describes the `@codebuff/sdk` SDK and the CLI instead, and the public Freebuff README states that no API key is required, which does not match a bearer-authenticated REST contract. The upstream registry entry cites no first-party documentation either. Authorization for the exact REST contract is therefore unestablished, so the identity stays unverified rather than being called a supported gateway. | A later authorized implementation must prove, offline: the bearer is rejected before any request when missing; the session call precedes the agent-run call; the model id maps to the upstream agent id; the completion body carries the upstream Buffy prompt and model mapping; and the run, session and upstream error shapes convert to a normalized provider error. No external request may occur. |
| `minimax-code` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/minimax-code/index.ts): `minimax-code://gateway`, `authType: none`, `executor: minimax-code`, with a device-code OAuth flow in `src/lib/oauth/providers/minimax-code.ts`. | Not composed, and blocked on authorization rather than on capability. [`minimax-code-2034.md`](./minimax-code-2034.md) records the finding: the reviewed sources do not establish a MiniMax-approved client binding and grant for DurinDoor, nor a supported operator-managed inference sidecar with explicit account and region binding. The registry `authType: none` reflects a locally installed MiniMax Code profile, which is a delegated local runtime rather than a gateway contract. The existing `minimax` and `minimax-cn` API-key routes are separate and stay out of scope. | The mock lifecycle cannot be demonstrated until a binding or delegation is documented. When it is, the required coverage is: device authorization pending, denied and poll-success transitions, S256 PKCE binding, token rotation persistence, the per-account catalog and the gateway request, with no real CLI profile read and no real MiniMax endpoint contacted. |
| `zed-hosted` — [registry](https://github.com/cheaper-inference/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/config/providers/registry/zed-hosted/index.ts): `https://cloud.zed.dev/completions`, OAuth with a per-login RSA key flow, catalog at `/models`. | Not composed. The upstream implementation exists, but the authorization question is open. [`zed-hosted-contract.md`](./zed-hosted-contract.md) records that Zed's published documents describe hosted models billed through Zed, do not specify a third-party gateway registration, credential or authorized hosted-model API, and that the current General Terms section 2.4 restricts providing access to or distributing a Product to a third party and seeking access to non-public APIs. That is a documentation and authorization gap, not a finding that the upstream contract disappeared and not a determination that such access is forbidden. The local `zed` entry is hidden keychain-import metadata with no transport and is not Zed-hosted inference. | The required coverage, once first-party documentation or authorization exists: the signed key exchange and native-app sign-in, the hosted catalog, the authenticated completion and stream, and the auth-failure path, each against a fake token, catalog and completion endpoint with injected deterministic key material and no Zed account access. |

## OmniRoute release delta #20839 and the Copilot Responses fallback

The release branch tip moved from `355eb07c36fcae2440e6c4407b39542b2000374f`
to `b748429cf5b3aeb142a708fd3e8751b6918b9dc8` in three commits, ending in the
merge of pull request #20839,
`fix/qg-v3855-codeql-parsers-186db2-20261120`. That range touches ten files:
the model and compression parsers, the Context7 fetch executor, the model display
name helper, and the GitHub Copilot Responses fallback.

The relevant change is in `src/sse/services/githubResponsesFallback.ts`, with its
fixture in `tests/unit/github-copilot-responses-unsynced.test.ts`.

**Upstream contract before and after #20839.** The helper
`inferGithubUnsyncedTargetFormat(providerId, modelId)` decides the wire format
for a `github`, `gh` or `ghe-copilot` model that no catalog row tags as
Responses-only. Before the change the matcher was
`/^(?:.*codex.*|gpt-(?:[6-9]|5\.[5-9]).*)$/i`. After it, the codex branch is a
case-normalized substring test, the version branch is an anchored prefix
`/^gpt-(?:[6-9]|5\.[5-9])/i`, and model ids containing a line separator are
rejected outright. The set of ids classified as `openai-responses` is the same
before and after; the change removes a backtracking-prone pattern, anchors the
version branch, and adds the explicit line-separator rejection that the PR title
refers to.

**DurinDoor's equivalent contract.** DurinDoor does not infer the route from the
model id at all. The decision is made from the account's own discovered catalog
and from a bounded error:

- [`open-sse/executors/github.js`](../../open-sse/executors/github.js) reads the
  per-connection `copilotEndpointContract` from `providerSpecificData` and
  resolves the route for that account with `resolveCopilotEndpointRoute`, so a
  model the account serves only through `/responses` goes there directly. An
  explicit registry override still wins over the discovered contract.
- When no contract is known, the request goes to `/chat/completions` first and is
  escalated only on Copilot's own bounded error: a 400 whose body contains
  "not accessible via the /chat/completions endpoint" or "The requested model is
  not supported", read through `readBoundedResponseText` with a 64 KiB byte cap
  and a 2 second timeout. The learned route is cached per connection and API
  host and is bound to the generation of the routing metadata it was learned
  under, so a refreshed catalog expires it.
- Claude and Gemini models are excluded from escalation, because the Copilot
  `/responses` endpoint rejects them.

**Verdict: no actionable provider contract difference.** The two mechanisms
solve the same problem with different inputs. Upstream infers the format from
the model id when nothing else says otherwise, and #20839 hardens that
inference. DurinDoor prefers the account-specific discovery result and falls
back to a bounded, error-driven escalation. There is no local code that parses a
model id to decide the Copilot route, so the upstream hardening has no local
counterpart to port, and the upstream classification set is unchanged, so no
behavioral contract moves.

What the delta does contain — the linear-time model and compression parsers, the
Context7 fetch executor change and the display-name helper — is generic upstream
parser and executor work. Those stay with the Upstream orchestrator; they are not
provider parity gaps for this work order.

## CLIProxyAPI and EasyCLIProxyAPI reconciliation

Both upstream tips are unchanged from the pins the earlier closure comparisons
recorded, so neither project contributes a new provider delta at this revision.

| Project | Tip at this revision | Delta since the recorded closure pin | Disposition |
| --- | --- | --- | --- |
| CLIProxyAPI `main` | `f5c5681a8361c9da53e93c60b6507816eee7468b` | None. The closure comparison in [`provider-parity-cliproxyapi.md`](./provider-parity-cliproxyapi.md) was already written against this exact commit, and the tip has not moved since. | No new provider identity, sign-in flow, executor, authenticator package or API-key group upstream. The rows D1 to D16 and M1 to M8 in that file keep their recorded dispositions against the DurinDoor side, with the assigned integration now at `26ce7ee4c38142c3276410a3186cc8adef59c74c` instead of `082b48d0f85e3a11579bede9c6e1e5ec5c21472c`. The four bounded candidates in that file, the Antigravity 403 probe classification, the inbound gzip body decoding, the Antigravity refresh-failure scope and the Codex live catalog refresh, remain open and unchanged. The catalog grew from 374 entries at `082b48d0` to 376 at the assigned integration; the two added registry modules are `notrack` and `y-api`, and neither changes a CLIProxyAPI parity row. |
| EasyCLIProxyAPI `main` | `e4223d5eefa22a3301ca7e2a28d05897432b07f9` | None. The closure comparison in [`provider-parity-easycliproxyapi.md`](./provider-parity-easycliproxyapi.md) was already written against this exact commit. | No new guided identity or API section upstream, so the seven guided OAuth identities and nine guided API choices remain as inventoried. The recorded boundary stands: the packaged CLIProxyAPI core revision is not pinned by the EasyCLIProxyAPI source, so exact request, runtime, refresh and quota parity cannot be established from that repository alone and must not be inferred from the UI inventory. The one actionable item remains UI-scoped guided onboarding, and it still requires verifying that the core accepts the ordinary API-key configuration of the chosen provider before any form is added. |

## Evidence limits

- Every upstream statement in this file was read from the pinned source trees.
  No provider service was called and no credential was used, so a disposition
  describes a code contract and a documentation state, not a verified runtime
  behavior.
- Every DurinDoor statement was read from the assigned integration
  `26ce7ee4c38142c3276410a3186cc8adef59c74c`. The registry enumeration was
  produced by importing the generated barrel; no generated file was hand-edited
  and no registry index was regenerated.
- Issue dispositions are quoted from the dated comments on the referenced
  tickets. A closed issue is a decision about a candidate, not proof that the
  upstream contract no longer exists, and it is not proof that the vendor is
  gone.
- The mock acceptance matrix for `chatgpt` and the mock outlines for the three
  still-unverified flows are proposals. They were not written or run here, and
  none of them may contact a provider service.
- No test file, registry file, generated index or workflow was modified. The
  only change for this work order is this document.
