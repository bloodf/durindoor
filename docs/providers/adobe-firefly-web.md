---
title: Adobe Firefly (experimental browser)
description: Experimental operator-mapped browser provider, tested with mocks only. A guarded browser flow for the Firefly website, image and video, driven by an operator-owned profile and an operator-validated control mapping.
status: experimental
---

> **Experimental, operator-mapped, mock-only verification.** `adobe-firefly-web` is available in the catalog for explicit per-connection configuration. It is disabled by default. No live Adobe compatibility or entitlement is verified.

This provider drives Adobe's ordinary Firefly website (`https://firefly.adobe.com`) in an unmodified Playwright Chromium. It is separate from the registered [Adobe Firefly Services API](./adobe-firefly-api.md) (`adobe-firefly-api`), which uses an Adobe Developer Console credential. It does not make `adobe-firefly` or `firefly` known IDs; see [Adobe Firefly](./adobe-firefly.md).

## What is implemented

- One canonical ID, `adobe-firefly-web`, with no alias and `authType: none`. It serves images and video.
- Two adapters with the gateway's synchronous `.generate({ model, body, credentials, signal, log })` contract: images (`open-sse/handlers/imageProviders/adobe-firefly-web.js`) and video (`open-sse/handlers/videoProviders/adobe-firefly-web.js`). They are registered for `/v1/images/generations` and synchronous `/v1/video/generations`.
- The browser flow in `open-sse/services/fireflyWebUi/`, plus setup helpers (`initializeFireflyWebUiProfile`, `openFireflyWebUiSetup`, `closeFireflyWebUiSetup`) behind the authenticated dashboard connection setup route.

The tests use a synthetic fake browser only. No real browser was launched, no Adobe page was loaded and no generation was made.

## What the operator must provide

Everything lives on the stored connection, in `providerSpecificData.fireflyWebUi`. A request body cannot set or override any of it.

| Field | Requirement |
| --- | --- |
| `enabled` | Exactly `true`. Any other value keeps the provider off. |
| `profileHandle` | The 32-character hex handle the server created for this connection. It cannot be supplied or replaced by a client. |
| `mapping.validatedBy`, `mapping.validatedAt` | `"operator"` and an ISO 8601 time. The operator has checked the mapping against their own current Firefly UI. |
| `mapping.locators` | Role/name or label locators only (`{ role, name }` or `{ label }`): `prompt`, `submit`, `modelPicker`, `modelOptionRole`, `resultItem`, `resultReady`, `download`, `stopMarkers`, and optionally `identityAttr` (`id` or a `data-*` attribute). No CSS, XPath, script or evaluation. |
| `mapping.startPaths` | Optional plain paths on the Firefly origin for `image` and `video`. The origin itself is fixed. |
| `modelMap` | Public model ID to `{ label, kind }`, where `label` is the UI's model name and `kind` is `image` or `video`. Only these models run. |
| `limits` | Optional, each inside fixed bounds: overall, navigation, action and download timeouts, poll interval, prompt length, image and video byte limits, result item count. |

DurinDoor ships **no default Adobe selectors**. Adobe's help pages describe a Prompt field, a Model choice, a Generate action and a download in Generation history, but publish no stable accessible names. The operator supplies and validates every locator.

The connection holds no API key, bearer, access token or cookie. Any such value on the connection is refused.

## Setup

Use the provider dashboard browser configuration panel to create a disabled connection, explicitly enable it, and edit the JSON model/control mapping. Saving a mapping requires operator attestation; it does not verify the live site. Setup opens on the **DurinDoor host**, requires a display, and offers no remote browser or stealth fallback. Status reports `needs_operator` while open and `unknown` after close, never live sign-in verification.

1. An operator creates the connection's private profile. The server mints the handle and stores it at `DATA_DIR/browser-profiles/adobe-firefly-web/<connectionId>/<profileHandle>`, with a marker that binds the handle to the connection.
2. The operator opens a setup session. This needs an authenticated operator, `enabled: true` and the initialized profile, but no mapping. A headed, ordinary browser opens the Firefly home page. DurinDoor navigates once and does nothing else: the operator signs in, completes any MFA or challenge, and accepts any terms themselves. DurinDoor reads no cookies, storage or tokens and exports nothing.
3. The operator closes the session (or the window), then writes and validates the mapping and model map.

Setup and generation never share a profile at the same time: the second one gets `409` before any browser starts. Profiles are never deleted automatically.

## Requests and output

Images and video accept only `model`, `prompt`, `n` (1 only) and `response_format`. Size, seconds, seed, references, edits, masks, streaming and any other field are refused with `400` before launch.

The output is this gateway's own local synchronous body, not an Adobe API response:

```json
{ "created": 1764201600, "data": [{ "b64_json": "<base64>", "mime_type": "video/mp4", "output_format": "mp4" }] }
```

An omitted `response_format` means `b64_json`. An explicit `b64_json` is accepted. `url` or any other format is refused with `400` before launch; the format is never changed silently. The type comes from the downloaded file's magic bytes: PNG, JPEG or WebP for images, MP4 or WebM for video.

There is no `/v1/videos` job or cancel route. Adobe's help documents no job ID or cancellation, and none is invented.

## How a generation runs

1. Config, request, credentials and profile are checked before launch.
2. An ordinary Chromium opens the profile with only `headless` and `acceptDownloads` set: no stealth or patched browser, user-agent or client-hint override, init script, cookie injection or shared browser pool.
3. On any other origin, or when a mapped sign-in, challenge, consent or entitlement marker is visible, the result is `409 needs_operator`. Nothing is clicked through.
4. Prompt, submit, the model picker and the requested model's option must each match exactly one actionable element. Existing results are recorded first. Without `identityAttr` there must be none; with it, their IDs must be unique and stable.
5. A local correlation is recorded, then Generate is clicked once.
6. DurinDoor waits for exactly one new result with exactly one ready marker and one download control inside it. It downloads through the page's own download event, never by fetching a URL, within the time and size limits.
7. Only that verified file is returned and counted: `images: 1` or `videos: 1`. No duration, tokens or USD cost are invented.

After the click, any abort, deadline, page loss, ambiguity, operator marker or bad download is `outcome_unknown`. The response carries accepted-job accounting with unknown cost, the correlation stays in a local journal, and nothing is submitted again. An abort before the click has no accepted job.

## Known limitations

- Model discovery lists only this connection’s configured image/video modelMap, never live entitlements. Automatic discovery and validation never open a browser.
- No live parity is claimed. The tests prove our state machine on synthetic pages, not Adobe compatibility. An operator mapping can stop working whenever Adobe changes its UI.
- The profile lock is per process.
- An item list that virtualizes or reorders earlier results can make outcomes unknown.

## Sources

- Adobe help: [Firefly workspace overview](https://helpx.adobe.com/firefly/web/get-started/access-the-app/firefly-workspace-overview.html), [Generate images using GPT Image](https://helpx.adobe.com/firefly/web/work-with-images/generate-images/generate-images-using-gpt-image.html), [Generate videos using text prompts](https://helpx.adobe.com/firefly/web/work-with-audio-and-video/work-with-video/generate-videos-using-text-prompts.html), [View and manage generation history](https://helpx.adobe.com/firefly/web/access-your-files/view-generation-history.html). These describe the human workflow only.
- No third-party code was ported. Playwright is the browser library the project already depends on.
