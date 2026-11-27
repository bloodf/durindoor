# SiliconFlow native rerank — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-siliconflow-rerank/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/rerankRegistry.ts`: enabled `siliconflow` entry — `id: "siliconflow"`,
  `baseUrl: "https://api.siliconflow.com/v1/rerank"`, `authType: "apikey"`,
  `authHeader: "bearer"`, no `format`. Four models: `Qwen/Qwen3-Reranker-8B`,
  `Qwen/Qwen3-Reranker-4B`, `Qwen/Qwen3-Reranker-0.6B`, `BAAI/bge-reranker-v2-m3`.
  `RERANK_PROVIDER_ALIASES` maps only `jina` and `voyage`, so no rerank alias maps to
  `siliconflow`.
- `open-sse/handlers/rerank.ts`: `buildAuthHeader` sends `Bearer <apiKey||accessToken>`.
  `transformRequestForProvider` uses the default Cohere-compatible branch; its comment
  names SiliconFlow. The handler sends `{ model, query, documents, top_n: top_n ||
  documents.length, return_documents: return_documents !== false }`.
  `transformResponseFromProvider` returns the upstream body unchanged, and errors relay
  the upstream message. This is the same branch the staged Together adapter uses.
- `src/app/api/providers/[id]/models/discovery/providerSets.ts`: `siliconflow` is in
  `NAMED_OPENAI_STYLE_PROVIDERS`. Live discovery uses `<baseUrl>/models`, which is
  `https://api.siliconflow.com/v1/models` with a bearer token.
  `normalizers.ts` `normalizeOpenAiLikeModelsResponse` reads a bare array, `data` or
  `models`, with row id `id || model || name`. For siliconflow it also keeps pricing
  and free-tier evidence fields.

Fetched `origin/main` (`f7514b9ba3d0b341e0b5b422486049cf4f851a17`). It has no diff from
local HEAD for `registry/siliconflow.js`, `handlers/rerankCore.js` or the models
discovery routes. The checks compared wire behavior, not only names:

- `providers/registry/siliconflow.js`: an existing apikey provider with alias
  `siliconflow` and chat transport `https://api.siliconflow.com/v1/chat/completions`.
  It also has `validateUrl` and `modelsFetcher` set to `https://api.siliconflow.com/v1/models`
  and `passthroughModels: true`. It declares no `serviceKinds`, no rerank model and no
  `rerankConfig`.
- `handlers/rerankCore.js` `deriveRerankUrl` derives
  `https://api.siliconflow.com/v1/rerank` from the chat transport, the same endpoint as
  the source. The existing executor sends
  `{ "Content-Type": "application/json", Authorization: "Bearer <key>" }`, the same
  headers as the source and the staged adapter. Both points are asserted in the test
  file. This corrects the inventory's "no derivable local rerank config".
- `src/sse/handlers/modelKind.js` `modelKindError`: the reranker IDs are unknown to the
  registry entry. Untyped or unknown IDs remain dispatchable, so
  `siliconflow/Qwen/Qwen3-Reranker-8B` already reaches the generic core today, unless a
  custom or synced row declares another kind. The catalog does not advertise them as
  rerank models.
- The generic core is not envelope-equivalent. It forwards the caller body verbatim
  (`{...body, model}`), so the source `top_n` and `return_documents` defaults are not
  applied. It relays the raw upstream body and does not validate the output. The
  remaining delta is the catalog metadata (models, serviceKind, rerankConfig), the
  source request envelope and a validated response. The URL and auth are already
  equivalent.
- Discovery: the existing `modelsConfig.js` / `providerModelsConfig.js`
  `siliconflow: createOpenAIModelsConfig("https://api.siliconflow.com/v1/models")` and
  the registry `modelsFetcher` already match the source. No second production discovery
  is needed. The staged discovery adds a bounded transport, safe-ID validation and
  catalog-only capability claims.

All searches were checkout-only rg/git reads. No live provider calls.

## Supported subset and contracts

Exports: immutable `rerankConfig`, `rerankModels` and `siliconflowRerankMetadata`; the
`siliconflowRerankAdapter` builders and normalizer; `handleSiliconflowRerankNative`; and
`discoverSiliconflowModels`. `handleSiliconflowRerankNative` returns the existing
`handleRerankCore` result shape (success, status, Response, accounting) or an error
result plus `acceptedJob`.

Request subset:

- a non-empty query;
- 1–1024 documents, each a string or `{text}`;
- the query and each document are at most 20,000 characters;
- `top_n` is an integer from 1 to documents.length;
- `return_documents` is a boolean.

Anything else is refused before submission. That includes `rank_fields`, structured
documents, media and `stream`. It also includes SiliconFlow's own extras
(`instruction`, `max_chunks_per_doc`, `overlap_tokens`), which the source simply
passes through. Those extras are not claimed as supported. The wire body is exactly
the source envelope. Model IDs keep vendor slashes. Schemes, traversal, escapes, query
strings, fragments, empty segments and whitespace are refused. Custom safe IDs are
allowed, but they claim no capability.

Response:

- It requires a `results` array of 1..top_n rows with unique, in-range integer indices
  and finite scores.
- Rows are sorted by score, descending, with ties kept stable by index.
- Document text is rebuilt from the caller's originals, never from the upstream echo.
- A safe upstream `id` is kept. Otherwise the module uses a local `rerank-<ts>` id.
- Only numeric `usage` token/USD fields are kept. Upstream `meta.tokens` and
  `meta.billed_units` are not mapped into a receipt, and no synthetic `billed_units`
  are added. Unknown cost stays null/unknown.

**Intentional difference from the source:** the source relays the upstream body and
error message unchanged. The staged module never relays upstream bodies, messages or
parser errors.

Transport:

- It uses the local `proxyAwareFetch` with the selected connection's proxy options.
- Auth is the `apiKey`, falling back to the `accessToken`, sent as a bearer token.
  Missing or header-unsafe keys fail before any network call.
- It calls a fixed HTTPS origin with `redirect: "manual"`. It refuses redirects and
  foreign or redirected responses, and it fetches no result URLs.
- Each call makes one submission. There is no retry, refresh, replay or failover, and
  401/403 responses never change credentials.
- The total deadline defaults to 30 s, with a 60 s maximum. It covers both the headers
  and the body read.
- Body reads are capped at 8 MiB for success and 16 KiB for errors.
- Abort and deadline end every wait and abort both the fetch and the body reader, even
  when a transport ignores the signal. Late responses are discarded.

Cancellation before send and proven non-connects are not accepted work. These outcomes
carry `acceptedJob` with honest unknown cost and the selected connection id:

- uncertain network failures;
- 5xx responses;
- foreign responses;
- answers that completed but were unread or unusable.

Quota (402, or 403/429 with a quota code) is scoped to the selected credential. A 429
response uses the existing Retry-After rate-limit evidence.

Discovery uses `GET https://api.siliconflow.com/v1/models` with the same bounded
transport. It accepts a bare array, a `data` list or a `models` list. Each row id is
`id || model || name`, and an unsafe id rejects the whole catalog. Only the four pinned
models claim the `rerank` serviceKind. Pricing and free-tier evidence is not kept, and
discovery failures carry no `acceptedJob`.

This is a synchronous API. It has no async jobs, polling, artifacts, WebSocket or
browser contracts.

## Registration handoff

`registration.json` records the exports, IDs/alias, models, serviceKind, endpoints/auth,
envelope and integration points. At serial registration:

- add `serviceKinds` to `registry/siliconflow.js`. It declares none today, so include
  `llm` together with `rerank`;
- add the four `kind: "rerank"` models and `rerankConfig` from
  `siliconflowRerankMetadata`. Preserve the transport, `validateUrl`, `modelsFetcher`,
  `passthroughModels` and the chat models;
- in `rerankCore.js`, dispatch `handleSiliconflowRerankNative` before the generic
  derive/passthrough path;
- update the catalog docs.

The isolated staging block in the test file is the only place that asserts the
unregistered state. All protocol, security, usage and equivalence assertions work
independently of registration.

## Focused evidence

Dependencies were installed in root, cli and tests with frozen lockfiles and
`--prefer-offline`. No previous committed candidate exists for this unit; attempt `a1`
is the first. The implementation reuses the reviewed Together staging contract, adapted
to the SiliconFlow source fields.

```sh
cd tests && test -f unit/native-siliconflow-rerank.test.js && node node_modules/vitest/vitest.mjs run unit/native-siliconflow-rerank.test.js --maxWorkers=2
pnpm exec eslint open-sse/services/providerParity/native-siliconflow-rerank/*.js tests/unit/native-siliconflow-rerank.test.js
pnpm run lint:anti-slop
```

Result: 104 focused tests passed, and the scoped ESLint run passed. The anti-slop gate
passed with 0 diagnostics; its regenerated bundle was restored and is not part of this change. No full suite,
baseline changes, live accounts, paid APIs, browser, Docker or deploy.
