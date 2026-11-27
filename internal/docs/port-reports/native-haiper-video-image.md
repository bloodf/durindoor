# Haiper native image and video (staged), 2026-11-27

Issue: #2034. The inventory rows for `haiper` video (registry → video dispatcher) and image (`IMAGE_ADAPTERS`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `haiper`: baseUrl `https://api.haiper.ai/v1/jobs/gen2/text2video`, statusUrl `https://api.haiper.ai/v1/jobs`, authType `apikey`, authHeader `HAIPER_KEY`, format `haiper-video`, model `gen2` ("Gen 2").
- `open-sse/config/imageRegistryData.ts`, entry `haiper`: baseUrl `https://api.haiper.ai/v1/jobs/gen2/text2image`, statusUrl `https://api.haiper.ai/v1/jobs`, authType `apikey`, authHeader `HAIPER_KEY`, format `haiper-image`, model `gen2` ("Gen 2 Image"), `supportedSizes` `16:9`/`9:16`/`1:1`/`4:3`/`3:4`.
- `open-sse/handlers/videoGeneration.ts`, `handleHaiperVideoGeneration` and `deliverHaiperVideo`, with `pollJsonAfter` from `handlers/videoGeneration/abort.ts`:
  - Submit `POST` with `Content-Type: application/json` and `HAIPER_KEY: <key>`; body is always `{ prompt, duration: 4, aspect_ratio: "16:9" }`.
  - Reads `job_id`, then every 5 s `GET {statusUrl}/{job_id}` with `HAIPER_KEY` only, for up to 300 s.
  - `completed` or `succeeded` with `creation_url` or `output.video_url` → downloads the video and answers base64; `failed` → 502; deadline → 504.
- `open-sse/handlers/imageGeneration/providers/haiper.ts`, `handleHaiperImageGeneration`: the same envelope with body `{ prompt, aspect_ratio: body.aspect_ratio || "16:9" }` and result `creation_url` or `output.image_url`, downloaded and answered base64.
- `open-sse/config/providers/registry/haiper/index.ts`: the chat-format provider entry (alias `hp`, models `gen2`, `gen2-image`). The media registries use `gen2` for both kinds.

## Fresh-main check

- `open-sse/providers/registry/haiper.js` exists with alias `hp`, `authType: "apikey"` and a raw `HAIPER_KEY` transport header, but `serviceKinds: []`, `models: []` and `hiddenKinds: ["image", "video"]`. Its comment says it stays hidden "until image/video routes have Haiper adapters".
- `rg -i haiper open-sse/handlers` finds no match. Neither `IMAGE_ADAPTERS` nor `VIDEO_GENERATION_ADAPTERS` has a `haiper` (or `hp`) key; `getImageAdapter("haiper")` and `getVideoGenerationAdapter("haiper")` return null.
- No other adapter sends to `api.haiper.ai`, and no generic adapter speaks the Haiper envelope (`HAIPER_KEY` raw header, `job_id`, `GET /v1/jobs/{id}`). So no equivalent exists, and the delta is real.

## What landed

All new files are under `open-sse/services/providerParity/native-haiper-video-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and endpoints, auth header, model lists, aspect ratios, fixed video values, and bounds. |
| `http.js` | Bounded abortable fetch, redirect refusal, bounded JSON reads, refused-answer mapping without quoting upstream text, the public https URL check, and accepted-job accounting. |
| `request.js` | `buildHaiperImageRequest` and `buildHaiperVideoRequest`. |
| `job.js` | `runHaiperJob`: the shared submit + bounded poll envelope. |
| `adapters.js` | `createHaiperImageAdapter` (guarded `generate`) and `createHaiperVideoAdapter` (`VIDEO_GENERATION_ADAPTERS` contract). |
| `index.js` | Re-exports, plus default `haiperImageAdapter` and `haiperVideoAdapter`. |
| `registration.json` | Exports, canonical ID and alias, models, endpoints, auth, and the registration steps. |

Tests are in `tests/unit/native-haiper-video-image.test.js`: 76 tests over a closed network. The job-outcome block runs once per modality.

Nothing is registered. `imageProviders/index.js`, `videoProviders/index.js`, `providers/registry/haiper.js` and the docs catalog are unchanged. Only the isolated `staging state` test block asserts that.

## Supported subset

### Image

`POST https://api.haiper.ai/v1/jobs/gen2/text2image`, headers exactly `Content-Type: application/json` and `HAIPER_KEY: <key>`.

- Body `{ prompt, aspect_ratio }`. `aspect_ratio` is one of `16:9`, `9:16`, `1:1`, `4:3`, `3:4`, defaulting to `16:9` as in the source.
- `size` is accepted as an alias of `aspect_ratio` only when it is one of those ratios (the registry's `supportedSizes`). A `size` that disagrees with `aspect_ratio` is refused.
- Answer `{ created, data: [{ url }] }`. `nativeUnits.images` is 1 and the cost is unknown. `meta.jobId` keeps the Haiper job id.

### Video

`POST https://api.haiper.ai/v1/jobs/gen2/text2video` with the same headers.

- Body is always `{ prompt, duration: 4, aspect_ratio: "16:9" }`, as in the source. `duration` or `seconds` of `4` and `aspect_ratio` `16:9` are accepted; any other value is refused.
- Answer `{ created, data: [{ url, format: "mp4" }] }`. `nativeUnits.videos` is 1 and the cost is unknown.

### Both kinds

- Status `GET https://api.haiper.ai/v1/jobs/{job_id}` with `HAIPER_KEY` only, as in the source. Job ids must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$` and are URL-encoded.
- `status` `completed` or `succeeded` finishes; the result comes from `creation_url`, then `output.image_url` / `output.video_url`. `failed` is an ordinary failure. Any other string is pending.
- `response_format` is `url` only. The result URL must be https on a public literal host with no userinfo, and it is returned, never downloaded.
- The poll interval is 5 s and the job deadline 300 s, both from the source. Each submit and each status request is bounded at 30 s. A 429 or 503 status check is retried up to 5 times with backoff that honors `Retry-After`.
- The key is the selected connection's `apiKey` only (the source reads `credentials.apiKey`). A key containing CR or LF is refused. The connection's proxy options are applied. A connection base URL is ignored; the key only goes to `https://api.haiper.ai`.
- Nothing is cached between calls. Concurrent calls from two connections keep their own keys and job ids, and a test covers this.

## Errors, uncertainty and no replay

- Redirects are refused (`redirect: "manual"`). A 3xx submit answer is a 502 without `acceptedJob`. An answer from another origin, or one marked `redirected`, carries `acceptedJob` (`submit-unknown`).
- Refused submit answers:

  | Answer | Result |
  | --- | --- |
  | 401 or 403 | Passed through. |
  | 402, or a 403/429 whose vendor code matches `quota`, `balance`, `credit` or `insufficient` | 402 with `quotaExhausted: true`. |
  | 429 | Rate limited, with `Retry-After` evidence when present. |
  | Other 4xx | Status passed through. |
  | 5xx | 502 with `acceptedJob` (`submit-unknown`). |

  The message carries only the status and a vendor code of a safe shape; never the upstream text or the key.
- A transport failure before any connection (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, connect timeout) is a plain 502. Any later transport failure or a submit timeout carries `acceptedJob` (`submit-unknown`). Nothing is resent.
- A caller abort before the send is a 499 without `acceptedJob`; after the send, a 499 with `acceptedJob`. The deadline and the caller abort both tear down the socket through the fetch signal and stop the poll wait.
- After a job is accepted, these are unknown outcomes with `acceptedJob` (`accepted`): an unreadable status body, a status without a status string, an answer about another `job_id`, completed without a usable URL (the source kept polling until the deadline), a non-OK poll (401, 403 and 429 are passed through), a redirected poll, retry exhaustion, the deadline (504), and an abort. A submit answer without a usable `job_id` is also an unknown outcome.

## Refused before any billable send (the source dropped or replaced these)

- Unknown model (only `gen2`), empty prompt, a prompt over 8,000 characters.
- `n` other than 1, `stream`, `response_format` other than `url` (including `b64_json` and binary).
- Any field outside the supported set. Image allows `model`, `prompt`, `aspect_ratio`, `size`, `n`, `response_format`, `user`, `stream`. Video allows `model`, `prompt`, `aspect_ratio`, `duration`, `seconds`, `n`, `response_format`, `user`, `stream`. This covers input images, masks, negative prompts, seeds and quality options, which the source silently dropped.
- Image: an `aspect_ratio` or `size` outside the five ratios.
- Video: `duration`/`seconds` other than 4, `aspect_ratio` other than `16:9`. The source always sent 4 s at 16:9 regardless of the request.

## Remaining restrictions

- Base64 output: the source downloaded the result and answered `b64_json`. This port answers the URL only, because no shared bounded SSRF-guarded media downloader exists locally; `b64_json` is refused before submit rather than claimed.
- Model discovery: the source has no dynamic discovery for Haiper; the lists are static. `gen2-image` from the OmniRoute chat-format entry is not added.
- Image-to-video, other durations and other video ratios: not in the source, so not offered.
- Cancellation: no upstream cancel is sent, and the source sends none. An abandoned job may still run and bill; `acceptedJob` records it.
- `/v1/videos`: the async proxy (`videoCore.js`) gets no Haiper config, because it has no accepted-job ledger.
- No live Haiper call was made. The wire shapes come from the pinned source only.

## Registration (separate, serial)

See `registration.json` → `integrationPoints`:

1. Add `haiper` to `IMAGE_ADAPTERS` and `VIDEO_GENERATION_ADAPTERS`.
2. In `registry/haiper.js`: set `serviceKinds` to `["image", "video"]`, drop `hiddenKinds`, and add the `gen2` image and video model rows. Keep alias `hp`, `authType: "apikey"` and the raw `HAIPER_KEY` transport.
3. Update the docs catalog.
4. Replace the isolated `staging state` test block with positive registry identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-haiper-video-image.test.js --maxWorkers=2
# Test Files 1 passed (1) · Tests 76 passed (76)
npx eslint open-sse/services/providerParity/native-haiper-video-image tests/unit/native-haiper-video-image.test.js
# clean
node scripts/check-anti-slop.mjs
# anti-slop gate OK
```
