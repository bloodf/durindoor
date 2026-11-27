# UC native image and video (staged), 2026-11-27

Issue: #2034. The inventory rows for `uc` video (registry -> `videoGeneration/providers/ucVideo.ts`) and image (`IMAGE_ADAPTERS`, format `uc-image`) were MISSING. Decision 15 accepted this delta.

Outcome: the metered REST surface is staged as private, unregistered image and video adapters for the existing `uc-direct` provider (alias `ucd`). The persona surface is not ported. It is the `uc` consumer-app path that #1241 retired.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `uc`:
  - `baseUrl` `https://internal.chatuncensored.ai/image_to_video`
  - `statusUrl` `https://api.uncensored.com/api/v1/videos/generations`
  - `authType` `apikey`, `authHeader` `bearer`, `format` `uc-video`
  - Models: `wan-2.2-spicy`, the persona default, plus 13 ids marked "uc-direct REST metered catalog".
- `open-sse/config/imageRegistryData.ts`, entry `uc`:
  - `baseUrl` `https://internal.chatuncensored.ai/v2/image-gen`
  - `authType` `apikey`, `authHeader` `bearer`, `format` `uc-image`
  - 22 model ids, with aspect-bucket `supportedSizes`.
- `open-sse/handlers/imageGeneration/providers/ucImage.ts` and `open-sse/handlers/videoGeneration/providers/ucVideo.ts`. Each handler serves two surfaces and picks one by credential:
  - **(A) Persona.** Used for any credential that is not a `uai_` key. Reads `clientCookie`, `sid`, `uid` and the cookie jar from `providerSpecificData`, then mints a Clerk `__session` JWT at `https://clerk.uncensored.com/v1/client/sessions/{sid}/tokens`. It sends `Authorization: Bearer <jwt>` with `Origin`/`Referer` `https://uncensored.com` to `internal.chatuncensored.ai` (`/v2/image-gen`, `/text_to_video`, `/image_to_video`) and `internal-6.pubyar.com/generate-signed-url`. It then polls a CDN URL until it returns 200. The source notes that `/text_to_video` was never captured.
  - **(B) uc-direct REST.** Used when a `uai_` key is present. Sends `X-api-key: <key>` to `https://api.uncensored.com/api/v1/images/generations` or `/videos/generations`.
- `open-sse/config/providers/registry/uc-direct/index.ts` sets `X-api-key` (not Bearer) and defines the error contract: 402 means out of funds, 403 means moderation or scope, and 429 means rate limited.
- `open-sse/executors/uc/constants.ts`: `UC_TTS_WS_HOST = wss://tts-stream.chatuncensored.ai`.
- `tests/unit/uc-image.test.ts` and `tests/unit/uc-video.test.ts` cover the direct-path wire, including `X-api-key` with that exact casing.

The `authHeader: "bearer"` in both registry entries describes the persona JWT. The REST path ignores it and uses `X-api-key`.

## Fresh-main check

`origin/main` at `f14f877ec1`:

- `git grep -i 'chatuncensored\|uncensored\.com/api/v1/\(images\|videos\)\|"uc-image"\|"uc-video"' origin/main -- open-sse src` finds nothing.
- `git grep '"uc-direct"\|ucd' origin/main -- open-sse/handlers` finds nothing, so neither ID has an image or video adapter.
- `open-sse/providers/registry/uc-direct.js` is the same vendor, origin and key as surface (B):
  - id `uc-direct`, alias `ucd`
  - `https://api.uncensored.com/api/v1/chat/completions`
  - `x-api-key`, raw scheme
  - `modelsFetcher` on `/api/v1/models`
  - `serviceKinds: ["llm"]` only
- There is no `uc` provider. `internal/docs/provider-parity-current-dispositions.md` and `provider-parity-omni-vendor-gaps.md` record `uc` as retired. #1241 was closed as not planned because it is consumer-app scraping, and #1242 names `uc-direct` as the documented replacement.

So the remaining delta is image and video on `uc-direct`. No exact equivalent exists:

- The generic OpenAI image adapter sends Bearer and defaults options.
- `/v1/videos` has no `uc-direct` `videoConfig`.

## Not ported (evidence)

- **Persona surface (A)**, image and video. It needs consumer-app cookies and a Clerk session that the fork has no connection mode for. #1241 retired it. Its endpoints are kept only as data in `UC_PERSONA_ENDPOINTS` and are never called. `wan-2.2-spicy`, the persona-only model, is not staged.
- **UC TTS** is a persona WebSocket at `wss://tts-stream.chatuncensored.ai`. It is a separate inventory row and was not replaced with a REST shape.
- No `uc` alias is added: that ID is the retired provider.

## Staged files

`open-sse/services/providerParity/native-uc-video-image/`:

- `config.js`: IDs, the fixed origin, endpoints, 22 image and 13 video models (`input` is `text`, `image` or `any`), bounds, and `UC_PROVIDER_MEDIA_ADDITIONS`.
- `http.js`: bounded fetch, manual redirect refusal, foreign-origin detection, bounded JSON reads, refused-answer mapping and accepted-job accounting.
- `image.js`: guarded `generate` adapter. `responseFormats` is `[url, b64_json]`.
- `video.js`: `VIDEO_GENERATION_ADAPTERS` adapter (`async: true`). `responseFormats` is `[url]`.
- `index.js`: exports and default instances.
- `registration.json`: exports, canonical ID and alias, models, endpoints, auth, and integration points.

Nothing in production imports the module.

## Supported subset

**Auth.** The selected connection's `apiKey` must start with `uai_`, as in the source's discriminator. It is sent only as `X-api-key` and only to `https://api.uncensored.com`. `accessToken`, cookies and `providerSpecificData` are never used for auth. The connection proxy options pass through `resolveCredentialProxyOptions`. Connection base URLs are ignored.

**Image.** `POST /api/v1/images/generations` with:

- Headers `{ X-api-key, Content-Type: application/json }`.
- Body `{ model, prompt, n, size? }`. `model` comes from the 22 source IDs after removing a `uc-direct/`, `ucd/` or `uc/` prefix. `n` is an integer from 1 to 4. `size` must be `WxH`.
- `response_format` is not forwarded, because the source never sent it. When a caller asks for one, only items of that form are returned.

**Video.** `POST /api/v1/videos/generations` with:

- Headers `{ X-api-key, Content-Type }`.
- Body `{ model, prompt, size?, aspect_ratio?, resolution?, duration?, image? }`. `image` is the first of `image`, `image_url`, `input_image` or `media`.
- The result URL is read from the source's shapes: `data[0].url`, `url`, `video_url`, `video.url`, or a string `output`.
- If the submit answer is not final, the adapter polls `status_url` with `GET` and `X-api-key` only. The first poll is immediate, then every 3 s, inside a 300 s job deadline.
- 429 and 503 on a poll are retried up to 5 times with backoff and `Retry-After`.
- The result is `{ url, format: "mp4", request_id? }` and is never downloaded.

**Accounting.**

- Image usage counts the images returned.
- Video usage counts one video, plus `videoSeconds` only when UC reports them.
- Cost is always `unknown`.

## Restrictions and deviations from the source

- **Input checks.** All of these are refused before anything billable is sent:
  - an unknown model
  - an `i2v-*` model without an image, or a `t2v-*` model with one
  - bare base64 images, `http:` or private image URLs, and disagreeing image fields
  - malformed `size`, `aspect_ratio`, `resolution` or `duration`
  - persona knobs (`num_frames`, `seconds`, `timeout_ms`, `poll_interval_ms`, `aspect_ratio` on image)
  - streaming, `n > 1` for video, video `response_format` other than `url`, and unknown fields

  The source clamped `n` and passed most of these through.
- **`status_url`.** It is followed only when it is https on `api.uncensored.com` under `/api/v1/videos/`. Any other `status_url` is never contacted, and the job becomes an accepted job with unknown outcome. The source followed any URL with the key.
- **Callback-only jobs.** A job ID with no `status_url` is an accepted job with an unknown outcome that carries `jobId`. The source returned it as a success without a video.
- **Unknown outcomes.** All of these keep `acceptedJob` and are never resent:
  - a send cut off after connecting, a timeout, or an abort in flight
  - a 5xx submit answer, or a redirect answered by another origin
  - an unreadable 2xx answer
  - a finished job without a public https URL, or an answer about another job
  - a lost poll, or the job deadline
- **Failures that are not accepted jobs.**
  - A job UC reports as failed, and a refused 4xx, are ordinary failures.
  - A 402, or a 400/403/429 whose code mentions quota or funds, sets `quotaExhausted` for this connection only.
  - 429 keeps a bounded `Retry-After`.
- **Error text.** Messages never quote the upstream body. Only a vendor code of a safe shape survives, and the selected connection's secrets are redacted.
- **Redirects.** They are refused (`redirect: "manual"`) and never followed with the key.
- **Model discovery.** There is no dynamic media model discovery. The source has only static lists. The existing `uc-direct` `modelsFetcher` stays the LLM catalog.
- **Bare-ID collisions.** Several image IDs collide with other providers' bare IDs, for example `nano-banana`, `z-image-turbo` and `gpt-image`. Registration should scope them to `uc-direct`, matching the source's choice to keep `uc` last.

## Registration (serial step)

See `registration.json` `integrationPoints`:

1. In `open-sse/providers/registry/uc-direct.js`, add the `image` and `video` service kinds, the model kinds and `imageConfig`. Keep the LLM transport and auth unchanged.
2. Add `"uc-direct"` and `ucd` to `IMAGE_ADAPTERS` and to `VIDEO_GENERATION_ADAPTERS`.
3. Update `docs/providers/catalog.mdx`.

Registration then replaces the isolated `staging state (isolated)` block in the test with positive identity assertions.

## Evidence

```
cd tests && node node_modules/vitest/vitest.mjs run unit/native-uc-video-image.test.js --maxWorkers=2
 Test Files  1 passed (1)
      Tests  65 passed (65)
npx eslint open-sse/services/providerParity/native-uc-video-image tests/unit/native-uc-video-image.test.js  (clean)
```

The tests use closed mocks only, with synthetic `uai_` keys and no live calls. Passing them says nothing about the live service.
