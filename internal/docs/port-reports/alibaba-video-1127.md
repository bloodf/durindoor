# Alibaba DashScope video jobs (staged), 2026-11-27

Issue: #2034 (review8 P2: native Alibaba video is missing; `mediaEndpointSupport` was false for both video endpoints, the core answered 400, and no fetch was made).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT):

- `open-sse/config/videoRegistry.ts`: the `alibaba` entry (base `https://dashscope-intl.aliyuncs.com/api/v1`, Bearer API key, format `dashscope-video`, nine models).
- `open-sse/handlers/videoGeneration.ts`: dispatches `dashscope-video` to the handler below.
- `open-sse/handlers/videoGeneration/dashscopeHandler.ts`: submit, poll, payload builders, media collection, resolution and ratio normalisation.
- `open-sse/services/accountFallback.ts`: `DASHSCOPE_DEAD_ACCOUNT_RE` (`Arrearage`, `AccessDenied.Unpurchased`). DurinDoor already has these codes in `open-sse/services/accountFallback.js`.

## What landed

| File | Role |
| --- | --- |
| `open-sse/services/alibabaVideo/request.js` | Builds the DashScope request body and refuses anything it cannot use before submit. |
| `open-sse/services/alibabaVideo/job.js` | Sends one bounded submit, polls within the job deadline, and handles accepted-job accounting. |
| `open-sse/handlers/videoProviders/alibaba.js` | Adapter for `/v1/video/generations` (`async: true`, `generate`). |
| `tests/unit/alibaba-video-flow.test.js` | 76 tests over a closed network. |

The adapter is **not registered**. The following shared files are unchanged: `videoProviders/index.js`, the provider registry, media endpoint support, and the docs catalog. `getVideoGenerationAdapter("alibaba")` still returns null, so `/v1/video/generations` still refuses Alibaba until a separate registration change lands.

## Supported subset

Wire contract:

- **Submit:** `POST {origin}/api/v1/services/aigc/video-generation/video-synthesis` with `Authorization: Bearer <apiKey>`, `X-DashScope-Async: enable`, and `{ model, input, parameters }`. The task id is read from `output.task_id`.
- **Poll:** `GET {origin}/api/v1/tasks/{task_id}`. Statuses: `PENDING` and `RUNNING` (keep polling), `SUCCEEDED` (read `output.video_url`), `FAILED` (failure).
- **Origin:** fixed. The default is the international origin (`https://dashscope-intl.aliyuncs.com`). A factory option allows the source's china-beijing origin (`https://dashscope.aliyuncs.com`). Any other origin is refused.

Models: the nine `alibaba` ids in the source registry. Each one uses the body the source builds for it:

| Model | Kind | Media |
| --- | --- | --- |
| `happyhorse-1.1-t2v` | text-to-video | none |
| `happyhorse-1.1-i2v` | image-to-video | exactly one first frame |
| `happyhorse-1.1-r2v` | reference-to-video | reference images, at least one |
| `happyhorse-1.0-video-edit`, `wan2.7-videoedit` | video edit | one source video; optional reference images |
| `wan2.7-t2v-2026-06-12` | text-to-video | optional driving audio (`input.audio_url`) |
| `wan2.7-i2v-2026-04-25`, `wan2.6-i2v-flash` | image-to-video | one first frame; optional last frame and driving audio |
| `wan2.7-r2v-2026-06-12` | reference-to-video | reference images and/or reference videos, at least one |

The undated `wan2.7-t2v` and `wan2.7-i2v` ids belong to the source's `qwen-cloud` entry, not `alibaba`. They are refused, and no aliases are added.

Request fields:

- **Prompt and media:** `prompt`, `negative_prompt`, and media as an explicit `media` list or the source's shorthand fields (`image`, `image_url`, `imageUrls`, `image_urls`, `reference_images`, `video`, `video_url`, `videoUrls`, `video_urls`, `reference_videos`, `audio`, `audio_url`).
- **Parameters:** `resolution` (720P or 1080P), `ratio` or `aspect_ratio` (16:9, 9:16, 1:1, 4:3, 3:4; not accepted for image-to-video), `size`, `duration` or OpenAI's `seconds`, `prompt_extend`, `watermark`, `seed`, `shot_type`.
- **Response:** `{ created, data: [{ url, format: "mp4" }] }`. Accounting is `nativeUnits.videos = 1` with unknown cost.

## Deviations from the source

All of these are refusals or bounds; none invents behaviour.

- **Refused before submit (the source drops or forwards these):**
  - a raw `parameters` object;
  - media that the model's builder ignores;
  - a second first frame or source video;
  - an explicit `media` list mixed with shorthand fields;
  - an unknown explicit media type;
  - a non-https media URL, one on a private or metadata host, or one with credentials;
  - a resolution other than 720P or 1080P;
  - a ratio outside the five the source derives;
  - a `size` without one of those ratios and a 720 or 1080 short side (the source rounds any size to a tier);
  - a ratio or size for image-to-video models;
  - an unusable duration, seed, boolean or `shot_type`;
  - `n` other than 1.
- **No duration ranges:** neither the source nor this port checks them. DashScope refuses an out-of-range value before it creates a task.
- **Timeouts and redirects:**
  - the job has a total deadline (source value 300 s) and the poll interval is the source's 2.5 s;
  - submit and each status check are bounded to 30 s;
  - the caller's signal aborts every fetch and every wait;
  - submit uses `redirect: "manual"` and a 3xx is refused; status checks use `redirect: "error"`;
  - an answer from another origin is treated as an unknown outcome.
- **Error text:** upstream messages are never repeated. Only a vendor `code` that matches `^[A-Za-z][A-Za-z0-9._-]{0,63}$` appears, and errors redact the connection's key. JSON bodies are capped at 64 KiB (16 KiB for refusals).
- **Account health (selected connection only):**
  - 401 stays 401;
  - `Arrearage` or `AccessDenied.Unpurchased` on 400/403 becomes 402 with `quotaExhausted: true`;
  - 429 keeps a bounded Retry-After reset only;
  - other 4xx pass through as refusals.
- **Accepted and uncertain jobs:** nothing is resent. These are returned with `acceptedJob` (`costSource: "accepted-job"`) so the route records them once:
  - a submit that times out, is interrupted or is aborted in flight;
  - a 5xx submit;
  - a 2xx without a usable task id;
  - an answer that was redirected;
  - a poll timeout, abort, refused or unreadable status check, or an answer about another task;
  - `UNKNOWN_ERROR`, `CANCELED` or any unrecognised status;
  - `SUCCEEDED` without a usable URL.

  A `FAILED` task, a connect failure (ENOTFOUND, ECONNREFUSED and similar), an abort before submit, and every pre-acceptance refusal are plain failures.
- **Result URL:** must be https on a public literal host (`isBlockedHost` from `src/shared/utils/ssrfGuard.js`), without userinfo, and at most 4096 characters. It is returned and never fetched, so no result bytes pass through the gateway.
- **Credentials and region:** the source's region resolver and connection base URLs are not ported. The key goes only to a fixed DashScope origin. Nothing is shared between calls, and each call uses only its own key, task id and proxy options.

## Limitations

- **No cancellation:** the source never cancels a DashScope task, and this port does not add a cancel call without a verified contract. An abandoned task may still run and bill; `acceptedJob` records it.
- **Usage:** DashScope usage fields such as duration are not read, because the source reads none. Cost stays unknown.
- **Media URLs:** only https URLs on public hosts. `data:` URIs, `oss://` references and DashScope temporary uploads are refused.
- **Not live-tested:** nothing has been checked against a live DashScope account. Every test is closed-network with synthetic keys.

## Registration follow-up

A separate change must:

- add `alibaba` to `open-sse/handlers/videoProviders/index.js`;
- list the nine models for `/v1/video/generations` in the provider media metadata;
- update the docs catalog;
- decide whether `alibaba-cn` registers `createAlibabaVideoAdapter({ origin: ALIBABA_DASHSCOPE_CN_ORIGIN })`.
