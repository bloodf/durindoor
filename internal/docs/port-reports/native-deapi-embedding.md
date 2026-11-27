# deAPI native embeddings (staged), 2026-11-27

Issue: #2034. The inventory row for `deapi` embeddings (`open-sse/config/embeddingRegistry.ts` → `handlers/embeddings.ts`, missing from `EMBEDDING_ADAPTERS`) was missing. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/embeddingRegistry.ts`, entry `deapi`: id `deapi`, baseUrl `https://oai.deapi.ai/v1/embeddings`, authType `apikey`, authHeader `bearer`. It lists one model, `Bge_M3_FP16` ("BGE-M3 (deAPI)", 1024 dimensions), with no `modalities`, `defaultParams`, `structuredInputProtocol`, `singleTextProtocol`, `nativeInvokeProtocol`, `tokenField` or `requiresArrayInput`.
- `open-sse/handlers/embeddings.ts` sends deAPI down the generic path:
  - Makes one `POST` to the baseUrl with `Content-Type: application/json` and `Authorization: Bearer <apiKey || accessToken>`.
  - Sends `{ model, input, dimensions?, encoding_format?, ...unknown client fields }`. String items longer than 20,000 characters are silently cut.
  - Refuses structured (canonical, Jina-native, Gemini-native) input, because the model advertises no modalities.
  - Unwraps one redundant row per vector and fills a missing `index` by position. When the client asked for `base64` and got floats, it packs little-endian float32.
  - Echoes `body.model` when it has no `/`, else `deapi/<model>`. A missing `usage` becomes `{ prompt_tokens: 0, total_tokens: 0 }`.
  - Relays a non-2xx with the upstream body text as the error, and marks the connection unavailable.
  - Uses `AbortSignal.timeout(FETCH_TIMEOUT_MS)` with no caller signal, no redirect handling and no body bound. It does not check vector count, width or numbers.
- `src/shared/constants/providers/apikey/specialty-media.ts`: catalog row `deapi` (alias `deapi`, name `deAPI`, website `https://deapi.ai`, `serviceKinds: []`, kinds derived from the media registries).

The source has no dynamic model discovery for deAPI. The list is static, and no `/models` fetcher exists for it.

## Fresh-main check

- `rg -w -i deapi` over `src`, `open-sse` and `tests` finds nothing. There is no registry entry, alias, catalog row or adapter.
- `getEmbeddingAdapter("deapi")` is null. `deapi` is not in `OPENAI_COMPAT_PROVIDERS`, and it has no `openai-compatible-` or `custom-embedding-` prefix.
- The generic `createOpenAIEmbeddingAdapter` reads `PROVIDER_MEDIA[id].embeddingConfig.baseUrl`. With no deapi registry entry that URL would be `undefined`, so a same-name config is not reachable either. The delta is real: provider metadata plus the embeddings adapter.

## What landed

All new files are under `open-sse/services/providerParity/native-deapi-embedding/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and URL, auth header and scheme, staged provider metadata (`DEAPI_PROVIDER`), model list, encodings and bounds. |
| `request.js` | `buildDeapiEmbeddingRequest`: validates the body and refuses anything unsupported with a 400. |
| `http.js` | Key selection, a bounded and abortable send through an injectable transport, redirect and foreign-origin checks, refused-answer mapping that never quotes the upstream body, and accepted-work accounting. |
| `adapter.js` | `createDeapiEmbeddingAdapter` with `embed()`, plus `buildUrl`, `buildHeaders` and `buildBody` for the `EMBEDDING_ADAPTERS` shape; `normalizeDeapiEmbeddings`; `packFloat32Base64`. |
| `index.js` | Re-exports, plus the default `deapiEmbeddingAdapter`. |
| `registration.json` | Exports, canonical ID and alias, models, endpoint, auth, supported input and the registration steps. |

The tests are in `tests/unit/native-deapi-embedding.test.js`: 52 tests over a closed network. Nothing is registered. `embeddingProviders/index.js`, `embeddingsCore.js`, the provider registry and the docs catalog are unchanged. Only the isolated `staging state` block asserts that.

## Supported subset

`POST https://oai.deapi.ai/v1/embeddings`. The headers are exactly `Content-Type: application/json` and `Authorization: Bearer <key>`, and redirects are set to `manual`.

- The model must be `Bge_M3_FP16`.
- `input` is a string, or an array of 1 to 256 strings. Each must be non-blank and at most 20,000 characters.
- The upstream body is always `{ model, input, encoding_format: "float" }`.
- `encoding_format` may be `float` (the default) or `base64`. Base64 is packed locally from the checked floats, as in the source's fallback.
- `dimensions` may be absent or exactly `1024`. It is not forwarded, because the model has a fixed width.
- `user` is accepted and not forwarded.
- The key is the selected connection's `apiKey`, then `accessToken`. A key with CR or LF is refused. `providerSpecificData.baseUrl` is ignored, so the key only goes to `oai.deapi.ai`. The default transport is `proxyAwareFetch` with the connection's proxy options.

## Refused before sending (400)

The following are refused before anything is sent:

- Any other model.
- Empty or missing input, blank items, token arrays, and structured or multimodal items.
- Strings over 20,000 characters. The source cut them silently.
- More than 256 items.
- Any `dimensions` other than the number 1024.
- Any `encoding_format` other than `float` or `base64`.
- Any other field (`input_type`, `task`, ...). The source forwarded these blindly.

A missing or unusable key returns a 401, also without sending.

## Answers

- **2xx:** the answer is read with a 16 MiB and deadline bound. An unparseable body, or an in-band `error` envelope (which is never quoted), is unusable. Otherwise there must be exactly one finite numeric vector of width 1024 per input. A missing `index` is filled by position, and indices must be unique and in range. One redundant row is unwrapped. The output is ordered by index as `{ object: "embedding", index, embedding }` and returned as `{ object: "list", data, model, usage }`, with the source's model echo rule.
- **Usage and cost:** accounting comes only from deAPI's own `usage` (`mediaAccounting`). Cost is always unknown, and `nativeUnits.inputs` is the input count. With no receipt, the tokens are empty and `meta.usageMissing` is true. The body still carries the source's zero fallback, but that is not counted as real usage.
- **401/403:** "refused the API key", with no refresh because the key is an API key.
- **402:** `quotaExhausted: true` for this connection only. The next call with another key proceeds.
- **429:** keeps a Retry-After reset when present.
- **Other 4xx:** keep their status.
- **5xx:** become a 502 with `acceptedJob` (`submit-unknown`).
- **Redirects:** a 3xx or opaque redirect is refused and never followed. An answer from another origin is uncertain (`acceptedJob`).
- **Upstream text:** the body is never read into an error, and credential values are redacted through `createErrorResult`.

## Deadlines, cancellation and replay

- One 60-second deadline covers the send and the body read. The wait ends at the deadline even if the transport ignores its signal, and a late answer is discarded.
- Abort before send returns 499 with nothing sent. Abort after send aborts the socket and returns 499 with `acceptedJob` (`submit-unknown`).
- Pre-connect failures (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `UND_ERR_CONNECT_TIMEOUT`, outbound URL guard) return 502 without `acceptedJob`. A timeout or mid-flight failure after send is uncertain. A 2xx whose body cannot be read or used counts as completed-unusable work.
- The adapter makes exactly one request per call and never resends. Every uncertain outcome carries `acceptedJob` with unknown cost.

## Registration steps (serial, not done here)

From `registration.json`:

1. Add `deapi: deapiEmbeddingAdapter` to `EMBEDDING_ADAPTERS`, not to `OPENAI_COMPAT_PROVIDERS`.
2. In `handleEmbeddingsCore`, delegate to `adapter.embed` when present. The shared fetch has no deadline, redirect refusal or input checks, and its refresh retry and upstream error relay must not run for deapi.
3. Add `open-sse/providers/registry/deapi.js`: apikey, alias `deapi`, `serviceKinds: ["embedding"]`, the model row, and no chat transport.
4. In `src/sse/handlers/embeddings.js`, record `acceptedJob` as unknown-cost usage on the selected connection, as image generation does. A result carrying `acceptedJob` must not fall through to another account. That handler does not read `acceptedJob` today.
5. Then list deAPI in `docs/providers/catalog.mdx`. Promote the isolated staging test block to positive identity checks.

## Remaining restrictions

- deAPI image, video, TTS and STT are separate inventory rows and are not claimed by this module.
- Only the source's single static model is supported. Other deAPI embedding models need a source-backed list.
- Whether deAPI honors `encoding_format: "base64"` or `dimensions` is unverified, so neither is forwarded.
- Closed mocks only. Nothing here says anything about the live service.

## Evidence

- `cd tests && node node_modules/vitest/vitest.mjs run unit/native-deapi-embedding.test.js --maxWorkers=2`: 52 passed.
- `npx eslint` and `oxlint -c .oxlintrc.json` on the module and test: clean.
