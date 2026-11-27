---
title: Adobe Firefly Services API
description: Staged and unavailable. Firefly Services image and text-to-video generation with an Adobe Developer Console OAuth Server-to-Server credential, its job flow, errors and limits.
status: unreleased
---

> **Staged and unavailable.** The code exists, but the provider is not registered. You cannot add an Adobe Firefly Services API connection or send requests to it yet. A later change has to register it.

Adobe Firefly Services API (`adobe-firefly-api`) generates images, and in a separately staged slice five-second videos, through Adobe's published, asynchronous [Firefly API](https://developer.adobe.com/firefly-services/docs/firefly-api/). It has been tested only against mocks. No Adobe account, IMS endpoint or Firefly endpoint has been contacted, so there is no claim that it works against the live service.

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
| Text-to-video with `POST /v3/videos/generate`, model `video1_standard` | Staged separately, covered by mocks. See [Video](#video) |
| Image-to-video keyframes (`image.conditions`) | Not supported. Refused |
| Reference images, style and structure references, expand, fill, upscale | Not supported. Refused or not exposed |
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
node node_modules/vitest/vitest.mjs run unit/adobe-firefly-api-video.test.js unit/adobe-firefly-api.test.js unit/adobe-firefly-submit.test.js --maxWorkers=2
```

Mocks show only that the code follows Adobe's published contract. They do not show that a live account is entitled, that Adobe accepts these exact requests or that the documented scopes are enough.

## Video

The video slice is staged on its own. Nothing registers it, and the image adapter, image models and image routes do not know it. It uses the same connection credential, the same in-memory token cache and the same fixed origin as images.

### Entitlement

Generate Video is part of the Firefly Services API. Adobe's [usage notes](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/) have a "Generate Video API usage" section, and the [changelog](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/changelog/) lists its launch on June 19, 2025. Your organization's Services entitlement has to include it. Whether a given credential may generate video is decided by Adobe: a refusal comes back as a submit `403`, with `x-access-error` (`quota_exhausted`, `user_non_entitled`, `user_profile_denied` or `invalid_ims_scope`) repeated in the message when Adobe sends one of those values.

This is Adobe's own native video model through the Services API. It is not the firefly.adobe.com web app, and it gives no access to the third-party video models that web app may offer. No claim is made that it matches the web app's output, options or models. It has not been run against a live Adobe account.

### Exports

From `open-sse/providers/private/adobe-firefly-api.js` (the default export stays image-only, `serviceKinds: ["image"]`):

| Export | Value |
| --- | --- |
| `ADOBE_FIREFLY_VIDEO_GENERATE_URL` | `https://firefly-api.adobe.io/v3/videos/generate` |
| `ADOBE_FIREFLY_VIDEO_MODEL_IDS` | `["video1_standard"]` |
| `ADOBE_FIREFLY_VIDEO_SECONDS` | `5` |
| `ADOBE_FIREFLY_VIDEO_SIZES` | The nine documented `[width, height]` pairs |
| `ADOBE_FIREFLY_STAGED_VIDEO` | `{ serviceKinds: ["video"], models: [{ id: "video1_standard", kind: "video", … }], videoConfig: { baseUrl } }`, for the registration change |

From `open-sse/handlers/videoProviders/adobe-firefly-api.js`: the default adapter, `createAdobeFireflyApiVideoAdapter(options)` and `buildAdobeFireflyVideoRequest(model, body)`. The adapter has `async: true` and one method, `generate({ model, body, credentials, signal, log })`, the same shape as the staged RenderHour video adapter.

From `open-sse/services/adobeFireflyApi/video.js`: `runAdobeFireflyVideoJob`, `awaitAdobeFireflyVideo`, `adobeFireflyVideoAcceptedJob` and the `ADOBE_FIREFLY_VIDEO_*` bounds.

### Routes

Only a **synchronous** generation is supported: `generate()` submits, polls and returns once the job has a URL, failed or was abandoned. Once registered, that fits a one-shot route such as `POST /v1/video/generations`.

The asynchronous `/v1/videos` job API (create, then `GET /v1/videos/{request_id}`) is **not** supported. That route forwards the client's body to a configured base URL, which cannot mint IMS tokens, add `x-api-key` and `x-model-version`, or keep the token on the fixed origin. There is no job-id handoff to the client.

### Request

| Field | Sent as |
| --- | --- |
| `prompt` (required) | `prompt`. Adobe documents no length limit; the gateway allows up to 4096 characters |
| `size` such as `1280x720` | `sizes: [{ width, height }]`. Only the nine sizes in the usage notes: 1920x1080, 1280x720, 960x540, 1080x1920, 720x1280, 540x960, 1080x1080, 720x720, 540x540 |
| `aspect_ratio` (`16:9`, `9:16`, `1:1`) with `resolution` (`1080p`, `720p`, `540p`) | The matching documented size. A ratio without a resolution is refused |
| `seed`, or `seeds` with one integer | `seeds: [n]`. Adobe supports one seed |
| `bitRateFactor` or `bit_rate_factor` | `bitRateFactor`, an integer 0–63 |
| `cameraMotion`, `promptStyle`, `shotAngle`, `shotSize` (or snake case, or inside `videoSettings`) | `videoSettings`, only with Adobe's documented enum values |
| `seconds`, `duration`, `duration_s` | Not sent. Must be 5 if present, because every video is five seconds |
| `n` | Not sent. Must be 1 if present |

The model `video1_standard` is sent as `x-model-version`. Image models are refused with `400`, naming them as image models, and video models are refused by the image adapter. Image inputs (`image`, `image_url`, first and last frames, references, `conditions`) and chat bodies are refused with `400` before anything is sent. Without a size, Adobe's default applies.

### Job flow

| Request | Purpose |
| --- | --- |
| `POST https://ims-na1.adobelogin.com/ims/token/v3` | Mint a token (client-credentials mode only), shared with images |
| `POST https://firefly-api.adobe.io/v3/videos/generate` | Submit one job, `redirect: "manual"`, 30 seconds |
| `GET https://firefly-api.adobe.io/v3/status/{jobId}` | Read that job, every 10 seconds for up to 10 minutes |
| `PUT https://firefly-api.adobe.io/v3/cancel/{jobId}` | Best-effort cancel after a disconnect, deadline or late submit answer |

The adapter carries its own submit policy, matching the image core's: a redirect is refused and never followed, a followed redirect is an unknown outcome and drops the token, and the submit is resent only after a `401` with one newly minted token. The token stays in the in-memory cache, and nothing is written to the connection.

If the submit deadline passes or the client disconnects and Adobe answers later, that answer is not used. When it accepted a job, the job is cancelled on the fixed origin; it is never polled.

The status poll is the image poll with video bounds: 10-second interval, 10-minute deadline, 30-second request bound, 64 KiB bodies, one re-mint on a status `401`, and up to 5 retries on `429`/`503` honoring `Retry-After` with waits capped at 60 seconds. Adobe's default rate limit is 4 requests per minute per organization; the spec does not say whether status reads count toward it.

### Result

The spec's status operation names `JobResponse`, whose success schema lists image outputs. The only video result schema it publishes is `AsyncResult`, with `outputs[].video.url`. A succeeded job must have exactly one output with an HTTPS `video.url` without embedded credentials, at most 2083 characters. Anything else is an unknown outcome. Whether a live video job answers exactly this way has not been verified.

The result is `{ created, data: [{ url }] }`. The pre-signed URL is returned **without being downloaded**, even for `response_format: "b64_json"`, and is never fetched with a credential.

### Usage, cost and errors

Usage is `nativeUnits: { videos: 1 }` (`nativeUnitsSource: "returned-videos"`) on the selected connection. Cost is unknown. Adobe returns no price.

Errors follow the image table above, with these differences: submit errors are the gateway's own text (a `400`/`422` becomes `400`, `415` stays, `408` becomes `504`, other statuses `502`), with only a documented `x-access-error` value repeated; a submit `429` `Retry-After` sets the account cooldown; and the local deadline is 10 minutes. Accepted jobs whose outcome is unknown carry `acceptedJob` with `modality: "video"`, `costSource: "accepted-job"` and `jobState` `accepted` or `submit-unknown`.

### Offline evidence

`tests/unit/adobe-firefly-api-video.test.js` drives the real adapter, service and auth modules with a fetch mock that contacts nothing and only synthetic credentials. It covers image/video separation and staging, request mapping and refusals, both credential modes and web-app refusal, IMS refusal, success with fixed status URLs and unfetched results, token reuse, two concurrent accounts, submit `401` re-mint and terminal `401`, `403` with `x-access-error`, `429` `Retry-After`, other submit statuses, redirects, transport failures with no replay, caller abort before and during submit, late-answer cleanup with a fixed-origin cancel, reported and malformed jobs, poll `401`/`403`/`429`/`503`, caller abort and deadline cancels, and secret redaction. The image test files are unchanged.

## Before registration

A later change has to:

- register `adobe-firefly-api` in the provider registry and add its adapter to `IMAGE_ADAPTERS`
- add an auth form with a client ID field (`providerSpecificData.clientId`), a secret field (`apiKey`, stored like other API keys) and an optional pasted access token with an expiry
- keep the image route's `refreshCredentials` unset for this provider (today `leasedAntigravityRefresher` returns `undefined` for it). The adapter handles a submit `401` itself and must not have a minted token merged or persisted
- read `x-access-error` on a submit `403` for quota cooldowns
- for video, add the staged video adapter to the video route and the `ADOBE_FIREFLY_STAGED_VIDEO` models to the provider's model list, keeping image and video models apart
- run one owner-authorized live check with a real Firefly Services credential before any claim of live support, separately for video

## Sources

Written from Adobe's own documentation. No third-party code was ported.

- [AdobeDocs/ffs-firefly-api](https://github.com/AdobeDocs/ffs-firefly-api) at [`1027f559cdb1509a61b34e2f2da9618ec431f2cb`](https://github.com/AdobeDocs/ffs-firefly-api/tree/1027f559cdb1509a61b34e2f2da9618ec431f2cb): [`static/firefly-api.json`](https://github.com/AdobeDocs/ffs-firefly-api/blob/1027f559cdb1509a61b34e2f2da9618ec431f2cb/static/firefly-api.json) (OpenAPI 3.1.0, `info.version` 3.0.0, blob `9004da2c5d57850bb72068e6e06b93e04b1bad9e`, last changed in `0fed5f9c3437ce1072bc7a01616b5d15c5eb1030`)
- [Authentication](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/) (`src/pages/getting-started/index.md`)
- [Adobe Developer Console](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/dev-console/) (`src/pages/getting-started/dev-console/index.md`)
- [Usage notes](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/usage-notes/) (`src/pages/getting-started/usage-notes/index.md`, blob `975ebb6e3e875cb66c0d600abde6d7518682f8b4`): rate limits and Generate Video sizes
- [Changelog](https://developer.adobe.com/firefly-services/docs/firefly-api/getting-started/changelog/) (`src/pages/getting-started/changelog/index.md`, blob `6c92714c45bbe0a80aa15baf3c4bb3a79190005b`): Generate Video launch
- [Guides](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/) and [Using the async APIs](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/how-tos/using-async-apis) (`src/pages/guides/how-tos/using-async-apis.md`)
