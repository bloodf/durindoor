---
title: Adobe Firefly Services API
description: Staged and unavailable. Firefly Services image generation with an Adobe Developer Console OAuth Server-to-Server credential, its job flow, errors and limits.
status: unreleased
---

> **Staged and unavailable.** The code exists, but the provider is not registered. You cannot add an Adobe Firefly Services API connection or send requests to it yet. A later change has to register it.

Adobe Firefly Services API (`adobe-firefly-api`) generates images through Adobe's published, asynchronous [Firefly API](https://developer.adobe.com/firefly-services/docs/firefly-api/). It has been tested only against mocks. No Adobe account, IMS endpoint or Firefly endpoint has been contacted, so there is no claim that it works against the live service.

## Services API entitlement vs. a Firefly subscription

This provider needs a **Firefly Services API entitlement** for your organization, and an **OAuth Server-to-Server** credential for it in [Adobe Developer Console](https://developer.adobe.com/developer-console/docs/guides/services/services-add-api-oauth-s2s/). Adobe sells and grants API entitlement separately.

A consumer Firefly, Creative Cloud or Adobe Express subscription, the firefly.adobe.com web app and its browser sign-in are **not** API access. They do not work here. Signing in to the web app does not produce a usable credential.

The consumer web app is a separate, declined route: `adobe-firefly` and `firefly` stay unknown provider IDs. See [Adobe Firefly](./adobe-firefly.md) for why. This provider does not reproduce that web-cookie route.

## Scope

| Capability | State |
| --- | --- |
| Text-to-image with `POST /v3/images/generate-async` | Staged, covered by mocks |
| Models `image3`, `image4_standard`, `image4_ultra` | Staged. Sent as the `x-model-version` header |
| Custom models (`image3_custom`, `image4_custom`) | Not supported. Refused |
| Reference images, style and structure references, expand, fill, upscale, video | Not supported. Refused or not exposed |
| Consumer web app session, cookies or browser sign-in | Never. Refused |
| Chat | Not part of this provider. It has no chat transport |

## Credential

Every connection needs the **client ID** of your OAuth Server-to-Server credential, plus one of these:

| Mode | Fields | Behavior |
| --- | --- | --- |
| Client credentials (preferred) | `providerSpecificData.clientId` and the **client secret** in `apiKey` | DurinDoor mints an access token at Adobe IMS, caches it in memory and mints again before it expires |
| Pasted access token | `providerSpecificData.clientId` and an S2S access token in `accessToken`, optionally `expiresAt` | Used as given. It cannot be refreshed. Paste a new one after it expires (Adobe documents 24 hours) |

If both a secret and a token are stored, the secret is used.

These are refused with `401` before anything is sent:

- a missing or malformed client ID, secret or token
- Adobe's own web-app client IDs (`clio-playground-web`, `projectx_webapp`)
- a pasted token that looks like a cookie header, or a JWT issued to a web app or to another client ID
- a pasted token whose `expiresAt` has passed

### Token minting and cache

The token request is Adobe's documented one:

```text
POST https://ims-na1.adobelogin.com/ims/token/v3
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=…&client_secret=…&scope=openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis
```

- The cache is in process memory only. A minted token is never written to the connection, logs or responses.
- Entries are keyed by a hash of client ID and secret, so two connections never share a token, and a rotated secret mints a new one.
- Concurrent requests of one connection share a single mint.
- A token is minted again 5 minutes before `expires_in` runs out. A lifetime longer than 24 hours is cut to 24 hours.
- A failed mint is not cached.
- When a status request returns `401`, the token is dropped and one new token is minted for that job.
- When the submit returns `401`, the token it carried is dropped from the cache. In client-credentials mode one new token is minted (bounded by the 15-second IMS timeout and the client's disconnect) and the refused submit is sent once more. A `401` is a refusal, so that submit was never accepted. A second `401` stands, and its token is dropped too. Nothing is resent after a submit that may have been accepted.
- A pasted access token is never refreshed: a submit `401` stands and nothing is minted.
- A submit `403` (entitlement or quota) is not retried and keeps the cached token.
- The adapter does this itself through the image core's `onSubmitAuthRejected` hook. Nothing is merged into the connection credentials, `onCredentialsRefreshed` is not called and nothing is persisted. An injected `refreshCredentials` is not used for this provider.

## What is sent, and where

| Request | Purpose |
| --- | --- |
| `POST https://ims-na1.adobelogin.com/ims/token/v3` | Mint a token (client-credentials mode only) |
| `POST https://firefly-api.adobe.io/v3/images/generate-async` | Submit one job |
| `GET https://firefly-api.adobe.io/v3/status/{jobId}` | Read that job |
| `PUT https://firefly-api.adobe.io/v3/cancel/{jobId}` | Best-effort cancel after a client disconnect or local timeout |

Firefly requests carry `Authorization: Bearer <token>` and `x-api-key: <client ID>`. No browser, cookie or fingerprint header is sent.

Connection settings and upstream answers cannot change these addresses. The `statusUrl` and `cancelUrl` fields of the submit answer are **ignored**. The status and cancel URLs are built from the validated `jobId` on the fixed origin. Token, status and cancel requests refuse redirects.

The submit is sent by the shared image core with `redirect: "manual"`. A `3xx` answer or an opaque redirect is refused with `502` and its body is cancelled. The redirect is never followed, so neither the token nor the body reaches its target. Adobe did not accept the job, so no accepted job is recorded and the next account may be tried. As a second guard, a submit answer that reports it was redirected is not trusted: its token is dropped and the job is recorded as an unknown outcome.

### Submit deadline and disconnects

The submit has 30 seconds. Its fetch gets one signal that aborts at the deadline or when the client disconnects, so the transport itself is torn down. The wait also ends then even if a transport ignores its signal, and an answer that still arrives is cancelled unread.

| Submit transport outcome | Status | Accepted job recorded |
| --- | --- | --- |
| Client disconnected before anything was sent | 499 | No |
| Connection never made (`ECONNREFUSED`, DNS failure, connect timeout) | 502, next account may be tried | No |
| Deadline passed after sending | 504 | Yes, `submit-unknown`, on the selected account |
| Client disconnected after sending | 499 | Yes, `submit-unknown`, on the selected account |
| Other transport failure after sending (for example a reset) | 502 | Yes, `submit-unknown`, on the selected account |

A `submit-unknown` job has unknown cost. The route records it on the account that sent it and does not resubmit it to another account.

The submit body holds `prompt` and `numVariations`, plus these when present:

- `n` becomes `numVariations`, kept between 1 and 4.
- `size` such as `2048x2048` becomes `{ width, height }` when both are 1–4096. Otherwise Adobe's default applies. Adobe decides which sizes a model accepts.
- `contentClass` or `content_class`: `photo` or `art`.
- `negativePrompt` or `negative_prompt`, up to 1024 characters.

The prompt must be 1–1024 characters. Other OpenAI fields such as `quality` are ignored.

## Polling and results

The job is read every 2 seconds for up to 5 minutes. A single status request has at most 30 seconds, and a response is limited to 64 KiB. On status `429` or `503`, polling backs off, honoring `Retry-After`, with waits capped at 30 seconds, for at most 5 consecutive retries. An accepted or possibly accepted submit is never retried by this provider. Only a submit Adobe refused with `401` is resent, once, with a fresh token. `pending`, `running` and `cancel_pending` keep polling.

A result is returned as `data: [{ "url": ... }]`. Every output must have an HTTPS URL without embedded credentials, at most 2083 characters, and there must not be more outputs than requested. Otherwise the whole result is rejected. The pre-signed URLs are returned **without being downloaded**, and never fetched with your credentials. Binary output (`response_format=binary`) makes the shared handler fetch the first URL without any credential, through its public-address guard. How long Adobe's pre-signed URLs last has not been verified.

## Usage and cost

Usage counts the images actually returned. Token counts and cost are **unknown**. Adobe does not return a price, and none is recorded.

After a submit is accepted (any 2xx answer), the job may consume your entitlement. When its outcome cannot be seen, it is recorded as an accepted job with unknown cost, and the gateway does not resubmit it to another account. That covers client disconnects, timeouts, rejected or failed status requests, unreadable or invalid answers, a redirected submit and an unusable job id.

## Errors

| Situation | Status | Accepted job recorded |
| --- | --- | --- |
| Bad, missing, expired or web-app credential | 401, nothing sent | No |
| Unsupported model, reference input, bad prompt or content class | 400, nothing sent | No |
| IMS refuses the credential (`invalid_client`, `invalid_scope`, …) | 401 (403 if IMS says 403) | No, nothing submitted |
| IMS rate limit / server error / unusable answer / timeout | 429 / 502 / 502 / 504 | No, nothing submitted |
| Client disconnects while the token is minted | 499 | No, nothing submitted |
| Submit `401` after one fresh token, or with a pasted token | 401 | No |
| Submit `403` or `429` | Kept as is. A `429` `Retry-After` sets the account cooldown | No |
| Submit redirect (`3xx` or opaque redirect) | 502, not followed | No |
| Status `401` after one re-mint, `401` with a pasted token, `403`, `429` after retries | Kept as is | Yes |
| Status `404`, `500` or other | 502 | Yes |
| Job `failed` with `validation_error`, `bad_request`, `invalid_content_type`, `empty_input_body` | 422 | No |
| Job `failed` with `timeout_error` / `rate_limited` / `access_error` / `runtime_error` | 504 / 429 / 403 / 502 | No |
| Job `failed` with any other code | 502, code not repeated | No |
| Job `cancelled` / `timeout` | 502 / 504 | No |
| Local 5-minute deadline or status request timeout | 504, with a cancel request | Yes |
| Client disconnects during polling | 499, with a cancel request | Yes |

Upstream messages, IMS error descriptions and transport error text are never repeated. Only the documented codes above are. The connection's secret and pasted token, and the temporary token minted for the submit, are redacted from submit error messages.

The `x-access-error` header that Adobe documents on a submit `403` (`quota_exhausted`, `user_non_entitled`, `user_profile_denied`, `invalid_ims_scope`) is not yet read by the shared core, so a quota `403` is not turned into a quota cooldown.

## Offline evidence

`tests/unit/adobe-firefly-api.test.js` drives the real `handleImageGenerationCore` with this adapter, a fetch mock that contacts nothing and only synthetic credentials. Its only substitution is the adapter-map lookup, because the provider is not registered. `tests/unit/adobe-firefly-submit.test.js` drives the real core and the real image route (`src/sse/handlers/imageGeneration.js`) with only account storage, the usage ledger and the adapter-map lookup substituted. It covers `3xx` and opaque redirects with zero forwarding to the target, the submit deadline and caller abort with transport cancellation and late-body cleanup, `submit-unknown` jobs recorded on the selected account without a second submit, pre-connect fallback, submit `401` token eviction and the single fresh-token resend, terminal `401`, pasted tokens, `403`, `Retry-After` and redaction.

The first file covers token minting and its form body, the cache's reuse, expiry and 24-hour cap, account separation, single-flight minting, secret rotation, refusals, IMS errors and timeouts, submit `401`/`403`/`429`, the submit `401` re-mint and resend, redirected submits, unusable job ids, poll `401` re-mint, `403`, `429`/`Retry-After`, malformed status answers, reported failures, the local deadline, request timeouts, client disconnects, cancel requests and credential redaction.

From `tests/`:

```bash
node node_modules/vitest/vitest.mjs run unit/adobe-firefly-api.test.js unit/adobe-firefly-submit.test.js --maxWorkers=2
```

Mocks show only that the code follows Adobe's published contract. They do not show that a live account is entitled, that Adobe accepts these exact requests or that the documented scopes are enough.

## Before registration

A later change has to:

- register `adobe-firefly-api` in the provider registry and add its adapter to `IMAGE_ADAPTERS`
- add an auth form with a client ID field (`providerSpecificData.clientId`), a secret field (`apiKey`, stored like other API keys) and an optional pasted access token with an expiry
- keep the image route's `refreshCredentials` unset for this provider (today `leasedAntigravityRefresher` returns `undefined` for it). The adapter handles a submit `401` itself and must not have a minted token merged or persisted
- read `x-access-error` on a submit `403` for quota cooldowns
- run one owner-authorized live check with a real Firefly Services credential before any claim of live support

## Sources

Written from Adobe's own documentation. No third-party code was ported.

- [AdobeDocs/ffs-firefly-api](https://github.com/AdobeDocs/ffs-firefly-api) at [`1027f559cdb1509a61b34e2f2da9618ec431f2cb`](https://github.com/AdobeDocs/ffs-firefly-api/tree/1027f559cdb1509a61b34e2f2da9618ec431f2cb): [`static/firefly-api.json`](https://github.com/AdobeDocs/ffs-firefly-api/blob/1027f559cdb1509a61b34e2f2da9618ec431f2cb/static/firefly-api.json) (OpenAPI 3.1.0, `info.version` 3.0.0, blob `9004da2c5d57850bb72068e6e06b93e04b1bad9e`, last changed in `0fed5f9c3437ce1072bc7a01616b5d15c5eb1030`)
- [Authentication](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/) (`src/pages/getting-started/index.md`)
- [Adobe Developer Console](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/dev-console/) (`src/pages/getting-started/dev-console/index.md`)
- [Guides](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/) and [Using the async APIs](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/using-async-apis) (`src/pages/guides/how-tos/using-async-apis.md`)
