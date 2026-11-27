# Codex Web Search native search — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-codex-search-search/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/searchRegistry.ts`: enabled `codex-search` entry — `id: "codex-search"`,
  `baseUrl: "https://chatgpt.com/backend-api/codex/responses"`, `method: "POST"`,
  `authType: "apikey"`, `authHeader: "bearer"`, `costPerQuery: 0`, `freeMonthlyQuota: 0`,
  `searchTypes: ["web","news"]`, `defaultMaxResults: 5`, `maxMaxResults: 10`,
  `timeoutMs: 60_000`, `cacheTTLMs: 600_000`, `fallbackOnly: true`.
  `SEARCH_CREDENTIAL_FALLBACKS["codex-search"] = ["codex"]`;
  `SEARCH_PROVIDER_ALIASES.codex_search = "codex-search"` (and `codex` is deliberately not
  an alias).
- `open-sse/handlers/search.ts`: `config.id === "codex-search"` dispatches
  `executeCodexSearch`; the global timeout default rises to the 60s registry value for this
  provider only.
- `open-sse/handlers/search/codexSearch.ts`: the wire contract — Codex identity headers,
  bearer token, optional `chatgpt-account-id`, a streamed Responses body with
  `tool_choice: "required"` `web_search`, SSE snapshot parsing, grounding, and error
  classification.
- `src/shared/constants/providers/search.ts`: catalog entry ("Codex Web Search (ChatGPT)",
  alias `codex_search`, `CS`, `#10A37F`, `serviceKinds: ["webSearch"]`).
- `src/app/api/v1/search/route.ts`: credentials resolve through the `codex` provider, and
  a `web_search`-scoped model lock gates the selected connection.
- `tests/unit/codex-search-provider.test.ts`: helper builders and grounding cases reused.

Local checkout HEAD `4a3934723d` and fetched `origin/main` `e183a69458` were both checked
with `git grep -i -e codex-search -e codex_search -e codexSearch` over `open-sse` and `src`.
Neither has any hit. Nearest local code, not equivalent:

- `src/sse/handlers/codexAlphaSearch.js` posts a caller-supplied native SearchRequest to
  `https://chatgpt.com/backend-api/codex/alpha/search` (JSON in/out, `output`/`results`).
  The endpoint, envelope and route (`/backend-api/codex/alpha/search` vs `/v1/search`)
  differ. It does supply the search-only cooldown scope `websearch:codex`, which this
  staging reuses as its lock key.
- `open-sse/providers/registry/codex.js` targets the same `codex/responses` URL as a chat
  transport. It has no `searchConfig` and no `searchViaChat`. `handlers/search` has no
  Codex builder, normalizer or chat wrapper.

## Supported subset

- Request: `query` (NFKC, trimmed, collapsed, ≤2000 chars, no control characters),
  `provider` (`codex-search` / `codex_search`), `max_results` (positive integer, clamped
  to 10), `search_type` `web`|`news`, `time_range` `any|day|week|month|year`,
  `domain_filter` (≤20 hostnames, `-` prefix excludes), and `provider_options.model` /
  `provider_options.reasoning_effort`.
- Wire body (field order kept): `{ model, instructions, input: [{ role: "user", content:
  [{ type: "input_text", text }] }], tools: [{ type: "web_search" }], tool_choice:
  "required", include: ["web_search_call.action.sources"], reasoning: { effort },
  stream: true, store: false }`. The `news`, time and domain values are instruction hints
  only, as in the source.
- Model: `provider_options.model`, then the connection's `providerSpecificData.searchModel`,
  then `gpt-6-luna`. Effort: `low|medium|high|xhigh`. `minimal`/`none` clamp to `low` as
  the source does (the source fixture shows upstream rejects `web_search` with `minimal`).
- Headers: `User-Agent: codex_cli_rs/<codex cliVersion>`, `originator: codex_cli_rs`,
  `Version: <codex cliVersion>`, `Authorization: Bearer <apiKey || accessToken>`,
  `Content-Type: application/json`, `Accept: text/event-stream`, and
  `chatgpt-account-id` when the connection has one.
- Response: final SSE snapshots only (`response.output_item.done`,
  `response.output_text.done`, `response.completed`). Model JSON rows survive only when
  their host+path was observed in a `web_search_call` source/`open_page` or a
  `url_citation`. Otherwise the result falls back to annotations, then to observed
  sources. Rows are deduped by host+path, `utm_source` is stripped, and output is capped at
  `min(10, max_results)`. `queries_used` = `tool_usage.web_search.num_requests`, or else
  the `web_search_call` count.
- Accounting: tokens come from `response.usage` via `mediaAccounting`. `costStatus` stays
  `unknown` (subscription quota), `nativeUnits.queries` is set, and `meta` carries
  `connectionId`, `quotaScope: websearch:codex` and the model.

## Intentional deviations from the source

- Refused before submission (the source silently ignores them or throws later):
  unknown fields, `country`, `language`, `offset`, `content_options`, `provider_options`
  keys other than `model`/`reasoning_effort` (including `baseUrl`), unknown effort values,
  unsafe model ids, and malformed domains. Domains are restricted to hostname syntax
  because they are interpolated into the instructions.
- Account id uses the local `resolveCodexAccountId` (workspaceId first, as the source,
  then `chatgptAccountId`/`chatgptWorkspaceId`/`accountId`/id_token), matching the local
  Codex executor.
- Result URLs must classify as public (`classifyHost`). Loopback, private, metadata and
  userinfo URLs are dropped. Titles/snippets with control characters or over 1000/4000
  characters fall back to the hostname or an empty string.
- `upstreamStatus` also reads `error.type`, so typed `usage_limit_reached` errors map
  to 429.
- Fixed origin only: the operator `providerSpecificData.baseUrl` override the source
  honors is not supported, because it would send the Codex OAuth token to that host.
  `redirect: "manual"` with refusal replaces the source's `redirect: "error"`.
  Foreign-origin responses are refused.
- Cooldown is reported, not performed: rate-limit/quota results carry `rateLimited`,
  `quotaExhausted`, `lockKey: "websearch:codex"`, `lockConnectionId` and reset evidence,
  so the caller locks only the search scope (the source caps this at 60s).

## Failure contract

| Case | Result |
| --- | --- |
| invalid input / unsafe credential header | 400 / 401, no fetch |
| caller abort before send | 499, no fetch |
| 401/403 | fixed "credential refused", body never read |
| 429 / 402 | 429, `rateLimited`, `quotaExhausted` when `usage_limit`/quota code, reset evidence |
| other 4xx | fixed "request refused" |
| 5xx, redirect, foreign origin, abort/deadline/socket loss after send | `acceptedJob` `submit-unknown` (never replayed) |
| 200 then stream error / incomplete / malformed / oversized | `acceptedJob` `completed-unusable`; stream 429 also scoped-locked |
| DNS/connect refused before send | plain 502, no `acceptedJob` |

Deadline: 60s default and maximum, applied to both submit and body read. Bodies are capped
at 4 MiB for success and 16 KiB for errors. Upstream messages, bodies and tokens are never
relayed.

## Remaining restrictions

- Unregistered. Integration points (registry file, `handleSearchCore` dispatch, 60s
  provider timeout, `codex` credential resolution with token refresh by the caller,
  explicit-only selection, search-scope lock, catalog) are listed in `registration.json`.
- The adapter does not refresh tokens. The caller passes an already refreshed `codex`
  connection.
- No answer synthesis, no caller streaming, and no model discovery (the source exposes none
  for this provider).
- The source's real-traffic fixtures are not vendored (outside the allowed paths). The
  tests use synthetic SSE built with the source test's helpers and mirror the
  `real_en_ref_param.sse` grounding shape.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-codex-search-search.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 21 passed (21)
node node_modules/oxlint/dist/cli.js -c .oxlintrc.json \
  open-sse/services/providerParity/native-codex-search-search tests/unit/native-codex-search-search.test.js
# exit 0
```
