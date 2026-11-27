# deAPI native image and video (staged), 2026-11-27

Issue: #2034. The inventory rows for `deapi` video (registry -> video job dispatcher) and image (`IMAGE_ADAPTERS`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `deapi`:
  - baseUrl `https://oai.deapi.ai/v1/images/generations`, authType `apikey`, authHeader `bearer`, format `openai`.
  - Models `ZImageTurbo_INT8`, `Flux_2_Klein_4B_BF16`, `Flux1schnell`, and `ZAnimeDistill_8Step_INT8`.
  - Provider `supportedSizes` `512x512`/`768x768`/`1024x1024`/`1024x1536`/`1536x1024`. The two Z-Image models take only the three square sizes.
- `open-sse/handlers/imageGeneration.ts`, `handleOpenAIImageGeneration` for format `openai`:
  - The body is `{ model, prompt }`, plus `n`, `size`, `quality`, `response_format`, and `style` when the caller gives them.
  - Headers are `Content-Type: application/json` and `Authorization: Bearer <key>`.
  - `handlers/imageGeneration/openAiImageFetch.ts` turns a 2xx without a `data[]` item that has a `url` or `b64_json` into a 502.
- `open-sse/config/videoRegistry.ts`, entry `deapi`:
  - baseUrl `https://oai.deapi.ai/v1/videos`, authType `apikey`, authHeader `bearer`, format `deapi-video-job`.
  - Models `Ltx2_5_22B_Dist_INT8`, `MiniMaxH3_33B_Turbo_INT8`, `Ltx2_3_22B_Dist_INT8`, and `Ltxv_13B_0_9_8_Distilled_FP8`.
- `open-sse/handlers/videoGeneration/job.ts`, preset `deapi-video-job`:
  1. `POST /v1/videos` with `{ model, prompt, seconds: String(duration), ...extras }`. The job id is `id`.
  2. `GET /v1/videos/{id}` until `completed` or `failed`, every 5 s, at most 120 polls. The finished object has no URL.
  3. `GET /v1/videos/{id}/content` with the key. The source stores the bytes in its media store and answers `{ url, format: "mp4" }` on its own origin.
- `src/shared/constants/providers/apikey/specialty-media.ts`, entry `deapi`: alias `deapi`, name `deAPI`, website `https://deapi.ai`. The API key has the shape `sk-dp-<id>-<secret>` and is sent as `Authorization: Bearer`.
- `tests/unit/deapi-provider.test.ts`: the source's wire assertions. The fork tests repeat the video flow, header, and body checks.

## Fresh-main check

`origin/main` at `f14f877ec1` has no `deapi` provider in any form:

- `git grep -n -i 'deapi\.ai\|"deapi"' origin/main -- open-sse src` finds nothing.
- `rg -i deapi` in the checkout matches only port reports and unrelated `modeApiProvider` strings.
- There is no `open-sse/providers/registry/deapi.js`, no `deapi` alias, and no `imageConfig` or `videoConfig` pointing at `oai.deapi.ai`.
- `getImageAdapter("deapi")` and `getVideoGenerationAdapter("deapi")` return null.

Nothing nearby is an equivalent:

- `deepai` (`imageProviders/deepai.js`) is a different vendor. It calls `api.deepai.org` with a multipart body and an `api-key` header.
- The generic OpenAI image adapter (`imageProviders/openai.js`) reads the `imageConfig.baseUrl` of a registered provider. No `deapi` entry exists. It would also default to `n: 1` and `size: "1024x1024"` and forward OpenAI output options that deAPI does not take.
- A custom OpenAI-compatible node sends the key to whatever base URL the user set, and it has no deAPI video job.
- The `/v1/videos` proxy (`videoCore.js`) has no `deapi` config. It hands job ids to the client, has no accepted-job ledger, and cannot do the key-gated content download.

TTS, STT, and embeddings for `deapi` are separate inventory rows and are not staged here.

## What landed

All new files are under `open-sse/services/providerParity/native-deapi-video-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and endpoints, model lists, sizes, bounds, and the staged `DEAPI_PROVIDER_DEFINITION`. |
| `http.js` | Bounded abortable fetch, redirect refusal, bounded JSON and byte reads, mapping of refused answers without quoting the upstream body, the public https URL check, and accepted-job accounting. |
| `image.js` | `buildDeapiImageRequest` and `createDeapiImageAdapter`, a guarded `generate` adapter. |
| `video.js` | `buildDeapiVideoRequest`, `runDeapiVideoJob`, and `createDeapiVideoAdapter`, which follows the `VIDEO_GENERATION_ADAPTERS` contract. |
| `index.js` | Re-exports, plus the default `deapiImageAdapter` and `deapiVideoAdapter` instances. |
| `registration.json` | Exports, canonical ID, models, endpoints, auth, non-equivalents, and the registration steps. |

Tests are in `tests/unit/native-deapi-video-image.test.js`: 46 tests over a closed network.

Nothing is registered. `imageProviders/index.js`, `videoProviders/index.js`, the provider registry, and the docs catalog are unchanged. Only the isolated `staging state` test block asserts that `deapi` is absent.

## Supported subset

### Image

`POST https://oai.deapi.ai/v1/images/generations` with `Content-Type: application/json` and `Authorization: Bearer <key>`.

- The body is `{ model, prompt }`, plus `n` (1 only), `size`, `quality`, `response_format`, and `style` when given. This is the source's order and set.
- `model` must be one of the four catalog ids.
- `size` must be one of that model's sizes.
- `quality` and `style` must be short lowercase option names. deAPI maps `quality` to a per-model step preset.
- `response_format` may be `url` or `b64_json`.
- The answer is normalized to `{ created, data: [{ url } | { b64_json }, revised_prompt?] }`:
  - A `url` must be public https without userinfo.
  - A `b64_json` must use the base64 charset and be at most `MAX_IMAGE_BYTES`.
  - When a format was requested, items of the other form are dropped.
- Usage counts the returned images. Cost stays unknown.

### Video

1. `POST https://oai.deapi.ai/v1/videos` with the same headers. The body is `{ model, prompt, seconds?, size? }`, with `seconds` as a string.
2. `GET https://oai.deapi.ai/v1/videos/{id}` with `Authorization: Bearer <key>` only.
3. On `completed`, `GET https://oai.deapi.ai/v1/videos/{id}/content` with `Authorization: Bearer <key>` only.

- `model` must be one of the four catalog ids.
- `seconds` or `duration` must be a whole number from 1 to 600. If both are given they must agree. `duration` is sent as `seconds`, never as `duration`.
- `size` must be `WxH`. deAPI checks it per model.
- The terminal states are the source's: `completed`/`succeeded`/`success`/`done`, and `failed`/`error`/`cancelled`/`canceled`. `expired` is also treated as failed. Any other status keeps polling.
- The content must be an mp4: its `content-type`, when present, must be `video/*` or `application/octet-stream`, and the bytes must start with an ISO-BMFF `ftyp` box. At most 64 MiB is read.
- The result is `{ created, data: [{ b64_json, format: "mp4", mime_type: "video/mp4" }] }`.
- Usage records `nativeUnits.videos = 1`. `videoSeconds` is recorded only when the completed job reports `seconds`. The requested length is never billed. Cost stays unknown.

### Both kinds

- The key is sent only to `https://oai.deapi.ai`. A connection base URL is ignored.
- Proxy options come from the selected connection.
- `apiKey` is used, or `accessToken` if there is no `apiKey`. A key containing CR or LF is refused.
- Every call uses the key of the connection it was given. Nothing is cached or shared between calls.

## Deviations from the source, and remaining restrictions

- **No media store.** The source re-served the clip from its own media store as a URL. The fork has no such store for adapters, so the bounded mp4 is returned as `b64_json`, as the fork's staged Vertex video adapter does. Video `response_format` is `b64_json` only; `url` is refused before submit.
- **Fixed origin.** The source used a connection base URL when one was set. The fork never sends the key anywhere but `oai.deapi.ai`.
- **Redirects are refused.** Every request uses `redirect: "manual"`. A 3xx submit is refused without following it, and no job is claimed. An answer from another origin is treated as possibly accepted. A redirect on `/content` is an unread completed job. If deAPI ever serves content through a redirect to storage, the adapter will need a keyless single-hop rule; it does not do that today.
- **Fields are refused, not passed through.** The source spread every extra video field into the body. The fork takes only `model`, `prompt`, `size`, `seconds`, `duration`, `n` (1 only), `response_format`, and `user`. Image fields outside the forwarded set, such as input images, masks, `background`, and `output_compression`, are refused. `output_format` may only be `png`, because deAPI output is always PNG, and it is not forwarded. Streaming is refused.
- **Validated catalog.** Raw model ids are refused. The source left the model and size checks to the gateway. Image `n` above 1 is refused.
- **Bounds.**
  - Image call: 120 s for headers and body.
  - Video submit: 30 s.
  - Each status request: 30 s.
  - Content download: 120 s.
  - Whole video job: 600 s, the source's 5 s × 120 window.
  - At most 120 completed polls.
  - A 429 or 503 status answer is retried up to 5 times, with Retry-After honored and capped at 30 s.
- **Abort.** An abort before send sends nothing and claims nothing. An abort during a request or the poll wait tears down that request and returns 499. Once the submit may have reached deAPI, the result carries `acceptedJob`.
- **No replay.** A submit is never resent. These cases carry `acceptedJob` with unknown cost:
  - `submit-unknown`: a transport failure after connect, a submit timeout, a 5xx submit answer, or an answer from another origin
  - `accepted`: an unreadable submit answer, a missing or unsafe job id, a poll error, timeout, or redirect, a status answer about another job or with no status, or the job deadline
  - `completed-unread`: a completed job whose content fails, is redirected, times out, is too large, is not an mp4, or is aborted; or an unreadable 2xx image answer
  - `completed-unusable`: a 2xx image answer without a usable item
- **A failed job is an ordinary failure.** A job deAPI reports as `failed` returns 502 without `acceptedJob` and is not downloaded. The source did the same.
- **Errors.**
  - A 402 is quota for that connection only (`quotaExhausted`). So is a 400, 403, or 429 whose vendor code mentions quota, balance, credit, billing, or payment.
  - 401 and 403 are key refusals.
  - A 429 keeps a usable Retry-After.
  - The upstream body is never quoted; only a vendor code of a safe shape (`error.code`, `code`, or `error.type`) is kept. Error results pass the connection's secrets to `createErrorResult` for redaction.
- **Discovery.** The source has no dynamic model discovery for `deapi`; the lists are static. None is added.

## Registration (serial step, not done here)

See `registration.json`:

1. Add `open-sse/providers/registry/deapi.js` from `DEAPI_PROVIDER_DEFINITION`: id and alias `deapi`, API-key connection, `serviceKinds: ["image", "video"]`, and `imageConfig`. Add no `videoConfig`, so `/v1/videos` stays unavailable for `deapi`.
2. Add a `deapi` key for the image adapter in `open-sse/handlers/imageProviders/index.js` and for the video adapter in `open-sse/handlers/videoProviders/index.js`.
3. List the kinds in `docs/providers/catalog.mdx`.
4. Replace the isolated staging block in the test with positive identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-deapi-video-image.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 46 passed (46)
npx eslint open-sse/services/providerParity/native-deapi-video-image tests/unit/native-deapi-video-image.test.js
# exit 0
pnpm run lint:anti-slop
# anti-slop gate OK (0 diagnostics)
```

Closed mocks only. Passing says nothing about the live service.
