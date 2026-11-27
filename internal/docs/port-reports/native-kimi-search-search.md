# Kimi Search native search — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-kimi-search-search/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/searchRegistry.ts`: enabled `kimi-search` entry — `id: "kimi-search"`,
  `baseUrl: "https://api.moonshot.ai/v1/tools/search"`, `method: "POST"`,
  `authType: "apikey"`, `authHeader: "bearer"`, `costPerQuery: 0.005` ("per successful
  non-empty call"), `freeMonthlyQuota: 0`, `searchTypes: ["web"]`, `defaultMaxResults: 5`,
  `maxMaxResults: 20`, `timeoutMs: 10_000`, `cacheTTLMs: 300_000`.
  `SEARCH_PROVIDER_ALIASES` maps `kimi` and `moonshot` to `kimi-search`.
- `open-sse/handlers/search/kimiSearch.ts` (dispatched from `open-sse/handlers/search.ts`):
  `Authorization: Bearer <token>`, body `{ text_query, limit: min(maxResults, 20),
  include_content: true }`; response `search_results[]` maps `title`, `url`,
  `snippet || ""`, `date` → `published_at`, `text || undefined` → text content.
  Other fields (`site_name`, `authority`, `icon`, `mime`) are not surfaced.
- `src/shared/constants/providers/search.ts`: catalog entry (`serviceKinds: ["webSearch"]`,
  "Kimi Search", `KM`, `#2563EB`, website `platform.kimi.ai/docs/api/tools-search`).
- `tests/unit/search-kimi-provider.test.ts`: fixture reused verbatim in the local test.

Local checkout: HEAD `7fec87b11c` and fetched `origin/main` `e183a69458` (2026-11-27)
were both checked. Neither has the native endpoint:

- `git grep "kimi-search|tools/search|moonshot.ai/v1/tools"` over `open-sse` and `src` hits
  only an unrelated Nimble website URL.
- `open-sse/providers/registry/kimi.js` has `serviceKinds: ["llm","webSearch"]` and
  `searchViaChat` only. `handlers/search/chatSearch.js` `kimi` sends a **chat completion**
  to `https://api.moonshot.ai/v1/chat/completions` with the `$web_search` builtin tool.
  The endpoint, request envelope (`messages`/`tools` vs `text_query`/`limit`), response
  (assistant text + tool-call citations vs `search_results[]`) and billing (chat tokens vs
  a flat per-call price) all differ. This is a different contract, not an equivalent.
- `handlers/search/callers.js` and `normalizers.js` have no Kimi builder or normalizer.

So the delta is the whole native `/v1/tools/search` contract. It is staged here.

## Alias decision

The source maps `kimi` → `kimi-search` for search routing. Locally, `kimi` is the canonical
LLM provider id, and its `searchViaChat` already serves `/v1/search`. Remapping it would
silently change which wire contract and price an existing `kimi` connection gets. The
staging exports both `KIMI_SEARCH_SOURCE_ALIASES` (`kimi`, `moonshot`) and the safe
`KIMI_SEARCH_ALIASES` (`moonshot` only). `resolveKimiSearchProviderId` accepts all three
spellings when a request has already been routed to this adapter.

## Supported subset

- `POST https://api.moonshot.ai/v1/tools/search` only (fixed constant origin;
  `redirect: "manual"`; any 3xx, `redirected` or foreign `response.url` is refused).
- Bearer `apiKey`, then `accessToken`, from the selected connection; proxy options from
  `resolveCredentialProxyOptions(credentials)`. One connection per call, no refresh.
- Request fields: `query` (NFKC, trimmed, whitespace collapsed, no control characters,
  at most 2000 chars), optional `max_results` (positive integer, clamped to 20, default 5),
  optional `search_type: "web"`, optional `provider` (a Kimi Search spelling).
- Output: the local `handleSearchCore` success shape `{ provider: "kimi-search", query,
  results, answer: null, usage, metrics, errors: [] }`. Each result follows the local
  `normalizers.js` `makeResult` shape with `provider_raw: null`.

## Intentional deviations from the source

- Fields the source silently ignores (`country`, `language`, `time_range`, `offset`,
  `domain_filter`, `content_options`, `provider_options`, and unknown fields) and non-web
  `search_type` values are refused with 400 before any billable submission.
- Result rows without a public `http(s)` URL (checked with local `classifyHost`: loopback,
  private, link-local/metadata, `localhost`; userinfo; other schemes) are dropped.
  Non-string titles, snippets and text become empty. Dates must look like ISO dates.
  Results are capped to the requested `limit`; `total_results_available` counts the
  surfaced rows.
- A non-object envelope, an `error` member, or a missing or non-array `search_results`
  is malformed. It returns 502 with `acceptedJob` (`completed-unusable`). The source
  returns zero results instead.
- Upstream error bodies are never relayed. Errors are fixed messages: 401/403 →
  "credential refused"; 402, or 403/429 with `exceeded_current_quota_error`,
  `insufficient_quota`, `quota_exceeded`, `insufficient_balance`, `insufficient_credits`
  or `credit_limit` → 402 with `quotaExhausted: true`; other 429 → rate-limit evidence
  and `Retry-After`; 5xx → 502 with `acceptedJob` (`submit-unknown`).
- No chat-search fallback. The source and local dispatchers fall back to chat search on
  retriable errors only when a provider has both configs; this provider has none.

## Accounting

Kimi returns no usage receipt. `accounting` stays `costStatus: "unknown"` with
`meta.connectionId`, `meta.registryCostPerQueryUsd: 0.005` and `meta.nonEmpty`.
`data.usage.search_cost_usd` follows the local search contract with the registry list
price, `0.005` for non-empty results and `0` for empty ones (the documented pricing; the
source charges `costPerQuery` on every success).

## Deadlines, cancellation and replay

- 10 s default, 15 s maximum total deadline (the local search `GLOBAL_TIMEOUT_MS`). It
  covers the send and the bounded body read: 8 MiB on success, 16 KiB on error.
- A caller `AbortSignal` aborts the socket (499). The deadline aborts it too (504).
- Exactly one submit. Any failure after the request may have reached Moonshot (abort,
  deadline, reset, 5xx, redirect, foreign origin, unusable body) returns `acceptedJob`
  with `costSource: "accepted-job"` and is never resent. Pre-connect failures
  (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) and requests
  cancelled before send carry no `acceptedJob`.
- No discovery endpoint exists for this provider in the source (no model list). The
  staging declares `endpoints.discovery: null`.

## Remaining restrictions

- Unregistered. Registration adds `registry/kimi-search.js` from
  `kimiSearchProviderDefinition`, the `moonshot` alias, dispatch from
  `handlers/search/index.js`, and the `blockedProviders` check on the resolved id
  (OmniRoute #20276). Catalog docs are updated at that time.
- Web search only. No answer synthesis, streaming, news/images, filters or pagination.
- No result caching (`cacheTTLMs` is metadata for the registering dispatcher).

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-kimi-search-search.test.js --maxWorkers=2
# 23 passed
npx eslint open-sse/services/providerParity/native-kimi-search-search tests/unit/native-kimi-search-search.test.js
# exit 0
```

Tests use closed `fetchImpl` mocks only. They assert the exact URL, headers, body and
proxy options; normalization of the source fixture; unsafe and malformed outputs; 401,
quota, rate-limit and 5xx mapping; two-credential isolation; pre-send refusal of
unsupported inputs and credentials; caller abort, deadline, no replay and redirect
refusal. Unregistered-state checks are isolated in the final `staging state` block.
