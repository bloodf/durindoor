# NanoGPT native embeddings (staged), 2026-11-27

Issue: #2034. The inventory row for `nanogpt` embeddings (`open-sse/config/embeddingRegistry.ts` → `handlers/embeddings.ts`, missing from `EMBEDDING_ADAPTERS`) was missing. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/embeddingRegistry.ts`, entry `nanogpt`: id `nanogpt`, baseUrl `https://nano-gpt.com/v1/embeddings`, authType `apikey`, authHeader `bearer`. It lists two models: `text-embedding-3-small` ("Text Embedding 3 Small", 1536) and `text-embedding-3-large` ("Text Embedding 3 Large", 3072). Neither has `modalities`, `defaultParams` or a native protocol. The provider has no `tokenField` and no `requiresArrayInput`. `EMBEDDING_PROVIDER_ALIASES` and `EMBEDDING_MODEL_ALIASES` have no NanoGPT entries.
- `open-sse/handlers/embeddings.ts` sends NanoGPT down the generic path:
  - Makes one `POST` to the fixed baseUrl. Only local providers honor a connection base URL. Headers are `Content-Type: application/json` and `Authorization: Bearer <apiKey || accessToken>`.
  - Sends `{ model, input, dimensions?, encoding_format?, ...unknown client fields }`. String items longer than 20,000 characters are silently cut.
  - Refuses structured input, because neither model advertises modalities.
  - Unwraps one redundant row per vector and fills a missing `index` by position. When the client asked for `base64` and got floats, it packs little-endian float32.
  - Echoes `body.model` when it has no `/`, else `nanogpt/<model>`. A missing `usage` becomes zeros.
  - Relays a non-2xx with the upstream body text, and marks the connection unavailable.
  - Uses `AbortSignal.timeout(FETCH_TIMEOUT_MS)` only. It does not handle redirects or bound the body, and it does not check vectors.
- Bare `text-embedding-3-*` resolves to `openai` in the source. NanoGPT is reached only as `nanogpt/<model>`.
- Discovery: the source's live NanoGPT discovery (`src/app/api/providers/[id]/models/discovery/providerSets.ts`) reads the chat catalog. Nothing feeds `EMBEDDING_PROVIDERS`, so the embeddings list is static.

## Fresh-main check

- `open-sse/providers/registry/nanogpt.js` already exists:
  - API key auth.
  - Chat at `https://nano-gpt.com/api/v1/chat/completions` and `modelsFetcher` at `/api/v1/models`.
  - `passthroughModels: true` and `serviceKinds: ["llm"]`.
  - No `media.embeddingConfig` and no embedding model rows.
- `getEmbeddingAdapter("nanogpt")` is null. `nanogpt` is not in `OPENAI_COMPAT_PROVIDERS` and has no compatible-node prefix.
- The generic `createOpenAIEmbeddingAdapter` would read `PROVIDER_MEDIA.nanogpt.embeddingConfig.baseUrl`, which is `undefined`. The chat entry has the same name, but it has no embeddings endpoint (`/v1/embeddings`, not `/api/v1/...`) or envelope.
- `providerQuota.js` lists `nanogpt` as `provider-not-present` (no quota adapter). This is unchanged.
- Result: the existing provider identity and API key mode are reused. The embeddings adapter and its two model rows are the whole delta. No provider metadata is duplicated.

## What landed

All new files are under `open-sse/services/providerParity/native-nanogpt-embedding/`. The module follows the staged deAPI embeddings adapter's contract (`embed()`, `acceptedJob`, `mediaAccounting`, abort):

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and URL, auth header and scheme, the existing provider facts plus the kind to add (`NANOGPT_PROVIDER`), the two models, encodings and bounds. |
| `request.js` | `buildNanogptEmbeddingRequest`: validates the body and refuses anything unsupported with a 400. |
| `http.js` | Key selection, a bounded and abortable send, redirect and foreign-origin checks, refused-answer mapping that never quotes upstream text, and accepted-work accounting. |
| `adapter.js` | `createNanogptEmbeddingAdapter` with `embed()`, plus `buildUrl`, `buildHeaders` and `buildBody`; `normalizeNanogptEmbeddings`; `packFloat32Base64`. |
| `index.js` | Re-exports, plus the default `nanogptEmbeddingAdapter`. |
| `registration.json` | Exports, canonical ID and alias, existing and added service kinds, models, addressing, endpoint, auth, supported input and integration points. |

The tests are in `tests/unit/native-nanogpt-embedding.test.js`: 59 tests over a closed network. Nothing is registered. Two tests in the isolated `staging state` block assert this: no `EMBEDDING_ADAPTERS` key, and a registry entry that is still chat-only (`["llm"]`, no embedding rows). No other test depends on that state.

## Supported subset

`POST https://nano-gpt.com/v1/embeddings`. Headers are exactly `Content-Type: application/json` and `Authorization: Bearer <key>`, and redirects are set to `manual`.

- The model must be `text-embedding-3-small` or `text-embedding-3-large`. The core passes the unprefixed id.
- `input` is a string, or an array of 1 to 256 strings. Each must be non-blank and at most 20,000 characters.
- The upstream body is `{ model, input, dimensions?, encoding_format: "float" }`, in source order.
- `dimensions` may be absent, or an integer from 1 to the model's width (1536 or 3072). It is forwarded as the source does. The answer must then carry vectors of exactly that width. When it is absent, the full width is required.
- `encoding_format` may be `float` (the default) or `base64`. Base64 is packed locally from the checked floats.
- `user` is accepted and not forwarded.
- The key is the selected connection's `apiKey`, then `accessToken`. A key with CR or LF is refused.
- `providerSpecificData.baseUrl` is ignored, so the key only goes to `nano-gpt.com`.
- The transport is `proxyAwareFetch` with the connection's proxy options.

## Refused before sending

These return a 400:

- Any other model, including a prefixed id at the adapter.
- Empty or missing input, blank items, token arrays, and structured or multimodal items.
- Strings over 20,000 characters. The source cut them silently.
- More than 256 items.
- A `dimensions` value that is not an integer, is out of range, or is a string.
- Any other `encoding_format`.
- Any other field (`input_type`, ...). The source forwarded these blindly.

A missing or header-unsafe key returns a 401.

## Answers

- **2xx:** the body is read within a 32 MiB bound and the deadline. An unparseable body, an in-band `error` envelope (never quoted), a wrong count or width, non-finite numbers, a string vector, or bad or duplicate indices make the answer unusable. That returns a 502 with `acceptedJob` (`completed-unusable`). A usable answer is ordered by index and returned as an OpenAI list with the source's model echo rule.
- **Usage and cost:** accounting comes only from NanoGPT's own `usage`. Cost is always unknown, and `nativeUnits.inputs` is the input count. With no receipt, the tokens stay empty and `meta.usageMissing` is set. The body still carries the source's zero fallback, but it is never counted.
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

1. Add `nanogpt: nanogptEmbeddingAdapter` to `EMBEDDING_ADAPTERS`, not to `OPENAI_COMPAT_PROVIDERS`.
2. In `handleEmbeddingsCore`, delegate to `adapter.embed` when present. This is the same hook the deAPI registration needs.
3. In `open-sse/providers/registry/nanogpt.js`, add `"embedding"` to `serviceKinds` and the two model rows (`kind: "embedding"`). Keep the chat transport, chat models, `modelsFetcher` and `passthroughModels` unchanged. Registration must not change how bare `text-embedding-3-*` ids resolve (`openai.js` and `github.js` list them).
4. In `src/sse/handlers/embeddings.js`, record `acceptedJob` as unknown-cost usage on the selected connection. Do not fall through to another account for such a result.
5. Add the embedding kind to the NanoGPT row in `docs/providers/catalog.mdx`. Promote the isolated staging test block to positive identity checks.

## Remaining restrictions

- NanoGPT image, video, TTS and STT are separate inventory rows and are not claimed here.
- Only the source's two static models are supported. NanoGPT's chat catalog discovery does not list embedding models, and the source does not use it for embeddings.
- It is unverified whether NanoGPT honors `dimensions`. It is forwarded as the source does, and a wrong-width answer is refused as unusable accepted work rather than returned. `encoding_format: "base64"` is never forwarded.
- Closed mocks only. Nothing here says anything about the live service.

## Evidence

- `cd tests && node node_modules/vitest/vitest.mjs run unit/native-nanogpt-embedding.test.js --maxWorkers=2`: 59 passed.
- `npx eslint` and `npx oxlint -c .oxlintrc.json` on the module and test: clean.
