# KIE.AI native image and video (staged), 2026-11-27

Issue: #2034. The inventory rows for `kie` video (registry -> video dispatcher) and `kie` image (`IMAGE_ADAPTERS`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `kie`:
  - baseUrl `https://api.kie.ai`, statusUrl `https://api.kie.ai/api/v1/jobs/recordInfo`, authType `apikey`, authHeader `bearer`, format `kie-video`.
  - 16 Market models (`veo/veo-3-1` ... `sora-2-pro-image-to-video`).
- `open-sse/config/imageRegistryData.ts`, entry `kie`:
  - Same baseUrl, statusUrl and auth, format `kie-image`, `supportedSizes` `1:1`/`16:9`/`9:16`/`4:3`/`3:4`.
  - 35 models from `open-sse/config/providers/registry/kie/imageModels.ts` (`isMarket`, and `kieFluxKontextModel` on `flux/kontext` and `flux/kontext-max`).
- `open-sse/handlers/videoGeneration.ts`, `handleKieVideoGeneration` and `normalizeKieVideoResult`.
- `open-sse/handlers/imageGeneration.ts`, `handleKieImageGeneration`, `normalizeKieImageResult`, `KIE_MARKET_UPSTREAM_MODEL_IDS` and `extractImageInputs`.
- `open-sse/executors/kie.ts` (`createTask`, `pollTask`) and `open-sse/utils/kieTask.ts` (`getKieTaskId`, `normalizeKieTaskState`, `parseKieResultJson`).
- `open-sse/translator/image/sizeMapper.ts` (`mapImageSize`).

## Fresh-main check

`origin/main` at `f14f877ec1` and this worktree were searched with `git grep` / `rg`:

- `open-sse/providers/registry/kie.js` exists for chat only: `serviceKinds: ["llm"]`, API-key connection, `transport.baseUrl` `https://api.kie.ai/v1/chat/completions`.
- No file under `open-sse/handlers`, `open-sse/executors` or `open-sse/services` mentions `kie`, `api.kie.ai`, `createTask` or `recordInfo`.
- Neither `IMAGE_ADAPTERS` nor `VIDEO_GENERATION_ADAPTERS` has a `kie` key or alias, and no registry entry has an `imageConfig` or `videoConfig` that points at `api.kie.ai`.
- A generic OpenAI image or video adapter is not an equivalent: KIE takes a `{ model, input }` task body, answers a `{ code, msg, data: { taskId } }` envelope and needs a `recordInfo?taskId=` poll.

So the whole delta is missing and was ported. KIE audio (`kie-audio`) and music (`kie-music`) are outside this delta and were not touched.

## What landed

All new files are under `open-sse/services/providerParity/native-kie-video-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin, the three image routes, model lists, sizes, the upstream ID table and the bounds. |
| `http.js` | Bounded abortable fetch, redirect refusal, bounded JSON reads, mapping of refused HTTP answers and envelope codes without quoting upstream text, the public https URL check and accepted-job accounting. |
| `job.js` | `runKieTask`: one createTask submit and a bounded recordInfo poll; `kieTaskState`, `kieResultJson`. |
| `image.js` | `buildKieImageRequest` and `createKieImageAdapter`, a guarded `generate` adapter. |
| `video.js` | `buildKieVideoRequest` and `createKieVideoAdapter`, which follows the `VIDEO_GENERATION_ADAPTERS` contract. |
| `index.js` | Re-exports, plus the default `kieImageAdapter` and `kieVideoAdapter` instances. |
| `registration.json` | Exports, canonical ID and alias, models with route and upstream ID, endpoints, auth and the registration steps. |

Tests are in `tests/unit/native-kie-video-image.test.js`: 70 tests over a closed network.

Nothing is registered. These are unchanged: `imageProviders/index.js`, `videoProviders/index.js`, `providers/registry/kie.js` and the docs catalog.

## Wire contract (source-derived)

Auth is the selected connection's `apiKey` (or `accessToken`) as `Authorization: Bearer <key>`. The submit also sends `Content-Type: application/json`. A status check sends only the Bearer header, as `KieExecutor.pollTask` does. Each status check is `GET <statusUrl>?taskId=<id>`.

| Route | Submit | Body | Status |
| --- | --- | --- | --- |
| Video (all models) | `POST /api/v1/jobs/createTask` | `{ model, input: { prompt, duration, aspect_ratio, sound } }` | `/api/v1/jobs/recordInfo` |
| Image, Market | `POST /api/v1/jobs/createTask` | `{ model: upstreamId, input: { prompt, aspect_ratio, image_url? } }` | `/api/v1/jobs/recordInfo` |
| Image, Flux Kontext | `POST /api/v1/flux/kontext/generate` | `{ prompt, aspectRatio, model: flux-kontext-pro/max, inputImage? }` | `/api/v1/flux/kontext/record-info` |
| Image, direct (`gpt4o-image`) | `POST /api/v1/gpt4o-image/generate` | `{ prompt, size, nVariants }` | `/api/v1/gpt4o-image/record-info` |

- The task ID is `data.taskId`, then a top-level `taskId`.
- The state is `data.status ?? data.state ?? data.successFlag`, with the source's success and failure sets (for example `success`, `1`, `FIRST_SUCCESS`; `fail`, `2`, `3`, `GENERATE_FAILED`). Anything else is pending.
- Video URLs come from the first present list of `resultJson.resultUrls`, `resultJson.videoUrls` and `data.response.resultUrls`. Each item is `{ url, format: "mp4" }`.
- Image URLs come from all of the source's fields (`resultJson.resultUrls/imageUrls/resultUrl/imageUrl`, `data.response.resultUrls/resultUrl/resultImageUrl/resultImageUrls`, `data.resultImageUrls/resultImageUrl/url`), de-duplicated.
- Video defaults are the source's: `duration` `"5"`, `aspect_ratio` `"16:9"`, `sound` `false`.
- The image ratio is the source's `mapImageSize(size)` with default `1:1`. Market IDs go through the source's `KIE_MARKET_UPSTREAM_MODEL_IDS` table.

## Supported subset

- Image: the 35 catalog models on their source routes; `size` is one of the registry ratios, or an OpenAI pixel size that maps into them (`256x256`, `512x512`, `1024x1024`, `1792x1024`, `1024x1792`); at most one public https input image on the Market and Kontext routes; `n` 1 (or 1, 2 or 4 for `gpt4o-image`); `response_format` `url`.
- Video: the 10 text-to-video catalog models; `duration` 1-60 whole seconds; `aspect_ratio` like `16:9`; boolean `sound`; `n` 1; `response_format` `url`.

## Fork deviations and restrictions

Each is enforced and tested.

- Fixed origin: the key goes only to `https://api.kie.ai`. A connection `baseUrl` or `providerSpecificData.baseUrl` is ignored.
- Bounds:
  - Each submit and each status check has its own timeout (30 s).
  - The whole task has the source's 300 s deadline, at most 120 polls of 2.5 s.
  - A 429 or 503 status check is retried at most 5 times, honoring `Retry-After` up to 30 s.
  - The caller's signal aborts the socket and the poll wait.
  - Caller `timeout_ms` and `poll_interval_ms` are not honored.
- Redirects are refused (`redirect: "manual"`), never followed with the key. An answer from another origin is an unknown outcome.
- Envelope codes are honored. KIE answers HTTP 200 with a body `code`, which the source ignored.
  - On submit, 401/403 refuse the key, 402 refuses with `quotaExhausted`, 429 rate-limits, 400/404/409/413/422 pass through, and other 4xx codes (for example 455) become 502. None of these carry `acceptedJob`.
  - Any non-4xx, non-200 code (for example 500, 501) carries `acceptedJob` with `submit-unknown`.
  - On a status check, any non-200 code is an unknown outcome of the accepted task.
- No upstream text leaves the adapter. `msg`, `failMsg`, `errorMessage` and HTTP error bodies are never quoted. Only a short code of a safe shape (for example `failCode`) is kept. Messages are also redacted against the connection's secrets.
- Missing state: a status answer with no `status`/`state`/`successFlag` is an unknown outcome. The source fell back to the envelope `msg`, which reads `success` on every answer, and could report a pending task as done.
- A status answer whose `data.taskId` names another task is an unknown outcome.
- A success with no usable public https URL is an unknown outcome with `acceptedJob`. The source returned an empty video list as a 200. Unsafe result URLs (http, private or metadata hosts, userinfo) are dropped and never fetched.
- No replay: a submit whose outcome is unknown (timeout, reset, 5xx, unreadable answer, foreign redirect), and every accepted task not seen to fail, carries `acceptedJob` with unknown cost and is never resent. A submit refused before connecting (`ECONNREFUSED` and similar) carries no `acceptedJob`. A task KIE reports as failed is an ordinary 502.
- Refused before submit, where the source dropped or misrouted them:
  - Image-to-video models (`wan/2-7-image-to-video`, `hailuo/2-3-image-to-video-pro`, `grok-imagine/image-to-video`, `happyhorse/image-to-video`, `sora-2-image-to-video`, `sora-2-pro-image-to-video`). The source body never carries an input image. These stay in the metadata and registration marks them `supported: false`.
  - Image fields on video requests.
  - `aspect_ratio` on image requests, which the source ignored; the ratio goes in `size`.
  - A second input image (the source kept only the first), an input image on `gpt4o-image`, non-https or private input URLs, and data URIs.
  - `n` other than 1 on Market and Kontext, masks, quality/style/output options, streaming, and `b64_json` or binary output.
  - Image sizes outside the registry ratios, such as `1536x1024` -> `3:2`.
- Image items carry no `revised_prompt`. The source echoed the request prompt there.
- Usage is honest: accounting is `costStatus: "unknown"`. Native units count the images or videos returned. KIE answers carry no credit amount.
- Dynamic discovery: the source has none for KIE media, only static lists. The chat `validateUrl` stays on the `llm` kind.

## Not verified

- No live KIE call was made. Every test uses closed mocks.
- The upstream IDs, body field names and per-model input needs (for example which Market edit models require `image_url`, or whether `gpt4o-image` takes all five ratios) come from the pinned source, not from a live check.
- Market video models that also accept optional images are text-only here.

## Registration (serial step, not done here)

See `registration.json`, `integrationPoints`:

1. Add `kie: kieImageAdapter` to `IMAGE_ADAPTERS` in `open-sse/handlers/imageProviders/index.js`.
2. Add `kie: kieVideoAdapter` to `VIDEO_GENERATION_ADAPTERS` in `open-sse/handlers/videoProviders/index.js`.
3. In `open-sse/providers/registry/kie.js`, set `serviceKinds: ["llm", "image", "video"]` and add the image and video model rows. Omit the `KIE_VIDEO_UNSUPPORTED_MODELS` rows or mark them. Keep the chat transport.
4. List the kinds in `docs/providers/catalog.mdx`.
5. Replace the test block `staging state (isolated)` with positive identity checks. No other test block depends on the unregistered state.

## Evidence

```bash
cd tests && test -f unit/native-kie-video-image.test.js && node node_modules/vitest/vitest.mjs run unit/native-kie-video-image.test.js --maxWorkers=2
```

Result: 1 file, 70 tests passed. `npx eslint` on the new module directory and the test file exited 0. The full suite was not run.
