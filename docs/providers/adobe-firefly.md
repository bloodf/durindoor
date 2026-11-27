---
title: Adobe Firefly
description: Not available. Why the pinned source gives no bearer-only image contract, and what would have to change.
---

> **Not available.** DurinDoor has no Adobe Firefly provider. There is no adapter, staged or registered. You cannot add a connection or send requests to it.

This page records why an adapter for a pasted Adobe sign-in (IMS) bearer token was not built. The finding comes from reading source code. No Adobe account or endpoint was contacted, so nothing here is verified against the live service.

## Finding

The wanted adapter would send a user-pasted bearer token to Firefly's `generate-async` endpoint, then poll for the image, with no browser emulation.

The pinned [OmniRoute](https://github.com/cheaper-inference/OmniRoute/tree/9671192011beb2d7f83979f40be488c5da8772b9) source does not provide that contract. Its image, video and upload requests all build headers that present the gateway as Adobe's web app in a browser. No code path in it submits with only the bearer token.

| What the source sends or states | Source |
| --- | --- |
| The module describes itself as "browser-session emulation" | [`adobeFireflyArp.ts`, line 2](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyArp.ts#L2) |
| A fixed Chrome `User-Agent`, Firefly `Origin` and `Referer`, and `sec-ch-ua` and `sec-fetch-*` headers | [`browserHeaders`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyArp.ts#L21) |
| Every submit has `x-arp-session-id`. If none was supplied, one is generated | [`buildAdobeSubmitHeaders`, lines 312–347](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyArp.ts#L312-L347) |
| The generated value imitates Arkose and Forter anti-abuse data, a browser fingerprint and a FingerprintJS result | [`buildAdobeArpSessionId`, from line 108](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyArp.ts#L108) |
| A derived `x-nonce`. A comment says that outside Adobe's web app, random values still get HTTP `408` on many accounts and the derived value is what unblocks generation | [`adobeFireflyArp.ts`, from line 47](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyArp.ts#L47) |
| A comment says generated sessions without real Arkose data often get `408` | [`adobeFireflyArp.ts`, from line 62](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyArp.ts#L62) |
| The error shown to users says "JWT alone almost always 408s even when credits/Limits work" | [`adobeFireflyResponses.ts`, line 76](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyResponses.ts#L76) |
| `x-api-key` is the client ID of Adobe's own web app, and a comment says it must match the token's client or the request gets `401` | [`adobeFireflyClient.ts`, lines 18–19](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyClient.ts#L18-L19) |
| To keep requests working, the session layer refreshes this data from cookies or a signed-in Chrome profile | [`adobeFireflySession.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflySession.ts) |

The `408` statements are the source authors' claims. They were not reproduced here. They do not prove that a bearer-only request always fails. They do mean there is no source evidence that it works, and some evidence that it usually does not.

Polling is closer to bearer-only. A [comment says the captured poll used only the bearer and `Accept`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyResponses.ts#L29-L38), although the code also sends a Chrome `User-Agent` and the Firefly `Referer`. This does not help without a working submit.

## Why no adapter was built

DurinDoor excluded these for this work: browser sign-in, device fingerprinting, headers that impersonate or emulate a browser or Adobe's app, and capture of credentials whose contract is unverified.

- Generating `x-arp-session-id` is fingerprint forgery.
- Asking users to copy a real `x-arp-session-id`, `sherlockToken` or cookie jar is capture of device-fingerprint and risk data.
- An adapter that sent only the bearer, `x-api-key` and `Content-Type` would rest on a contract that no examined source shows working. Mock tests for it would only confirm our own guess.

[CLIProxyAPI at `47f18e4`](https://github.com/router-for-me/CLIProxyAPI/tree/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e), the other pinned source, adds no Firefly contract. A search for `firefly` and `adobe` found only Adobe file types in its MIME table.

Adobe's separately documented Firefly Services API uses a different credential and contract: an operator-entitled OAuth Server-to-Server credential from Adobe Developer Console and the published [AdobeDocs/ffs-firefly-api](https://github.com/AdobeDocs/ffs-firefly-api/tree/1027f559cdb1509a61b34e2f2da9618ec431f2cb) contract. That separate decision is the staged [Adobe Firefly Services API](./adobe-firefly-api.md) provider (`adobe-firefly-api`). It does not reuse this web-app route, its client IDs, cookies or browser headers, and it does not make `adobe-firefly` or `firefly` known IDs.

## What DurinDoor does today

Both `adobe-firefly` and `firefly` are unknown provider IDs.

| Action | Result |
| --- | --- |
| Save a connection through `POST /api/providers` | `400 Invalid provider`; nothing is stored |
| Image generation core | `400`, `Provider '<id>' does not support image generation` |
| Image edit or synchronous video core | `400` |
| Chat core, streaming or not | `502`, `Unknown provider "<id>": no supported transport endpoint` |

In these tested paths nothing is sent to Adobe or any other host, and chat usage is not recorded. A model name such as `adobe-firefly/nano-banana-pro` is not rerouted to another vendor.

OmniRoute adds a [Firefly chat guard](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/adobe-firefly.ts) because its default executor would otherwise send the Adobe credential to another vendor. DurinDoor needs no extra guard while the ID is unregistered: an unknown provider has no endpoint, so the request fails before it is sent.

## Offline evidence

`tests/unit/adobe-firefly-images.test.js` uses synthetic tokens and a fetch mock that contacts nothing. It covers well-formed, expired and malformed tokens, a token with cookies, and two concurrent accounts. Control cases show that the same harness does see requests and saves from registered providers. The cores are called directly; the public `/v1` routes are not exercised.

There is no adapter, so success, upstream authentication and quota errors, polling failures and timeouts, cancellation and redirects are **not** covered by mocks.

From `tests/`:

```bash
node node_modules/vitest/vitest.mjs run unit/adobe-firefly-images.test.js --maxWorkers=2
```

## Before building it

First, there must be evidence that submit works with a bearer token and without the excluded headers or data, using a client identity that DurinDoor is allowed to use. That evidence should be Adobe documentation, or a check on an account whose owner has authorized it.

Do not copy these behaviors from the pinned source:

- **Poll destination.** The URL [comes from the submit response](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyResponses.ts#L92-L120). [URLs whose host does not start with `firefly-epo` are returned unchanged](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyResponses.ts#L131-L137), and the poll [sends the bearer there](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyPoll.ts#L47-L50). An adapter must allow only fixed HTTPS hosts before attaching a credential.
- **Redirects and cancellation.** The [submit](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyClient.ts#L240-L248) and poll requests set no redirect mode and no abort signal, and the poll wait cannot be cancelled. An adapter must refuse redirects, bound each request and the whole job, and stop when the client disconnects.
- **Accepted jobs.** Once submit succeeds, the job may use credits. A later failure to read its status must be recorded as an unknown outcome, not retried as a new job.
- **Quota.** The source reads `x-access-error: taste_exhausted` on `401` or `403` as exhausted quota (`429`), not an expired token. This is unverified.
- **Model names.** The source [turns an unrecognized image model into Nano Banana Pro](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/services/adobeFireflyPayload.ts#L161). An adapter must reject it.

When a contract is established, replace the unavailability tests with adapter tests for each of these cases and for account separation.

## Attribution

The behavior described here was read from [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) at `9671192011beb2d7f83979f40be488c5da8772b9` (MIT, Copyright (c) 2026 Cheaper Inference, created by Diego Souza): `open-sse/executors/adobe-firefly.ts`, `open-sse/handlers/imageGeneration/providers/adobeFirefly.ts` and `open-sse/services/adobeFirefly*.ts`. No OmniRoute code was ported.
