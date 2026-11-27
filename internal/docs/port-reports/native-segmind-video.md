# Segmind native video (staged), 2026-11-27

Issue: #2034. The inventory row for `segmind` video (registry → `videoGeneration/providers/segmind.ts`, `x-api-key`, model endpoint, raw video response) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `segmind`: id `segmind`, baseUrl `https://api.segmind.com/v1`, authType `apikey`, authHeader `x-api-key`, format `segmind`, models `SEGMIND_VIDEO_MODELS`.
- `open-sse/config/providers/registry/segmind/videoModels.ts`: `wan2.1-t2v`, `wan2.7-i2v`, `hunyuan-video-t2v`, `ltx-video-t2v`, `kling-video-t2v`. The source comment says only the two Wan slugs were checked against Segmind's model pages; the other three "follow the same documented naming convention".
- `open-sse/handlers/videoGeneration.ts`: `format === "segmind"` dispatches to `handleSegmindVideoGeneration`.
- `open-sse/handlers/videoGeneration/providers/segmind.ts`: the token is `apiKey || accessToken`. The body is `{ prompt }`, plus `negative_prompt` when it is a string, `seed` when it is a number, `duration` as `Number(duration)` when it is given, and `aspect_ratio` when it is a string. The answer is `{ created, data: [{ b64_json, format: "mp4" }] }`.
- `open-sse/utils/segmindClient.ts`, `segmindRequest`: `POST {baseUrl}/{model}` with `Content-Type: application/json` and `x-api-key: <token>`. A 2xx answer's bytes are returned as they are. A non-2xx answer returns its status with the sanitized upstream text. A transport error returns 502.
- `src/shared/constants/providers/apikey/specialty-media.ts`, `segmind`: an API-key connection (name "Segmind", color `#7C3AED`, text icon `SG`, website `https://segmind.com`) whose hint says other models "can be routed by using their Segmind slug as the model id".

## Fresh-main check

- `rg -i segmind open-sse src` finds no match. There is no `open-sse/providers/registry/segmind.js`, no alias, and no `segmind` key in `VIDEO_GENERATION_ADAPTERS`. `getVideoGenerationAdapter("segmind")` returns null.
- No other adapter sends to `api.segmind.com`, and no generic adapter matches this wire shape (synchronous `POST /v1/{slug}`, raw `x-api-key`, raw video bytes as the answer). There is no equivalent, so the delta is real. It includes the provider definition.

## What landed

All new files are under `open-sse/services/providerParity/native-segmind-video/`:

| File | Role |
| --- | --- |
| `config.js` | Provider ID, fixed origin, auth header, source and supported model lists, slug validation, bounds, the staged `SEGMIND_PROVIDER_DEFINITION` (local registry shape), and catalog metadata. |
| `request.js` | `buildSegmindVideoRequest`: the source body mapping, with every value checked first. |
| `job.js` | `runSegmindVideoJob`: one bounded POST, refused-answer mapping, a bounded MP4 body read, and accepted-job accounting. |
| `adapter.js` | `createSegmindVideoAdapter`, following the `VIDEO_GENERATION_ADAPTERS` contract. The default export is the adapter. |
| `index.js` | Re-exports. |
| `registration.json` | Exports, canonical ID, aliases, models, endpoints, auth, and the registration steps. |

Tests are in `tests/unit/native-segmind-video.test.js`: 67 tests over a closed network.

Nothing is registered. `videoProviders/index.js`, `providers/registry/` and the docs catalog are unchanged. Only the isolated `staging state` test block asserts that.

## Supported subset

`POST https://api.segmind.com/v1/{slug}` with exactly two headers, `Content-Type: application/json` and `x-api-key: <key>`, and `redirect: "manual"`.

- **Models:** `wan2.1-t2v`, `hunyuan-video-t2v`, `ltx-video-t2v` and `kling-video-t2v`. The `segmind/` prefix is optional. Any other single Segmind slug (`^[a-z0-9][a-z0-9._-]{0,127}$`, case-insensitive, without `..`) is also accepted, as the source documents. Nothing is discovered: the source calls no model-listing API.
- **Body:** `{ prompt, negative_prompt?, seed?, duration?, aspect_ratio? }`, as in the source.
  - `prompt` must be a non-empty string of at most 10,000 characters.
  - `negative_prompt` must be a string.
  - `seed` must be an integer from 0 to 2³²−1.
  - `duration` must be a number, or a numeric string, above 0 and at most 60.
  - `aspect_ratio` must have the form `N:M`.
  - `n` must be 1, `stream` must be false, and `response_format` must be `b64_json`.
- **Answer:** `{ created, data: [{ b64_json, format: "mp4" }] }`. `nativeUnits.videos` is 1, the cost is unknown (`costSource: "unavailable"`), and `meta.model` is the slug.
- **Credentials:** the selected connection's `apiKey`, or its `accessToken`, is used for that call only. Connection proxy settings are honored. Connection base URLs are ignored.

## Refused before submit (400 or 401, nothing sent)

- `wan2.7-i2v` and any slug that names image-to-video (`i2v`, `image-to-video`, `img2vid`). The source lists `wan2.7-i2v`, but its body never sends an image, so the request could only fail upstream. The model stays in `SEGMIND_SOURCE_VIDEO_MODELS` and is left out of `SEGMIND_VIDEO_MODELS`.
- Input media and fields the source silently dropped that would change the output: `image`, `image_url`, `image_urls`, `images`, `input_image`, `input_reference`, `reference_images`, `first_frame`, `last_frame`, `video`, `video_url`, `audio`, `audio_url`, `mask`, `size`, `resolution`, `quality`, `fps`, `width`, `height`, and `seconds` (the error points the caller to `duration`).
- Mistyped or out-of-range values. The source sent `duration: "5s"` as `null`, and dropped a string seed.
- `n > 1`, `stream`, `response_format: "url"`, and malformed slugs (`a/b`, `../x`, empty).
- A missing key, or one containing CR, LF or NUL, gets a local 401. The source sent an empty header.

## Errors and accounting

The upstream body is never returned. On 403, 406 and 429 it is read (at most 16 KiB) only to match the spent-credit wording.

| Upstream | Local | Notes |
| --- | --- | --- |
| 401, 403 | 401 | |
| 402, or 403/406/429 whose body says the credits are spent | 402, `quotaExhausted: true` | Applies to this connection only. |
| 429 | 429 | Includes a reset time when `Retry-After` is given. |
| 404 | 404 | |
| 400, 422 | 400 | |
| Other 4xx | Passed through | |
| 5xx | 502 + `acceptedJob` (`submit-unknown`) | |
| 3xx | 502 | Refused and never followed. |
| Answer from another origin | 502 + `acceptedJob` | |
| Failure before connecting (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) | 502 | Nothing was sent. |
| Interrupted send | 502 + `acceptedJob` | |
| Deadline | 504 + `acceptedJob` | |
| Caller abort after the send | 499 + `acceptedJob` | |
| 200 with JSON, text, image or audio content type, non-MP4 bytes (no `ftyp` box), an empty body, or more than 64 MiB | 502 + `acceptedJob` (`completed-unusable`) | The source would have labeled such a body `mp4`. |
| Body read timeout or abort | 504 / 499 + `acceptedJob` (`accepted`) | |

Nothing is ever resent.

## Bounds

- One 600 s deadline (`SEGMIND_VIDEO_TIMEOUT_MS`) covers the request, the wait for headers and the body read. Segmind answers only when the video is ready.
- The deadline and the caller's signal both abort the fetch signal, and so the socket. The wait ends even when a transport ignores its signal, and a late answer is discarded.
- The body read stops at 64 MiB, whether the length is declared or streamed.

## Remaining restrictions

- No image-to-video. That would need an image upload contract the source does not have.
- No `url` output: Segmind returns bytes, not a hosted file.
- No cancel. Segmind has no job ID, so an abort only stops this client.
- The 406 quota mapping and the spent-credit wording are fork choices, based on Segmind's public API documentation. They are not source behavior and have not been checked against the live service.
- The slugs `hunyuan-video-t2v`, `ltx-video-t2v` and `kling-video-t2v` were not verified even upstream. A wrong slug gives a 404.
- Custom slugs are not checked against a catalog. A custom slug for an image model returns image bytes, which are reported as `completed-unusable` with `acceptedJob`.
- Segmind image generation (`imageRegistryData.ts` `segmind`) is a separate delta and is not ported here.

## Registration (serial, not done here)

1. Add `open-sse/providers/registry/segmind.js` from `SEGMIND_PROVIDER_DEFINITION`, then regenerate `registry/index.js` with `scripts/gen-registry-index.mjs`.
2. Add `segmind: segmindVideoAdapter` to `VIDEO_GENERATION_ADAPTERS` in `open-sse/handlers/videoProviders/index.js`.
3. List Segmind video in `docs/providers/catalog.mdx`.
4. Replace the `staging state (isolated)` test block with positive identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-segmind-video.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 67 passed (67)
node scripts/check-anti-slop.mjs   # 0 diagnostics
```
