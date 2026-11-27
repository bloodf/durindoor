# Poe Web

> **Available, mocked coverage only.** Poe Web (`poe-web`, alias `poew`) is registered: you can add a connection from the dashboard, list its models and send requests through the OpenAI and Anthropic routes. Every test runs against closed mocks; nothing here has been accepted against a live account.

This web-session provider is separate from the existing `poe` API-key provider; do not enter a Poe API key here. The two share no connection or credential.

## Credential and import

Enter the `p-b` cookie value from a signed-in poe.com session, either as a bare value or as a Cookie header containing exactly one `p-b`. Other cookies in a pasted header are ignored.

Dashboard import (Cookie header, cURL command or HAR file) allows one cookie, `p-b`, from the origin `https://www.poe.com`, with a cookie domain of `www.poe.com` or `.poe.com`, and stores `p-b=<value>`. Browser extension capture and web login are not configured: the pinned source defines no capture or sign-in contract, and the extension's compiled allowlist has no Poe entry.

Only `p-b` is sent, and only to `https://www.poe.com/api/gql_POST`. Redirects are never followed. A `401`, `403` or redirect is reported as `401 session_expired`; obtain and enter a new cookie. There is no refresh.

## Validation and discovery

Poe has no read-only session check in the pinned source; its only request is a chat. **Validate** and **Test Connection** therefore reject a malformed value locally and otherwise skip the network check, so a skipped check does not prove the cookie works.

Discovery returns the pinned static mapping of model IDs to Poe bot names (`poe-default`, `gpt-4o`, `gpt-4-turbo`, `claude-3.5-sonnet`, `claude-3-opus`, `gemini-2.0-flash`, `llama-3-70b`, `mixtral-8x22b`) without sending the cookie. It is not account-specific availability.

## Requests, responses and usage

The last text user message is sent in a `ChatViewQuery` GraphQL request. Earlier turns, tools and images are not sent. The upstream JSON answer is returned as a completion or a synthesized SSE stream; streaming is not incremental. Poe reports no token counts, so the gateway records its own usage estimate, marked as estimated, against the selected connection.

## Mocked evidence

`tests/unit/poe-web-provider.test.js` covers credentials, the request envelope, model mapping, account isolation, JSON, SSE, errors and redirects. `tests/unit/provider-session-registration-1127.test.js` runs the registered path with the real executor map: dashboard import into the connection store, Cookie header, cURL and HAR parsing, discovery, OpenAI and Anthropic JSON and SSE, account separation, expiry, redirects, server errors and recorded usage. They do not establish current endpoint compatibility, subscription access or live reliability.

## Attribution

Ported logic: [OmniRoute `open-sse/executors/poe-web.ts` at 9671192011beb2d7f83979f40be488c5da8772b9](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/poe-web.ts), and its web-cookie catalog and credential definitions (MIT).
