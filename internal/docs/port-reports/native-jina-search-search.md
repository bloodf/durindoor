# Jina Search native search — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-jina-search-search/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/searchRegistry.ts`: enabled `jina-search` entry — `id: "jina-search"`,
  `baseUrl: "https://s.jina.ai"`, `method: "POST"`, `authType: "apikey"`,
  `authHeader: "bearer"`, `costPerQuery: 0.002`, `freeMonthlyQuota: 1000`,
  `searchTypes: ["web"]`, `defaultMaxResults: 5`, `maxMaxResults: 50`,
  `timeoutMs: 15000`, `cacheTTLMs: 300000`. `SEARCH_CREDENTIAL_FALLBACKS` maps
  `jina-search` to `jina-ai`. `SEARCH_PROVIDER_ALIASES` maps `jina-ai` and `jina` to
  `jina-search` for `/v1/search` requests only (the source comment warns that a global
  remap broke the Foundation `jina-ai` card).
- `open-sse/handlers/search/jinaSearch.ts`: `buildJinaSearchRequest` POSTs JSON
  `{ q, num, gl?, hl?, page? }` to `baseUrl + "/"` with `Content-Type` and `Accept`
  `application/json` and `Authorization: Bearer <token>`; `page` is the raw `offset`
  when it is greater than 0. `extractJinaSearchItems` reads a bare array, `data` or `results`.
- `open-sse/handlers/search.ts`: `normalizeJinaSearchResponse` maps `title`, `url`,
  `description || snippet`, and `content || text` as markdown full text.
- `src/shared/validation/schemas/apiV1.ts`: query 1..500 characters, `max_results` 1..100,
  `offset` >= 0, `country` max 2 characters (upper-cased), `language` 2..5 characters.
- The source has no dynamic model discovery for search providers; the provider is the model.

Fetched `origin/main` on 2026-11-27 (`e183a6945892866e518309161b22db09107d88dd`); local HEAD
`339db53c6273754d5aef785040bd3af8bfa5e092`. Both have the same search handler, `jina-ai`,
`jina-reader` and search route. This compared wire behavior, not only names:

- No `jina-search` provider exists. `registry/jina-ai.js` (alias `jina`) is embedding-only at
  `api.jina.ai/v1/embeddings`; `registry/jina-reader.js` is webFetch at `r.jina.ai`. Neither
  has a `searchConfig` or a `webSearch` serviceKind, so `/v1/search` with `jina` resolves to
  `jina-ai` and fails with "does not support web search".
- `open-sse/handlers/search/callers.js` has no `jina-search` builder. Its generic fallback
  would POST `{ query, max_results, search_type }`, not the source `{ q, num }` envelope.
  `normalizers.js` has no normalizer, so it would return zero results. The test file
  asserts both gaps.
- Result: the delta is a real missing native search path, not an equivalent.

## Staged implementation

`config.js` (exact registry fields, request-only aliases, credential fallback, a new provider
definition), `adapter.js` (request/headers/normalizer), `service.js` (one bounded submit plus a
static model list), `index.js`, `registration.json`.

Supported subset:

- `search_type` `web` only; `query` after local normalization (control bytes refused, NFKC,
  whitespace collapse) 1..500 characters.
- `max_results` positive integer clamped to 50 like the source; default 5.
- `country` two letters (upper-cased to `gl`), `language` 2–3 letters with an optional short
  region (`hl`), `offset` 0..100 forwarded verbatim as `page` (source mapping).
- `provider`/`model` may name `jina-search`, `jina-ai`, `jina` or `<id>/search`.
- Response: the local search envelope `{ provider, query, results, answer: null,
  usage: { queries_used: 1, search_cost_usd: 0.002 }, metrics, errors }`. Each result is built
  in the local `makeResult` shape from validated items; `provider_raw` is never filled.

Restrictions and intentional differences from the source:

- The source silently drops `time_range`, `domain_filter`, `content_options`,
  `provider_options` and non-web types. These are refused with 400 before any network call
  unless empty or `time_range: "any"`.
- Fixed origin `https://s.jina.ai/`; caller or connection base URL overrides are not honored.
  `redirect: "manual"`; 3xx and foreign response origins are refused.
- Result URLs must be public `http(s)` without userinfo (local `isBlockedHost`). Unsafe or
  malformed items are dropped and counted in `errors: [{ code: "unsafe_results_dropped" }]`.
  Text fields lose control bytes and are length-bounded. Result links are returned, never
  fetched.
- Upstream error messages and bodies are never relayed (the source relays them).
- Deadlines: 15s default, 60s maximum per call. An optional absolute `deadlineAt` bounds the
  total. Body reads are bounded to 8MiB on success and 16KiB on error, and share the deadline.
- No streaming, answer synthesis, polling, browser or WebSocket protocol.

## Security, usage and failure contracts

- Auth: `Bearer` from the selected connection (`apiKey`, then `accessToken`); keys with
  non-visible bytes are refused before network. No refresh, cache, mutation or failover; the
  connection id is recorded in `accounting.meta.connectionId`.
- Usage: Jina has no USD receipt. `meta.usage.tokens` is recorded as
  `nativeUnits.jina_tokens` with `meta.nativeUnitsSource`; ledger cost stays `unknown`. The
  envelope's `search_cost_usd` is the listed registry rate, as every local search provider reports.
- 402, or 403/429 with `InsufficientBalanceError`/quota codes, becomes 402 `quotaExhausted`.
  401/403 becomes "credentials refused". 429 carries `Retry-After` evidence. Other 4xx statuses
  pass through with a generic message.
- Uncertain work is never replayed. Exactly one submit is made. 5xx, a post-send socket error,
  caller abort, deadline, a redirect or foreign origin carry `acceptedJob`
  (`costSource: "accepted-job"`, `jobState: submit-unknown`). A stalled body is
  `completed-unread`; an unusable 2xx is `completed-unusable`. A DNS or connect failure
  (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) and pre-send
  validation carry none.

## Registration handoff

See `registration.json` `integration`: add the provider definition as a new
`registry/jina-search.js`, dispatch `handleJinaSearchNative` from `handleSearchCore` for
`jina-search`, apply `jina-ai`/`jina` as `/v1/search`-only aliases without changing
`resolveProviderId`, and select credentials from `jina-search` and then `jina-ai` while keeping
the selected connection's quota scope. The only unregistered assertions live in the isolated
"private staging registration" block of `tests/unit/native-jina-search-search.test.js`.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-jina-search-search.test.js --maxWorkers=2
```

65 tests pass with closed mocks only (no live provider, browser or paid API). ESLint is clean
on the staged directory and the test file.
