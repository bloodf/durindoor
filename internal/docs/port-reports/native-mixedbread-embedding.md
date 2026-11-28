# Mixedbread native embeddings (staged), 2026-11-27

Issue: #2034. The inventory row for `mixedbread` embeddings (`open-sse/config/embeddingRegistry.ts` → `handlers/embeddings.ts`, missing from `EMBEDDING_ADAPTERS`) was missing. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/embeddingRegistry.ts`, entry `mixedbread` (issue #6660): id `mixedbread`, baseUrl `https://api.mixedbread.com/v1/embeddings`, authType `apikey`, authHeader `bearer`. It lists two models: `mixedbread-ai/mxbai-embed-large-v1` ("Mixedbread Embed Large v1", 1024) and `mixedbread-ai/mxbai-embed-2d-large-v1` ("Mixedbread Embed 2D Large v1", 1024). Neither has `modalities`, `defaultParams` or a native protocol. There is no `tokenField` or `requiresArrayInput`. The embedding alias tables have no Mixedbread entries.
- `src/shared/constants/providers/apikey/specialty-media.ts`, entry `mixedbread`: alias `mxbai`, name "Mixedbread AI", website `https://www.mixedbread.com`, `hasFree`, free note, auth hint "Bearer API key for the Mixedbread embeddings API.", `serviceKinds: []`.
- `tests/unit/mixedbread-embedding-provider-6660.test.ts` pins the registry fields, `mixedbread/<upstream id>` parsing, and the 1024 width.
- `open-sse/handlers/embeddings.ts` sends Mixedbread down the generic path:
  - Makes one `POST` to the fixed baseUrl with `Content-Type: application/json` and `Authorization: Bearer <apiKey || accessToken>`.
  - Sends `{ model, input }`, adding `dimensions` and `encoding_format` only when the client sent them, plus any unknown client fields. String items longer than 20,000 characters are silently cut.
  - Refuses structured input, because neither model advertises modalities.
  - Unwraps one redundant row per vector, fills a missing `index`, and packs little-endian float32 when the client asked for `base64`.
  - Echoes `body.model` when it has no `/`, else `mixedbread/<model>`. A missing `usage` becomes zeros.
  - Relays a non-2xx with the upstream body text. It uses `AbortSignal.timeout(FETCH_TIMEOUT_MS)` only, with no redirect handling, body bound or vector checks.
- Addressing: `parseEmbeddingModel("mixedbread/mixedbread-ai/mxbai-embed-large-v1")` gives provider `mixedbread` and model `mixedbread-ai/mxbai-embed-large-v1`. The bare upstream id parses as the unknown provider `mixedbread-ai`. The `mxbai` alias is not in `EMBEDDING_PROVIDER_ALIASES`, so `mxbai/...` does not route to embeddings in the source.
- Discovery: none. Both models are static and no Mixedbread models endpoint is called.

## Fresh-main check

- No `open-sse/providers/registry/mixedbread.js` or `mxbai.js`. No registry entry has id `mixedbread` or alias or uiAlias `mxbai`, and none lists a `mixedbread-ai/*` model.
- `getEmbeddingAdapter("mixedbread")` and `getEmbeddingAdapter("mxbai")` are null. Neither is in `OPENAI_COMPAT_PROVIDERS`. `PROVIDERS`, `PROVIDER_MODELS` and `PROVIDER_MEDIA` have no entry.
- A user-configured `openai-compatible-*` or `custom-embedding-*` node aimed at Mixedbread is a user base URL, not a fork provider. It has none of the checks below.
- A checkout-only search for `mixedbread` and `mxbai` (`rg`) finds only:
  - `website/pnpm-lock.yaml`: `@mixedbread/sdk` as an optional peer dependency of a docs package.
  - Port-report inventory rows.
  - `open-sse/services/ollamaCatalog.js`: a name heuristic for local Ollama tags like `mxbai-embed-large`. It never calls `api.mixedbread.com`.
- Result: no equivalent exists. The provider definition, both model rows and the embeddings adapter are the whole delta. There are no existing auth, cookie or OAuth modes to preserve; the provider is API key only.

## What landed

All new files are under `open-sse/services/providerParity/native-mixedbread-embedding/`. The module follows the staged Upstage, deAPI and NanoGPT embeddings adapters' contract (`embed()`, `acceptedJob`, `mediaAccounting`, abort):

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and URL, auth header and scheme, the source provider facts (`MIXEDBREAD_PROVIDER`), a staged registry entry (`MIXEDBREAD_PROVIDER_DEFINITION`), the two models, encodings and bounds. |
| `request.js` | `buildMixedbreadEmbeddingRequest`: validates the body and refuses anything unsupported with a 400. |
| `http.js` | Key selection, a bounded and abortable send, redirect and foreign-origin checks, refused-answer mapping that never quotes upstream text, and accepted-work accounting. |
| `adapter.js` | `createMixedbreadEmbeddingAdapter` with `embed()`, plus `buildUrl`, `buildHeaders` and `buildBody`; `normalizeMixedbreadEmbeddings`; `packFloat32Base64`. |
| `index.js` | Re-exports, plus the default `mixedbreadEmbeddingAdapter`. |
| `registration.json` | Exports, canonical ID and alias, service kinds, models, addressing, endpoint, auth, supported input and integration points. |

The tests are in `tests/unit/native-mixedbread-embedding.test.js`: 63 tests over a closed network. Nothing is registered. Two tests in the isolated `staging state` block assert this: no adapter, provider, model or media entry for `mixedbread` or `mxbai`, and no registry entry. No other test depends on that state.

## Supported subset

`POST https://api.mixedbread.com/v1/embeddings`. Headers are exactly `Content-Type: application/json` and `Authorization: Bearer <key>`, and redirects are set to `manual`.

- The model must be `mixedbread-ai/mxbai-embed-large-v1` or `mixedbread-ai/mxbai-embed-2d-large-v1`. The core passes the id without the `mixedbread/` prefix.
- `input` is a string, or an array of 1 to 100 strings. Each must be non-blank and at most 20,000 characters.
- The upstream body is `{ model, input }`. `encoding_format: "float"` is added only when the client sent it.
- `dimensions` may be absent or `1024`. It is not forwarded.
- `encoding_format` may be `float` (the default) or `base64`. Base64 is not forwarded; it is packed locally from the checked floats.
- `user` is accepted and not forwarded.
- The key is the selected connection's `apiKey`, then `accessToken`. A key with CR or LF is refused.
- `providerSpecificData.baseUrl` is ignored, so the key only goes to `api.mixedbread.com`.
- The transport is `proxyAwareFetch` with the connection's proxy options.
- The response `model` follows the source rule. Every Mixedbread id contains `/`, so a routed request gets `mixedbread/<upstream id>`.

## Refused before sending

These return a 400:

- Any other model, including other Mixedbread models (`mxbai-embed-xsmall-v1`, ...), the short id without `mixedbread-ai/`, and a `mixedbread/`-prefixed id at the adapter.
- Empty or missing input, blank items, token arrays, and structured or multimodal items.
- Strings over 20,000 characters. The source cut them silently.
- More than 100 items (a fork bound; the source had none).
- A `dimensions` value other than `1024`, including reduced Matryoshka widths. The source records one width per model.
- Any other `encoding_format` (`int8`, `ubinary`, ...).
- Any other field, including Mixedbread's own `prompt`, `normalized` and `truncation_strategy`, and `input_type`. The source forwarded these blindly; their effect on the vectors and the answer shape is outside the pinned contract.

A missing or header-unsafe key returns a 401.

## Answers

- **2xx:** the body is read within an 8 MiB bound and the deadline. An unparseable or oversized body, an in-band `error` envelope (never quoted), a wrong count or width, non-finite numbers, a string vector, or bad or duplicate indices make the answer unusable. That returns a 502 with `acceptedJob` (`completed-unusable`). A usable answer is ordered by index and returned as an OpenAI list.
- **Usage and cost:** accounting comes only from Mixedbread's own `usage`. Cost is always unknown, and `nativeUnits.inputs` is the input count. With no receipt, the tokens stay empty and `meta.usageMissing` is set. The body still carries the source's zero fallback, but it is never counted.
- **401/403:** final for the call.
- **402:** `quotaExhausted` on this connection only. Two-key tests show the next call on the other key proceeds with that key's header.
- **429:** keeps a bounded Retry-After.
- **Other 4xx:** keep their status.
- **5xx:** become a 502 with `acceptedJob` (`submit-unknown`).
- **Redirects:** a 3xx or opaque redirect is refused. An answer from another origin is uncertain.
- **Upstream text:** never relayed, and credentials are redacted.

## Deadlines, cancellation and replay

- One 60-second deadline covers the send and the body read, even when a transport ignores its signal.
- Abort before send returns 499 with nothing sent. Abort after send aborts the socket and returns 499 with `acceptedJob`.
- Pre-connect failures return 502 without `acceptedJob`. A timeout, a reset, or a 5xx after send is uncertain.
- Exactly one request per call. Nothing is ever resent.

## Registration steps (serial, not done here)

From `registration.json`:

1. Add `open-sse/providers/registry/mixedbread.js` from `MIXEDBREAD_PROVIDER_DEFINITION`: id and alias `mixedbread`, uiAlias `mxbai`, API key, `serviceKinds: ["embedding"]`, two `kind: "embedding"` rows, and an `embeddingConfig` with the fixed URL and bearer auth for the key probe. Then add it to the registry index. Exposing `mxbai/` as a routing prefix is a registration decision; the source does not route it for embeddings.
2. Add `mixedbread: mixedbreadEmbeddingAdapter` to `EMBEDDING_ADAPTERS`, not to `OPENAI_COMPAT_PROVIDERS`.
3. In `handleEmbeddingsCore`, delegate to `adapter.embed` when present. This is the same hook the deAPI, NanoGPT and Upstage registrations need.
4. In `src/sse/handlers/embeddings.js`, record `acceptedJob` as unknown-cost usage on the selected connection. Do not fall through to another account for such a result.
5. Add a Mixedbread AI row to `docs/providers/catalog.mdx`. Promote the isolated staging test block to positive identity checks.

## Remaining restrictions

- Mixedbread reranking, document parsing, stores and other non-embedding APIs are not claimed.
- Only the source's two static models are supported. No discovery exists in either tree.
- Reduced dimensions, native quantized encodings and Mixedbread's `prompt`, `normalized` and `truncation_strategy` options are refused, not translated.
- The 100-item batch bound is a fork limit. Mixedbread's own per-request and per-input token limits are not modeled; an over-limit input surfaces as Mixedbread's 4xx (status kept, body not quoted).
- Closed mocks only. Nothing here says anything about the live service.

## Evidence

- `cd tests && node node_modules/vitest/vitest.mjs run unit/native-mixedbread-embedding.test.js --maxWorkers=2`: 63 passed.
- `npx eslint` and `npx oxlint -c .oxlintrc.json` on the module and test: clean.
