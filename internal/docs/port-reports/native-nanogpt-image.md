# NanoGPT native image (staged), 2026-11-27

Issue: #2034. The inventory row for `nanogpt` image (`IMAGE_ADAPTERS`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `nanogpt`: baseUrl `https://nano-gpt.com/api/v1/images/generations`, authType `apikey`, authHeader `bearer`, format `openai`. Models are `qwen-image` ("Qwen Image", `inputModalities: ["text", "image"]`), `z-image-turbo`, `chroma` and `hidream` ("Hidream I1 Full"). `supportedSizes` is `["1024x1024", "1024x1280", "1280x1024"]`. There is no `fallbackUrl`.
- `open-sse/handlers/imageGeneration.ts`, `handleOpenAIImageGeneration`: the body is `{ model, prompt }`. The validated output options, `n`, `size`, `quality`, `response_format` and `style` are added only when the caller sets them. Headers are `Content-Type: application/json` and `Authorization: Bearer <apiKey || accessToken>`. An input image is forwarded as `image_url` only for models in `OPENAI_IMAGE_TO_IMAGE_MODELS`, and that set contains no NanoGPT ID.
- `open-sse/handlers/imageGeneration/generationOptions.ts`: providers other than `openai` get only the validated `output_format` options.
- `open-sse/handlers/imageGeneration/openAiImageFetch.ts`: the deadline also covers the body read. A 2xx answer without a usable `b64_json` or `url` item becomes a 502. Upstream `usage` stays internal.
- `open-sse/config/providers/registry/nanogpt/index.ts`: chat baseUrl `https://nano-gpt.com/api/v1/chat/completions`, `modelsUrl` `https://nano-gpt.com/api/v1/models`.
- `src/app/api/providers/[id]/models/discovery/providerSets.ts`, `helpers.ts` and `normalizers.ts`: `nanogpt` is a named OpenAI-style provider. Discovery strips `/chat/completions` and `/v1` from the chat baseUrl and sends `GET https://nano-gpt.com/api/v1/models` with `Content-Type: application/json` and Bearer auth. Items come from a bare array, `data.data` or `data.models`, and each ID is `id || model || name`.

The entry is enabled and reachable through `handleImageGeneration`. There is no disabled flag or comment.

## Fresh-main check

This worktree and `origin/main` at `fdbb72865a` were searched with `rg` and `git grep`:

- `open-sse/providers/registry/nanogpt.js` declares `serviceKinds: ["llm"]` and `authType: "apikey"`, with chat on `https://nano-gpt.com/api/v1/chat/completions` and a `modelsFetcher` for chat models. It has no `imageConfig`.
- `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) has no `nanogpt` key. No file names `nano-gpt.com/api/v1/images/generations`.
- The generic `createOpenAIAdapter("nanogpt")` would find no `imageConfig.baseUrl`. It also has no fixed-origin or redirect refusal and no handling for an uncertain submit. It is not an equivalent.

The whole delta was missing, so it was ported.

## What landed

All new files are under `open-sse/services/providerParity/native-nanogpt-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and paths, the four source models and sizes, and gateway bounds. |
| `http.js` | Bounded abortable fetch, redirect and origin checks, bounded reads, `discoverNanoGptModels`, `parseNanoGptModelList` and `isSafeNanoGptModelId`. |
| `image.js` | `buildNanoGptImageRequest`, `normalizeNanoGptImageItems`, `resolveNanoGptImageCredential`, `resolveNanoGptImageModel`, and `createNanoGptImageAdapter`, a guarded `generate` adapter. |
| `index.js` | Exports and the default `nanoGptImageAdapter`. |
| `registration.json` | Exports, IDs, models, endpoints, auth, accounting and integration points. |

Tests are in `tests/unit/native-nanogpt-image.test.js`. Nothing in production imports the module.

## Supported subset

- Canonical ID `nanogpt`. There are no extra aliases, because the source and local alias is also `nanogpt`. Service kind `image`.
- Auth uses the existing local API-key connection. The selected connection's `apiKey` is used, or its `accessToken` when there is no `apiKey`, matching the source order. The key is sent only as `Authorization: Bearer` to `https://nano-gpt.com`. A connection `baseUrl` is ignored. The proxy comes from `resolveCredentialProxyOptions(credentials)`.
- Models: the four source models are listed. Like the source, any model ID with safe syntax passes through. The ID is sent verbatim: the image core already strips the routing prefix, and NanoGPT serves real IDs that start with `nanogpt/` (for example `nanogpt/coding-router`), so stripping it again would change the model.
- Request fields:
  - `prompt` is required and limited to 32,000 characters.
  - `n` must be an integer from 1 to 10.
  - `size` must be `WxH`, with each side from 64 to 2048. The source sizes are advertised, not enforced, as in the source.
  - `quality` and `style` must each be a short word.
  - `response_format` may be `url` or `b64_json`.
  - `output_format` may be `png`, `jpeg` or `webp`.
  - `user` is accepted but not sent. `stream` may only be `false`.
- Results:
  - A URL item must be public `https` on a host allowed by `isBlockedHost`, with no userinfo. It is never fetched.
  - A `b64_json` item must be valid base64 that sniffs as PNG, JPEG or WebP. It is labelled with `mime_type`.
  - A uniform base64 container is reported as `output_format`. A mismatch with the requested container is only logged, as in the source.
  - At most 16 items are returned.
- Discovery: `discoverNanoGptModels({ apiKey })` sends a bounded `GET https://nano-gpt.com/api/v1/models` with manual redirects and returns every safe model ID. The list includes chat models; the source does not mark which models produce images, so it is not classified.

## Restrictions and deviations from the source

- Before anything is sent, these are refused with a 400:
  - input images (`image`, `image_url`, `image_urls`) and masks, for every model including `qwen-image`. The source listed `qwen-image` as accepting images but silently dropped them for every NanoGPT model, so image-to-image is not claimed.
  - `background`, animation frames, `output_compression` and `partial_images`
  - `gif` and `svg` output
  - streaming
  - any other non-null field
  - malformed `n`, `size` or model values
- 404 and 410 are reported as "does not serve this image model". There is no fallback host, as in the source.
- 5xx answers may follow work NanoGPT accepted. They return a 502 with `acceptedJob` (`submit-unknown`) and are never replayed.
- Redirects are refused (502) and never followed. An answer whose URL is on another origin is not trusted and carries `acceptedJob`.
- The submit deadline is 120 s, capped by a total deadline of 180 s that also covers the body read. Response bodies are limited to 40 MiB. Discovery has a 10 s deadline and a 4 MiB limit.
- Discovery does not retry `https://nano-gpt.com/api/models` after a failure, which the source's generic endpoint list did.
- Error messages never quote the upstream body or the key.

## Error and accounting contract

| Upstream outcome | Result |
| --- | --- |
| 401 or 403 | Passed through as an auth failure. No `acceptedJob`. |
| 402 | 402 with `quotaExhausted: true`, scoped to this connection. |
| 429 | 429 with the reset time from `Retry-After`. |
| 400 or 422 | Passed through with a generic message. |
| 404 or 410 | 404 "does not serve this image model". No retry. |
| 5xx, a timeout or disconnect after send, or a caller abort mid-flight | `acceptedJob` with `jobState` `submit-unknown`. Never resent. |
| 2xx that is unreadable or has no usable image | 502 with `acceptedJob` `accepted`. |
| Pre-connect failure, or an abort before send | No `acceptedJob`. |
| Success | `nativeUnits.images` is the number of returned items. Upstream `usage` is recorded as internal accounting tokens and is not added to the response. Cost stays unknown unless the usage carries a USD receipt. |

## Registration (serial step, not done here)

1. Add `nanogpt: nanoGptImageAdapter` to `IMAGE_ADAPTERS` in `open-sse/handlers/imageProviders/index.js`.
2. In `open-sse/providers/registry/nanogpt.js`, add `image` to `serviceKinds`, add `imageConfig.baseUrl` and the four image model entries, and keep chat, `modelsFetcher`, `passthroughModels` and API-key auth unchanged.
3. List image for `nanogpt` in `docs/providers/catalog.mdx`.
4. Replace the isolated `staging state (isolated)` block in the test with positive registry identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-nanogpt-image.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 64 passed (64)
npx eslint open-sse/services/providerParity/native-nanogpt-image tests/unit/native-nanogpt-image.test.js
# exit 0
```

Every test uses closed mocks. No live NanoGPT call was made.
