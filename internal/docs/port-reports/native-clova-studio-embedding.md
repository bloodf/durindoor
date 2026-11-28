# Naver CLOVA Studio native embeddings (staged), 2026-11-27

Issue: #2034. The inventory row for `clova-studio` embeddings (`open-sse/config/embeddingRegistry.ts` → `handlers/embeddings.ts`, missing from `EMBEDDING_ADAPTERS`) was missing. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/embeddingRegistry.ts`, entry `clova-studio`: id `clova-studio`, baseUrl `https://clovastudio.stream.ntruss.com/v1/api-tools/embedding/v2`, authType `apikey`, authHeader `bearer`, `singleTextProtocol: "clova-v2"`. One model: `clova-embedding-v2` ("CLOVA Embedding v2", 1024). `EMBEDDING_PROVIDER_ALIASES` has no CLOVA entry.
- `open-sse/handlers/embeddings.ts`:
  - `resolveSingleTexts` accepts a string or an array of non-blank strings and refuses anything else with a 400. It refuses `dimensions` unless `Number(dimensions) === 1024`. Strings over 20,000 characters are silently cut.
  - `fetchClovaEmbeddingBatch` sends one sequential `POST` of `{ text }` per input, with `Content-Type: application/json` and `Authorization: Bearer <apiKey || accessToken>`, and `AbortSignal.timeout(FETCH_TIMEOUT_MS)` per call. The first non-2xx is returned as is and stops the batch. `encoding_format`, `dimensions` and `user` are never sent.
  - `appendClovaEmbedding` re-indexes vectors by input position and sums `inputTokens` (a missing count becomes 0).
  - The common path then packs base64 when asked and echoes a bare client model id, else `clova-studio/<model>`.
- `open-sse/handlers/embeddingStructuredInput.ts` `normalizeClovaEmbeddingV2Response`: any `status.code` other than `"20000"` throws, even on HTTP 200. A missing `result.embedding` array throws.
- Discovery: the source's live CLOVA discovery (`src/app/api/providers/[id]/models/discovery/providerSets.ts`, `<baseUrl>/models`) reads the chat catalog. Nothing feeds `EMBEDDING_PROVIDERS`, so the embedding list is static.

## Fresh-main check

- `open-sse/providers/registry/clova-studio.js` exists: alias `clova`, API key, chat through the OpenAI-compatible `https://clovastudio.stream.ntruss.com/v1/openai/chat/completions`, three HCX chat models, `serviceKinds: ["llm"]`, no `media.embeddingConfig`, no embedding rows.
- `getEmbeddingAdapter("clova-studio")` and `getEmbeddingAdapter("clova")` are null. Neither id is in `OPENAI_COMPAT_PROVIDERS`, and `lookupMediaAdapter` does no alias resolution.
- The generic OpenAI-compatible embeddings adapter is not an equivalent even if configured: it sends one `{ model, input }` per request and expects an OpenAI list, while CLOVA v2 takes one `{ text }` per call and answers a `{ status, result }` envelope.
- `rg -i clova` over the checkout finds no `api-tools/embedding`, no single-text protocol and no v2 envelope normalizer.
- Result: the existing provider identity, alias and API key mode are reused. The embeddings adapter and its one model row are the whole delta.

## What landed

All new files are under `open-sse/services/providerParity/native-clova-studio-embedding/`. The module follows the staged NanoGPT and deAPI embeddings adapters' contract (`embed()`, `acceptedJob`, `mediaAccounting`, abort):

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and URL, auth header and scheme, success code, the existing provider facts plus the kind to add (`CLOVA_PROVIDER`), the model, encodings and bounds. |
| `request.js` | `buildClovaEmbeddingRequest`: validates the body, refuses anything unsupported with a 400, and builds one `{ text }` per input. |
| `http.js` | Key selection, a bounded and abortable send, redirect and foreign-origin checks, refused-answer mapping that never quotes upstream text, and accepted-work accounting with fan-out progress. |
| `adapter.js` | `createClovaEmbeddingAdapter` with `embed()`, plus `buildUrl`, `buildHeaders` and `buildBody`; `normalizeClovaEmbedding`; `packFloat32Base64`. |
| `index.js` | Re-exports, plus the default `clovaEmbeddingAdapter`. |
| `registration.json` | Exports, canonical ID and alias, existing and added service kinds, model, addressing, endpoint, auth, supported input, accounting and integration points. |

The tests are in `tests/unit/native-clova-studio-embedding.test.js`: 68 tests over a closed network. Nothing is registered. Two tests in the isolated `staging state` block assert this: no `EMBEDDING_ADAPTERS` key under `clova-studio` or `clova`, and a registry entry that is still chat-only. No other test depends on that state.

## Supported subset

`POST https://clovastudio.stream.ntruss.com/v1/api-tools/embedding/v2`, one call per input, sequential, in input order. Headers are exactly `Content-Type: application/json` and `Authorization: Bearer <key>`, the body is exactly `{ text }`, and redirects are set to `manual`.

- The model must be `clova-embedding-v2`. The core passes the unprefixed id. The response echoes a bare client id, else `clova-studio/clova-embedding-v2` (also for `clova/...`).
- `input` is a string, or an array of 1 to 64 strings. Each must be non-blank and at most 20,000 characters.
- `dimensions` may be absent, `null` or the number `1024`. It is never forwarded.
- `encoding_format` may be `float` (the default) or `base64`. Base64 is packed locally from the checked floats, little-endian float32.
- `user` is accepted and not forwarded.
- The key is the selected connection's `apiKey`, then `accessToken`. A key with CR or LF is refused.
- `providerSpecificData.baseUrl` is ignored, so the key only goes to `clovastudio.stream.ntruss.com`.
- The transport is `proxyAwareFetch` with the connection's proxy options.

## Refused before sending

These return a 400 with nothing sent:

- Any other model, including a prefixed id at the adapter.
- Empty or missing input, blank items (anywhere in the batch), token arrays, and structured or multimodal items.
- Strings over 20,000 characters. The source cut them silently.
- More than 64 items. The source had no bound; each item is a separate call.
- Any `dimensions` other than 1024, including the string `"1024"`. The source accepted `"1024"` via `Number()`; this is the only intentional narrowing of a source-accepted value.
- Any other `encoding_format`.
- Any other field (`input_type`, ...). The source dropped these silently.

A missing or header-unsafe key returns a 401.

## Answers

- **2xx:** each body is read within a 1 MiB bound and the call deadline. It must carry `status.code` `"20000"` (string or number) and `result.embedding` as exactly 1024 finite numbers. One redundant row is unwrapped. Anything else, including an HTTP-200 error envelope or unparseable JSON, is unusable: 502 with `acceptedJob` (`completed-unusable`), message never quoted.
- **Usage and cost:** accounting comes only from CLOVA's own `inputTokens`, summed. Cost is always unknown, and `nativeUnits` is `{ inputs, calls }`. If any call omits `inputTokens`, tokens stay empty and `meta.usageMissing` is set. The body still carries the source's zero fallback, but it is never counted.
- **401/403:** final for the call (no refresh for an API key).
- **402:** `quotaExhausted` on this connection only. Two-key tests show the next call on the other key proceeds with that key's header.
- **429:** keeps a bounded Retry-After.
- **Other 4xx:** keep their status.
- **5xx:** become a 502 with `acceptedJob` (`submit-unknown`).
- **Redirects:** a 3xx or opaque redirect is refused. An answer from another origin is uncertain.
- **Upstream text:** never relayed, and credentials are redacted.

## Fan-out, deadlines, cancellation and replay

- Each call has a 30-second deadline covering the send and the body read. The whole fan-out has a 120-second total deadline, and a call never gets more than what is left of it. Both hold even when a transport ignores its signal.
- The fan-out stops at the first failure. Nothing is retried or resent.
- When earlier calls in the batch already succeeded, any failure carries `acceptedJob` with `completedInputs`, `requestedInputs` and the known `inputTokens` of the completed calls. A definite failure is reported as `partial`. An uncertain one keeps its own state (`submit-unknown`, `completed-unusable`, `accepted`).
- Abort before the first send returns 499 with nothing sent. Abort after a send aborts the socket and returns 499 with `acceptedJob`.
- A spent total deadline before the next call returns 504 and reports the completed calls.
- Pre-connect failures return 502 without `acceptedJob` (unless earlier calls completed). A timeout, a reset, or a 5xx after send is uncertain.

## Registration steps (serial, not done here)

From `registration.json`:

1. Add `"clova-studio": clovaEmbeddingAdapter` to `EMBEDDING_ADAPTERS`, not to `OPENAI_COMPAT_PROVIDERS`.
2. In `handleEmbeddingsCore`, delegate to `adapter.embed` when present. This is the same hook the deAPI and NanoGPT registrations need; the shared single-request fetch cannot fan out.
3. In `open-sse/providers/registry/clova-studio.js`, add `"embedding"` to `serviceKinds` and the model row (`kind: "embedding"`). Keep the chat transport and HCX models unchanged.
4. In `src/sse/handlers/embeddings.js`, record `acceptedJob` as unknown-cost usage on the selected connection. Do not fall through to another account for such a result.
5. Add the embedding kind to the Naver CLOVA Studio row in `docs/providers/catalog.mdx`. Promote the isolated staging test block to positive identity checks.

## Remaining restrictions

- Only the source's one static model is supported. CLOVA's chat catalog discovery does not list embedding models, and the source does not use it for embeddings.
- Batches are capped at 64 inputs and are sequential, so a large batch is slow (about 100 ms per call per the source's live note).
- The v2 HTTP error body (`status.code`/`message`) is never read; only the HTTP status is mapped.
- Closed mocks only. Nothing here says anything about the live service.

## Evidence

- `cd tests && node node_modules/vitest/vitest.mjs run unit/native-clova-studio-embedding.test.js --maxWorkers=2`: 68 passed.
- `npx eslint` and `npx oxlint -c .oxlintrc.json` on the module and test: clean.
