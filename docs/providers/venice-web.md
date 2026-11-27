---
title: Venice Web
description: Available, with mocked coverage only. The signed-in Venice session cookie, request flow, errors and limits.
---

> **Available, mocked coverage only.** Venice Web is registered: you can add a connection from the dashboard (manual paste, cookie import or the browser extension), list its models, validate it and send requests through the OpenAI and Anthropic routes. Every test runs against closed mocks; nothing here has been accepted against a live account.

Venice Web (`venice-web`, alias `venw`) uses the session of an account signed in at [venice.ai](https://venice.ai). It has been tested only against mocks. No real account or Venice endpoint has been contacted, so there is no claim that it works against the live service or stays working.

It is separate from the [`venice`](https://venice.ai/settings/api) API-key provider. The two do not share connections or hosts. A Venice API key is refused here, and the session cookie is never sent to `api.venice.ai`.

## Credential format

The credential is the `__client` cookie that Clerk, Venice's sign-in service, keeps for `clerk.venice.ai`. Its value is a JWT.

1. Sign in at `venice.ai`.
2. In the browser developer tools, open **Application → Cookies** and find the `__client` cookie listed for `.clerk.venice.ai`. You may have to open a `clerk.venice.ai` request or tab to see it.
3. Paste it as the connection credential.

These forms are accepted:

```text
<jwt>
__client=<jwt>
Cookie: __client_uat=…; __client=<jwt>; …
```

From a full header, only `__client` is kept and sent. Treat the value as a password: it can create new session tokens for your account.

Before anything is sent, the gateway refuses an API key, a value that is not a JWT with a readable payload, a header with no `__client` or with more than one, and a value containing line breaks. If the JWT has an `exp` time in the past, it is reported as expired. The signature is not verified locally.

### Cookie import, extension capture and sign-in

Dashboard import (Cookie header, cURL command or HAR file) and the [browser extension](./cookie-capture-extension.mdx) take one cookie, `__client`, from the exact origin `https://clerk.venice.ai`. The cookie domain must be `clerk.venice.ai` or a parent of it (`.clerk.venice.ai`, `.venice.ai`); a cookie scoped to `api.venice.ai`, `outerface.venice.ai` or another site is refused. Import stores `__client=<value>`.

To capture with the extension:

1. Sign in at `https://venice.ai` in a normal tab.
2. In the same browser profile, open `https://clerk.venice.ai` in the active tab. The page may show only a short JSON or error message; that is fine. The cookie belongs to this origin.
3. Create a pairing in the dashboard, paste it into the extension popup and confirm.

The extension refuses a `venice.ai` tab: the tab it captures from must be the Clerk origin itself, and it asks for host access to `https://clerk.venice.ai/*` and your dashboard only. This capture has not been tried against a live Venice account.

There is no built-in web sign-in: the source defines no sign-in or session-ready contract.

## What is sent, and where

Destinations are fixed. Connection settings cannot change them. The only variable part is the session id, which must contain only letters, digits, `_` and `-`.

| Request | Credential sent | Purpose | Uses chat quota |
| --- | --- | --- | --- |
| `GET https://clerk.venice.ai/v1/client` | `Cookie: __client=…` | Find the active session | No |
| `POST https://clerk.venice.ai/v1/client/sessions/{id}/tokens` | `Cookie: __client=…` | Get a short-lived session token | No |
| `POST https://outerface.venice.ai/api/inference/chat` | `Authorization: Bearer <session token>` | Send the turn | Yes |

Redirects are never followed, so neither credential is forwarded to another address.

The chat body carries the model id, the text messages, `temperature` (default `0.7`), `topP` (default `0.9`), the user id from the session token and a random request id. Reasoning, the Venice system prompt, web search, web scraping and X search are off. Logged copies of the request redact the session token and user id.

### Session tokens and expiry

A session token is reused until 10 seconds before its `exp` time. A token without `exp` is treated as valid for 55 seconds. Tokens are held in memory only. The cache is keyed by a digest of the whole cookie and the connection's proxy settings, so accounts never share a token. Concurrent requests that find no cached token each get their own.

A `401`, `403` or redirect from chat drops the cached token. The rejected request is not retried; the next one asks Clerk again. The gateway cannot renew the `__client` cookie itself. When it stops working, import a new one. A replacement cookie that Clerk sends in a response is not saved.

## Models and discovery

Venice has no known model list for this kind of session. The catalog is the source's static list:

`venice-uncensored`, `llama-3.3-70b`, `qwen3-235b`, `qwen3-4b`, `deepseek-r1-671b`

Discovery makes one read-only `GET /v1/client` to check that the selected connection still has an active session, then returns that list. **The list does not come from your account.** It may be out of date, and a listed model may be unavailable to you. Other model ids are passed to Venice unchanged. The connection check (**Validate** and **Test Connection**) is the same single request; it creates no session token and starts no chat.

## Responses and usage

Venice answers with one JSON event per line, labelled as `text/html`. The gateway turns `content` events, including any `reasoning_content`, into OpenAI JSON or SSE. The usual translation serves other client formats.

The source defines no end-of-answer event. An answer is complete when the response body ends, and only if some text arrived. **An answer cut off exactly between two lines cannot be detected.** A cut or damaged event is detected.

The executor reads no token counts from Venice and reports none, so the gateway records its own usage **estimate**, marked as estimated, against the selected connection. It is not a measure of Venice credits.

## Errors

| Condition | Result |
| --- | --- |
| Missing or malformed credential | `401 invalid_credential`; nothing is sent |
| Expired cookie JWT, or no active Clerk session | `401 session_expired` |
| `401`, `403` or any redirect from Clerk | `401 session_expired`; no chat is sent |
| Chat `401` or redirect | `401 session_expired` |
| Chat `403` | `403 forbidden`: session, account, model or an anti-bot check |
| `429` at any step | `429 rate_limited`, with `Retry-After` when Venice sends it in seconds |
| Other upstream error status | The same status |
| Network failure | `502 network_error` |
| Unreadable Clerk reply, or a reply with no text, a damaged event, an error event or a line over 1,000,000 characters | `502 invalid_response` |
| Tools, tool messages, images or other non-text input, or no user text | `400 invalid_request`; nothing is sent |

A failure before the first text is an HTTP error. A failure after streaming has started ends the stream with an error event and no `stop` chunk; the HTTP status is already `200`. Upstream error text is never returned to the client.

## Limits

- Text only. There is no tool calling, so clients that always offer tools get a `400`. Tools with `tool_choice: "none"` are ignored.
- `max_tokens`, stop sequences and other sampling settings are not sent. Every successful answer reports `stop` as its finish reason.
- Venice may require browser checks that a server request cannot pass. This has not been tested.
- The endpoints are not a published API and can change without notice. Automated use may break the service's terms or affect your account.

## Mocked evidence

`tests/unit/venice-web-provider.test.js` uses synthetic tokens and a fetch mock that fails on any unlisted URL. It covers credential parsing, exact headers and request body, discovery, account separation, JSON and SSE, broken answers, HTTP errors, redirects, token expiry and estimated usage. Its gateway cases use a fresh executor instance per test so the session-token cache never crosses tests.

`tests/unit/provider-session-registration-1127.test.js` runs the registered path with the real executor map: dashboard and extension import through the pairing and import routes into the connection store (with the Clerk origin and cookie domain checks), Cookie header, cURL and HAR parsing, discovery and validation for the selected connection, OpenAI and Anthropic JSON and SSE, account separation, an ended Clerk session, expiry, redirects, server errors and recorded usage.

`tests/unit/provider-cookie-capture-extension.test.js` checks the extension side with a fake `chrome` namespace: only an exact `https://clerk.venice.ai` tab is accepted (not `venice.ai`, another Venice host or a lookalike), only `__client` is read, cookies scoped to other hosts are dropped, and the two requested host permissions are given back.

From `tests/`:

```bash
node node_modules/vitest/vitest.mjs run unit/venice-web-provider.test.js unit/provider-session-registration-1127.test.js unit/provider-cookie-capture-extension.test.js --maxWorkers=2
```

## Attribution

Ported from [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) at `9671192011beb2d7f83979f40be488c5da8772b9` (MIT, Copyright (c) 2026 Cheaper Inference, created by Diego Souza):

- `open-sse/executors/venice-web.ts`: inference URL, headers, request body and events.
- `open-sse/executors/venice-web-auth.ts`: `__client` parsing, Clerk session lookup, session token and caching.
- `src/lib/providers/staticModels.ts`: model list.
- `src/shared/providers/webSessionCredentials.ts` and `src/shared/constants/providers/web-cookie.ts`: cookie name and origin.

This version is stricter than the source. It accepts only a JWT-shaped `__client` value, never follows redirects, checks the session id before using it in a URL, refuses input the source would drop, treats empty or damaged answers as errors and never returns upstream error text. It does not share a pending token request between callers.
