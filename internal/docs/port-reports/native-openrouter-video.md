# OpenRouter native video (staged), 2026-11-27

Issue: #2034. The inventory row for `openrouter` video (registry -> video job dispatcher; Bearer key, `POST /videos`, polling and content) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `openrouter`: `id: "openrouter"`, `baseUrl: "https://openrouter.ai/api/v1"`, `authType: "apikey"`, `authHeader: "bearer"`, `format: "openrouter-video-job"`, and 14 static model slugs (Veo 3.1 / Fast / Lite, Sora 2 Pro, Kling 3.0 Pro / Standard, Seedance 2.5 / 2.0, Hailuo 3 Max / 3, Wan 3.0 / Prime, Grok Imagine Video 1.5, Runway Gen-4.5). The source comment says `/videos/generations` is a 404 and `/videos` answers 202 with a job id.
- `open-sse/handlers/videoGeneration.ts`: a registry provider whose `format` names a job preset goes to `handleVideoJobGeneration`. The caller's `max_polls` and `poll_interval_ms` become polling overrides.
- `open-sse/handlers/videoGeneration/job.ts`, preset `openrouter-video-job`:
  1. `POST {base}/videos` with `{ model, prompt, duration?, ...extras }`. `duration` is a plain number. Headers are `Content-Type: application/json` and `Authorization: Bearer <key>`.
  2. The job id is `id`. `GET {base}/videos/{id}` with the same headers, every 2 s, at most 180 polls. The poll window may not exceed the larger of the preset window and 600 s.
  3. `completed` is done. `failed`, `cancelled`, and `expired` (plus the generic `error` and `canceled`) are failures. 429 and 503 status answers are retried with backoff, at most 5 times in a row.
  4. The result is `unsigned_urls`. Because the content route needs the key, the source downloads it with the key, but only when it is on the provider origin. It stores the bytes in its media store and returns `{ url, format: "mp4" }` on its own origin.
- `open-sse/handlers/videoGeneration/pollRetry.ts` and `open-sse/utils/pollBounds.ts`: retry and window bounds.
- `tests/unit/services/openrouter-video-job.test.ts`: the submit answer is 202 `{ id, polling_url, status: "pending" }`. The finished job carries `unsigned_urls: ["https://openrouter.ai/api/v1/videos/{id}/content?index=0"]`. The test also passes `aspect_ratio` through as an extra.

The source has no dynamic discovery for video. The model list is static.

## Fresh-main check

`origin/main` at `f14f877ec1` and this branch have no OpenRouter video path:

- `git grep -i 'openrouter\.ai/api/v1/videos\|unsigned_urls\|openrouter-video' origin/main -- open-sse src` finds nothing.
- `open-sse/providers/registry/openrouter.js` exists with alias `openrouter`, an API key, and Bearer auth. Its `serviceKinds` are `llm`, `embedding`, `tts`, `imageToText`, `rerank`, and `systemone`. It has no video model rows and no `videoConfig`.
- `getVideoGenerationAdapter("openrouter")` returns null. `VIDEO_GENERATION_ADAPTERS` has `alibaba`, `ali`, `renderhour`, `adobe-firefly-api`, and `adobe-firefly-web`.
- The `/v1/videos` proxy (`videoCore.js`) reads `PROVIDER_MEDIA[provider].videoConfig`, and OpenRouter has none. That proxy also hands job ids to the client, has no accepted-job ledger, and cannot do a key-gated content download, so it would not be equivalent even with a config.
- The registry's `imageConfig`, `ttsConfig`, and `embeddingConfig` point at other OpenRouter routes. None of them reaches `/videos`.

The provider exists; only the video kind is missing. Nothing in the provider definition needs to be staged beyond the video model rows and the `video` service kind, which are described in `registration.json`.

## What landed

All new files are under `open-sse/services/providerParity/native-openrouter-video/`:

| File | Role |
| --- | --- |
| `config.js` | The pinned registry fields, the fixed origin and endpoints, the 14 models, and the bounds. |
| `http.js` | Bounded abortable fetch, redirect refusal, bounded JSON and byte reads, mapping of refused answers without quoting the upstream body, the same-origin content URL check, and accepted-job accounting. Adapted from the staged deAPI video transport. |
| `video.js` | `buildOpenrouterVideoRequest`, `resolveOpenrouterTiming`, `runOpenrouterVideoJob`, and `createOpenrouterVideoAdapter`, which follows the `VIDEO_GENERATION_ADAPTERS` contract. |
| `index.js` | Re-exports and the default `openrouterVideoAdapter` instance. |
| `registration.json` | Exports, canonical ID and alias, models, endpoints, auth, the fresh-main evidence, and the registration steps. |

Tests are in `tests/unit/native-openrouter-video.test.js`: 36 tests over a closed network.

Nothing is registered. `videoProviders/index.js`, the provider registry, and the docs catalog are unchanged. Only the isolated `staging state` test block asserts that OpenRouter has no video kind, rows, config, or adapter.

## Supported subset

1. `POST https://openrouter.ai/api/v1/videos` with `Content-Type: application/json` and `Authorization: Bearer <key>`. The body is `{ model, prompt, duration?, aspect_ratio? }`.
2. `GET https://openrouter.ai/api/v1/videos/{id}` with the same two headers.
3. On `completed`, `GET` the first `unsigned_urls` entry with the same two headers.

- `model` must be one of the 14 source slugs. Requests address them as `openrouter/<vendor>/<model>`; the prefix is split on the first slash.
- `duration`, or `seconds` as an alias, must be a whole number from 1 to 60. If both are given they must agree. It is sent as `duration`, a number.
- `aspect_ratio` must look like `16:9`.
- `poll_interval_ms` is clamped to 1 s through 120 s. `max_polls` is clamped so the window stays within 600 s. Neither is forwarded.
- The content URL must be `https://openrouter.ai/api/v1/videos/{this job id}/content`, with no userinfo, no fragment, and at most one numeric `index` query. Any other URL is never fetched.
- The content must be an mp4: its `content-type`, when present, must be `video/*` or `application/octet-stream`, and the bytes must start with an ISO-BMFF `ftyp` box. At most 64 MiB is read.
- The result is `{ created, data: [{ b64_json, format: "mp4", mime_type: "video/mp4" }] }`.
- Usage records `nativeUnits.videos = 1` and the job id. The requested duration is never billed. Cost stays unknown; the source read no cost either.
- The key is `apiKey`, or `accessToken` if there is no `apiKey`. A key containing CR or LF is refused. Each call uses the key of the connection it was given. Proxy options come from that connection. Nothing is cached or shared between calls.

## Deviations from the source, and remaining restrictions

- **No media store.** The source re-served the clip from its media store as a gateway URL. The fork has no such store for adapters, so the bounded mp4 is returned as `b64_json`, as the staged deAPI and Vertex video adapters do. `response_format` is `b64_json` only; `url` is refused before submit. A clip larger than 64 MiB cannot be returned.
- **Fixed origin.** The source used a connection base URL when one was set. The key goes only to `https://openrouter.ai`.
- **No extra headers.** The registry's chat `HTTP-Referer` and `X-Title` headers are not sent, because the source preset did not send them on video.
- **Redirects are refused.** Every request uses `redirect: "manual"`. A 3xx submit is refused without following it, and no job is claimed. An answer from another origin is treated as possibly accepted. A redirect on a status or content request is an unknown outcome.
- **Fields are refused, not passed through.** The source spread every extra field into the body. The fork forwards only `aspect_ratio`, the one extra the source test exercises. `size`, `resolution`, input images or references, and any other field are refused with a 400 before submit. `n` above 1 and streaming are refused.
- **Validated catalog.** Raw slugs outside the 14 are refused. The registry's `passthroughModels` and its `/models` discovery serve chat and do not feed video.
- **Unknown outcomes carry `acceptedJob`.** A 5xx or interrupted submit, a submit answer without a safe job id, a status answer about another job or without a status, a status redirect, an exhausted deadline or poll budget, and a completed job whose content URL or content is missing, unsafe, unreadable, oversized, or not an mp4 all return an error with `acceptedJob` (cost unknown). The `jobState` is `submit-unknown`, `accepted`, or `completed-unread`. Nothing is resent. A job reported `failed`, `cancelled`, or `expired` is an ordinary failure without `acceptedJob`. A pre-connect failure (`ECONNREFUSED`, DNS) proves nothing was sent and claims no job.
- **Errors never quote the upstream body.** Only the status and a safe vendor code are kept. 402, or 400/403/429 with a quota-like code, sets `quotaExhausted` for this connection. 401 and 403 keep their status. 429 keeps a bounded `Retry-After`.
- **Bounds.** Submit 30 s, each status request 30 s, content download 120 s, and the whole job 600 s. The caller's abort signal stops the submit, the wait between polls, every request, and the body reads.

## Registration (serial step)

See `registration.json`. In short:

1. `open-sse/handlers/videoProviders/index.js`: add `openrouter: openrouterVideoAdapter` to `VIDEO_GENERATION_ADAPTERS`.
2. `open-sse/providers/registry/openrouter.js`: append `"video"` to `serviceKinds` and the 14 video rows (`kind: "video"`). Keep everything else, and add no `videoConfig`.
3. `docs/providers/catalog.mdx`: list the video kind.
4. Promote the test's `staging state (isolated)` block to positive identity checks.

## Evidence

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/native-openrouter-video.test.js --maxWorkers=2
# Tests 36 passed (36)
npx eslint open-sse/services/providerParity/native-openrouter-video tests/unit/native-openrouter-video.test.js
# no findings
```

No live account, provider call, browser, or paid API was used. The closed mocks say nothing about the live service.
