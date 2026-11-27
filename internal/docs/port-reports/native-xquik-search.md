# Xquik X Search native search — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-xquik-search/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/searchRegistry.ts`: enabled `xquik-search` entry — `id: "xquik-search"`,
  `name: "Xquik X Search"`, `baseUrl: "https://xquik.com/api/v1/x/tweets/search"`,
  `method: "GET"`, `authType: "apikey"`, `authHeader: "x-api-key"`, `costPerQuery: 0.00075`,
  `freeMonthlyQuota: 0`, `searchTypes: ["x"]`, `defaultMaxResults: 5`, `maxMaxResults: 20`,
  `timeoutMs: 15_000`, `cacheTTLMs: 300_000`, `fallbackOnly: true`.
  `SEARCH_PROVIDER_ALIASES` maps `xquik` and `xquik_search` to `xquik-search`. The registry
  key is the canonical id; no alias was invented.
- `open-sse/handlers/search/xquikSearch.ts` (dispatched from `open-sse/handlers/search.ts`
  `requestBuilders` / `responseNormalizers`): `GET <baseUrl>?q&queryType&limit[&sinceTime]`
  with `Accept: application/json` and `x-api-key: <token>`. `queryType` is `"Top"` only when
  `provider_options.queryType` or `providerSpecificData.queryType` is `"Top"`, else `"Latest"`.
  `time_range` `hour|day|week|month|year` becomes `sinceTime = now - duration` (ISO).
  Response `tweets[]` rows that pass `XquikTweetSchema` (numeric `id`, string `text`, optional
  `createdAt`, optional `author.username` matching `^[A-Za-z0-9_]{1,15}$`) become
  `{ title: "@user" | "X post", url: https://x.com/<user>/status/<id> | https://x.com/i/status/<id>,
  snippet: text, author, published_at: createdAt, source_type: "x" }`.
- `src/shared/constants/providers/search.ts`: catalog entry (`alias: "xquik"`, `icon: "tag"`,
  `#111827`, `XQ`, `https://docs.xquik.com`, `serviceKinds: ["webSearch"]`, authHint
  "metered per returned post; the catalog estimate uses 5 results").
- `src/lib/providers/validation/searchProviders.ts`: key validator is
  `GET …/tweets/search?q=test&limit=1` with the same two headers.
- `src/lib/search/executeWebSearch.ts` and `v1SearchSchema`: canonicalize the aliases and
  force `search_type: "x"` for this provider.
- `tests/unit/xquik-search-provider.test.ts`: fixture reused verbatim in the local test.

Local checkout: HEAD `fb66767e7c` and fetched `origin/main` `e183a69458` (2026-11-27)
were both checked. `git grep -i -E "xquik|tweets/search"` over `open-sse` and `src` has no
hits in either. No local provider, alias, builder, normalizer or validator exists. Local
`handlers/search/callers.js` / `normalizers.js` have no GET `x-api-key` tweet builder.
The generic fallback would send a different request. The only local X search is the
`x_search` Responses tool in `executors/xai.js` and `executors/grok-cli.js`, which is a chat
tool on another endpoint, auth and envelope, not an equivalent.

An earlier attempt exists outside main (`f0a6d35818`, "feat(search): add Xquik as an X
search provider", only on unrelated `orq/tornf6/*` branches). It edits the shared registry
and handlers. That is out of scope for staging, and it was not carried forward. Its key
validation uses a credits endpoint that the pinned source does not use.

So the delta is the whole native contract. It is staged here.

## Supported subset

- `GET https://xquik.com/api/v1/x/tweets/search` only. The origin and path are fixed.
  Caller input only enters the encoded query string. `redirect: "manual"` is set. Any 3xx,
  `redirected` response or foreign `response.url` is refused.
- `x-api-key` from `apiKey`, then `accessToken`, of the selected connection. Proxy options
  come from `resolveCredentialProxyOptions(credentials)`. One connection per call, with no
  refresh. The connection's `providerSpecificData.queryType` (`Top`) is honored as a default.
- Request fields: `query` (trimmed, X operators and quotes preserved, no control
  characters, at most 2000 chars), `max_results` (positive integer, clamped to 20, default
  5), `search_type` `"x"` (`"web"` is canonicalized to `"x"` as the source route does),
  `time_range` (`hour|day|week|month|year`), `provider_options.queryType`
  (`Latest|Top`), and `provider` (an Xquik spelling).
- Output: the local `handleSearchCore` success shape `{ provider: "xquik-search", query,
  results, answer: null, usage, metrics, errors: [] }`. Each result follows the local
  `normalizers.js` `makeResult` shape with `metadata.source_type: "x"`,
  `metadata.author`, `content: null` and `provider_raw: null`.

## Intentional deviations from the source

- Fields the source silently ignores are refused with 400 before any billable submission:
  `country`, `language`, `offset`, `domain_filter`, `content_options`, `cursor`, `stream`,
  unknown `provider_options` keys, and unknown fields. Also refused: a `queryType` other
  than `Latest`/`Top` (the source maps it to `Latest`), an unknown `time_range` (the source
  drops it), and `search_type: "news"`.
- Citations are always rebuilt on `x.com` from a validated id and handle. Upstream URLs
  are never used, so result SSRF is not possible. Rows are skipped when the id is longer
  than 25 digits, the text is over 100k chars or has control characters, or `author` is
  not an object with a valid handle. A non-ISO `createdAt` becomes `null`. Results are
  capped to the requested `limit`.
- A non-object envelope, an `error` member, a missing or non-array `tweets`, or more than
  1000 rows is malformed. It returns 502 with `acceptedJob` (`completed-unusable`). The
  source defaults `tweets` to `[]` and reports an empty success.
- Upstream error bodies are never relayed. Errors are fixed messages: 401/403 →
  "credential refused"; 402, or 403/429 with an error code `insufficient_credits`,
  `insufficient_quota`, `quota_exceeded`, `credit_limit`, `no_credits` or
  `payment_required` → 402 with `quotaExhausted: true`; other 429 → rate-limit evidence
  and `Retry-After`; 5xx → 502 with `acceptedJob` (`submit-unknown`).
- Pagination is not exposed: `has_next_page` and `next_cursor` are dropped.

## Accounting

Xquik returns no usage receipt and meters per returned post. `accounting` stays
`costStatus: "unknown"` with `meta.connectionId`, `meta.registryCostPerQueryUsd: 0.00075`,
`meta.returnedPosts` and `meta.queryType`. `data.usage.search_cost_usd` is the source
handler value (`config.costPerQuery`, the 5-result catalog estimate). It is not a receipt.

## Deadlines, cancellation and replay

- 15 s default and maximum total deadline (source `timeoutMs` and the local search
  `GLOBAL_TIMEOUT_MS`). It covers the send and the bounded body read: 8 MiB on success,
  16 KiB on error.
- A caller `AbortSignal` aborts the socket (499). The deadline aborts it too (504).
- Exactly one GET. A lost GET may already have been metered. Any failure after the request
  may have reached Xquik (abort, deadline, reset, 5xx, redirect, foreign origin, unusable
  body) returns `acceptedJob` with `costSource: "accepted-job"` and is never resent.
  Pre-connect failures (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`,
  `UND_ERR_CONNECT_TIMEOUT`) and requests cancelled before send carry no `acceptedJob`.
- No discovery endpoint exists for this provider in the source (no model list), so
  `endpoints.discovery` is `null`. The source key validator is exported as
  `xquikValidationProbe` metadata only. It is a real metered search and is never called here.

## Remaining restrictions

- Unregistered. Registration adds `registry/xquik.js` from
  `xquikSearchProviderDefinition` with the `xquik`/`xquik_search` aliases, dispatch from
  `handlers/search/index.js`, and route canonicalization that forces `search_type: "x"`.
  The local search UI and handlers only know `web`/`news`, so `x` must be added there. The
  provider stays fallback-only and is never auto-selected for `web`. Catalog docs and the
  icon are updated at that time.
- X post search only. No answer synthesis, streaming, media, pagination or result caching
  (`cacheTTLMs` is metadata for the registering dispatcher).

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-xquik-search.test.js --maxWorkers=2
# 24 passed
npx eslint --no-warn-ignored open-sse/services/providerParity/native-xquik-search tests/unit/native-xquik-search.test.js
# exit 0
node scripts/check-anti-slop.mjs
# 0 diagnostics
```

Tests use closed `fetchImpl` mocks only. They assert the exact URL, query parameters,
headers, absent body and proxy options; `queryType`/`sinceTime`/limit mapping; normalization
of the source fixture; schema-failing, unsafe and malformed outputs; 401, quota,
rate-limit and 5xx mapping; isolation of two credentials and their settings; pre-send
refusal of unsupported inputs and credentials; caller abort, deadlines, no replay, redirect
and foreign-origin refusal. Unregistered-state checks are isolated in the final
`staging state` block.
