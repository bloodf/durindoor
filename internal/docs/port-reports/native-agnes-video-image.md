# Agnes native image and video (staged), 2026-11-27

Issue: #2034. The inventory rows for `agnes` image (`IMAGE_ADAPTERS`) and video (`VIDEO_GENERATION_ADAPTERS`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `agnes`:
  - baseUrl `https://apihub.agnes-ai.com/v1/images/generations`, authType `apikey`, authHeader `bearer`, format `agnes-image`.
  - Models `agnes-image-2.0-flash`, `agnes-image-2.1-flash`, and `agnes-image-2.5-flash`, each with input modalities text and image.
  - `supportedSizes` `1K`/`2K`/`3K`/`4K`.
- `open-sse/handlers/imageGeneration.ts`:
  - Requires a non-empty `size` for `agnes-image`.
  - `buildAgnesImageRequestBody` builds the request body.
  - `extractImageInputs` collects input images.
  - The OpenAI-compatible fetch is in `handlers/imageGeneration/openAiImageFetch.ts`. It sends `Authorization: Bearer`, expects items with `data[]`, and accepts only an item that has a `url` or `b64_json`.
- `open-sse/config/videoRegistry.ts`, entry `agnes`:
  - baseUrl `https://apihub.agnes-ai.com`, statusUrl `https://apihub.agnes-ai.com/agnesapi`, authType `apikey`, authHeader `bearer`, format `agnes-video-job`.
  - Model `agnes-video-v2.0`.
  - Models `agnes-video-2.5-flash` and `agnes-video-2.5` use `jobPreset: "agnes-video-2.5-job"`.
- `open-sse/handlers/videoGeneration.ts`: a model's `jobPreset` takes precedence over the provider's `format`.
- `open-sse/handlers/videoGeneration/job.ts`, presets `agnes-video-job` and `agnes-video-2.5-job`.
- `tests/unit/agnes-provider.test.ts`: the source's wire assertions. The fork tests repeat them.

## Fresh-main check

The `agnes` provider is present only for chat: `open-sse/providers/registry/agnes.js` has `serviceKinds: ["llm"]` and an API-key connection.

No equivalent exists in fresh main:

- `rg -i agnes open-sse/handlers` finds no match.
- Neither `IMAGE_ADAPTERS` nor `VIDEO_GENERATION_ADAPTERS` has an `agnes` key or alias.
- No registry entry has an `imageConfig` or `videoConfig` that points at `apihub.agnes-ai.com`.
- A generic OpenAI image adapter does not count as an equivalent. It would send OpenAI fields (`n`, `quality`, top-level `response_format`) instead of the Agnes `ratio` and `extra_body` envelope, and it would not require `size`.
- `/v1/videos` (`videoCore.js`) has no Agnes config.

The source has no image or video entry for `agnes-cn`, so it gets none here.

## What landed

All new files are under `open-sse/services/providerParity/native-agnes-video-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and endpoints, model lists, sizes, the two job presets, and the bounds. |
| `http.js` | Bounded abortable fetch, redirect refusal, bounded JSON reads, mapping of refused answers without quoting the upstream body, the public https URL check, and accepted-job accounting. |
| `image.js` | `buildAgnesImageRequest` and `createAgnesImageAdapter`, a guarded `generate` adapter. |
| `video.js` | `buildAgnesVideoRequest`, `runAgnesVideoJob`, and `createAgnesVideoAdapter`, which follows the `VIDEO_GENERATION_ADAPTERS` contract. |
| `index.js` | Re-exports, plus the default `agnesImageAdapter` and `agnesVideoAdapter` instances. |
| `registration.json` | Exports, canonical ID, models, endpoints, auth, and the registration steps. |

Tests are in `tests/unit/native-agnes-video-image.test.js`: 56 tests over a closed network.

Nothing is registered. The following are unchanged:

- `imageProviders/index.js` and `videoProviders/index.js`
- `providers/registry/agnes.js`
- the docs catalog

`getImageAdapter("agnes")` and `getVideoGenerationAdapter("agnes")` still return null. Only the isolated `staging state` test block asserts this.

## Supported subset

### Image

`POST https://apihub.agnes-ai.com/v1/images/generations`

Headers are exactly `Content-Type: application/json` and `Authorization: Bearer <key>`, as in the source.

The request body is `{ model, prompt, size, ratio?, return_base64?, extra_body? }`:

- `ratio` comes from `ratio` if present, otherwise from `aspect_ratio`.
- `extra_body` merges these, in this order:
  1. the caller's `extra_body`
  2. `image`: the deduplicated inputs from `image_url`, `image`, `imageUrls`, `image_urls`, and chat `image_url` parts
  3. `response_format`

`size` is required and must be one of `1K`, `2K`, `3K`, or `4K`.

`response_format` may be `url` or `b64_json`:

- When the caller names a format, it is forwarded, and an answer in the other form fails with a 502 and `acceptedJob`. URLs are never downloaded and base64 is never re-hosted.
- When the caller names no format, either form is returned as Agnes sends it.

The answer is normalized to `{ created, data: [{ url } | { b64_json }, revised_prompt?] }`:

- A `url` must be https on a public literal host and have no userinfo.
- A `b64_json` must use the base64 charset and be at most `MAX_IMAGE_BYTES`.
- Items that fail these checks are dropped. If none remain, the call fails with a 502 and `acceptedJob` (`completed-unusable`), because a 2xx may already have been billed.

Accounting: `mediaAccounting(answer)` keeps any `usage` receipt, `nativeUnits.images` counts the returned items, and the cost stays unknown.

### Video

`POST https://apihub.agnes-ai.com/v1/videos` with the same headers. The body is `{ model, prompt, ...extras }`, where extras are every field except the gateway fields (`model`, `prompt`, `duration`, `poll_interval_ms`, `max_polls`, `response_format`, `n`, `stream`).

| Model | Preset | Job id | Poll |
| --- | --- | --- | --- |
| `agnes-video-v2.0` | `agnes-video-job` | `video_id`, then `task_id`, `id`, `request_id` | `GET /agnesapi?video_id={id}&model_name={model}` |
| `agnes-video-2.5-flash`, `agnes-video-2.5` | `agnes-video-2.5-job` (numeric `seconds` is sent as a string) | `id`, then `video_id`, `task_id`, `request_id` | `GET /v1/videos/{id}` |

Status is read from `status`, then `task_status`, then `state`:

- `completed`, `succeeded`, `success`, and `done` mean finished.
- `failed`, `error`, `cancelled`, and `canceled` are an ordinary failure.
- Any other string means the job is still pending.

The result is read from `metadata.url`, then `url`, then `video_url`. It must be a public https URL and is returned without being downloaded, as `{ created, data: [{ url, format: "mp4" }] }`.

Bounds and accounting:

- The poll interval is 2 s and the limit is 60 polls, both from the source.
- A 429 or 503 status check is retried up to 5 times with backoff that honors `Retry-After`. These retries do not count against the 60-poll budget.
- The job deadline is 300 s, the submit deadline 30 s, and each status request 30 s.
- `nativeUnits.videos` is 1 and the cost is unknown.

### Both kinds

- The key comes from the selected connection's `apiKey`, falling back to `accessToken` as in the source. A key containing CR or LF is refused.
- The connection's proxy options are applied.
- A connection base URL (`baseUrl` or `providerSpecificData.baseUrl`) is ignored. The key only ever goes to `https://apihub.agnes-ai.com`.
- Nothing is cached between calls. Concurrent calls from two connections keep their own keys and job ids, and a test covers this.

## Errors, uncertainty and no replay

- Redirects are refused (`redirect: "manual"`). A 3xx is a 502 without `acceptedJob`. A response from another origin, or one marked `redirected`, carries `acceptedJob` (`submit-unknown`).
- Upstream answers that refuse the request:

  | Answer | Result |
  | --- | --- |
  | 401 or 403 | Passed through. |
  | 402, or a 403/429 whose vendor code matches `quota`, `balance`, `credit`, `insufficient` or `arrear` | 402 with `quotaExhausted: true`. |
  | 429 | Rate-limited, with `Retry-After` evidence when the header is present. |
  | Other 4xx | Status passed through. |
  | 5xx | 502 with `acceptedJob` (`submit-unknown`). |

  The message carries only the status and a vendor code of a safe shape. The upstream text and the key are never included.
- A transport failure before any connection is made (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, or a connect timeout) is a plain 502.
- Any later transport failure, or a submit timeout, carries `acceptedJob` (`submit-unknown`). The request is never resent.
- A caller abort before the send is a 499 without `acceptedJob`. After the send it is a 499 with `acceptedJob`. The deadline and the caller abort both tear down the socket through the fetch signal, and both stop the poll wait.
- After a video job is accepted, the following are unknown outcomes that carry `acceptedJob` (`accepted`):
  - an unreadable status body
  - a status without a status string
  - an answer about another job id
  - completed without a usable URL
  - a poll that is not OK (401, 403 and 429 are passed through)
  - a redirected poll
  - running out of the poll budget or the deadline (504)
  - an abort
- A missing or unsafe job id in the submit answer is also an unknown outcome. Job ids must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`.

## Refused before any billable send (source dropped or passed these)

- **Image:**
  - unknown model
  - missing or unsupported `size`
  - `n` other than 1
  - `mask`, `mask_url`, `quality`, `style`, `output_format`, `output_compression`, `background`, `moderation`
  - `stream`
  - `response_format` other than `url` or `b64_json`, including binary output
  - `return_base64` that is not a boolean
  - `extra_body` that is not an object, or `extra_body.image` that is not a list of strings
  - a `ratio` that is not in `N:M` form
  - a prompt over 32,000 characters
  - more than 16 input images
  - input images that are not public https URLs or `data:image/*;base64` URIs of at most `MAX_IMAGE_BYTES`. Agnes fetches these inputs; the gateway never does.
- **Video:**
  - unknown model
  - empty prompt
  - `duration`, which the source silently dropped for both Agnes presets. Use `seconds` for 2.5, or `num_frames` and `frame_rate` for V2.0.
  - `n` other than 1
  - `stream`
  - `response_format` other than `url`
  - a request body over 20 MiB

## Remaining restrictions

- Model discovery: the source has no dynamic discovery for Agnes media, so the model lists are static. The `/v1/models` fetcher in the chat registry stays on the `llm` kind.
- Caller polling overrides: `poll_interval_ms` and `max_polls` are ignored and never forwarded. The source honored them within a ceiling.
- Result scanning: there is no deep scan of the status payload for a video URL. Only the three named fields are read.
- Cancellation: no upstream cancel is sent, and the source sends none. An abandoned job may still run and bill, and `acceptedJob` records it.
- `/v1/videos`: the async proxy (`videoCore.js`) gets no Agnes config, because it has no accepted-job ledger.
- No live Agnes call was made. The wire shapes come from the pinned source and its tests only.

## Registration (separate, serial)

See `registration.json` → `integrationPoints`:

1. Add `agnes` to `IMAGE_ADAPTERS` and `VIDEO_GENERATION_ADAPTERS`.
2. In `registry/agnes.js`:
   - Set `serviceKinds` to `["llm", "image", "video"]`.
   - Add the image and video model rows.
   - Add `imageConfig.baseUrl`.
3. Update the docs catalog.
4. Replace the isolated `staging state` test block with positive registry identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-agnes-video-image.test.js --maxWorkers=2
# Test Files 1 passed (1) · Tests 56 passed (56)
npx eslint open-sse/services/providerParity/native-agnes-video-image tests/unit/native-agnes-video-image.test.js
# clean
```
