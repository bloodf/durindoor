# xAI native video (staged), 2026-11-27

Issue: #2034. Two inventory rows cover xAI video. The first is `xai`: registry → `xaiGrokImagineHandler.ts`, Bearer key, video create and status. The second is CPA's xAI handling of `/v1/videos` with generation, edit, extension, retrieve and content. Both were marked MISSING. Decision 15 accepted this delta. This report records what was missing locally and what was already equivalent.

## Sources

- OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.
  - `open-sse/config/videoRegistry.ts`, entry `xai`: `id: "xai"`, `baseUrl: "https://api.x.ai/v1/videos"`, `statusUrl: "https://api.x.ai/v1/videos"`, `authType: "apikey"`, `authHeader: "bearer"`, `format: "xai-video"`, model `grok-imagine-video`.
  - `open-sse/handlers/videoGeneration.ts`: `format === "xai-video"` dispatches to `handleXaiVideoGeneration` with the caller's signal.
  - `open-sse/handlers/videoGeneration/xaiGrokImagineHandler.ts`:
    - Credential `apiKey || accessToken`.
    - `POST {baseUrl}/generations` with `Authorization: Bearer`, `Content-Type: application/json` and a one-shot body. The body is `{ model, prompt, image?: { url }, reference_images?, duration?, aspect_ratio?, resolution? }`.
    - Reads `request_id` (`^[A-Za-z0-9_-]+$`), then polls `GET {statusUrl}/{request_id}` every 2.5 s.
    - Bounds: 300 s by default, a 30 min ceiling and 300 polls. Each is a client knob: `timeout_ms`, `poll_interval_ms` (1 s floor) and `max_polls`.
    - `done` + `video.url` → `{ created, data: [{ url, format: "mp4" }] }`. `failed` → 502.
    - Bodies are bounded at 1 MiB. Requests use `redirect: "error"`.
    - Upstream `error.message` is passed back after sanitizing.
- CLIProxyAPI at `47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e` (MIT). The read-only checkout was `/tmp/cpa-2034`.
  - `internal/api/server_routes.go` registers these routes:
    - Native routes: `POST /v1/videos`, `/v1/videos/generations`, `/edits` and `/extensions`, plus `GET /v1/videos/:request_id`.
    - OpenAI-shaped routes: `POST /videos`, `GET /videos/:id` and `GET /videos/:id/content`.
  - `internal/runtime/executor/xai_executor_media.go` `executeVideos`:
    - Posts to `/videos/{generations|edits|extensions}`, or sends `GET /videos/{request_id}`.
    - Applies xAI headers and `x-idempotency-key`.
    - Records usage through `ParseXAIVideoUsage` (`usage_helpers.go`). That falls back to the requested duration.
  - `sdk/api/handlers/openai/openai_videos_handlers.go`:
    - Models: `grok-imagine-video`, `-1.5`, `-1.5-lite`, and the `-1.5-preview` alias.
    - `buildXAIVideosCreateRequest` reads `seconds` (clamped 1..15), `size` (four sizes → aspect ratio and 720p), `aspect_ratio`, `resolution`, `input_reference.image_url` (a `file_id` is refused), `image` and `image_url`, plus `reference_images` and `reference_image_urls` (at most 7, never combined with `image`).
    - Response builders: OpenAI `video` objects on create and on retrieve, with `error.message` copied from upstream.
    - Content: `xaiVideoContentURLFromPayload` accepts `http` or `https` on any host. `VideosContent` downloads and streams the bytes.
    - A per-video auth-binding store keeps follow-up requests on the same connection.

## Fresh-main check (what already exists)

- `open-sse/providers/registry/xai.js` already contains everything below. Nothing needs to be added to the registry or catalog:
  - alias `xai`, `authModes ["oauth", "apikey"]`;
  - `serviceKinds` including `video`;
  - video models `grok-imagine-video`, `grok-imagine-video-1.5` (aliases `-1.5-preview` and `-1.5-2026-05-30`, param `generate_audio`) and `grok-imagine-video-1.5-lite`;
  - `videoConfig: { baseUrl: "https://api.x.ai/v1/videos" }`.
- The async `/v1/videos` proxy is equivalent to the CPA native routes. Its parts are `src/app/api/v1/videos/[[...path]]/route.js`, `src/sse/handlers/video.js` and `open-sse/handlers/videoCore.js` `handleVideoProxyCore`.
  - **Routes and wire.** It serves `POST /v1/videos/{generations|edits|extensions}` and `GET /v1/videos/{request_id}`. The body goes byte-for-byte (JSON or multipart) to the same upstream paths, with `Authorization: Bearer accessToken || apiKey`. `Idempotency-Key` is forwarded.
  - **Connection binding.** A media-job ledger binds each job to its connection, and the `x-9router-connection-id` header plays the role of CPA's auth-binding store.
  - **Retries and errors.** An OAuth refresh-and-retry happens once on 401/403. A create is never resent after a network error. Error text is sanitized.
  - **Tests.** New contract tests here confirm the exact path, method, Bearer header and byte-identical body for all three actions and for retrieve. That code is not duplicated.
- What was missing:
  - **Synchronous `/v1/video/generations`.** `getVideoGenerationAdapter("xai")` is null, so `handleVideoGenerationCore` answers "use /v1/videos". This is the OmniRoute `xai-video` dispatch.
  - **OpenAI-shaped envelopes.** These are CPA's `POST /videos` translation (`seconds`/`size`/`input_reference`), the OpenAI `video` object on retrieve, and `GET /videos/{id}/content`.
- Out of scope: `grok-cli`, OmniRoute's Grok Build OAuth proxy video entry. It is a separate provider; the local `grok-cli` registry has no video. `fal-ai`'s `xai/grok-imagine-video/text-to-video` is a fal model, not the xAI API.

## What landed

All new files are under `open-sse/services/providerParity/native-xai-video/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and endpoints (create, edit, extend, status), auth header, models and aliases, CPA input limits, job states and bounds. |
| `request.js` | `buildXaiVideoRequest` (native and OpenAI-style fields), `resolveXaiTiming`, `xaiImageReference`. |
| `http.js` | Credential by auth mode, bounded abortable fetch, redirect refusal, bounded JSON reads, refused-answer mapping, public https URL check, accepted-job accounting. |
| `job.js` | `submitXaiVideoJob`, `fetchXaiVideoStatus`, `settleXaiStatus`, `runXaiVideoJob` (create + bounded poll). |
| `envelope.js` | CPA `openAIVideoStatus`, `openAIVideoFromXaiCreate`, `openAIVideoFromXaiStatus`, `resolveXaiVideoContent`. |
| `adapter.js` | `createXaiVideoAdapter` (`VIDEO_GENERATION_ADAPTERS` contract). |
| `index.js` | Re-exports, plus the default `xaiVideoAdapter`. |
| `registration.json` | Exports, canonical ID and alias, models, endpoints, auth, equivalence evidence, integration points. |

Tests are in `tests/unit/native-xai-video.test.js`: 44 tests over a closed network.

Nothing is registered. `videoProviders/index.js`, `providers/registry/xai.js`, `src/**` and the docs catalog are unchanged. Only the isolated `staging state` test block asserts the unregistered state.

## Supported subset (synchronous adapter)

- **Models.** `grok-imagine-video`, `grok-imagine-video-1.5` and `grok-imagine-video-1.5-lite`, optionally prefixed with `xai/`. The aliases `grok-imagine-video-1.5-preview` and `-2026-05-30` are sent as `grok-imagine-video-1.5`, as in CPA. Any other model is a 400.
- **Create request.** `POST https://api.x.ai/v1/videos/generations` with exactly `Authorization: Bearer <credential>` and `Content-Type: application/json`. The body is `{ model, prompt, duration?, aspect_ratio?, resolution?, generate_audio?, image?: { url }, reference_images?: [{ url }] }`.
- **Body fields:**
  - `duration` or `seconds`: whole seconds from 1 to 15. If both are sent they must agree.
  - `size`: one of `720x1280`, `1024x1792`, `1280x720` or `1792x1024`. It maps to `9:16` or `16:9` and `720p`, as in CPA. An `aspect_ratio` sent alongside it must agree.
  - `aspect_ratio`: `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2` or `2:3`, or `square`, `landscape` or `portrait`.
  - `resolution`: `480p`, `720p` or `1080p`.
  - `generate_audio`: a boolean, on `grok-imagine-video-1.5` only.
  - Start image: one of `image` (a string, `{ url }` or `{ image_url: { url } }`), `image_url`, or `input_reference.image_url`.
  - Reference images: `reference_images` or `reference_image_urls`, at most 7 in total, never combined with a start image.
  - Every image must be a public https URL (no userinfo, no private or loopback host) or a base64 `data:image/{png,jpeg,jpg,webp,gif}` URI of at most 10 MiB.
- **Refused fields.** `n` other than 1, `stream`, a `response_format` other than `url`, and any unknown field are a 400 before the create is sent.
- **Status polling.** `GET https://api.x.ai/v1/videos/{request_id}` with the Bearer credential only. The `request_id` must match `^[A-Za-z0-9_-]{1,256}$` and is URL-encoded.
- **Job states.**

  | xAI status | Result |
  | --- | --- |
  | `done`, `completed`, `succeeded`, `success` | Finish with `video.url`. |
  | `pending`, `queued`, `processing`, `in_progress`, `running` | Keep polling. |
  | `failed`, `error`, `cancelled`, `canceled` | Ordinary failure (502, vendor code only). |
  | `expired`, any other status, a missing status, an answer naming another request, or `done` without a public https URL | Unknown outcome that is kept as accepted work. |

- **Answer.** `{ created, data: [{ url, format: "mp4" }] }`, with `response_format` `url` only. The URL is never downloaded.
- **Timing.** The source defaults and ceilings apply: a 300 s job deadline (30 min ceiling), a 2.5 s interval (1 s – 30 min) and at most 300 polls. The poll budget is `min(max_polls, ceil(timeout/interval))`. These knobs are never forwarded. Each create is bounded at 60 s and each status read at 30 s. A 429 or 503 status read is retried up to 5 times with backoff that honors `Retry-After` (capped at 30 s).

## Auth modes and identity

- **Credential choice.**
  - An `authType: "apikey"` connection sends its `apiKey`.
  - An `authType: "oauth"` connection sends its `accessToken`.
  - A connection with neither type falls back to the source's `apiKey || accessToken`.
  - A credential containing CR or LF is refused.
- **No refresh in the adapter.** The adapter never refreshes an OAuth token and never retries a 401/403; it returns `authFailed`. When this is registered, the route must refresh xAI OAuth credentials before dispatch, as it already does for RenderHour. `registration.json` lists this integration point.
- **Origin and isolation.**
  - The connection's proxy options are applied.
  - A connection base URL is ignored; the credential only goes to `https://api.x.ai`.
  - Nothing is cached between calls. A test runs two connections concurrently and checks that each keeps its own credential and request id.
- **Accounting identity.** Success accounting and `acceptedJob` metadata carry `jobId` (the xAI `request_id`), `authMode` and `connectionId`.

## Usage and cost

- `nativeUnits.videos` is 1. `nativeUnits.videoSeconds` comes only from the response's `video.duration`. CPA's fallback to the requested duration is not ported.
- The cost is the provider receipt when the status answer carries `usage.cost_in_usd_ticks` or another USD field, decoded by `mediaAccounting`. Otherwise it is `unknown` / `unavailable`.
- Accepted work whose outcome is unknown carries `acceptedJob`, with `costSource: "accepted-job"` and an unknown cost.

## Errors, uncertainty and no replay

- **Redirects.** Redirects are refused (`redirect: "manual"`). A 3xx create answer is a 502 without `acceptedJob`. An answer from another origin, or one marked `redirected`, carries `acceptedJob` (`submit-unknown`).
- **Refused creates.** Only the status and a vendor `code` of a safe shape are kept; the upstream `error` and `message` text is never quoted.

  | Create answer | Result |
  | --- | --- |
  | 402, or 400/403/429 with a credit, quota, balance, spend or billing code | 402 with `quotaExhausted` |
  | 401/403 | `authFailed` |
  | 429 | 429 with bounded `Retry-After` evidence |
  | other 4xx | passed through |
  | 5xx | 502 with `acceptedJob` (`submit-unknown`) |

- **Uncertain creates.** A create that times out, is interrupted after the send, or answers without a usable `request_id` or with an unreadable body carries `acceptedJob` (`submit-unknown`). It is never resent. A proven pre-connect failure (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, connect timeout) carries no `acceptedJob`.
- **Cancellation.** The caller's signal aborts the create socket, the status socket and the wait between polls. Each case gives these results:
  - before the send: 499 without `acceptedJob`;
  - during the create: 499 with `submit-unknown`;
  - after acceptance: 499 with `accepted`. xAI owns the remote job's lifetime.
- **Secrets.** Credential values are redacted from every error result, and tests assert that no credential, prompt or upstream echo appears.

## OpenAI envelope helpers (staged, not routed)

- **`openAIVideoStatus`.** This is CPA's status mapping.
- **`openAIVideoFromXaiCreate(answer, meta)`.** It returns `{ object: "video", id, model, status, progress, prompt, created_at, seconds?, size? }`, or null when there is no safe `request_id`.
- **`openAIVideoFromXaiStatus(id, answer, fallbackModel)`.**
  - It returns CPA's retrieve object, with `seconds` from `video.duration`.
  - `video_url` is included only when the job is completed and the URL is public https.
  - Errors become `{ code, message: "Video generation failed" }`. The upstream message is never copied.
- **`resolveXaiVideoContent({ videoId, variant, credentials, signal })`.**
  - It makes one bounded status read on the given connection and returns `{ success: true, url }`.
  - A `variant` other than `video` is a 400, as in CPA. A job that is not finished is a 409.
  - The gateway does not download or stream the bytes. CPA proxied them; an integrator can redirect to the URL.

## Remaining restrictions

- Registration is the next step. It covers `VIDEO_GENERATION_ADAPTERS`, OAuth refresh before dispatch in `src/sse/handlers/video.js`, and optional OpenAI-shaped routes. `registration.json` lists each point.
- The synchronous adapter does generation only. Edits and extensions stay on the existing `/v1/videos/{edits|extensions}` proxy, which is already wire-equivalent to CPA.
- Model discovery is a static list. Neither source discovers video models dynamically, and xAI's `/v1/models` lists chat models only.
- Multipart input is not accepted by the synchronous adapter. The async proxy forwards it as-is.
- No live xAI call was made. Passing tests say nothing about the live service.

## Evidence

```bash
cd tests && test -f unit/native-xai-video.test.js && node node_modules/vitest/vitest.mjs run unit/native-xai-video.test.js --maxWorkers=2
```

The run passed 44 of 44 tests. `npx eslint` on the new files exited 0. `node scripts/check-anti-slop.mjs` reported 0 diagnostics.
