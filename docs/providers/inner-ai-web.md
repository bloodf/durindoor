---
title: Inner.ai Web
description: Staged and unavailable. The signed-in Inner.ai session credential, request flow, errors and limits.
---

> **Staged and unavailable.** The code exists, but the provider is not registered. You cannot add an Inner.ai Web connection or send requests to it yet. A later change has to register it.

Inner.ai Web (`inner-ai-web`, alias `inaw`) uses the session of an account signed in at [app.innerai.com](https://app.innerai.com). It has been tested only against mocks. No real account or Inner.ai endpoint has been contacted, so there is no claim that it works against the live service or stays working.

It is separate from the existing `inner-ai` entry in the API-key category. The two do not share connections, and no stored credential is moved or reread from one to the other.

## Credential format

1. Sign in at `app.innerai.com`.
2. In the browser developer tools, open **Application → Cookies** and find the `token` cookie for `.innerai.com`. Its value is a JWT.
3. After registration, paste it as the connection credential, followed by a space and your Inner.ai login email.

These forms are accepted:

```text
<token>
<token> you@example.com
token=<token>
token=<token> you@example.com
```

Treat the token as a password. A full `Cookie` header with other cookies, another cookie name, an API key or a value that is not a JWT is rejected before anything is sent. If the JWT has an `exp` time in the past, it is reported as expired without a request. The signature is not verified locally.

### Cookie import and sign-in

The staged import profile allows one cookie, `token`, from the origin `https://app.innerai.com`. Dashboard import stores `token=<value>` **without an email**. The gateway then depends on the account profile lookup to find the email. If that lookup fails and the token has no email in its `sub` claim, requests go out without `USER-EMAIL`; whether Inner.ai accepts them is unknown. Pasting the token and email by hand avoids this.

Browser extension capture is off because it cannot collect the email. There is no built-in web sign-in: the source defines no sign-in or session-ready contract for it. There is no token refresh. When the session expires, paste or import a new token.

## What is sent, and where

The session token goes to three fixed URLs only. Connection settings cannot change them.

| Request | Purpose | Uses chat quota |
| --- | --- | --- |
| `GET https://platformapi.innerai.com/api/v1/users/profile` | Find the account email | No |
| `GET https://platformapi.innerai.com/api/v1/ai_models` | List the account's models | No |
| `POST https://chatapi.innerai.com/chat` | Send the turn | Yes |

Each request carries the token as `Cookie: token=…` and `USER-TOKEN`, with `Origin` and `Referer` set to `https://app.innerai.com`. `DEVICE-ID` comes from the JWT. `USER-EMAIL` is the profile's email, else the pasted one, else an email-shaped `sub` claim. Redirects are never followed.

## Models

Discovery keeps enabled text models that the account's plan allows. The plan is read from the JWT (`plan`, `tier` or `subscription`) and is only a filter; Inner.ai still decides what the account may use. A requested id matches the listed id exactly, ignoring case, or without its vendor prefix and eight-digit date suffix. If nothing matches, the gateway returns `404 model_not_found` and sends no chat. It never substitutes a similar model.

Chat reuses an account's email and catalog for up to an hour. The cache is keyed by that exact token and pasted email. A rejected session or unlisted model clears it. A direct discovery call always reads fresh. The 19-model fallback catalog is copied from the source and may not match your account.

## Responses and usage

Inner.ai always answers with its own event stream. The gateway returns OpenAI JSON or SSE, and the usual translation serves other client formats. Only the `end_stream` event completes an answer.

Inner.ai reports no token counts. The executor reports none, so the gateway records its own usage **estimate**, marked as estimated, against the selected connection. It is not a measure of Inner.ai credits.

## Errors

| Condition | Result |
| --- | --- |
| Missing or malformed credential | `401 invalid_credential`; nothing is sent |
| Expired JWT; or `401`, `403` or any redirect from any of the three URLs | `401 session_expired`; nothing further is sent |
| Chat `429`, or a `missing_credits`, `reached_limit`, `rate_limit_reached` or `rate_limit_longer_reached` event | `429`; the event name is the error code for events |
| Catalog failure, including an unreadable reply | An error status; no chat is sent |
| Malformed, oversized or truncated event stream | `502 invalid_response` |

A failure before the first text is an HTTP error. A failure after streaming has started ends the stream with an error event and no `stop` chunk; the HTTP status is already `200`. A failed profile lookup other than a rejection does not stop the request. Upstream error text is never returned to the client.

## Limits

- All turns are flattened into one labelled text message. Images and other non-text parts are dropped.
- Each request is a new temporary conversation. Web search and knowledge files are off.
- Sampling settings such as `temperature` and `max_tokens` are not sent.
- Tool calling is emulated through prompt text. A request with tools is buffered until the answer is complete.
- The endpoints are not a published API and can change without notice. Automated use may break the service's terms or affect your account.

## Mocked evidence

`tests/unit/inner-ai-web-provider.test.js` uses synthetic tokens and a fetch mock that fails on any other URL. It covers credential parsing, headers and request body, discovery, account separation, JSON and SSE, quota and stream errors, expiry, redirects, and estimated usage. Its gateway cases replace the executor lookup, because the provider is not registered.

The upstream stream is read with the shared SSE frame reader (`open-sse/utils/sseFrames.js`). `tests/unit/inner-ai-web-sse.test.js` covers LF, CRLF and CR endings, byte-fragmented reads, split UTF-8, multi-line data, comments, a final frame without a blank line, quota events, malformed or truncated frames, and the pending-frame byte bound.

From `tests/`:

```bash
node node_modules/vitest/vitest.mjs run unit/inner-ai-web-provider.test.js unit/inner-ai-web-sse.test.js --maxWorkers=2
```

## Attribution

Ported from [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) at `9671192011beb2d7f83979f40be488c5da8772b9` (MIT, Copyright (c) 2026 Cheaper Inference, created by Diego Souza):

- `open-sse/executors/inner-ai.ts`: endpoints, headers, request body, events and model filtering.
- `open-sse/config/providers/registry/inner-ai/index.ts`: fallback model catalog.
- `src/shared/providers/webSessionCredentials.ts` and `src/shared/constants/providers/web-cookie.ts`: the token and email credential.

This version is stricter than the source. Redirects or a rejected profile stop the request, catalog failures and unlisted models send no chat, substring model matching is removed, bad or truncated streams are errors, and the source's zero usage values are not reported.
