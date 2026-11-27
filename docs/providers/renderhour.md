---
title: RenderHour
description: Staged and unavailable. RenderHour image generation with an rh_ API key, its job flow, errors and limits.
status: unreleased
---

> **Staged and unavailable.** The code exists, but the provider is not registered. You cannot add a RenderHour connection or send requests to it yet. A later change has to register it.

RenderHour (`renderhour`) generates images through an asynchronous job API at [renderhour.com](https://renderhour.com). It has been tested only against mocks. No real account or RenderHour endpoint has been contacted, so there is no claim that it works against the live service.

## Scope

| Capability | State |
| --- | --- |
| Image generation from a text prompt, with an `rh_` API key | Staged, covered by mocks |
| Reference images and image editing | Not supported. The request is refused |
| Video and speech | Not supported |
| Subscription OAuth sign-in | Not supported |
| Chat | Not part of this provider. It has no chat transport or fallback |

## Credential

Use an API key that starts with `rh_`. It is sent as `Authorization: Bearer rh_...`. A missing key, an OAuth access token or any other key format is refused with `401` before anything is sent. There is no token refresh. Each request uses the key and proxy settings of its selected connection, and polling keeps both for that job.

## What is sent, and where

| Request | Purpose |
| --- | --- |
| `POST https://renderhour.com/v1/generations` | Submit one job. Sent with a new `Idempotency-Key` |
| `GET https://renderhour.com/v1/generations/{id}` | Read that job |

Connection settings cannot change these addresses. Neither request follows a redirect. A redirected submit is refused with `502` and the key is never sent to the new address. That failure records no accepted job, so another connection may try.

The submit body holds `model`, `prompt` and `count`, plus `aspect_ratio` and `config` when present:

- `n` becomes `count`, kept between 1 and 4. A value that is not a number counts as 1.
- `aspect_ratio` is sent as given. Otherwise a `size` such as `1792x1024` becomes the nearest of `1:1`, `3:4`, `4:3`, `4:5`, `9:16` and `16:9`.
- `config.resolution` (or `resolution`) and `config.quality` are sent. The OpenAI `quality` field is ignored.

## Models

`nano-banana-pro`, `nano-banana-2.1`, `nano-banana-2`, `gpt-image-2`, `seedream-5.0-pro`, `seedream-5.0-flash`, `flux-3-image`, `flux-2-pro`, `grok-imagine-image-2.0`, `z-image` and `recraft-v4.1`. Any other id is refused with `400` before submission. This is a fixed list copied from the source. There is no model discovery, and your account may not offer every model.

## Polling and results

The job is read every 2 seconds for up to 5 minutes. A single status request or response body has at most 30 seconds, and a response is limited to 64 KiB. On status `429` or `503`, polling backs off, honoring `Retry-After`, with waits capped at 30 seconds, for at most 5 consecutive retries. The submit is never retried by this provider. The submit itself waits at most 30 seconds. The 5 minutes start when the submit is answered.

A result is returned as `data: [{ "url": ... }]`. Every file must be a PNG, JPEG or WebP with an HTTPS URL that has no embedded credentials and does not contain the connection's API key, raw or URL-encoded. There must not be more files than requested. Otherwise the whole result is rejected. The gateway returns the URLs without downloading them, even if you ask for `b64_json`. Binary output (`response_format=binary`) makes the shared handler fetch the first URL without your API key. Whether RenderHour file URLs work without a key, and how long they last, has not been verified.

## Usage and cost

Usage counts the images actually returned. Token counts and cost are **unknown**. No RenderHour price or receipt is recorded, even if a response contains one.

After a submit is accepted (any 2xx answer), the job may be billed. When its outcome cannot be seen, it is recorded as an accepted job with unknown cost, and the gateway does not resubmit it to another account. That covers cancellation, timeout, a rejected or failed status request and an unreadable or invalid response.

A submit that may have reached RenderHour but got no answer is handled the same way: a submit timeout, a reset connection or any other transport failure after a connection may have been made. It is recorded on the connection that sent it as an accepted job with unknown cost (`jobState: "submit-unknown"`), and no other account gets a second submit. Only a failure before any connection exists (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` or a connect timeout) counts as unsent, so another connection may try.

## Errors

| Situation | Status | Accepted job recorded |
| --- | --- | --- |
| Bad key format, unsupported model or reference image | 401 or 400 | No, nothing sent |
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
| Cancelled while the submit is in flight | 499 | No. Whether RenderHour accepted it is unknown |

A job that RenderHour reports as failed is treated as a normal failure, so the shared account fallback policy decides whether another connection tries a new job. Whether RenderHour charges for failed jobs is unknown. Errors raised while following a job do not repeat RenderHour's text, and only the four failure reasons above are named. A refused submit's message can come from RenderHour, but the selected connection's key is removed from it and from the error body, including on `401` and `403`. A `429` message is always replaced.

When a refused submit is `429` with a `Retry-After` header, either in seconds or as an HTTP date, that exact reset is passed to account cooldown with the source `retry_after`. The client gets the same `Retry-After`. Without the header no reset is claimed.

## Before registration

The three gaps that offline runs found in the shared image handler are closed: submit redirects, an echoed key in submit errors, and a dropped `Retry-After`. Each one is covered by closed-network tests through the shared handler and the image route.

Registration still needs the provider catalog, the image adapter map and the usual generated indexes and dashboard files. Until then, the tests have to substitute the adapter lookup. A live check with a real account is separate and has not happened. It is also unknown whether RenderHour honors `Idempotency-Key` or charges for failed jobs, how long file URLs last, and whether they work without a key.

## Source

Adapted from [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) at `9671192011beb2d7f83979f40be488c5da8772b9` (MIT, Copyright (c) 2026 Cheaper Inference - Created by Diego Souza):

- [`registry/renderhour/mediaModels.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/renderhour/mediaModels.ts)
- [`handlers/mediaGeneration/renderhour.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/mediaGeneration/renderhour.ts)
- [`handlers/imageGeneration/providers/renderhour.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/imageGeneration/providers/renderhour.ts)
- [`handlers/videoGeneration/pollRetry.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/videoGeneration/pollRetry.ts)

Differences from the source: only `rh_` keys and images; fixed addresses with no base URL override; no reference uploads; unknown job statuses stop polling; fixed polling bounds that callers cannot change; and stricter checks on job ids, results and error text.
