---
title: RenderHour
description: Available. RenderHour image, text-to-video and text-to-speech jobs with an rh_ API key or a plan sign-in, their job flow, errors and limits. Mock-tested only.
status: available
---

> **Available, mock-tested only.** You can add a RenderHour connection with an `rh_` API key, or sign in to a RenderHour plan with no extra server setup. Every flow below is covered by closed mocks. No real account or RenderHour endpoint has been contacted, so there is no claim that it works against the live service.

RenderHour (`renderhour`) generates images, videos and speech through one asynchronous job API at [renderhour.com](https://renderhour.com).

## Scope

| Capability | Route | State |
| --- | --- | --- |
| Image generation from a text prompt | `POST /v1/images/generations` | Available. `response_format` `url` only |
| Reference images and image editing | — | Not supported. Refused before submit |
| Video from a text prompt | `POST /v1/video/generations` | Available. `response_format` `url` only. Not on the `/v1/videos` job API |
| Image-to-video (start frame, end frame, reference images) | — | Not supported. Refused before submit |
| Speech from text | `POST /v1/audio/speech` | Available. Raw audio in RenderHour's container, or `response_format=json` |
| Voice selection, a named audio container | — | Not supported. Refused before submit |
| `rh_` API key | All three | Available |
| Plan sign-in (authorization code with PKCE, rotating refresh) | All three | Available by default. `RENDERHOUR_OAUTH_CLIENT_ID` optionally overrides the client |
| Model discovery | Provider models | The pinned lists, after a local check of the selected connection's credential |
| Chat | — | Not part of this provider. No chat transport or fallback |

## Credential

An API-key connection holds a key that starts with `rh_`. Adding one refuses any other format before it is stored. Validation checks only the format: RenderHour has no read-only key check, and a test job would bill.

An OAuth connection holds the plan access token from the sign-in below. The connection's auth type decides which secret is sent, as `Authorization: Bearer …`: an `rh_` key for an API-key connection, the access token for an OAuth connection. A missing secret, an `rh_` key on an OAuth connection or an access token on an API-key connection is refused with `401` before anything is sent. API keys have no refresh. Each request uses the credential and proxy settings of its selected connection, and polling keeps both for that job.

## Subscription sign-in

To sign in, open the RenderHour provider in the dashboard and add an OAuth connection. No environment variable is needed.

RenderHour accepts only loopback redirects, so the redirect is always `http://localhost:<port>/callback` (or `http://127.0.0.1:<port>/callback` when you open the dashboard on that address). The path never includes a dashboard base path.

- **Dashboard opened on `localhost` or `127.0.0.1`.** The redirect uses the dashboard's port and returns to it. With a dashboard base path, the redirected page does not load: copy its address and paste it into the sign-in window.
- **Remote or hosted dashboard.** After you approve, the browser goes to `localhost` on your own computer (the dashboard's port, or `20128` when its address names none), and that page usually does not load. Copy the full address from the address bar and paste it into **Paste callback URL manually**.

The pinned source also signs in to a RenderHour plan, whose access token pays in plan credits on the same `/v1` API. The protocol lives in `services/renderhour/oauth.js`, the handler in `src/lib/oauth/services/renderhour.js`. It is registered as `renderhour` in the OAuth provider map (`src/lib/oauth/providers.js`) and in the refresh table (`open-sse/services/tokenRefresh.js`). The image, video and speech routes refresh an expiring plan token before they submit a job.

What the source shows, and what the registered code does:

- **Client.** The public client id `rhc_omniroute`. It has no secret and is published in the source (`open-sse/utils/publicCreds.ts`, `renderhour_id`).
- **Redirect.** Loopback on any port (RFC 8252 section 7.3). The source's dashboard (`OAuthModal.tsx`, `LOOPBACK_REDIRECT_PROVIDERS`) uses it on remote installs too.
- **Authorize.** `GET https://renderhour.com/oauth/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `state`, an S256 `code_challenge` and no `scope`. The client is public, so there is no client secret.
- **Exchange.** `POST https://renderhour.com/api/oauth/token`, form-encoded, `grant_type=authorization_code` with `client_id`, `code`, `redirect_uri` and `code_verifier`. Then `GET https://renderhour.com/api/oauth/userinfo` with the access token reads `sub`, `email` and `name`. If that call fails, the sign-in is kept without them.
- **Refresh.** `POST` to the same token URL with `grant_type=refresh_token`, `refresh_token` and `client_id`. The source says access tokens (`rhat_`) last an hour and refresh tokens (`rhrt_`) rotate on every refresh, last 30 days and stop working once used. The registered code depends on none of those lifetimes. It refreshes five minutes before the stored expiry, or when no expiry is stored.
- **Refresh failures.** `invalid_grant`, `invalid_token`, `token_expired` or a `401` mean the refresh token is spent. The shared refresh path then checks whether a concurrent refresh already stored a newer pair. If none did, it marks the connection `reauth_required` and keeps the old tokens. Anything else, including `429`, `5xx`, `invalid_client`, a malformed body or a network error, keeps the stored credentials unchanged.
- **Persistence.** A refresh writes only through the shared compare-and-swap commit, bound to the connection's stored tokens and `accountId`. A stale refresh never overwrites a newer pair. Two refreshes of the same connection, or of the same refresh token, share one request, so a single-use token is never sent twice by one process. When RenderHour sends no new refresh token, the stored one is kept.
- **Account selection.** A repeat sign-in replaces the stored connection with the same RenderHour account id (`sub`). Email decides only when an id is missing. Two different ids never match, even with the same email. Connection storage applies this rule (`selectRenderHourConnection`).

Fork differences from the source:

- **Optional client override.** The source has none. See [Client override](#client-override).
- **Redirects refused.** Token and userinfo calls use fixed `https://renderhour.com` addresses with redirects disabled, and a `3xx` answer is treated as a failure. No code, verifier or token follows a redirect.
- **Closed error text.** Only standard OAuth error codes are named. RenderHour's error descriptions, transport errors and callback `error_description` are never repeated.
- **Bound session.** The standalone session compares `state` in constant time, requires the callback to land on the exact redirect origin and path, expires after 10 minutes and completes only once. A forged state does not use up the real session.

Not proven: the mocks follow the source's code and test fixtures. They do not show that RenderHour accepts this client from DurinDoor, the redirect URI or these requests, or that the stated token lifetimes hold.

### Client override

Authorize, code exchange and refresh all take the client id from the same setting:

| `RENDERHOUR_OAUTH_CLIENT_ID` | Result |
| --- | --- |
| Not set | The public client `rhc_omniroute` |
| A RenderHour client id: `rhc_` followed by 1 to 64 letters, digits, `_` or `-` (surrounding spaces are ignored) | That client |
| Set but blank, or anything else | Configuration error. The public client is not used instead |

With a configuration error, sign-in fails with a message that names the variable and never repeats its value. No code exchange or refresh request is sent, and stored tokens are kept without marking the connection `reauth_required`. A stored plan access token still works for media jobs until it expires. `rh_` API-key connections and other providers are not affected. To use the default, remove the variable. Setting it to an empty value is an error.

A refresh uses the client that is selected at that time. A refresh token issued to one client is not expected to work with another, so sign in again after you add, change or remove the override. An override client must accept the loopback redirect above. Whether RenderHour issues client ids to third parties is unknown.

## What is sent, and where

| Request | Purpose |
| --- | --- |
| `POST https://renderhour.com/v1/generations` | Submit one job. Sent with a new `Idempotency-Key` |
| `GET https://renderhour.com/v1/generations/{id}` | Read that job |
| `GET` the finished speech file, on `renderhour.com` or a subdomain | Speech only. Sent without the key |

Connection settings cannot change these addresses. Neither request follows a redirect. A redirected submit is refused with `502` and the key is never sent to the new address. That failure records no accepted job, so another connection may try.

For images, the submit body holds `model`, `prompt` and `count`, plus `aspect_ratio` and `config` when present:

- `n` becomes `count`, kept between 1 and 4. A value that is not a number counts as 1.
- `aspect_ratio` is sent as given. Otherwise a `size` such as `1792x1024` becomes the nearest of `1:1`, `3:4`, `4:3`, `4:5`, `9:16` and `16:9`.
- `config.resolution` (or `resolution`) and `config.quality` are sent. The OpenAI `quality` field is ignored.

## Models

The registry entry lists all 30 models, each with its kind (`image`, `video` or `tts`). Every model id belongs to exactly one task. A model of another task, or any id RenderHour does not list (a chat model, for example), is refused with `400` before submission, and the message names the task the id belongs to. A chat-shaped body (`messages`, `tools`) is refused too.

Image: `nano-banana-pro`, `nano-banana-2.1`, `nano-banana-2`, `gpt-image-2`, `seedream-5.0-pro`, `seedream-5.0-flash`, `flux-3-image`, `flux-2-pro`, `grok-imagine-image-2.0`, `z-image` and `recraft-v4.1`.

Video: `seedance-2.5`, `seedance-2.0`, `seedance-2.0-fast`, `seedance-2.0-mini`, `kling-3.0`, `kling-3.0-turbo`, `veo-3.1`, `grok-imagine-video-1.5`, `grok-imagine-video-1.5-lite`, `happyhorse-1.1`, `gemini-omni-flash`, `flux-3-video`, `flux-3-max`, `wan-3.0`, `minimax-h3` and `hailuo-2.3`.

Speech: `eleven-v4`, `eleven-v4-turbo` and `minimax-speech-2.8-hd`.

These are fixed lists copied from the source.

### Discovery

The provider models endpoint answers through `discoverRenderHourModels(credentials, { task })`, which returns the models of one task, or of all three, for the selected connection. It is static. The source says its list mirrors RenderHour's `GET /v1/models`, but it ships no client for that endpoint and does not document the response, so nothing is fetched. The call only checks that the connection holds a usable `rh_` key or plan token (otherwise `401`). It answers `accountVerified: false`: whether that account can use each model is unknown. The result is built per call, so one account never sees another's.

## Video

A video request is the OpenAI-style JSON body. The submit body holds `model` and `prompt`, plus these when present:

- `duration_s`, from `duration_s`, `duration` or `seconds` (`8`, `"8"` or `"8s"`), rounded to whole seconds. A value that is not a positive number is refused with `400`.
- `aspect_ratio`: `aspect_ratio` (or `ratio`) if it is `16:9`, `9:16` or `1:1`, otherwise `400`. Without one, a `size` such as `1280x720` becomes the nearest of those three.
- `config`: `resolution`, `quality`, `mode`, `audio` and `duration_s` from `config`, plus the top-level `resolution`, `mode` and `audio`. Other `config` keys are dropped.

`image`, `image_url`, `start_image`, `first_frame`, `end_image`, `last_frame`, `reference_images`, `image_urls`, `input_reference` and their spellings are refused with `400`. The source would upload them first, which this slice does not.

The job is read every 5 seconds for up to 15 minutes. The result is `{ created, data: [{ url, format }] }` with up to 4 files. Each must be an MP4, WebM or QuickTime file with an HTTPS URL that has no embedded credentials and does not contain the key. URLs are returned without being downloaded. Any `response_format` other than `url` (for example `b64_json`) is refused with `400` before submit. Usage counts the videos returned. Duration and cost are unknown.

## Speech

The speech adapter follows the speech core contract. The text input becomes the job's `text`, trimmed. `voice` and `response_format` are not sent, because RenderHour picks the voice and the container. Without a `response_format`, the response is the raw file and its `Content-Type` names the container RenderHour produced. With `response_format=json`, it is `{ audio, format }`. Any other named format (`mp3`, `wav`, …) is refused with `400` before submit, because the container cannot be promised. A `model/voice` id is refused with `400`. The job is read every 2 seconds for up to 3 minutes.

The first finished file is downloaded and returned as audio in the container RenderHour produced (MP3, WAV, Ogg, Opus, AAC, FLAC, MP4 or WebM audio). The download:

- goes only to `renderhour.com` or one of its subdomains, over HTTPS;
- carries no `Authorization` header and never the key;
- does not follow redirects;
- uses the selected connection's proxy;
- is limited to 25 MiB and 60 seconds.

Usage counts the input characters, as for every speech provider. Cost is unknown. Whether RenderHour file URLs work without a key, whether they redirect and which content types RenderHour really reports have not been verified. Any of those can make a real speech job fail here.

## Video and speech submits

The video and speech adapters cannot use the shared image core, so `services/renderhour/media.js` applies the same submit policy as the image core: one bounded submit with a new `Idempotency-Key`, a refused redirect, no resubmission, and the same accepted-job rules. Its results use the core shape. An error result has `acceptedJob` (`modality: "video"` or `"tts"`, unknown cost) whenever RenderHour may have taken the job.

## Polling and results

These rules apply to images. Video and speech use the same poll, retry and size bounds, with the intervals and deadlines given above.

The job is read every 2 seconds for up to 5 minutes. A single status request or response body has at most 30 seconds, and a response is limited to 64 KiB. On status `429` or `503`, polling backs off, honoring `Retry-After`, with waits capped at 30 seconds, for at most 5 consecutive retries. The submit is never retried by this provider. The submit itself waits at most 30 seconds. At that deadline, or when the client disconnects, the outgoing request is aborted, not only abandoned, and the body of any answer that still arrives is cancelled. The 5 minutes start when the submit is answered.

A result is returned as `data: [{ "url": ... }]`. Every file must be a PNG, JPEG or WebP with an HTTPS URL that has no embedded credentials and does not contain the connection's secret, raw or URL-encoded. There must not be more files than requested. Otherwise the whole result is rejected. The gateway returns the URLs without downloading them. `response_format` `b64_json` and `binary` are refused with `400` before submit, so no job is billed for a format the gateway would not return. Whether RenderHour file URLs work without a key, and how long they last, has not been verified.

## Usage and cost

Usage counts the images actually returned. Token counts and cost are **unknown**. No RenderHour price or receipt is recorded, even if a response contains one.

After a submit is accepted (any 2xx answer), the job may be billed. When its outcome cannot be seen, it is recorded as an accepted job with unknown cost, and the gateway does not resubmit it to another account. That covers cancellation, timeout, a rejected or failed status request and an unreadable or invalid response.

A submit that may have reached RenderHour but got no answer is handled the same way: a submit timeout, a client disconnect while the submit is in flight, a reset connection or any other transport failure after a connection may have been made. It is recorded on the connection that sent it as an accepted job with unknown cost (`jobState: "submit-unknown"`), and no other account gets a second submit. Only a failure before any connection exists (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` or a connect timeout) counts as unsent, so another connection may try. A client that disconnects before the submit is started gets `499` with nothing sent and nothing recorded.

## Errors

| Situation | Status | Accepted job recorded |
| --- | --- | --- |
| Bad key format, unsupported or other-task model, chat body, reference image, image-to-video input or unsupported `response_format` | 401 or 400 | No, nothing sent |
| Submit refused, such as 401, 403 or 429 | Same as RenderHour | No |
| Submit redirected | 502 | No. The redirect is not followed |
| Submit timed out after 30 seconds | 504 | Yes, as `submit-unknown` |
| Submit connection lost after it may have been sent | 502 | Yes, as `submit-unknown` |
| Submit could not connect at all | 502 | No |
| Status request refused with 401 or 403 | Same | Yes |
| Status request still 429 when retries or time run out | 429 | Yes |
| Any other status request failure | 502 | Yes |
| Job reported `failed`: `moderation` or `invalid_input` | 422 | No |
| Job reported `failed`: `timeout` or `expired` | 504 | No |
| Job reported `failed`: any other reason | 502 | No |
| Not finished in 5 minutes, or a status request timed out | 504 | Yes |
| Invalid job response or unusable result, including a response body that times out | 502 | Yes |
| Cancelled after the submit was accepted | 499 | Yes |
| Cancelled before the submit is sent | 499 | No, nothing sent |
| Cancelled while the submit is in flight | 499 | Yes, as `submit-unknown`, on the connection that sent it |
| Speech file off RenderHour's hosts, refused, redirected, empty, too large or timed out | 502 or 504 | Yes |
| Cancelled during the speech download | 499 | Yes |

The table holds for all three tasks. Job error messages name the task, for example `RenderHour video job failed: moderation`.

A job that RenderHour reports as failed is treated as a normal failure, so the shared account fallback policy decides whether another connection tries a new job. Whether RenderHour charges for failed jobs is unknown. Errors raised while following a job do not repeat RenderHour's text, and only the four failure reasons above are named. A refused submit's message can come from RenderHour, but the selected connection's key is removed from it and from the error body, including on `401` and `403`. A `429` message is always replaced.

When a refused submit is `429` with a `Retry-After` header, either in seconds or as an HTTP date, that exact reset is passed to account cooldown with the source `retry_after`. The client gets the same `Retry-After`. Without the header no reset is claimed.

## Registration and evidence

Registered for #2034 (1127): the registry entry (`open-sse/providers/registry/renderhour.js`), `IMAGE_ADAPTERS`, `TTS_ADAPTERS`, the synchronous video adapter map (`open-sse/handlers/videoProviders/index.js`), the OAuth provider map, the refresh table, connection create and validate, and model discovery. The speech and video routes record an accepted job with unknown cost when a job may bill and its outcome cannot be seen, and do not resubmit it to another account. RenderHour has no `videoConfig` or `ttsConfig`, so the `/v1/videos` job proxy never reaches it.

`tests/unit/provider-media-registration-1127.test.js` drives the public routes with closed mocks: connection create and validate, discovery, image, video and speech submit/poll/result, plan-token refresh and rotation persistence, sign-in start with a blank and a valid client override, PKCE exchange and account separation, `429` with `Retry-After`, redirected submits, an uncertain submit not repeated on a second account, deadline and client-disconnect accepted jobs, `response_format` refusals and two concurrent accounts. `tests/unit/renderhour-public-client.test.js` drives the OAuth route and the shared refresh with the default client, a valid override and invalid overrides, and checks the loopback redirect and API-key independence. The other `renderhour-*` test files cover the adapters and cores in detail.

Not proven: a live check with a real account has not happened for any task or for the sign-in. The mocks show what the gateway sends and how it reads answers shaped like the source's. They do not show that RenderHour accepts these requests or this client from DurinDoor. It is also unknown whether RenderHour honors `Idempotency-Key` or charges for failed jobs, how long file URLs last, and whether they work without a key.

## Source

Adapted from [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) at `9671192011beb2d7f83979f40be488c5da8772b9` (MIT, Copyright (c) 2026 Cheaper Inference - Created by Diego Souza). The public client id and the redirect rule were checked at `release/v3.8.55`, `d3f06ea668109f8ac1feadfcae25f6ff9b873b5f`, where the OAuth constants, public credentials, endpoint constants, OAuth provider, token refresh and OAuth test files are byte-identical to the pin:

- [`open-sse/utils/publicCreds.ts`](https://github.com/cheaper-inference/OmniRoute/blob/d3f06ea668109f8ac1feadfcae25f6ff9b873b5f/open-sse/utils/publicCreds.ts#L175) (`renderhour_id`)
- [`src/shared/components/OAuthModal.tsx`](https://github.com/cheaper-inference/OmniRoute/blob/d3f06ea668109f8ac1feadfcae25f6ff9b873b5f/src/shared/components/OAuthModal.tsx) (`LOOPBACK_REDIRECT_PROVIDERS`)

- [`registry/renderhour/mediaModels.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/renderhour/mediaModels.ts)
- [`handlers/mediaGeneration/renderhour.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/mediaGeneration/renderhour.ts)
- [`handlers/imageGeneration/providers/renderhour.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/imageGeneration/providers/renderhour.ts)
- [`handlers/videoGeneration/renderhourHandler.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/videoGeneration/renderhourHandler.ts)
- [`handlers/renderhourSpeech.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/renderhourSpeech.ts)
- [`src/lib/oauth/providers/renderhour.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/src/lib/oauth/providers/renderhour.ts)
- [`src/lib/oauth/constants/oauth.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/src/lib/oauth/constants/oauth.ts) (`RENDERHOUR_CONFIG`)
- [`services/tokenRefresh/providers/renderhour.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/tokenRefresh/providers/renderhour.ts)
- [`tests/unit/renderhour-oauth-provider.test.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/tests/unit/renderhour-oauth-provider.test.ts)
- [`handlers/videoGeneration/pollRetry.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/videoGeneration/pollRetry.ts)

Differences from the source: the sign-in has an optional client override; fixed addresses with no base URL override; no reference or frame uploads; no voice selection; speech files downloaded only from RenderHour hosts, without the key; unsupported video ratios and durations refused; unknown job statuses stop polling; fixed polling bounds that callers cannot change; and stricter checks on job ids, results and error text.
