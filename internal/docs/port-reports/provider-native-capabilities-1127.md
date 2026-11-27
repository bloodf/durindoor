# Native provider capability cross-check (#2034)

Compared the fresh DurinDoor integration worktree at `df77f6e0cca3927f02efed4c4c8cc95fd2303177` with pinned public source revisions on 2026-11-27. This is a bounded source/runtime cross-check of provider-native sign-in and request surfaces, not a general provider inventory or live acceptance report. No credentials, accounts, provider requests, upstream application execution, or paid APIs were used.

## Source pins and method

| Source | Pin | Dispatcher/capability evidence inspected |
| --- | --- | --- |
| CLIProxyAPI | `47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e` | `sdk/cliproxy/service_executors.go`, `internal/cmd/auth_manager.go`, `internal/runtime/executor/`, `sdk/` model definitions and API handlers |
| EasyCLIProxyAPI | `29567ead8164a00724dfdc2087f02a23895636ee` | `src/pages/EasyModePage.tsx`, `src-tauri/src/core_runtime.rs`, `core-version.txt`; this is a guided setup/management UI around CLIProxyAPI, not another wire runtime |
| OmniRoute | `c71f0065a7efe9230ec23b96a12253b050c4d7ad` | `open-sse/config/providers/`, native executor dispatch, image/video/audio/embedding/rerank registries and handlers |
| DurinDoor | `df77f6e0cca3927f02efed4c4c8cc95fd2303177` | provider registry, executor index, OAuth services, model route/catalog handlers, media adapter registries, and named offline tests |

The source repositories are available locally under `.work/provider-cap-1127/`. Their files were read only. Provider names in UI catalogs were not treated as capability proof: the cross-check followed registration/dispatch to executor or handler and the credential/header construction. Broad optional-parameter and model-row comparisons are intentionally out of scope.

## Native transport map and local coverage

The upstream code paths divide into native protocol families. CLIProxyAPI's API handlers dispatch OpenAI chat/completions, Responses, Anthropic Messages, Gemini generateContent/stream and Interactions. Native non-chat executor paths include OpenAI image generation/editing (including Codex `image_generation` tool calls within Responses), speech, video and supported embeddings/reranking through executor-specific or compatibility routes. OmniRoute adds dedicated media registries for images, videos, TTS, STT, embeddings, rerank, music, realtime and search; each dispatches by provider/model config into a native or protocol-compatible executor. EasyCLIProxyAPI exposes provider setup choices but invokes its selected bundled/installed CLIProxyAPI core for runtime traffic.

DurinDoor's native registered provider lane is `open-sse/providers/registry/index.js`, with actual executor selection in `open-sse/executors/index.js` and endpoint routing in `open-sse/handlers/chatCore.js`. It dispatches chat/messages/Responses through provider executors and format translation. Standalone media does not follow chat capability: image registrations dispatch through `open-sse/handlers/imageProviders/index.js`, synchronous video generation through `videoProviders/index.js`, and speech, transcription, embeddings and rerank through their respective handler registries. Models advertised in a chat catalog therefore do not imply standalone image/video/audio capability. Conversely, image generation used as a tool inside a Responses/chat request is a request capability and remains distinct from `/v1/images/generations` or `/v1/images/edits` adapters.

| Capability family | Upstream native evidence | DurinDoor runtime path / disposition |
| --- | --- | --- |
| Chat completions | CPA API handler dispatch plus provider executor registration; OmniRoute chat handler selects registered protocol executors and provider-specific auth | `chatCore.js` dispatches through registered executors. Existing native provider adapters and generic OpenAI/Anthropic-compatible routes cover this family. Provider auth is configured by provider-specific OAuth/API-key services; executor helpers construct wire auth. No newly missing provider-native sign-in or chat request identity established in this pass. |
| Anthropic Messages | CPA Anthropic API handler and Claude executor; OmniRoute provider route config can select native `/v1/messages` and its `x-api-key`/version contract | Local Claude and compatible executors route native Messages where appropriate; generic compatible-node paths remain available. Existing Claude auth/request tests are recorded in `parity-cli-1127.md`. No distinct missing identity/auth contract established. |
| OpenAI Responses | CPA Responses handler and Codex/GrokBuild-compatible executors; Codex image tool is also invoked within Responses | Local Responses-compatible executor routing exists, including Codex and Grok CLI paths. Do not infer standalone image adapter from in-chat image tool support. Generic compatible-node equivalents exist. No new native gap established. |
| Gemini generateContent / Interactions | CPA Gemini and Interactions handlers, Vertex/Antigravity executors; OmniRoute has native Gemini/Vertex executors | Local Gemini, Vertex, Antigravity, and Interactions provider routes/executors exist. Existing fixtures cover the supported native paths; this report does not claim live Google acceptance. |
| Standalone image generation/edit | CPA Codex image handler and executor; OmniRoute `imageRegistryData.ts` plus image registry/executor dispatch | Local adapter registry is `IMAGE_ADAPTERS` (`imageProviders/index.js`); it includes provider-specific adapters and explicit compatible OpenAI adapters. AI Horde image adapter/catalog implementation is staged but deliberately **not registered** by commit `58384494`; `tests/unit/aihorde-images-stage.test.js` actively guards that staged state. The focused implementation/registration work is the known pending item; do not create a duplicate unit. `aihorde-image-flow.test.js` and `aihorde-image-catalog.test.js` cover staged helper behavior, not public adapter registration. OmniRoute AI Horde image catalog background refresh (#21306) is a separate discovery behavior and is not an auth/request gap. |
| Video generation | CPA's executor capability routing and OmniRoute `videoRegistry`/provider executors | Local synchronous `/v1/video/generations` dispatch is `VIDEO_GENERATION_ADAPTERS`; RenderHour and Firefly Services are registered. Existing compatible-node paths can cover provider video APIs where configured. No new native identity/auth gap established. |
| Speech, transcription, embeddings, rerank | CPA executor capability definitions/handlers and OmniRoute audio, embedding, rerank registries | Local TTS, STT, embeddings and rerank each have separate provider dispatch/config. Existing generic compatible-node equivalents cover compatible APIs; no native provider auth/request omission confirmed by a dispatcher-to-wire trace in this bounded pass. |
| Other non-chat | OmniRoute has explicit music, realtime, search, OCR and web-fetch registries; CPA supports provider-specific tools/utility routes | DurinDoor has separate music/realtime/search/count-token/fetch paths where registered. No new native provider auth/request capability was confirmed missing. |

This family-level inventory is a dispatcher map, not a claim that every upstream catalog entry is locally mapped or every optional media operation is implemented. Retired/dead identities and disabled paths were not promoted based on stale names. A registered ID counts as present only where dispatch reaches a concrete executor/handler; explicit unsupported or unknown-provider guards remain authoritative.

## Provider/auth review and known states

| Provider/capability or auth mode | Native auth/request contract and source path | DurinDoor actual path and state |
| --- | --- | --- |
| AI Horde image API key | OmniRoute pinned image provider uses native image job submission and Horde-specific `apikey` header; local upstream comparison also identified dynamic catalog refresh as separate | `imageProviders/aihorde.js` contains the staged submit/poll/cancel flow with `apikey`, but `imageProviders/index.js` does not register it. **Known pending**: registration/integration work staged in `58384494`; `aihorde-images-stage.test.js` actively guards the unregistered state. Do not create a duplicate unit. Chat's existing `/v1/models` text fetch is not proof of image catalog support. |
| Firefly Services operator credential | OmniRoute has Firefly consumer-web path and service API workflows; these have different credentials and endpoints | `imageProviders/adobe-firefly-api.js` sends `Authorization: Bearer <token>` plus `x-api-key: <clientId>`; Firefly Services image/video adapters are separately registered as `adobe-firefly-api`. The consumer browser integration is independently registered as `adobe-firefly-web` and guarded by its browser/session flow. Raw Firefly consumer HTTP access is declined; a separate operator UI bridge is not evidence of an HTTP consumer API. |
| RenderHour subscription/API-key | OmniRoute OAuth provider describes subscription OAuth and `rh_` API key; media executors dispatch by media kind | Local image/video/TTS adapters are registered. `renderHourAuthorization` supplies the mode-specific authorization; requests use fixed endpoints and bounded task polling. Registration is integrated and guarded. |
| Native OAuth/device and API-key families | CPA `auth_manager.go` and `service_executors.go` connect auth providers to executors; OmniRoute OAuth registry and provider services connect sign-in to account state, refresh and wire headers | Local OAuth definitions/services live in `src/lib/oauth/` and token refresh in `open-sse/services/tokenRefresh/`; provider registry and executor paths are separate. The CLI and Antigravity parity reports document tested source/mock parity and remaining live-only acceptance. No new auth flow was identified solely from catalog or UI presence. |
| Generic compatible providers | Upstreams use protocol-compatible routes in addition to native executors | DurinDoor's default/generic compatible executors and `openaiCompatNode` embedding path are real fallback capabilities when configured with endpoint/key. They do not establish provider-native OAuth, headers, model discovery, or non-chat coverage for a named native provider. |

### Explicit guards and non-evidence

- `imageProviders/index.js` intentionally leaves `adobe-firefly` and `firefly` unknown. The consumer browser session adapter and the Firefly Services operator API adapter are separate identities/contracts.
- Media registration in an index alone is not sufficient evidence; the referenced handler must be reached through the corresponding image/video/TTS/STT/embedding/rerank dispatch.
- A chat model accepting image input is not the standalone image-generation endpoint. A Responses image-generation tool is also not standalone image generation.
- A provider identifier in an upstream UI/catalog may be retired, dead, metadata-only, or an alias. No such row was classified as a missing native provider without a reachable source dispatcher and an actual credential/request path.
- Lack of live credentials or account access is not an implementation gate and was not used to classify gaps. Source inspection cannot establish current vendor acceptance, entitlement, or quota.

## Findings and lane boundaries

**Counts:** 7 capability families reviewed; 4 focused provider/auth dispositions recorded; 0 new actionable native auth/request gaps established. AI Horde remains the already-known pending registration item. The focused review traced pinned native dispatcher/capability surfaces into local provider registration, executor/handler selection and auth construction. No additional supported provider identity with a real native request/auth contract was shown to be missing. AI Horde native image work remains the already-known pending item above.

Track elsewhere, without adding these to the provider-auth implementation queue:

- OmniRoute PR #21306: AI Horde image catalog background refresh. Catalog freshness/cache behavior, not sign-in or native image request auth.
- OmniRoute PR #21347: generic Claude effort-variant routing. Model resolution/routing, not a new provider identity or native auth flow.
- OpenAI image-generation option forwarding, MCP retrieval, build/Docker and UI fixes in the c71 range: other lanes, listed in `parity-omni-c71f006-refresh.md`.

## Focused evidence commands

The documentation-only check is `pnpm run check:docs`. For the already-known AI Horde image registration work, retain/update `tests/unit/aihorde-images-stage.test.js` as the focused registration guard and use `tests/unit/aihorde-image-flow.test.js` plus `tests/unit/aihorde-image-catalog.test.js` for adapter and catalog behavior. No unit was added or run for this report. A future newly established native gap must cite the pinned dispatcher and auth/header source files and name its focused closed-network acceptance test before implementation.

See also the [OmniRoute c71 refresh](../parity-omni-c71f006-refresh.md), [CLI sign-in parity](../parity-cli-1127.md), and [Antigravity parity](../parity-agy-1127.md).
