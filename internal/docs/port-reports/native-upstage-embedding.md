# Upstage native embeddings (staged), 2026-11-27

Issue: #2034. The inventory row for `upstage` embeddings (`open-sse/config/embeddingRegistry.ts` → `handlers/embeddings.ts`, missing from `EMBEDDING_ADAPTERS`) was missing. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/embeddingRegistry.ts`, entry `upstage`: id `upstage`, baseUrl `https://api.upstage.ai/v1/embeddings`, authType `apikey`, authHeader `bearer`. It lists two models: `embedding-query` ("Embedding Query", 4096) and `embedding-passage` ("Embedding Passage", 4096). Neither has `modalities`, `defaultParams` or a native protocol. The provider has no `tokenField` and no `requiresArrayInput`. The alias tables have no Upstage entries.
- `open-sse/handlers/embeddings.ts` sends Upstage down the generic path:
  - Makes one `POST` to the fixed baseUrl with `Content-Type: application/json` and `Authorization: Bearer <apiKey || accessToken>`.
  - Sends `{ model, input }`, adding `dimensions` and `encoding_format` only when the client sent them, plus any unknown client fields. The source's own Upstage handler test (`tests/unit/embeddings-handler.test.ts`) pins the body as exactly `{ model: "embedding-query", input }`. String items longer than 20,000 characters are silently cut.
  - Refuses structured input, because neither model advertises modalities.
  - Unwraps one redundant row per vector, fills a missing `index`, and packs little-endian float32 when the client asked for `base64` and got floats.
  - Echoes `body.model` when it has no `/`, else `upstage/<model>`. A missing `usage` becomes zeros.
  - Relays a non-2xx with the upstream body text and marks the connection unavailable.
  - Uses `AbortSignal.timeout(FETCH_TIMEOUT_MS)` only. It does not handle redirects, bound the body, or check vectors.
- Discovery: none for embeddings. The source's provider models route merges the static embedding rows into the Upstage local catalog (`tests/unit/provider-models-route.test.ts`, source `local_catalog`). Upstage is never asked for an embedding model list.
- The source also has `deriveEmbeddingProviderForChatProvider`, which would turn `/chat/completions` into `/embeddings` for Upstage. It is only a fallback; the curated entry above wins.

## Fresh-main check

- `open-sse/providers/registry/upstage.js` exists: API key (`category: "apikey"`), chat at `https://api.upstage.ai/v1/chat/completions`, models `solar-pro3` and `solar-mini`, no `serviceKinds` field (so `["llm"]` by default), no `modelsFetcher`, no `media.embeddingConfig` and no embedding rows.
- `getEmbeddingAdapter("upstage")` is null. `upstage` is not in `OPENAI_COMPAT_PROVIDERS` and has no compatible-node prefix. The fork has no chat-to-embeddings URL derivation.
- The generic `createOpenAIEmbeddingAdapter` would read `PROVIDER_MEDIA.upstage.embeddingConfig.baseUrl`, which is `undefined`.
- `open-sse/providers/registry/nvidia.js` lists `upstage/solar-10.7b-instruct` as an NVIDIA chat model. It is not an alias of the Upstage provider.
- `providerQuota.js` has no Upstage entry.
- Result: the existing provider identity and API key mode are reused. The embeddings adapter and its two model rows are the whole delta. No provider metadata is duplicated.

## What landed

All new files are under `open-sse/services/providerParity/native-upstage-embedding/`. The module follows the staged deAPI and NanoGPT embeddings adapters' contract (`embed()`, `acceptedJob`, `mediaAccounting`, abort):

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and URL, auth header and scheme, the existing provider facts plus the kind to add (`UPSTAGE_PROVIDER`), the two models, encodings and bounds. |
| `request.js` | `buildUpstageEmbeddingRequest`: validates the body and refuses anything unsupported with a 400. |
| `http.js` | Key selection, a bounded and abortable send, redirect and foreign-origin checks, refused-answer mapping that never quotes upstream text, and accepted-work accounting. |
| `adapter.js` | `createUpstageEmbeddingAdapter` with `embed()`, plus `buildUrl`, `buildHeaders` and `buildBody`; `normalizeUpstageEmbeddings`; `packFloat32Base64`. |
| `index.js` | Re-exports, plus the default `upstageEmbeddingAdapter`. |
| `registration.json` | Exports, canonical ID and alias, existing and added service kinds, models, addressing, endpoint, auth, supported input and integration points. |

The tests are in `tests/unit/native-upstage-embedding.test.js`: 57 tests over a closed network. Nothing is registered. Two tests in the isolated `staging state` block assert this: no `EMBEDDING_ADAPTERS` key, and a registry entry that is still chat-only. No other test depends on that state.

## Supported subset

`POST https://api.upstage.ai/v1/embeddings`. Headers are exactly `Content-Type: application/json` and `Authorization: Bearer <key>`, and redirects are set to `manual`.

- The model must be `embedding-query` or `embedding-passage`. The core passes the unprefixed id. Query and passage asymmetry is chosen by model id.
- `input` is a string, or an array of 1 to 100 strings. Each must be non-blank and at most 20,000 characters.
- The upstream body is `{ model, input }`, as the source pins it. `encoding_format: "float"` is added only when the client sent it.
- `dimensions` may be absent or `4096`. It is not forwarded (both models have one fixed width).
- `encoding_format` may be `float` (the default) or `base64`. Base64 is not forwarded; it is packed locally from the checked floats.
- `user` is accepted and not forwarded.
- The key is the selected connection's `apiKey`, then `accessToken`. A key with CR or LF is refused.
- `providerSpecificData.baseUrl` is ignored, so the key only goes to `api.upstage.ai`.
- The transport is `proxyAwareFetch` with the connection's proxy options.

## Refused before sending

These return a 400:

- Any other model, including the chat models, older `solar-embedding-*` names, and a prefixed id at the adapter.
- Empty or missing input, blank items, token arrays, and structured or multimodal items.
- Strings over 20,000 characters. The source cut them silently.
- More than 100 items (a fork bound; the source had none).
- A `dimensions` value other than `4096`.
- Any other `encoding_format`.
- Any other field (`input_type`, ...). The source forwarded these blindly.

A missing or header-unsafe key returns a 401.

## Answers

- **2xx:** the body is read within a 16 MiB bound and the deadline. An unparseable body, an in-band `error` envelope (never quoted), a wrong count or width, non-finite numbers, a string vector, or bad or duplicate indices make the answer unusable. That returns a 502 with `acceptedJob` (`completed-unusable`). A usable answer is ordered by index and returned as an OpenAI list with the source's model echo rule.
- **Usage and cost:** accounting comes only from Upstage's own `usage`. Cost is always unknown, and `nativeUnits.inputs` is the input count. With no receipt, the tokens stay empty and `meta.usageMissing` is set. The body still carries the source's zero fallback, but it is never counted.
- **401/403:** final for the call (no refresh for an API key).
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

1. Add `upstage: upstageEmbeddingAdapter` to `EMBEDDING_ADAPTERS`, not to `OPENAI_COMPAT_PROVIDERS`.
2. In `handleEmbeddingsCore`, delegate to `adapter.embed` when present. This is the same hook the deAPI and NanoGPT registrations need.
3. In `open-sse/providers/registry/upstage.js`, set `serviceKinds: ["llm", "embedding"]` (the entry has none today) and append the two model rows (`kind: "embedding"`). Keep the chat transport and chat models unchanged.
4. In `src/sse/handlers/embeddings.js`, record `acceptedJob` as unknown-cost usage on the selected connection. Do not fall through to another account for such a result.
5. Add the embedding kind to the Upstage row in `docs/providers/catalog.mdx`. Promote the isolated staging test block to positive identity checks.

## Remaining restrictions

- Upstage document parsing, OCR and other non-embedding APIs are not claimed here.
- Only the source's two static models are supported. No discovery exists in either tree.
- The 100-item batch bound is a fork limit. Upstage's per-input token limit is not modeled; an over-limit input surfaces as Upstage's 4xx (status kept, body not quoted).
- Closed mocks only. Nothing here says anything about the live service.

## Evidence

- `cd tests && node node_modules/vitest/vitest.mjs run unit/native-upstage-embedding.test.js --maxWorkers=2`: 57 passed.
- `npx eslint` and `npx oxlint -c .oxlintrc.json` on the module and test: clean.
