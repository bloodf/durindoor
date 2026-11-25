# Adapta Web and T3 Chat Web cookie parity — #2034

Work order #2034 covers the Adapta Web (`adapta-web`) and T3 Chat Web (`t3-web`)
saved-cookie lifecycle. This file pins the compared sources, records the gaps
that were verified offline and the ones that were fixed here, and states the
limits that remain.

Everything below was produced from a source and mock comparison. No Adapta or
T3 Chat account, browser, provider request, Docker or e2e run was involved.

## Pinned sources

- **OmniRoute `61e07fb7e0d4e1e76111495d3718c9e4d06d2a62`**
  ([diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute/tree/61e07fb7e0d4e1e76111495d3718c9e4d06d2a62)).
  The commit is the one recorded in `internal/docs/omniroute-provider-matrix.json`
  (`source.repository` / `source.commit`), the repository-wide parity matrix
  for this fork.
  - [`open-sse/executors/adapta-web.ts`](https://github.com/diegosouzapw/OmniRoute/blob/61e07fb7e0d4e1e76111495d3718c9e4d06d2a62/open-sse/executors/adapta-web.ts)
    — the Clerk two-step handshake (`GET /v1/client`, then
    `POST /v1/client/sessions/{id}/tokens`), the in-memory session cache keyed by
    the first 32 characters of the stored `__client` value with a 30 second
    expiry buffer, the `MODEL_ID_MAP` that sends `aiModelId: 14` for every
    registry model id, the SSE transform that suppresses the `quick-response`
    placeholder, and the `testConnection` that reads the Clerk session without
    opening a conversation.
  - [`open-sse/executors/t3-chat-web.ts`](https://github.com/diegosouzapw/OmniRoute/blob/61e07fb7e0d4e1e76111495d3718c9e4d06d2a62/open-sse/executors/t3-chat-web.ts)
    — the `parseT3Credentials` accepted paste forms (plain Cookie header, and the
    `cookies=…` / `convexSessionId=…` pair), the `POST https://t3.chat/api/chat`
    request shape, the TSS/NDJSON text extraction and the read-only `HEAD`
    probe against the site root.
- **OmniRoute `e3c1531a`** — the earlier snapshot already recorded in
  [`t3-web-signin-parity-2034.md`](./t3-web-signin-parity-2034.md) for the
  validator, executor, registry and model route. The T3 Chat contract did not
  change between that snapshot and `61e07fb7`; the sources were re-read at
  `61e07fb7` for this work order and are cited above.
- **OmniRoute `fbd3396`** — the snapshot recorded in
  [`chatgpt-web-2034.md`](./chatgpt-web-2034.md) and in the Adapta executor
  header. The Adapta contract did not change between that snapshot and
  `61e07fb7`.
- **DurinDoor `609c21cfdc`** — the local base of this work order, on branch
  `orq/toruzq/cookie-parity-adapta-t3-a1`.

The OmniRoute Adapta and T3 Chat executors are ports of the same provider
contracts DurinDoor ships, so they are the parity source for the request
shape, not a behavioural specification. DurinDoor's own additions — the
durable connection proxy contract, the relay refusal for T3 Chat, the account
fallback and the credential redaction rules — are local and are listed under
"Gaps found and fixed" below.

## Offline lifecycle evidence

`tests/unit/provider-cookie-lifecycle-adapta-t3.test.js` uses the real
database, the provider create/edit/validate/test routes, the connection model
discovery route, `/v1/models`, `handleChat`, account fallback, both executors
and the usage route. Only credentials and outbound bytes are synthetic: the
global `fetch` and the proxy dispatcher seam are closed mocks.

Covered and verified:

- **Saved connection creation.** Both providers persist with
  `authType: "cookie"`, keep the pasted value in the encrypted `apiKey` column
  and never return it to the client. The dashboard paste format is unchanged:
  Adapta accepts the `__client=<value>` form and the bare session value, T3
  Chat accepts a plain Cookie header and the `cookies=…` /
  `convexSessionId=…` pair.
- **Validation.** Adapta's automatic probe is skipped, because its only chat
  endpoint opens a conversation per probe. T3 Chat uses the read-only `HEAD`
  probe against the site root; a 401 or 403 rejects the session, a redirect or
  a transport failure reports the check as unavailable.
- **Discovery.** Both providers answer discovery from the registry's curated
  catalog and send no session cookie on that request.
- **Dispatch.** `/v1/chat/completions`, `/v1/messages` and `/v1/responses`,
  with JSON and streaming, for both providers.
- **Provider-specific framing.** Adapta's `quick-response` loading event is
  not answer text. T3 Chat's typed newline-delimited envelope
  (`{"t":10,"p":{"k":["content"],"v":[{"t":2,"s":"…"}]}}`) and its plain
  `{"text":"…"}` line both become OpenAI content.
- **Usage.** The Usage card reports DurinDoor's own 30 day history for a saved
  session, never another connection's.
- **Expiry, retry and re-import.** A rejected session falls back to the next
  connection of the same provider, leaves the sibling untouched, and recovers
  after the fresh cookie is pasted over the old one with **Edit**. Adapta
  reports a rejected Clerk session as `Adapta authentication failed` and a
  chat-level rejection as `Adapta request failed`; T3 Chat reports
  `T3 Chat request failed (HTTP <status>)`.
- **Account boundaries.** Each Adapta account exchanges its own Clerk session,
  and the cookie reaches only the Clerk hops while the short-lived bearer
  reaches only the chat hop. A T3 Chat session is sent only to `t3.chat`.
- **Proxy behaviour.** Every Adapta hop (Clerk lookup, Clerk token exchange,
  chat) uses the connection's proxy route. A T3 Chat session refuses an HTTP
  relay route, both on a request and on the connection test, and no session
  leaves the gateway in that case.

## Gaps found and fixed in DurinDoor

No upstream file was copied; these are local fixes.

- **Adapta Web had no model discovery.** `GET /api/providers/[id]/models`
  answered HTTP 400 `Provider adapta-web does not support models listing`,
  even though the registry declares seven curated models and the dashboard's
  model list already showed them. `fetchConnectionModels` now returns the
  registry catalog with `source: "local_catalog"`, the same shape T3 Chat and
  Yuanbao Web use, and `canDiscoverModels` reports the provider as
  discoverable. The request sends no session cookie.
- **Adapta Web and T3 Chat had no Usage card.** `GET /api/usage/[connectionId]`
  answered "Usage not available for this connection" for both, while Grok Web
  and ChatGPT Web already showed their local 30 day history. Both providers are
  now in the local-usage table and show requests, estimated tokens and a
  per-model breakdown.
- **Neither provider reported token counts.** Adapta's non-streamed reply
  carried `usage` with hard zero counters, so the request reached Usage with
  zero tokens, and T3 Chat's non-streamed reply carried no `usage` at all, so
  the request never reached Usage. Both executors now report the same estimate
  the other web-cookie transports use, about four characters per token. This
  is the same fix already recorded for ChatGPT Web in
  [`chatgpt-web-2034.md`](./chatgpt-web-2034.md).

## Known limits, unchanged

- No remote plan, quota or allowance API. The Usage card is DurinDoor's own
  recorded history, not the provider's remaining allowance.
- Adapta's registry model ids all map to the same internal `aiModelId` (14,
  the auto-select model), matching the OmniRoute source. The lane names are
  catalog entries, not distinct upstream models.
- The Adapta session cache is per cookie and per egress route and is not
  shared between connections, so a second connection re-exchanges its own
  Clerk session.
- The T3 Chat server function hash is deployment-specific upstream; only
  `https://t3.chat/api/chat` and the NDJSON/TSS framing are covered. Tool
  calls, media, session renewal and binary TSS framing are outside the
  contract.
- T3 Chat refuses an HTTP relay route, because a relay cannot carry the
  session cookie. Use a direct or proxied route for that provider.
- DurinDoor does not emulate browser attestation or work around provider
  access controls. A session the provider rejects stays rejected.
- Live endpoint availability, session acceptance, model entitlements and
  provider policy were not tested.
