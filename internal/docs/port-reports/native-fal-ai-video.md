# fal.ai queue video (staged), 2026-11-27

Issue: #2034. Decision15 accepted this delta. The parity inventory row for `fal-ai` is: registry → video dispatcher; queue key and queue/job envelope; DurinDoor equivalent: none (MISSING).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout at `/tmp/omni-2034` was confirmed to be at that HEAD.

- `open-sse/config/videoRegistry.ts`: the `fal-ai` entry. It has `id: "fal-ai"`, `baseUrl: "https://queue.fal.run"`, `authType: "apikey"`, `authHeader: "key"`, `format: "fal-ai-video"`, and three models: `veo3.1/lite`, `google/gemini-omni-flash`, and `xai/grok-imagine-video/text-to-video`.
- `open-sse/handlers/videoGeneration.ts`: dispatches `fal-ai-video` to `handleFalVideoGeneration`.
- `open-sse/handlers/mediaGeneration/fal.ts`: `handleFalVideoGeneration`, `runFalQueue`, `buildFalVideoRequestBody`, `resolveFalModel`, and `normalizeFalMediaResult`.
- `open-sse/config/falEndpoint.ts`: legacy ids, vendor owners, and `falSelectionEndpoint`.
- `open-sse/handlers/fal/client.ts`, `schema.ts`, and `compatibility.ts`: tracking-URL pinning, fixed origins, and OpenAPI schema discovery with compatibility mapping. The source uses these on its native path (`FAL_NATIVE_ENABLED`).

## What already existed locally

The checkout has an image path for fal, but no video path. A same-name provider is not a video equivalent:

- `open-sse/providers/registry/fal-ai.js` defines `fal-ai` (alias `fal`, API key) with `serviceKinds: ["image"]`, seven image models, and `imageConfig.baseUrl: "https://queue.fal.run"`.
- `open-sse/handlers/imageProviders/falAi.js` uses the same queue origin and `Authorization: Key`. It sends an image body (`num_images`, `image_size`) and reads `images[]`. Its endpoint, auth, and envelope are the queue shape, but its body and result are for images. It does not pin tracking URLs, does not check result URLs, and does not refuse redirects.
- `open-sse/handlers/videoProviders/index.js` registers `renderhour`, `adobe-firefly-api`, and `adobe-firefly-web` only. `rg "fal-ai-video|veo3.1/lite|gemini-omni|grok-imagine-video"` over `open-sse`, `src`, and `tests` finds nothing. `open-sse/handlers/videoCore.js` (`/v1/videos`) has no fal config.

The video adapter therefore reuses the existing `fal-ai` provider id, its `fal` alias, and its API-key connection. It adds only the video service kind, so no second provider definition is created.

## What landed (private, unregistered)

| File | Role |
| --- | --- |
| `open-sse/services/providerParity/native-fal-ai-video/config.js` | Provider id, alias, format, origins, the three models, endpoint id mapping, and catalog metadata. |
| `.../request.js` | Built-in bodies for the three source models. Refuses unsupported input before any credential use. |
| `.../schema.js` | OpenAPI discovery page check, input schema selection, compatibility mapping, and pre-submit validation. |
| `.../job.js` | Discovery read, bounded submit, bounded poll, result read and validation, and `acceptedJob` accounting. |
| `.../adapter.js` | Job adapter for `/v1/video/generations` (`generate`, `responseFormats: ["url"]`, `defaultResponseFormat`). |
| `.../index.js` | Re-exports everything above. |
| `.../registration.json` | Exports, ids, models, endpoints and auth, and the integration points for the registration change. |
| `tests/unit/native-fal-ai-video.test.js` | 80 tests over a closed network. |

Production code imports none of these modules. Unchanged files: `videoProviders/index.js`, `open-sse/providers/registry/**`, the docs catalog, and `src/**`. `getVideoGenerationAdapter("fal-ai")` and `getVideoGenerationAdapter("fal")` still return null. The test asserting that lives in its own staging block. No protocol, auth, security, or usage test depends on it.

## Supported subset

Wire contract (source-derived):

- **Auth:** `Authorization: Key <apiKey | accessToken>`. A missing key is a local 401, and nothing is sent.
- **Submit:** `POST https://queue.fal.run/{endpoint}` with `Content-Type: application/json` and `X-Fal-No-Retry: 1`. The response holds `request_id`, `status_url`, and `response_url`. A response without `request_id` but with `video` is taken as the result, as in `runFalQueue`.
- **Status:** `GET status_url` every 1 s. `IN_QUEUE` and `IN_PROGRESS` keep polling; `COMPLETED` leads to `GET response_url`. When fal omits either URL, the fallback is the source's `{submit}/requests/{id}[/status]`.
- **Result:** `video.url` becomes `{ created, data: [{ url, format? }] }`.
- **Discovery:** `GET https://api.fal.ai/v1/models?endpoint_id={endpoint}&expand=openapi-3.0`. The page must contain `models[]` and a boolean `has_more`, plus `next_cursor` when `has_more` is true. The endpoint must be listed.

Built-in models (no discovery):

| Model id(s) | fal endpoint | Body |
| --- | --- | --- |
| `veo3.1/lite`, `fal-ai/veo3.1/lite` | `fal-ai/veo3.1/lite` | `prompt`, `aspect_ratio` (16:9, 9:16; default 16:9), `duration` (4s, 6s, 8s; default 8s), `resolution` (720p, 1080p; `quality: "hd"` gives 1080p), `generate_audio` (default true), and optional `negative_prompt`, `safety_tolerance`, `seed`, `auto_fix`. Text only. |
| `google/gemini-omni-flash` (+ `/image-to-video`) | `google/gemini-omni-flash`, or `/image-to-video` with one image | `prompt`, `aspect_ratio` (default 16:9), `duration` (3 to 10 whole seconds, default 8), and an optional `image_url`. |
| `xai/grok-imagine-video/{text,image,reference}-to-video` | chosen from the number of images: 0, 1, or 2 or more | `prompt`, `aspect_ratio` (default 16:9), `duration` (whole seconds, default 6), `resolution` (default 720p), `image_url` or `reference_image_urls`. |

Discovered endpoints: any other fal id is accepted with the source's owner rule. A first-party id gets the `fal-ai/` owner, and the 25 vendor owners are used as given. A built-in id with `fal_input` is also discovered. The endpoint's `metadata.category` must end in `video`, and the OpenAPI document must have a queue status path. The caller's fields are mapped as in `falCompatibilityInput`:

- Undocumented `quality`, `style`, `user`, and `sync_mode` are dropped.
- `image_urls` goes to `reference_image_urls` or a single `image_url`.
- `size` becomes `aspect_ratio`.
- `fal_input` is merged last.

Public contract:

- `response_format` is `url` only. The core refuses `b64_json` before submit.
- **Accounting:** `nativeUnits.videos = 1`, with unknown cost. Neither requested duration nor prompt length is billed. Every failure after fal may have queued the request carries `acceptedJob` (`costSource: "accepted-job"`, with `jobState` either `submit-unknown` or `accepted`).

## Fork deviations from the source

- **Strict inputs:** the source replaces bad durations with defaults, clamps the Gemini duration, takes the first of several Gemini images, and drops images for Veo. All of these are refused with 400 here. `n > 1`, `stream`, and the upload fields (`image`, `images`, `mask`, `input_reference`, `video`, `video_url`, `audio_url`) are refused as well. A `size` that disagrees with `aspect_ratio` is refused.
- **Grok endpoint selection:** the source picks the endpoint from the caller's raw `image_url` or `reference_image_urls`, so a single `image_urls` entry was sent to `text-to-video` with an `image_url`. This adapter picks the endpoint from the body it actually sends.
- **Image references:** fal fetches these. Each one must be an https URL on a public host without credentials (`isBlockedHost`), or a base64 image data URI of at most 10 MiB.
- **Schema validation:** the source compiles the schema with Ajv, which is not a dependency here, so a subset is checked before submit:
  - undocumented fields (when `additionalProperties` is absent or false)
  - required fields
  - JSON type
  - `enum` and `const`
  - numeric bounds, and string and array lengths
  - local `$ref` and `allOf`/`anyOf`/`oneOf`, with `nullable` honored

  Formats and nested object shapes are left to fal, which answers 422. That is mapped to 400, without `acceptedJob`.
- **Definition cache:** the source injects a connection-scoped store. Here a `store` is optional, read and written under `credentials.connectionId` only, and never shared between connections.
- **Deadlines and cancellation:**
  - Discovery requests are limited to 15 s each, the submit to 30 s, each status or result request to 30 s, and the whole job to 600 s.
  - Every wait, request, and body read aborts on the caller's signal.
  - Discovery retries a 429 or 503 at most twice, when Retry-After is 5 s or less, and fails at once when it is longer (`client.ts` `retryFalRead`).
  - Status checks retry 429 and 503 up to 5 times with backoff.
- **Origins and redirects:**
  - Submit goes only to `https://queue.fal.run`, discovery only to `https://api.fal.ai`.
  - Submit uses `redirect: "manual"`, and a redirect is refused (nothing queued). A submit answered from another origin is discarded as `submit-unknown`.
  - Reads use `redirect: "error"`.
  - `status_url` and `response_url` must be on `https://queue.fal.run`, have no credentials or fragment, and name this `request_id` (`falTrackingUrl`). Any other value is a lost job, and nothing is fetched from it.
- **Errors never carry upstream text:**
  - Submit 401 or 403 becomes 401.
  - A 402, or a 403 whose body mentions an exhausted balance or insufficient credit, becomes 402 with `quotaExhausted` (checked by regex only; the body is not echoed).
  - 404 stays 404, and 422 becomes 400.
  - 429 keeps Retry-After evidence.
  - 5xx, a timeout, a reset after send, or an abort during the request are each `submit-unknown` and never resent.
  - Every error redacts the connection's key.
- **Results:**
  - Only `video.url` is returned. It must be an https URL on a public host, without credentials, and is never downloaded.
  - A `content_type` that is not `video/*` is refused. The format comes from `content_type` or the URL extension (mp4, webm, or mov) and is omitted when unknown.
  - The source's raw `output` and `artifacts` are not returned.
  - An unknown status, a failed result read, a missing or unsafe video, and unreadable bodies are each reported with `acceptedJob`, because fal may still bill a queued request.
- **No upstream cancel:** fal has a queue cancel call, but the source never uses it, and neither does this adapter. An abandoned request may still run and bill, and `acceptedJob` records it.

## Remaining restrictions

- One video per request. `url` output only.
- No uploads: image references must already be public https URLs or data URIs. Video and audio inputs are refused for the built-in models. Discovered endpoints may take other documented URL fields, but only the image fields listed in `schema.js` are checked for public hosts.
- Streaming, realtime, and HTTP-WebSocket transports from `handlers/fal/` are not ported. The queue transport is the only one used.
- The enums for the built-in models come from the source and its builders. Veo aspect ratios are limited to 16:9 and 9:16. Grok aspect ratios and resolutions are format-checked locally and value-checked by fal (422 → 400). None were verified against the live service.
- Schema validation is the subset described above. It is not Ajv.
- Music (`handleFalMusicGeneration`) is out of scope.

## Registration (serial, later)

See `registration.json`:

1. Add `"fal-ai": falVideoAdapter` to `VIDEO_GENERATION_ADAPTERS`. `lookupMediaAdapter` does not resolve aliases, so either confirm the route canonicalizes `fal` first, or register `fal` too.
2. Add `"video"` and the three models (kind `video`) to `open-sse/providers/registry/fal-ai.js`, and keep the image models and `imageConfig`.
3. Add a catalog row for fal video.
4. In the test file, replace the staging block with positive registry assertions.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-fal-ai-video.test.js --maxWorkers=2` reports 80 passed. `node scripts/check-anti-slop.mjs` reports nothing for the new files. These are closed mocks only: no live account, provider call, or browser was used, and passing says nothing about the live service.
