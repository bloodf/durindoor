# Vertex AI Veo video (staged), 2026-11-27

Issue: #2034. Decision15 accepted this delta. The parity inventory row for `vertex` is: registry → video dispatcher (`vertex-veo`); Bearer credential; Vertex operation envelope; DurinDoor equivalent: none (MISSING). The chat Vertex executor does not serve video.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The checkout at `/tmp/omni-2034` was confirmed to be at that HEAD.

- `open-sse/config/videoRegistry.ts`: the `vertex` entry. It has `baseUrl: "https://us-central1-aiplatform.googleapis.com/v1"`, `authType: "apikey"`, `authHeader: "bearer"`, `format: "vertex-veo"`, and five models: `veo-3.1-generate-001`, `veo-3.1-fast-generate-001`, `veo-3.0-generate-001`, `veo-3.0-fast-generate-001`, and `veo-2.0-generate-001`.
- `open-sse/handlers/videoGeneration.ts`: dispatches `vertex-veo` to `handleVertexVeoGeneration`, which maps the request body to `vertexGenerateVideo` and returns `{ created, data: [{ b64_json | url, format }] }`.
- `open-sse/executors/vertexMedia.ts`: `vertexGenerateVideo`, `resolveVertexAuth`, and `buildModelRequest`.

## What already existed locally

No equivalent existed. The following searches and checks found no Veo, `predictLongRunning`, or `fetchPredictOperation` path in this checkout:

- `rg vertex-veo|predictLongRunning|fetchPredictOperation` over `open-sse`, `src`, and `tests`.
- `open-sse/handlers/videoProviders/index.js` registers `renderhour`, `adobe-firefly-api`, and `adobe-firefly-web` only.
- `open-sse/providers/registry/vertex.js` declares `serviceKinds: ["llm", "imageToText"]` and Gemini chat models only.
- `open-sse/executors/vertex.js` builds only `generateContent` and `streamGenerateContent` URLs.

The `vertex` connection shares the provider id and credential, but it uses a different wire endpoint and envelope, so it is not a video equivalent.

## What landed (private, unregistered)

| File | Role |
| --- | --- |
| `open-sse/services/providerParity/native-vertex-video/config.js` | Provider id, alias, format, the two active Veo 3.1 models with per-model durations, and catalog metadata. |
| `.../request.js` | Builds the `:predictLongRunning` body and refuses unsupported input before any credential use. |
| `.../auth.js` | Credential scope (project, location, mode), a bounded token mint, and action URLs and headers. |
| `.../job.js` | Bounded submit, bounded poll, result validation, and `acceptedJob` accounting. |
| `.../adapter.js` | Job adapter for `/v1/video/generations` (`generate`, `responseFormats`, `defaultResponseFormat`). |
| `.../index.js` | Re-exports everything above. |
| `.../registration.json` | Exports, ids, models, endpoints and auth, and the integration points for the registration change. |
| `tests/unit/native-vertex-video.test.js` | 67 tests over a closed network. |

Production code imports none of these modules. Unchanged files: `videoProviders/index.js`, `open-sse/providers/registry/**`, the docs catalog, and `src/**`. `getVideoGenerationAdapter("vertex")` still returns null. The test asserting that lives in its own staging block, so the registration change can replace it with positive registry checks without touching the functional tests.

## Supported subset

Wire contract (source-derived):

- **Submit:** `POST {base}/publishers/google/models/{model}:predictLongRunning` with `{ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio?, durationSeconds?, negativePrompt? } }`. The response's `name` is the operation.
- **Poll:** `POST {base}/publishers/google/models/{model}:fetchPredictOperation` with `{ operationName }`, every 10 s, for at most 300 s. When `done: true`, either `error` is set (failure) or `response.videos[0].bytesBase64Encoded` holds the video.
- **Bearer credentials** (Service Account JSON, authorized_user ADC, or a preset access token): `{base}` is `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}`, with `Authorization: Bearer <token>`.
- **Express API key:** `{base}` is `https://aiplatform.googleapis.com/v1`, with `?key=<key>` and no Authorization header. This is the source's best-effort path, ported as is.

Public contract:

- **Accepted fields:**
  - `prompt` (required)
  - `aspect_ratio`, `aspectRatio`, or `size`: `16:9` or `9:16` only
  - `duration` or `durationSeconds`, an integer: Veo 3.1 and 3.1 Fast accept 4, 6, or 8
  - `negative_prompt`
  - `n`, `sampleCount`, or `sample_count`: 1 only
- **Response:** `{ created, data: [{ b64_json, format: "mp4" }] }`. The only response format is `b64_json`. The core refuses `url` before anything is sent.
- **Accounting:** `nativeUnits.videos = 1`, with unknown cost. Neither requested duration nor prompt length is billed.

## Fork deviations from the source

- **Credential scope** matches the chat executor:
  - The project comes from the Service Account `project_id`, the ADC `quota_project_id`, or `providerSpecificData.projectId`.
  - The location comes from `providerSpecificData.location` (the source read `region`), us-central1 by default.
  - A non-regional location (`global`, `us`, `eu`, or anything that does not match a regional id) is refused, never rerouted.
  - A JSON credential of an unknown shape is refused, never sent as a raw key.
- **Input checks before submit:** the source dropped non-numeric durations and forwarded any aspect-ratio or `size` string. Both are now validated per model. Media inputs (`image`, `input_reference`, `video`, `audio`, `media`, and similar) are refused, because the source handler never forwards them. `n > 1` and `stream` are refused too.
- **Deadlines and cancellation:**
  - The token mint is limited to 15 s, the submit to 30 s, each poll request to 60 s, and the whole job to 300 s.
  - Every wait, request, and body read aborts on the caller's signal.
  - Redirects are refused (`manual` on submit, `error` on poll). A submit answered from another origin is discarded.
- **Body limits:** a submit error body is read up to 16 KiB and the accept body up to 64 KiB. Poll bodies are capped at 64 MiB, which covers an inline MP4.
- **Errors never carry upstream text:** only the HTTP status, the Google `error.status`, and the first `ErrorInfo.reason` (each checked for a safe shape), or the operation's rpc code. Every error redacts the connection's key, its access token, and the minted token.
- **Submit outcomes:**
  - 4xx is refused with no `acceptedJob`.
  - `BILLING_DISABLED` returns 402 with `quotaExhausted` on this connection.
  - 429 carries Retry-After evidence.
  - 5xx, a timeout, a connection reset after send, or an abort during the request are each an unknown submit (`acceptedJob`, `submit-unknown`). These are never resent.
- **Operation checks:** the operation name must name this model, plus this location for Bearer scopes. A poll answer about another operation is treated as an unknown outcome.
- **Poll errors:** 429 and 503 are retried up to 5 times with backoff. Any other poll error, a timeout, or the job deadline means the job's outcome is unknown (`acceptedJob`, `accepted`).
- **Results:**
  - An operation `error` is an ordinary failure: 400 for rpc 3, 403 for rpc 7, 429 for rpc 8, 502 otherwise.
  - Each of these is a completed but unusable job, reported with `acceptedJob`: no video, safety-filtered output, a `gcsUri`-only result (no `storageUri` is ever sent), a non-MP4 `mimeType`, or bytes that are not base64 with an ISO BMFF `ftyp` box.
- **No cancellation upstream:** an operation abandoned by abort or deadline may still run and bill, and `acceptedJob` records it. The source has no cancel call either.

## Dynamic discovery

The source has no Vertex video model discovery; its model list is static. None is ported. Of the five source ids, only the two active Veo 3.1 ids are kept (see Retired models).

## Retired models

Primary source: the retired-models table at https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions, checked 2026-11-27. It lists `veo-3.0-generate-001`, `veo-3.0-fast-generate-001`, and `veo-2.0-generate-001` as retired on 2026-06-30. `veo-3.1-generate-001` and `veo-3.1-fast-generate-001` retire on 2027-05-04 or later.

The source registry at `c71f0065` still lists all five. Before this fix the provider catalog (`open-sse/providers/registry/vertex.js`) advertised only the two Veo 3.1 ids, but the private config still accepted all five, so an explicit retired id on `POST /v1/video/generations` minted a token and submitted a billable job.

Now:

- `config.js` and `registration.json` list only the two Veo 3.1 ids. The Veo 2 duration list (5 to 8 s) is gone; the Veo 3.1 limits (4, 6, or 8 s; 16:9 or 9:16) are unchanged.
- `registration.json` records the retired ids, date, and source under `retiredModels`.
- A retired id is refused locally with 400 (`Unsupported Vertex video model`) by `buildVertexVideoRequest`, before any token mint or request, on every credential mode. It is never aliased or silently replaced with a current model.
- Provider id, `vx` alias, source alias, and auth handling are unchanged. The registration state is unchanged.

Tests: `tests/unit/vertex-retired-video-models.test.js` runs every retired id through the public route (`vx/` and `vertex/` prefixes), the core, the registered adapter, and the private factory, with a Service Account JSON (injected counting minter), a preset access token, and an Express key. Each credential completes a job for the active models in the same file, so the zero-network refusal is not caused by bad auth. A successful job is queued for each retired-id request, so a dispatch would succeed. With `config.js` and `registration.json` reverted to their previous state, 39 of the file's tests fail, and the public route returns 200 for every retired id (`expected 200 to be 400`). `tests/unit/native-vertex-video.test.js` replaces its retired-id positive coverage with refusal tests, keeps the per-model duration checks for the active models, and runs the two-account isolation test with `veo-3.1-fast-generate-001` instead of Veo 2.

## Remaining restrictions

- Text-to-video only. There is no image-to-video, reference images, last frame, or video extension.
- One video per request.
- No `storageUri` or GCS output, and no `url` response format.
- No `generateAudio`, `resolution`, `seed`, `personGeneration`, or `enhancePrompt` parameters. The source does not send them.
- Express-key video is ported from the source's best-effort contract and has not been verified against the live service.
- Per-model durations and aspect ratios come from Google's Veo model documentation, not from the source. They are the first thing to revisit if Vertex widens them.
- `vertex-partner` is not covered.
- No retired managed DeepSeek model is involved or revived.

## Registration (serial, later)

See `registration.json`:

1. Add `vertex: vertexVideoAdapter` to `VIDEO_GENERATION_ADAPTERS`. `lookupMediaAdapter` does not resolve aliases, so either confirm the route canonicalizes `vx` first, or register `vx` too.
2. Add `"video"` and the two active Veo 3.1 models to `open-sse/providers/registry/vertex.js`.
3. Add a catalog row for Vertex video.
4. In the test file, replace the staging block with positive registry assertions.

## Evidence

Retired-model fix (2026-11-27): `cd tests && node node_modules/vitest/vitest.mjs run unit/vertex-retired-video-models.test.js unit/native-vertex-video.test.js unit/register-native-01.test.js --maxWorkers=2` reports 3 files and 206 tests passed. These are closed mocks only.

Original staging:

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-vertex-video.test.js --maxWorkers=2` reports 67 passed. `npx eslint` over the new files is clean. These are closed mocks only: no live account, provider call, or browser was used, and passing says nothing about the live service.
