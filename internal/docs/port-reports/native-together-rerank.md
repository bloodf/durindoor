# Together native rerank — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-together-rerank/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/rerankRegistry.ts`: enabled `together` entry — `id: "together"`,
  `baseUrl: "https://api.together.xyz/v1/rerank"`, `authType: "apikey"`,
  `authHeader: "bearer"`, no `format`, one model `Salesforce/Llama-Rank-V2`
  ("Llama Rank V2"). No rerank alias maps to `together`.
- `open-sse/handlers/rerank.ts`: `buildAuthHeader` sends `Bearer <apiKey||accessToken>`;
  the default (Cohere-compatible) branch of `transformRequestForProvider` sends
  `{ model, query, documents, top_n: top_n || documents.length,
  return_documents: return_documents !== false }`; `transformResponseFromProvider`
  returns the upstream body unchanged; errors relay the upstream message.
- `src/app/api/providers/[id]/models/discovery/providerModelsConfig.ts` and
  `providerSets.ts`: `together` live discovery at `https://api.together.xyz/v1/models`,
  bearer, `parseResponse: data.data || data.models || []`.

Fetched `origin/main` on 2026-11-27 (`f7514b9ba3d0b341e0b5b422486049cf4f851a17`);
local HEAD `ab65a22fe4c74ac10101f6815a15395935061519`. Both have the same
`registry/together.js` and `handlers/rerankCore.js` for these paths. The checks
compared wire behavior, not only provider names:

- `providers/registry/together.js`: existing apikey provider, chat transport
  `https://api.together.xyz/v1/chat/completions`, alias `together`, serviceKinds
  `llm, imageToText, image, video, tts, stt`. It has **no** rerank model, serviceKind
  or `rerankConfig`.
- `handlers/rerankCore.js` `deriveRerankUrl`: from the chat transport it **does**
  derive `https://api.together.xyz/v1/rerank`, the same endpoint as the source. This
  corrects the inventory's "no derivable local rerank config". The test file asserts
  this equivalence.
- `src/sse/handlers/modelKind.js` `modelKindError` (via `resolveTypedMediaModel`
  in `src/sse/handlers/rerank.js`): rejects `together/Salesforce/Llama-Rank-V2` for the
  rerank route because no Together model has `kind: "rerank"` and no
  `rerankConfig.models` exists. The derived endpoint is reachable only if an operator
  adds a custom rerank model.
- Even then, the generic core is not envelope-equivalent. It forwards the caller body
  verbatim (`{...body, model}`, without the `top_n`/`return_documents` defaults),
  relays the raw upstream body, and has no output validation. The remaining delta is
  therefore catalog metadata (model, serviceKind, rerankConfig) plus the source
  request envelope and a validated response. The URL and auth were already equivalent.
- Discovery: the existing `src/app/api/providers/[id]/models/modelsConfig.js`
  `together: createOpenAIModelsConfig("https://api.together.xyz/v1/models")` is
  equivalent (same URL and bearer; `parseOpenAIStyleModels` also accepts the bare-array
  shape). No second production discovery is needed. The staged discovery adds
  bounded transport, safe-ID validation and catalog-only capability claims.

All searches were checkout-only rg/git reads. No agents and no live provider calls.

## Supported subset and contracts

Exports: immutable `rerankConfig`/`rerankModels`/`togetherRerankMetadata`, the
`togetherRerankAdapter` builders/normalizer, `handleTogetherRerankNative` (existing
`handleRerankCore` result shape: success/status/Response/accounting, or the error result
plus `acceptedJob`) and `discoverTogetherModels`.

Request subset: a non-empty query; 1–1024 documents, each a string or `{text}`, with
the query and each document at most 20,000 characters; `top_n` an integer from 1 to
documents.length; `return_documents` boolean. Anything else (`rank_fields`, JSON or
structured documents, media, `stream`, extra fields) is refused before submission.
The wire body is exactly the source envelope. Documents are forwarded in the caller's
accepted form, `top_n` defaults to the document count and `return_documents` defaults
to true. The model goes only in the body. Model IDs keep vendor slashes, but schemes,
traversal, escapes, query strings, fragments, empty segments and whitespace are refused.
Custom safe IDs are allowed and claim no capability.

Response: requires a `results` array of 1..top_n rows with unique in-range integer
indices and finite scores. Rows are sorted by score (descending; ties stable by index).
Document text is rebuilt from the caller's originals, never from the upstream echo. A
safe upstream `id` is kept; otherwise a local `rerank-<ts>` id is used. Only numeric
`usage` token/USD fields are kept. No synthetic `billed_units` are added. Unknown cost
stays null/unknown. **Intentional difference from the source:** the source relays the
upstream body and error message unchanged. The staged module never relays upstream
bodies, messages or parser errors.

Transport: local `proxyAwareFetch` with the selected connection's proxy options.
Auth is `apiKey`, then `accessToken`, as a bearer token. Missing or header-unsafe keys
fail before any network call. The fixed HTTPS origin uses `redirect: "manual"`;
redirects and foreign or redirected responses are refused, and no result URLs are
fetched. One submission per call. There is no retry, refresh, replay or failover, and
401/403 never mutate credentials. The default total deadline is 30 s and the maximum
is 60 s; it covers the headers and the body read together. Successful bodies are read
up to 8 MiB and error bodies up to 16 KiB. Abort and deadline end every wait and abort
both the fetch and the body reader, even when a transport ignores the signal. Late
responses are discarded. Cancellation before send and proven non-connects are not
accepted work. Uncertain network failures, 5xx responses, foreign responses, and
completed-but-unread or unusable answers carry `acceptedJob` with honest unknown
cost and the selected connection id. Quota (402, or 403/429 with a quota code) is
scoped to the selected credential. A 429 response uses the existing Retry-After
rate-limit evidence.

This is a synchronous API. It has no async jobs, polling, artifacts, WebSocket or
browser contracts.

## Registration handoff

`registration.json` records the exports, IDs/alias, model, serviceKind, endpoints/auth,
envelope and integration points. At serial registration:

- append `rerank` to `registry/together.js` `serviceKinds`;
- add the `kind: "rerank"` model and `rerankConfig` from `togetherRerankMetadata`,
  preserving the existing transport, auth and media configs;
- dispatch `handleTogetherRerankNative` in `rerankCore.js` before the generic
  derive/passthrough path;
- update the catalog docs.

The test file's isolated staging block is the only place that asserts the unregistered
state. All protocol, security and accounting assertions work independently of
registration.

## Focused evidence

Dependencies were installed in root, cli and tests with frozen lockfiles and
`--prefer-offline`.

```sh
cd tests && test -f unit/native-together-rerank.test.js && node node_modules/vitest/vitest.mjs run unit/native-together-rerank.test.js --maxWorkers=2
pnpm exec eslint open-sse/services/providerParity/native-together-rerank/*.js tests/unit/native-together-rerank.test.js
pnpm run lint:anti-slop
```

Result: 91 focused tests passed. Scoped ESLint passed. The anti-slop gate passed with
0 diagnostics; its regenerated bundle was restored and is not part of this change. No
full suite, baseline changes, live accounts, paid APIs, browser, Docker or deploy.
