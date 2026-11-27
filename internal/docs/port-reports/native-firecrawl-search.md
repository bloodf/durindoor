# Firecrawl native search — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-firecrawl-search/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/searchRegistry.ts`: enabled `firecrawl` entry — `id: "firecrawl"`,
  `baseUrl: "https://api.firecrawl.dev/v2/search"`, `method: "POST"`,
  `authType: "apikey"`, `authHeader: "bearer"`, `costPerQuery: 0.002`,
  `resultBlockSize: 10`, `freeMonthlyQuota: 1000`, `searchTypes: ["web", "news"]`,
  `defaultMaxResults: 5`, `maxMaxResults: 100`, `timeoutMs: 30_000`, `cacheTTLMs: 300000`.
- `open-sse/handlers/search/firecrawlSearch.ts` (wired from `open-sse/handlers/search.ts`
  builder/normalizer maps): body `{ query, limit, sources: [web|news], country (lowercase),
  lang, tbs (qdr:d/w/m/y), includeDomains, excludeDomains }`, `Authorization: Bearer <token>`;
  response buckets `data.web` / `data.news` with field precedence
  title→metadata.title, url→metadata.sourceURL→link,
  description→snippet→markdown[:300]→content[:300], date→published_at→metadata.publishedTime.
- `open-sse/handlers/search/reportedCost.ts` `computeSearchCostUsd`: `costPerQuery` per
  started block of `resultBlockSize` returned results, at least one.

Local (`HEAD 7fec87b11c`, `origin/main e183a69458`, identical for these paths):
`open-sse/providers/registry/firecrawl.js` has `serviceKinds: ["webFetch"]` and
`fetchConfig` for `https://api.firecrawl.dev/v2/scrape` only — a different endpoint and
envelope. There is no `searchConfig` or `searchViaChat`, `open-sse/handlers/search/callers.js`
and `normalizers.js` have no firecrawl builder/normalizer, and `/v1/search` with
`provider: "firecrawl"` returns "does not support web search". `firecrawl_custom` is a
self-hosted webFetch provider, not a search equivalent. No alias maps another ID to
Firecrawl search. The full delta is therefore missing, and it is staged here.

## Supported subset

- `POST https://api.firecrawl.dev/v2/search` only, fixed origin, `redirect: "manual"`;
  3xx and foreign-origin responses are refused.
- Bearer from the selected connection's `apiKey`, then `accessToken`; no refresh, cache,
  replay or failover. Two connections never share state.
- Local `/v1/search` core body: `query` (NFKC/whitespace-normalized, ≤2000 chars, no
  control bytes), `max_results` 1..100 (default 5), `search_type` web|news, `country`
  ISO-2, `language`, `time_range` any|day|week|month|year, `domain_filter` (≤50 valid
  hostnames, `-` prefix excludes).
- Response rebuilt into the local unified `SearchResult` shape (`makeResult` in
  `open-sse/handlers/search/normalizers.js`), envelope identical to `handleSearchCore`'s
  `data`. Result and image URLs must be http(s), carry no userinfo and name a public host
  (`isBlockedHost` from `src/shared/utils/ssrfGuard.js`); otherwise the hit is dropped and
  counted in `errors`. Titles and snippets are stripped of control bytes and length-bounded.
- Accounting: cost stays `unknown`; `nativeUnits.operations` is the returned-result block
  count (the public handler's existing `costPerQuery × operations` estimate then equals the
  source price); Firecrawl `creditsUsed` is kept as `nativeUnits.credits` and never read as
  USD. `usage.search_cost_usd` is the source list-price estimate.
- Deadline: 30s default and maximum per call. The caller's signal and the deadline abort
  the socket and the body read. Success bodies are capped at 4MiB, error bodies at 16KiB.
- Errors: 402 (or 403 with a credit/quota code) → 402 `quotaExhausted`; 429 → rate-limit
  evidence with `Retry-After`; other 4xx keep their status; 5xx, interrupted or unread
  submissions and malformed 2xx envelopes return `acceptedJob` (`submit-unknown`,
  `completed-unread` or `completed-unusable`) and are never resubmitted. Upstream messages
  and bodies are never relayed. A send that fails at DNS or connect time is not marked
  accepted.

## Intentional differences from the source

- The source's `FIRECRAWL_BASE_URL` env and the caller's or connection's `baseUrl` overrides
  are not ported. Self-hosted Firecrawl stays on `firecrawl_custom`, and the operator key
  never leaves the hosted origin. `provider_options` must be absent or empty.
- The source silently drops `offset`, `content_options`, unknown search types and unknown
  time ranges. Here they are refused with 400 before submission, as are non-integer or
  out-of-range `max_results` (the source clamps).
- The source returns an empty list for an unrecognized `data` shape. Here a missing,
  array-shaped (v1) or `success: false` envelope is a 502 `completed-unusable`.
- There is no `scrapeOptions`/markdown content, no `images` source, no streaming, no
  polling, no browser and no WebSocket. Firecrawl search has no models, so there is no
  dynamic discovery endpoint.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-firecrawl-search.test.js --maxWorkers=2
```

13 tests pass. The closed mocks cover the exact URL, headers and body, news and filter
mapping, normalization precedence, block pricing, two credentials, pre-send rejection,
quota and rate limits, redirect and foreign-origin refusal, abort, the deadline, uncertain
submission without replay, and dropping unsafe output. The unregistered-state assertions
are isolated in the final `describe` block. `npx eslint` on the staged directory and the
test is clean.
