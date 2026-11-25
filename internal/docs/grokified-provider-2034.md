# Grokified provider contract and port notes (#2034)

Recorded on 2026-11-20, without provider credentials or account traffic. Every
statement about the vendor comes from reading the first-party documentation
listed below; none of it is evidence that Grokified currently accepts a
particular key, model or account.

## Revisions and sources read

| Side | Revision | Note |
| --- | --- | --- |
| Grokified docs | <https://grokified.com/docs> | Overview, quickstart, authentication and the OpenAI-compatible setup, inspected 2026-11-20. |
| Grokified errors | <https://grokified.com/docs/errors> | Status codes, the `{"error":{"message","type","code"}}` envelope and the retry guidance, inspected 2026-11-20. |
| Grokified models | <https://grokified.com/docs/models> | Active text models, older and retired names that still resolve, and the discovery endpoints, inspected 2026-11-20. |
| Grokified usage | <https://grokified.com/docs/usage-tracking> | The `usage` block, the vendor `usage.grokified` cost block and the streaming usage frame, inspected 2026-11-20. |
| OmniRoute | [`4624250231f49ed118fb4522a9d735e4894322c6`](https://github.com/cheaper-inference/OmniRoute/commit/4624250231f49ed118fb4522a9d735e4894322c6) | `open-sse/config/providers/registry/grokified/index.ts`. The same file is unchanged at `origin/main` `d1821d0db1` (fetched 2026-11-20). |
| DurinDoor | `6cc3b63ac6` | Comparison base for this port, branch `orq/toruzq/add-grokified-a1`. |

`internal/docs/provider-parity-omniroute.md` lists `grokified` among the 69
upstream identities with no exact DurinDoor id at the comparison SHA
`fd3a0f959a5eca082d8f042634d38b7005228e5c`. That inventory is a pinned
snapshot and was left unchanged; this note records the port that closed the
gap.

## Vendor contract

- Base URL `https://api.grokified.com/v1` (host and path, not the marketing
  site), OpenAI Chat Completions on `POST /v1/chat/completions`, SSE on the same
  host and key.
- Authentication is `Authorization: Bearer <key>` with `gk_live_` production
  keys and `gk_test_` test keys. There is no account or organization header.
- Discovery is `GET /v1/models` with the same key. The catalog is per key.
- Errors are one JSON envelope, `{"error":{"message","type","code"}}`, with
  400 `invalid_request_error`, 401 `invalid_api_key`, 402 `insufficient_quota`
  and `payment_required`, 403 `account_suspended` and
  `plan_capability_required`, 404 `not_found`, 413 `request_too_large`, 429
  `rate_limit_exceeded` and 5xx `api_error` and `service_overloaded`. The
  vendor states that only 429 and 5xx are retryable.
- Every response carries `x-grokified-api: grokified.com`. `x-request-id` only
  rides on calls that reached the model.
- Usage is the standard OpenAI `usage` block. JSON replies add a vendor
  `usage.grokified` block with `list_usd`, `charged_usd`, `discount_usd` and
  `balance_usd`. A streamed reply carries token counts in the frame before
  `[DONE]` because the vendor force-injects `stream_options.include_usage`;
  it does not carry the cost block.

## Distinctions kept

- `grokified` is not `xai`. xAI is `api.x.ai` with its own API key and Grok
  Build OAuth; Grokified is a separate prepaid product with its own `gk_` key
  namespace, its own balance and its own catalog. No xAI credential, executor
  or OAuth flow is reused.
- `grokified` is not `groq`. Groq is a different company serving different
  models on `api.groq.com`.
- `grok-4.20-multi-agent-0309` is deliberately not seeded. The vendor's own
  model page states "Responses API only. It does not work through Chat
  Completions." This port registers a Chat Completions transport only, so that
  id would be a broken picker row.

## DurinDoor surface

| Concern | File |
| --- | --- |
| Provider contract | `open-sse/providers/registry/grokified.js` |
| Generated registration | `open-sse/providers/registry/index.js` (from `scripts/gen-registry-index.mjs`) |
| Dashboard picker, discovery config | `src/shared/constants/providers.js` (registry-derived `APIKEY_PROVIDERS`) |
| Credential probe | `src/app/api/providers/providerProbe.js` (`buildRegistryProviderProbe`, `buildProviderProbeHeaders`) |
| Model discovery | `src/app/api/providers/[id]/models/fetchConnectionModels.js` (registry `modelsFetcher`) |
| Chat transport | `open-sse/executors/default.js` (`buildUrl`, `buildHeaders`) |
| Error mapping | `open-sse/config/errorConfig.js` (`ERROR_TYPES`, `ERROR_RULES`), `open-sse/utils/error.js` (`getClientStatusFromError`) |
| Usage accounting | `open-sse/handlers/chatCore/requestDetail.js` (`extractUsageFromResponse`), `open-sse/handlers/chatCore/nonStreamingHandler.js`, `open-sse/handlers/chatCore/streamingHandler.js` |

No new executor, no new credential helper and no new route were added. The
provider reuses the existing API-key connection machinery end to end: the
registry is the single source for the dashboard picker, the credential probe,
the discovery fetcher, the default executor and the error and usage paths.

## Model catalog decision

The upstream entry seeds `grok-4.6`, `grok-4.3` and `grok-build-0.1` from
`CHAT_OPENAI_COMPAT_MODELS` in `open-sse/config/providers/shared.ts`. This port
widens the seed to the vendor's documented active text catalog (`grok-4.7`,
`grok-4.6`, `grok-4.5`, `grok-4.3`, `grok-4.20-0309-reasoning`,
`grok-4.20-0309-non-reasoning`, `grok-build-0.1`) and adds the vendor's
documented older and retired names as request-only aliases, so
`gx-1-max`, `gx-build`, `grok-code-fast-1`, `grok-3` and the rest resolve to
their current id before the request leaves the gateway. The context windows
are the vendor's published figures. `modelsFetcher` and `passthroughModels`
keep the live, per-key catalog and unknown ids working.

## Mock acceptance

`tests/unit/grokified-provider.test.js` is a closed fixture: the only egress is
a mocked `proxyAwareFetch`, and `globalThis.fetch` throws so a real network
call fails the file. It drives the normal routes, `/v1/chat/completions` and
`/api/providers/[id]/models`, against a temporary SQLite database, and covers:

- the registry contract, the seeded catalog, the Responses-only exclusion and
  the alias resolution;
- separately scoped keys: two Grokified connections with different keys, each
  client key reaching only its own connection, and a foreign connection pin
  rejected before dispatch;
- distinct catalogs returned for each connection's key, with known media,
  Claude add-on and Responses-only entries filtered from the chat picker;
- discovery errors surfaced to the dashboard with the upstream status;
- a JSON chat completion and a streamed chat completion, each with the
  provider-reported usage recorded in the ledger;
- the 401, 402, 403 and 429 classes preserved on the client response, with the
  stored key never echoed back.

No credentials, paid calls, browser, end-to-end run or Docker were involved.

## Limits

- No live verification. Grokified's behavior here is what its documentation
  states on 2026-11-20. Account state, balance, plan capability, catalog
  contents and rate limits remain unverified.
- The mock proves local wiring only. It does not prove that the vendor accepts
  a `gk_` key, that a given model is reachable, or that the usage frame
  arrives as documented.
- The `cost_usd` field DurinDoor adds to a response is a built-in list-price
  estimate that resolves the model name against the canonical model pricing.
  Grokified charges its own discounted rate, and the vendor's authoritative
  per-call cost is on the Grokified dashboard. No provider-specific pricing
  override was added, because the vendor publishes mutable rates on its pricing
  page and the live catalog carries per-model prices.
- The vendor's `usage.grokified` cost block does not reach the client: the
  shared usage filter keeps the known OpenAI usage fields. The ledger records
  the provider-reported token counts, which is the part the gateway owns.
- `docs/providers/catalog.mdx` and `open-sse/AGENT-INDEX.md` were regenerated
  with `node scripts/gen-provider-catalog.mjs` and
  `node scripts/gen-agent-index.mjs`; `node scripts/gen-registry-index.mjs
  --check` reports the registration barrel as up to date.
