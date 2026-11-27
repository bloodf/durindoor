# AI Horde native images (#2034)

Status: **registered, experimental, mock-tested only.** `getImageAdapter("aihorde")` and `getImageAdapter("horde")` return the native adapter. Images run on the existing `aihorde` provider (alias `horde`): no new provider identity, private definition, connection type, auth mode or staging-manifest row. The `aihorde` chat route (`oai.aihorde.net` OpenAI facade, `Authorization: Bearer <key or 0000000000>`) and its `modelsFetcher` are unchanged. Live AI Horde acceptance is unproven: no live account or provider call was used, by owner decision.

Public user documentation: `docs/providers/free-and-local.mdx`, section "AI Horde images".

## Source

cheaper-inference/OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT):

- `open-sse/handlers/imageGeneration/providers/aihorde.ts`
- `open-sse/handlers/imageGeneration/providers/aihordeMapRequest.ts`
- `open-sse/services/aihordeImageCatalog.ts`

## Files

| File | Role |
| --- | --- |
| `open-sse/services/aihordeImageCatalog.js` | Public image catalog, shared blocking refresh, `listHordeImageModelRows` for discovery |
| `open-sse/handlers/imageProviders/aihorde.js` | `.generate({ model, body, credentials, signal, log })` adapter, `defaultResponseFormat: "b64_json"` |
| `open-sse/handlers/imageProviders/index.js` | `aihorde` and `horde` entries in `IMAGE_ADAPTERS` |
| `open-sse/providers/registry/aihorde.js` | `serviceKinds: ["llm", "image"]` and the notice; transport unchanged |
| `open-sse/providers/capabilities.js` | `kind: "image"` rows get image capabilities; chat rows keep the facade capabilities |
| `src/shared/models/modelCatalogSources.js` | `PROVIDER_MEDIA_CATALOGS.aihorde`, `resolveProviderMediaCatalog` |
| `src/shared/models/modelListCore.js` | Image rows in the keyless and saved-connection listings; facade names never become image rows |
| `src/app/api/providers/[id]/models/fetchConnectionModels.js` | Dashboard discovery appends image rows to a successful chat discovery |
| `tests/unit/aihorde-image-catalog.test.js` | Catalog state machine (unchanged) |
| `tests/unit/aihorde-image-flow.test.js` | Submit/poll/status/cancel/download flow (unchanged) |
| `tests/unit/aihorde-images-stage.test.js` | Former staging boundary, promoted to registration assertions |
| `tests/unit/aihorde-image-registration.test.js` | Public routes, real selector/registry/core/adapter, closed fetch |
| `tests/unit/aihorde.test.js` | Chat facade; the image-catalog case now proves facade ids stay out of image listings |

## Routing and accounts

`/v1/images/generations` resolves `horde/<name>` or `aihorde/<name>` through the ordinary registry alias (`getModelInfo`), then `runMediaAccounts` with the shared selector. No saved connection: the public no-auth credential (`connectionId: "noauth"`, no `apiKey`) sends `apikey: 0000000000`. Saved connection: its `apiKey`, else the sentinel. The core's `responseFormats` gate refuses `url` and `binary` before the adapter; the adapter's allow-list refuses other fields before the catalog. A chat model id sent to the image route is refused by the worker catalog with 400 before any submit; there is no chat fallback in either direction.

A definitive refusal (4xx, 503) has no `acceptedJob`; the selector marks only that account and may move to a sibling. A possibly accepted job (lost submit answer, other 5xx, missing id, timeout, cancel, failed download) returns `acceptedJob`; the route records it once (`status: "accepted"`, `costSource: "accepted-job"`), sets `x-durindoor-accepted-job`, and stops without replay.

## Discovery

The catalog row source is `listHordeImageModelRows`: it waits up to 3 s for a shared refresh (the refresh keeps its own 15 s bound), and lists only when the snapshot is fresh and error-free. A failed refresh lists nothing rather than the retained snapshot; the adapter still uses the retained snapshot for the request-time worker check, as before. Rows are `{ id: <exact Horde name>, kind: "image" }`, published as `horde/<name>` in `/v1/models/image` and in combined listings. `/v1/models` (chat only) does not fetch the image catalog. In keyless image-only listings the chat facade is not called. Facade ids whose name looks like an image model are dropped from image kinds instead of being inferred as images; their chat listing is unchanged. With a saved connection, an id present in both catalogs keeps its chat row; explicit allowlists, disabled models and the paid-model filter apply. Model auto-sync stores image rows with their explicit kind because it uses the same dashboard discovery; a synced catalog is not extended with new image rows, and a synced image-kind row is published only while it is in the current worker catalog. A chat discovery failure is returned unchanged by dashboard discovery, never replaced by an image-only list.

Connection create and validate are unchanged: no image job, catalog call or billed check is added.

## Protocol (kept from the source)

- Origin `https://aihorde.net/api`. Headers: `apikey` (the selected connection's `credentials.apiKey`, else `0000000000`), `Client-Agent: DurinDoor:4:https://github.com/bloodf/durindoor`, JSON accept/content type.
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
| Output | `b64_json` (R2 download) | `b64_json` only, plus `mime_type` and `output_format` from magic bytes; omitted means `b64_json`; `url` and `binary` are 400 |
| Cold catalog failure | Submits unchecked | 503, nothing submitted |
| Background refresh flag | `AIHORDE_CATALOG_BACKGROUND_REFRESH_ENABLED` | Not added; refresh always blocks (listing waits at most 3 s) |
| Listing a failed refresh | Last good snapshot | Nothing listed |
| Caller abort during refresh | First caller's signal aborts the shared fetch | Shared refresh has its own deadline; a caller abort ends only that wait |
| Submit outcomes | Non-200/202 is a plain failure | 3xx is refused (not followed); 4xx and 503 are definitive refusals; 2xx other than 200/202, other 5xx, transport loss and missing id are possibly accepted: `acceptedJob`, no replay |
| Finished-job output | Censored or missing items skipped silently | Same, but none usable is a 502 with `acceptedJob`; fewer than `n` sets `accounting.meta.partial` |
| Download | `fetchRemoteImage` public-only, DNS pinning, redirect limit | `fetchPublic` (`maxRedirects: 0`) over `guardedProbeFetch(..., "public-only")`: https only, no embedded credentials, no redirects, no headers beyond `Accept`, byte cap, image MIME and PNG/JPEG/WebP magic |
| Accounting | None | `nativeUnits.images` = returned images; `meta.providerKudos` raw; cost stays unknown. Kudos are never converted to USD or tokens |

## Remaining

Live limits, not verified here: real worker availability and queue times, anonymous versus keyed priority, kudos charged per job, R2 result URL hosts and formats, censorship rates, and whether the cancel releases kudos. One owner-authorized live run on a real account would establish these; it is not a registration prerequisite.
