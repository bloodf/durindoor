# Z.AI native MCP web search — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; the machine-readable handoff is
`open-sse/services/providerParity/native-zai-search-search/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT). Source attribution:

- `open-sse/config/searchRegistry.ts`: enabled `zai-search` entry — `id: "zai-search"`,
  `name: "Z.AI Coding Plan Search"`, `baseUrl: "https://api.z.ai/api/mcp/web_search_prime/mcp"`,
  `method: "POST"`, `authType: "apikey"`, `authHeader: "bearer"`, `costPerQuery: 0`,
  `freeMonthlyQuota: 0`, `searchTypes: ["web"]`, `defaultMaxResults: 5`, `maxMaxResults: 50`,
  `timeoutMs: 10_000`, `cacheTTLMs: 300000`. `SEARCH_CREDENTIAL_FALLBACKS["zai-search"] = "zai"`.
- `open-sse/handlers/search.ts`: `config.id === "zai-search" && token` dispatches
  `tryZaiMCPProvider` → `zaiSearchExecute`, which runs an `@modelcontextprotocol/sdk`
  `Client` over `StreamableHTTPClientTransport` with `Authorization: Bearer <token>`:
  `initialize` → `notifications/initialized` → `tools/call web_search_prime`
  `{ search_query, search_domain_filter?: includes.join(",") }`. No `count` is sent;
  results are sliced locally to `max_results`. `unwrapZaiContent` parses the joined
  text content as a JSON array, or as a JSON string that encodes the array.
  The timeout is `min(timeoutMs, remaining global)`; abort closes the client.

Fetched `origin/main` on 2026-11-27 (`e183a6945892866e518309161b22db09107d88dd`); local HEAD
`7fec87b11c0360e0477d8a925679fe982103bb33`. Neither differs on `providers/registry/glm.js`,
`handlers/search/` or `src/sse/handlers/search.js`. The checks compared the wire contract,
not only names:

- There is no `zai-search` provider locally. Upstream 9router commit `9dbdca0e5e`
  ("fold zai-search into the glm provider") removed it. `providers/registry/glm.js` now
  has `serviceKinds: ["llm", "webSearch"]` and a `searchConfig` with the **same** URL,
  method, auth, cost, result bounds, timeout and cache TTL as the source entry.
- The wire is **not** equivalent. `handlers/search/callers.js` `buildGlmSearchRequest`
  sends one stateless JSON-RPC `tools/call` with `{ search_query, count }`. It does no
  MCP `initialize`, sends no `Accept: application/json, text/event-stream`, carries no
  `mcp-session-id` or `mcp-protocol-version`, and cannot read an SSE response. It ignores
  `domain_filter`. `normalizers.js` `normalizeGlmSearch` parses the text once and expects
  `{results}`, `{news}` or an array. It does not unwrap the documented double-encoded
  string, so that shape yields zero results.
- `zai` (`providers/registry/zai.js`) has no search config, and the search route
  (`src/sse/handlers/search.js`) has no credential-fallback hook. The source's
  `zai` connection fallback is therefore not reachable locally today.
- The MCP gateway `Z.AI Web Search` preset (`src/lib/mcp/gateway/httpClient.js`)
  reaches the same endpoint, but it is an MCP proxy tied to gateway instances, shared
  sessions and retries. It is not a `/v1/search` provider, so it was not reused.

The delta is the source MCP session contract. This unit stages it without duplicating
the `glm` provider definition. `tests/unit/glm-web-search.test.js` keeps covering the
current stateless path.

## Supported subset

- `POST` to the fixed `https://api.z.ai/api/mcp/web_search_prime/mcp` only. Every step uses
  `redirect: "manual"`; any 3xx, opaque redirect or foreign response origin is refused.
- A fresh session for each call: `initialize` (id 0, protocol `2025-06-18`, client
  `durindoor-search/1.0`). The negotiated version must be in
  `2025-11-25 | 2025-06-18 | 2025-03-26 | 2024-11-05`. Next comes `notifications/initialized`,
  then `tools/call` (id 1). A visible-ASCII `mcp-session-id` of up to 512 bytes and the
  negotiated `mcp-protocol-version` are sent on later posts. Sessionless servers are
  supported.
- Responses may be `application/json` (an object or a batch) or `text/event-stream`. SSE is
  read incrementally, interleaved notifications are skipped, and reading stops at the
  matching response id.
- `search_type` `web` only. `max_results` must be a positive integer, defaults to 5 and is
  clamped to 50. Up to 20 include-domain hosts may be given and are joined with commas.
- Results become the local unified search result shape. Only `http(s)` links without userinfo
  are kept. Items outside the include domains are dropped, icons are reduced to safe
  `http(s)` URLs, and text fields are bounded. `total_results_available` is the count of
  valid items.
- Wire `usage` mirrors the source: `{ queries_used: 1, search_cost_usd: 0 }`. Internal
  accounting keeps `costStatus: "unknown"`, because coding-plan quota is not a dollar receipt.

## Safety and accounting

- Validation runs before any network call. These are refused: empty, control-character or
  over-2000-character queries; non-web types; bad `max_results`; excluded domains; non-host
  filters; `offset`; `country`; `language`; `time_range`; `content_options`; non-empty
  `provider_options`, including base URL overrides; and unknown fields. The source silently
  drops most of these.
- Only the selected connection's `apiKey` (then `accessToken`) is used. Header-unsafe keys
  are refused. Nothing (sessions, credentials or results) is cached across calls or
  connections, and there is no refresh, retry or failover.
- Deadlines: a per-step timeout (default 10 s) and a total timeout (default 15 s, the local
  search global budget), both capped at 60 s. A client abort gives 499 and a deadline gives
  504. Aborts cancel the in-flight fetch and the body reader, and a fetch that resolves late
  is discarded.
- Success bodies are bounded at 2 MiB and error bodies at 16 KiB. Upstream messages and
  bodies are never relayed. Errors map as follows: 401/403 → same status; 402, or 403/429 with
  a quota code (`insufficient_quota`, `quota_exceeded`, `insufficient_balance`,
  `insufficient_credits`, Z.AI `1113`) → 402 with `quotaExhausted`; 429 → rate-limit
  evidence and `Retry-After`; other failures → 502.
- No replay. Once `tools/call` may have left the gateway, an uncertain outcome returns an
  `acceptedJob` (`costSource: "accepted-job"`, connection id). Uncertain outcomes are 5xx,
  network reset, deadline, client abort, foreign origin, server-defined JSON-RPC error, tool
  `isError`, malformed text, or an unreadable, oversized or unmatched body. The job state
  is `submit-unknown`, `completed-unread`, `completed-unusable` or `tool-error`. Definite
  refusals carry no accepted job. Those are failures before the tool call, connection
  errors that prove nothing was sent (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, connect
  timeout), 4xx/429/quota, JSON-RPC protocol errors (−32700..−32600), session 404 and
  redirects.

## Intentional differences from the source

- Tool `isError` and malformed or non-array text are failures, not empty successes. The
  source returns `[]`, which would hide quota or tool errors as "no results".
- Items are validated one by one. The source's zod schema rejects the whole array when one
  field has the wrong type, and the result is then empty.
- Caller-ignored inputs, excluded domains and base URL overrides are refused instead of
  silently dropped. The fixed origin replaces `resolveSearchBaseUrl`.
- The client name is `durindoor-search`, not `omniroute-search`.

## Not ported / remaining restrictions

- No GET SSE listener, session `DELETE`, resumable streams or server-initiated requests.
  The source SDK closes its client without `DELETE`, and the search flow needs none of these.
- No dynamic discovery. The source has no model or tool discovery for search providers.
- The `zai` credential fallback is metadata only (`credentialProviders`) until the
  search route gains a fallback hook.
- Registration: switch `handleSearchCore` to dispatch `glm` (plus any future `zai-search`
  alias) to `handleZaiSearchNative`, and pass `request.signal` through. Record
  `acceptedJob` without account fallback. See `registration.json` `integration`.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-zai-search-search.test.js --maxWorkers=2
```

Result: 1 file, 50 tests passed. The anti-slop/oxlint gate reports 0 diagnostics. The
unregistered-state assertions are isolated in the final `staging registration state` block.
