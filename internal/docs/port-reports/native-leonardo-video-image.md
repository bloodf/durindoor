# Leonardo native image and video (staged), 2026-11-27

Issue: #2034. The inventory rows for `leonardo` image (`IMAGE_ADAPTERS`) and video (`VIDEO_GENERATION_ADAPTERS`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `leonardo`:
  - baseUrl `https://cloud.leonardo.ai/api/rest/v1/generations`, authType `apikey`, authHeader `bearer`, format `leonardo-image`.
  - Models `phoenix` and `sdxl`. `supportedSizes` `1024x1024`, `1024x576`, `576x1024`.
- `open-sse/handlers/imageGeneration.ts` dispatches format `leonardo-image` to `handlers/imageGeneration/providers/leonardo.ts`:
  - Submit `POST {baseUrl}` with `Content-Type: application/json` and `Authorization: Bearer <key>`.
  - Body `{ modelId, prompt, width, height, num_images: 1 }`.
  - `resolveLeonardoModelId` maps `phoenix` to `de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3` and `sdxl` to `16e7060a-803e-4df3-97ee-edcfa5dc9cc8`. Any other id passes through, and an empty id becomes `phoenix`.
  - `resolveLeonardoImageSize`: explicit `width`/`height` win, then a `WxH` `size`, then 1024.
  - The job id is `sdGenerationJob.generationId`. The handler polls `GET {baseUrl}/{id}` with `Authorization: Bearer` only, every 5 s, for up to 300 s. It reads `generations_by_pk || answer` and stops on `COMPLETE` (result `generated_images[0].url`, downloaded and answered as `b64_json`) or `FAILED`.
- `open-sse/config/videoRegistry.ts`, entry `leonardo`:
  - baseUrl `https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video`, statusUrl `https://cloud.leonardo.ai/api/rest/v1/generations`, authType `apikey`, authHeader `bearer`, format `leonardo-video`.
  - Models `motion-2.0` and `motion-2.0-fast`.
- `open-sse/handlers/videoGeneration.ts` dispatches format `leonardo-video` to `handlers/videoGeneration/leonardoHandler.ts`:
  - Body `{ model, prompt, resolution, width, height, isPublic: false }`.
  - `resolveLeonardoVideoModel` maps `motion-2.0` to `MOTION2`, `motion-2.0-fast` to `MOTION2FAST`, and the legacy `phoenix` to `MOTION2`. Any other id is sent as the enum.
  - `resolveLeonardoVideoSize` keeps the 2:3 (512x768) and 4:5 (576x720) portrait sizes, and maps any other size to 16:9 or 9:16. A short side of 480 or less selects `RESOLUTION_480`.
  - The job id is `motionVideoGenerationJob.generationId`. The handler polls `{statusUrl}/{id}`. The result is `generated_images[0].motionMP4URL`, because `url` is a jpg thumbnail.
- `open-sse/config/providers/registry/leonardo/index.ts`: the provider entry, alias `leo`, API key with bearer auth.
- Wire assertions in the source tests: `tests/unit/leonardo-image-model-id.test.ts` and `tests/unit/leonardo-video-generation.test.ts`. The fork tests repeat them.

The source has no dynamic model discovery for Leonardo. `GET /api/rest/v1/platformModels` appears only as a comment naming where the two UUIDs came from.

## Fresh-main check

`open-sse/providers/registry/leonardo.js` exists with:

- alias `leo` and an API-key connection
- `serviceKinds: []` and `hiddenKinds: ["image"]`, with the comment "Hidden until an image adapter is registered"
- an `imageConfig` that points at `https://cloud.leonardo.ai/api/rest/v1`

No equivalent dispatch exists:

- `rg -n leonardo open-sse/handlers` finds only a comment in `imageGenerationCore.js` about JPEG output.
- Neither `IMAGE_ADAPTERS` nor `VIDEO_GENERATION_ADAPTERS` has a `leonardo` or `leo` key. Aliases there are explicit keys (`createMediaRegistry`).
- `cloudflare-ai` lists `@cf/leonardo/lucid-origin` and `@cf/leonardo/phoenix-1.0`. These are Workers AI models with Cloudflare's endpoint, auth, and envelope, so they are not the Leonardo REST API.
- A generic OpenAI image adapter does not count as an equivalent. It would send an OpenAI body and expect a synchronous `data[]` answer. Leonardo needs a `modelId` UUID, `width`/`height`, and a generation poll.
- `/v1/videos` (`videoCore.js`) has no Leonardo config.

## What landed

All new files are under `open-sse/services/providerParity/native-leonardo-video-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and endpoints, model ids, UUIDs and enums, size tables, and bounds. |
| `http.js` | Bounded abortable fetch, redirect refusal, bounded JSON reads, mapping of refused answers without quoting the upstream body, the public https URL check, and accepted-job accounting. |
| `job.js` | `runLeonardoJob`: one submit, then a bounded poll of `/generations/{id}`. Both kinds use it. |
| `image.js` | `buildLeonardoImageRequest`, the model and size resolvers, and `createLeonardoImageAdapter`, a guarded `generate` adapter. |
| `video.js` | `buildLeonardoVideoRequest`, the model and size resolvers, and `createLeonardoVideoAdapter`, which follows the `VIDEO_GENERATION_ADAPTERS` contract. |
| `index.js` | Re-exports, plus the default `leonardoImageAdapter` and `leonardoVideoAdapter` instances. |
| `registration.json` | Exports, canonical ID and alias, models, endpoints, auth, and the registration steps. |

Tests are in `tests/unit/native-leonardo-video-image.test.js`: 66 tests over a closed network.

Nothing is registered. The following are unchanged:

- `imageProviders/index.js` and `videoProviders/index.js`
- `providers/registry/leonardo.js`
- the docs catalog

`getImageAdapter` and `getVideoGenerationAdapter` still return null for `leonardo` and `leo`. Only the isolated `staging state` test block asserts this.

## Supported subset

### Image

1. `POST https://cloud.leonardo.ai/api/rest/v1/generations` with `Content-Type: application/json` and `Authorization: Bearer <key>`.
2. Then `GET .../generations/{generationId}` with `Authorization: Bearer <key>` only.

- The body is `{ modelId, prompt, width, height, num_images: 1 }`.
- `model` is `phoenix`, `sdxl`, or a raw platform-model UUID. An empty model becomes Phoenix.
- The size comes from `width`/`height`, then a `WxH` `size`, then 1024. `size: "auto"` means 1024.
- The result is `{ created, data: [{ url }] }`. The URL is `generated_images[0].url` and must be public https.
- Usage records `nativeUnits.images = 1`. Cost stays unknown.

### Video

1. `POST https://cloud.leonardo.ai/api/rest/v1/generations-text-to-video` with the same submit headers.
2. Then the same status poll.

- The body is `{ model, prompt, resolution, width, height, isPublic: false }`, with the source's model and size mapping.
- `model` is `motion-2.0`, `motion-2.0-fast`, the legacy `phoenix` (Motion 2.0), or an upper-case Leonardo enum.
- The result is `{ created, data: [{ url, format: "mp4" }] }`. The URL is `motionMP4URL`, never the jpg `url`, and must be public https.
- Usage records `nativeUnits.videos = 1`. Cost and duration stay unknown.

### Both kinds

- The key is sent only to `https://cloud.leonardo.ai`. A connection base URL is ignored.
- Proxy options come from the selected connection.
- `apiKey` is used, or `accessToken` if there is no `apiKey`. A key containing CR or LF is refused.

## Deviations from the source, and remaining restrictions

- **No download.** The source downloaded the image or mp4 and answered `b64_json`. The fork returns the public result URL, so `response_format` is `url` only for both kinds. Every fork video adapter returns URLs only. `b64_json` and `binary` are refused before submit.
- **No image edits.** The source's `/v1/images/edits` init-image flow is not staged: `POST /init-image`, then an upload to a presigned S3 form URL that Leonardo returns, then `init_image_id`. It would need its own SSRF review for the S3 URL and an edits-route integration. Reference images, masks, and init images are refused.
- **Fields are refused, not dropped.** The image adapter takes only `model`, `prompt`, `size`, `width`, `height`, `n` (1 only), `response_format`, and `user`. The video adapter takes only `model`, `prompt`, `size`, `n` (1 only), `response_format`, and `user`. Any other non-null field returns 400 before submit. This includes `quality`, `style`, `negative_prompt`, `duration`, `seconds`, and image inputs. The source dropped them silently. Streaming is refused.
- **Validated sizes.** Image sides must be integers from 32 to 1536 and multiples of 8, which are Leonardo's documented bounds. A video `size` must be `WxH`; the source silently fell back to 720p 16:9.
- **Validated raw ids.** A raw image model must be a UUID, and a raw video model must be an upper-case enum.
- **Bounds.**
  - Submit: 30 s.
  - Each status request: 30 s.
  - Whole job: 300 s.
  - At most 60 completed polls, 5 s apart.
  - A 429 or 503 status answer is retried up to 5 times, with Retry-After honored and capped at 30 s.
- **Redirects.** Every request uses `redirect: "manual"`. A 3xx submit is refused without following it, and no job is claimed. An answer from another origin is treated as possibly accepted.
- **Abort.** An abort before send sends nothing and claims nothing. An abort during the submit, poll wait, or status request tears down that request and returns 499. Once the submit may have reached Leonardo, the result carries `acceptedJob`.
- **No replay.** A submit is never resent. Each of these cases carries `acceptedJob` with unknown cost:
  - a transport failure after connect, or a submit timeout (`submit-unknown`)
  - a 5xx submit answer (`submit-unknown`)
  - an unreadable submit answer, or a missing or unsafe generation id
  - a poll error, timeout, or redirect
  - a status answer about another generation, or one with no status or a null generation
  - a `COMPLETE` generation without a usable public result
  - the job deadline
- **FAILED is an ordinary failure.** A generation Leonardo reports as `FAILED` returns 502 without `acceptedJob`. The source did the same.
- **Errors.**
  - A 402 is quota for that connection only (`quotaExhausted`). So is a 400, 403, or 429 whose vendor `code` mentions quota, credit, or balance.
  - 401 and 403 are key refusals.
  - A 429 keeps a usable Retry-After.
  - The upstream body is never quoted; only a vendor code of a safe shape is kept. Error results pass the connection's secrets to `createErrorResult` for redaction.
- **Usage.** No units are inferred from Leonardo's `apiCreditCost`. It is an API-credit count, not USD, and the source did not use it.

## Registration (serial step, not done here)

See `registration.json`:

1. Add `leonardo` and `leo` keys for both adapters in `open-sse/handlers/imageProviders/index.js` and `open-sse/handlers/videoProviders/index.js`.
2. In `open-sse/providers/registry/leonardo.js`:
   - Set `serviceKinds: ["image", "video"]` and drop `hiddenKinds`.
   - Add the two Motion rows with `kind: "video"`.
   - Keep the API-key connection and `imageConfig`, and add no `videoConfig`.
3. List the kinds in `docs/providers/catalog.mdx`.
4. Replace the isolated staging block in the test with positive identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-leonardo-video-image.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 66 passed (66)
pnpm run lint:anti-slop
# anti-slop gate OK (0 diagnostics)
```

Closed mocks only. Passing says nothing about the live service.
