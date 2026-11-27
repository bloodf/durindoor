# SenseNova native image (staged), 2026-11-27

Issue: #2034. The inventory row for `sensenova` image (`IMAGE_ADAPTERS`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `sensenova`: baseUrl `https://api.sensenova.cn/v1/images/generations`, authType `apikey`, authHeader `bearer`, format `openai`. It lists one model, `sensenova-u1-fast`, named "SenseNova U1 Fast", with `supportedSizes` `["1024x1024"]`. There is no `fallbackUrl`. The source comment says the entry uses the same SenseNova API key and connection as the chat provider (9router#2233).
- `open-sse/handlers/imageGeneration.ts`, `handleOpenAIImageGeneration`: the body is `{ model, prompt }`. The validated output options, `n`, `size`, `quality`, `response_format` and `style` are added only when the caller sets them. Headers are `Content-Type: application/json` and `Authorization: Bearer <apiKey || accessToken>`.
- `open-sse/handlers/imageGeneration/openAiImageFetch.ts`: the deadline also covers the body read. A 2xx answer without a usable `b64_json` or `url` item becomes a 502.
- `open-sse/handlers/imageGeneration/result.ts`: upstream `usage` stays internal.
- `src/app/api/providers/[id]/models/discovery/providerSets.ts` and `providerModelsConfig.ts` have no `sensenova` entry. The source has no dynamic discovery for SenseNova image models, so none was ported. The static registry list is the catalog.

The entry is visible and reachable through `handleImageGeneration`. It is not disabled. Prefixed model IDs pass through unchanged in the source.

## Fresh-main check

This worktree and `origin/main` at `fdbb72865a` were searched with `rg` and `git grep`:

- `open-sse/providers/registry/sensenova.js` is a `freeTier` chat provider on `https://token.sensenova.cn/v1/chat/completions`. It has no `serviceKinds` and no `imageConfig`.
- `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) has no `sensenova` key. No checkout file names `api.sensenova.cn`.
- `sensenova-intl` does have an image adapter, `createOpenAIAdapter("sensenova-intl")`, on `https://token.sensenova.ai/v1/images/generations`. Its body whitelist adds `watermark` and `prompt_extend`. It uses a different host, account region and body, so it is not an equivalent. It is not reused and not changed.
- The generic `createOpenAIAdapter("sensenova")` would find no `imageConfig.baseUrl`. It also has no fixed-origin or redirect refusal and no handling for an uncertain submit.

The whole delta was missing, so it was ported.

## What landed

All new files are under `open-sse/services/providerParity/native-sensenova-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and path, the source model and sizes, and gateway bounds. |
| `http.js` | Bounded abortable fetch, redirect and origin checks, bounded reads and `isSafeSensenovaModelId`. |
| `image.js` | `buildSensenovaImageRequest`, `normalizeSensenovaImageItems`, `resolveSensenovaImageCredential`, `resolveSensenovaImageModel`, and `createSensenovaImageAdapter`, a guarded `generate` adapter. |
| `index.js` | Exports and the default `sensenovaImageAdapter`. |
| `registration.json` | Exports, IDs, models, endpoints, auth, accounting and integration points. |

Tests are in `tests/unit/native-sensenova-image.test.js`. Nothing in production imports the module.

## Supported subset

- Canonical ID `sensenova`. There are no extra aliases, because the source and local alias is also `sensenova`. Service kind `image`.
- Auth uses the existing local `sensenova` API-key connection. The selected connection's `apiKey` is used, or its `accessToken` when there is no `apiKey`, matching the source order. The key is sent only as `Authorization: Bearer` to `https://api.sensenova.cn`. A connection `baseUrl` is ignored. The proxy comes from `resolveCredentialProxyOptions(credentials)`.
- Models: `sensenova/` is stripped. Like the source, any single-segment model ID with safe syntax passes through. The registry lists only `sensenova-u1-fast`. `sensenova-intl` also lists that ID, so registration should route `sensenova/sensenova-u1-fast` explicitly and leave bare-ID resolution unchanged.
- Request fields:
  - `prompt` is required and limited to 32,000 characters.
  - `n` must be an integer from 1 to 10.
  - `size` must be `WxH`, with each side from 64 to 2048.
  - `quality` and `style` must each be a short word.
  - `response_format` may be `url` or `b64_json`.
  - `output_format` may be `png`, `jpeg` or `webp`.
  - `user` is accepted but not sent. `stream` may only be `false`.
- Results:
  - A URL item must be public `https` on a host allowed by `isBlockedHost`, with no userinfo. It is never fetched.
  - A `b64_json` item must be valid base64 that sniffs as PNG, JPEG or WebP. It is labelled with `mime_type`.
  - A uniform base64 container is reported as `output_format`. A mismatch with the requested container is only logged, as in the source.
  - At most 16 items are returned.

## Restrictions and deviations from the source

- Before anything is sent, these are refused with a 400:
  - input images (`image`, `image_url`) and masks
  - `background`, animation frames and `output_compression`
  - `watermark` and `prompt_extend` (intl-only fields, not in the source handler)
  - `gif` and `svg` output
  - streaming
  - any other non-null field
  - malformed `n`, `size` or model values

  The source dropped such fields or forwarded them unchecked.
- There is no fallback host and no retry. A 5xx may follow accepted work, so it returns a 502 with `acceptedJob` (`submit-unknown`).
- Redirects are refused (502) and never followed. An answer whose URL is on another origin is not trusted and carries `acceptedJob`.
- The submit has a 120 s deadline, inside a total deadline of 180 s that also covers the body read. Response bodies are limited to 40 MiB.
- No dynamic discovery: the source has none for SenseNova images.
- Error messages never quote the upstream body or the key.

## Error and accounting contract

| Upstream outcome | Result |
| --- | --- |
| 401 or 403 | Passed through as an auth failure. No `acceptedJob`. |
| 402 | 402 with `quotaExhausted: true`, scoped to this connection. |
| 429 | 429 with the reset time from `Retry-After`. |
| 400 or 422 | Passed through with a generic message. |
| 404 | 404 "does not serve this image model". |
| 5xx, a timeout or disconnect after send, or a caller abort mid-flight | `acceptedJob` with `jobState` `submit-unknown`. Never resent. |
| 2xx that is unreadable or has no usable image | 502 with `acceptedJob` `accepted`. |
| Pre-connect failure, or an abort before send | No `acceptedJob`. |
| Success | `nativeUnits.images` is the number of returned items. Upstream `usage` is recorded as internal accounting tokens and is not added to the response. Cost stays unknown unless the usage carries a USD receipt. |

## Registration (serial step, not done here)

1. Add `sensenova: sensenovaImageAdapter` to `IMAGE_ADAPTERS` in `open-sse/handlers/imageProviders/index.js`. Leave `sensenova-intl` unchanged.
2. In `open-sse/providers/registry/sensenova.js`, add `serviceKinds: ["llm", "image"]`, `imageConfig.baseUrl` and the image model entry. Keep category `freeTier`, the chat transport, the clamp and normalizers, and usage features unchanged.
3. List image for `sensenova` in `docs/providers/catalog.mdx`.
4. Replace the isolated `staging state (isolated)` block in the test with positive registry identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-sensenova-image.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 59 passed (59)
npx eslint open-sse/services/providerParity/native-sensenova-image tests/unit/native-sensenova-image.test.js
# exit 0
```

Every test uses closed mocks. No live SenseNova call was made.
