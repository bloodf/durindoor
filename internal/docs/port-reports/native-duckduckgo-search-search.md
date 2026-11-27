# DuckDuckGo free native search — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-duckduckgo-search-search/registration.json`.
The unit label "duckduckgo-search" is only a work identifier: the canonical identity is
`duckduckgo-free`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/searchRegistry.ts`: enabled `duckduckgo-free` entry — `id:
  "duckduckgo-free"`, `name: "DuckDuckGo (free)"`, `baseUrl:
  "https://lite.duckduckgo.com/lite/"`, `method: "POST"`, `authType: "none"`,
  `authHeader: "none"`, `costPerQuery: 0`, `freeMonthlyQuota: 999999`, `searchTypes:
  ["web"]`, `defaultMaxResults: 5`, `maxMaxResults: 25`, `timeoutMs: 10_000`,
  `cacheTTLMs: 300000`, `fallbackOnly: true`. Alias map: `duckduckgo: "duckduckgo-free"`.
- `open-sse/handlers/search.ts`: `tryProvider` dispatches `duckduckgo-free` to
  `tryDuckDuckGoFreeProvider` (HTML path, not the generic JSON path); success envelope
  `{ provider, query, results, answer: null, usage: { queries_used: 1, search_cost_usd: 0 },
  metrics, errors: [] }`; any failure is a 502 with the error message.
- `open-sse/services/freeWebSearch.ts`: `POST` form `q=<query>`, headers
  `Content-Type: application/x-www-form-urlencoded`, a Chrome `User-Agent`, `Accept:
  text/html`, public-only guard, `allowRedirect: false`; `parseDuckDuckGoLite` bounded
  regex parser (result-link anchors aligned to result-snippet cells, uddg decode,
  http(s)-only URLs, entity/tag stripping).

Local HEAD `339db53c62` and `origin/main` `e183a69458` (fetched 2026-11-27): `git grep`
finds no `duckduckgo-free` or `lite.duckduckgo` under `open-sse/` or `src/`. The local
search dispatcher (`open-sse/handlers/search/index.js` + `callers.js` builders) has no
builder for this id and only parses JSON, so it cannot serve the lite HTML endpoint. The
local `duckduckgo-web` provider is DuckDuckGo AI Chat (`serviceKinds: ["llm"]`,
`duckchat/v1/chat`, aliases `ddgw`/uiAlias `ddg`) — a different endpoint, envelope and
service, not an equivalent. The source alias `duckduckgo` is unused locally. There is no
dynamic model discovery in the source for this provider.

## Staged contract

- `config.js`: exact registry fields, alias, fixed origin/URL/User-Agent, and the missing
  provider definition (no-auth, `serviceKinds: ["webSearch"]`, `searchConfig`).
- `adapter.js`: input validation, exact request builder, source parser with local
  hardening, unified `SearchResult` normalization (local `normalizers.js` shape).
- `service.js`: `handleDuckDuckGoFreeSearchNative` returns the local `handleSearchCore`
  result shape (`success`, `status`, `data`, `accounting`, `response`) or a
  `createErrorResult` failure, plus `acceptedJob` for uncertain outcomes.

## Supported subset and restrictions

- `search_type: "web"` only. `country`, `language`, `time_range`, `offset`,
  `domain_filter`, `content_options`, `provider_options` must be absent, null or empty;
  the source ignored them silently, staging rejects them with 400 before any request.
- Query sanitized like local `sanitizeQuery` (control chars rejected, NFKC, whitespace
  collapsed) and bounded to 2000 characters. `max_results` integer 1..100, clamped to 25.
- Deadline 10 s default (source `timeoutMs`), 15 s maximum (local global search timeout);
  caller abort and deadline abort the socket and the body read.
- Redirects are sent `manual` and refused; a response whose final URL is not
  `https://lite.duckduckgo.com` is refused.
- Body bounds: 1 MiB success, 16 KiB error; parser input truncated to 256 KiB as in the
  source. Empty or non-`text/html` 200 bodies are `completed-unusable`, not empty success.
- Result URLs: http(s) only (source), plus local hardening — userinfo, literal
  internal/loopback/metadata hosts (`isBlockedHost`) and URLs over 2048 characters are
  dropped; `&amp;` in hrefs is decoded.

## Intentional deviations from the source

- 429, HTTP 202 and DuckDuckGo's anti-bot anomaly page surface as 429 `rateLimited`
  (with Retry-After evidence) instead of the source's empty success or generic 502.
- 5xx, a foreign final origin, a lost socket after send, deadline expiry and an unusable
  200 carry `acceptedJob` (`costSource: "accepted-job"`, `jobState`, `connectionId`).
  Nothing is retried or replayed. Unsent DNS/refused connections are plain failures.
- Upstream bodies and error messages are never relayed (the source relayed the message).
- No credential is ever sent (`authType: "none"`). The selected no-auth connection only
  chooses proxy options and accounting scope.
- Accounting reports `costStatus: "unknown"` with `nativeUnits.operations: 1`; no upstream
  receipt exists. The route's existing `costPerQuery` (0) pricing decides any estimate.
  No quota exhaustion is claimed.
- `fallbackOnly` auto-selection is route policy and is not wired at staging.

## Registration handoff

1. Add `open-sse/providers/registry/duckduckgo-free.js` from
   `duckduckgoFreeProviderDefinition` and its `index.js` entry.
2. In `handleSearchCore`, dispatch `handleDuckDuckGoFreeSearchNative` for
   `duckduckgo-free` before `tryDedicatedProvider`.
3. Promote the isolated staging block in the test to strict registered identity
   assertions; update catalogs and icons.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-duckduckgo-search-search.test.js --maxWorkers=2
```

20 tests pass (three consecutive runs); eslint and oxlint report no issues on the
staged directory and test. All tests use closed mocks; no live provider, browser or
WebSocket is involved.
