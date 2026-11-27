# AI Horde native images (#2034, staged)

Status: **staged, unregistered**. `getImageAdapter("aihorde")` and `getImageAdapter("horde")` return `null`. The registered `aihorde` chat route (`oai.aihorde.net` OpenAI facade, `Authorization: Bearer 0000000000`) is unchanged. No provider identity, private definition or staging-manifest row was added.

## Source

cheaper-inference/OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT):

- `open-sse/handlers/imageGeneration/providers/aihorde.ts`
- `open-sse/handlers/imageGeneration/providers/aihordeMapRequest.ts`
- `open-sse/services/aihordeImageCatalog.ts`

## Files

| File | Role |
| --- | --- |
| `open-sse/services/aihordeImageCatalog.js` | Public image catalog, shared blocking refresh |
| `open-sse/handlers/imageProviders/aihorde.js` | `.generate({ model, body, credentials, signal, log })` adapter |
| `tests/unit/aihorde-image-catalog.test.js` | Catalog state machine |
| `tests/unit/aihorde-image-flow.test.js` | Submit/poll/status/cancel/download flow |
| `tests/unit/aihorde-images-stage.test.js` | Staging boundary only; promote this file when registering |

All tests use closed mock transports. Live AI Horde acceptance is unproven.

## Protocol (kept from the source)

- Origin `https://aihorde.net/api`. Headers: `apikey` (the selected connection's `credentials.apiKey`, else `0000000000`), `Client-Agent: DurinDoor:staged:https://github.com/bloodf/durindoor`, JSON accept/content type.
- Catalog: `GET /v2/status/models?type=image`, no credential, rows with `count > 0`, exact names, 30 s freshness, 15 s fetch bound, one in-flight refresh, failure keeps the last good snapshot and sets `lastError`.
- Submit: `POST /v2/generate/async` with `{ prompt, models: [model], nsfw: false, censor_nsfw: true, r2: true, shared: false, validated_backends: true, slow_workers: true, allow_downgrade: true, params: { n, width, height, steps: 20 } }`. 200 or 202 with `id` is accepted.
- Poll: `GET /v2/generate/check/{id}`, delay 1-8 s (a tenth of `wait_time`), 504 early when `wait_time` exceeds the remaining budget, `faulted` and `is_possible: false` stop.
- Results: `GET /v2/generate/status/{id}`; cancel: `DELETE /v2/generate/status/{id}` with a separate 30 s bound.
- 600 s overall deadline over catalog, submit, poll and download; 30 s per API call; 60 s per download; 25 MiB per image.

## Deviations

| Area | Source | Here |
| --- | --- | --- |
| Request fields | Maps any body; img2img from `image`/`images`/`image_url` | Allow-list `model`, `prompt`, `n`, `size`, `response_format`, `user`; anything else is 400 before catalog or submit. Text-to-image only |
| `n` | Capped at 4 | Integer 1-4, else 400 |
| `size` | Snapped to 64 and clamped to 64-3072 | Must already be `WxH` in multiples of 64 within 64-3072, else 400 |
| Output | `b64_json` (R2 download) | `b64_json` only, plus `mime_type` and `output_format` from magic bytes; omitted means `b64_json`; `url` is 400 |
| Cold catalog failure | Submits unchecked | 503, nothing submitted |
| Background refresh flag | `AIHORDE_CATALOG_BACKGROUND_REFRESH_ENABLED` | Not added; refresh always blocks |
| Caller abort during refresh | First caller's signal aborts the shared fetch | Shared refresh has its own deadline; a caller abort ends only that wait |
| Submit outcomes | Non-200/202 is a plain failure | 3xx is refused (not followed); 4xx and 503 are definitive refusals; 2xx other than 200/202, other 5xx, transport loss and missing id are possibly accepted: `acceptedJob`, no replay |
| Finished-job output | Censored or missing items skipped silently | Same, but none usable is a 502 with `acceptedJob`; fewer than `n` sets `accounting.meta.partial` |
| Download | `fetchRemoteImage` public-only, DNS pinning, redirect limit | `fetchPublic` (`maxRedirects: 0`) over `guardedProbeFetch(..., "public-only")`: https only, no embedded credentials, no redirects, no headers beyond `Accept`, byte cap, image MIME and PNG/JPEG/WebP magic |
| Accounting | None | `nativeUnits.images` = returned images; `meta.providerKudos` raw; cost stays unknown. Kudos are never converted to USD or tokens |

## Before registration

Registering needs core support for `.generate` adapters that carry `acceptedJob`, a live acceptance run on a real account, a catalog listing decision, and promotion of the staging test.
