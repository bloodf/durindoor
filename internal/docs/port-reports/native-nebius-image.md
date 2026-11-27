# Nebius native image (staged), 2026-11-27

Issue: #2034. The inventory row for `nebius` image (`IMAGE_ADAPTERS`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `nebius`: baseUrl `https://api.tokenfactory.nebius.com/v1/images/generations`, fallbackUrl `https://api.studio.nebius.com/v1/images/generations`, authType `apikey`, authHeader `bearer`, format `openai`. It lists one model, `black-forest-labs/flux-schnell`, named "No Model yet", with `supportedSizes` `["1024x1024"]`. A source comment above the entry says "Curruntly no models serving".
- `open-sse/handlers/imageGeneration.ts`, `handleOpenAIImageGeneration`: the body is `{ model, prompt }`. The validated output options, `n`, `size`, `quality`, `response_format` and `style` are added only when the caller sets them. Headers are `Content-Type: application/json` and `Authorization: Bearer <apiKey || accessToken>`. When the primary URL answers 404, 410, 502 or 503, the source sends the same request to `fallbackUrl`.
- `open-sse/handlers/imageGeneration/openAiImageFetch.ts`: the deadline also covers the body read. A 2xx answer without a usable `b64_json` or `url` item becomes a 502.
- `open-sse/handlers/imageGeneration/result.ts`: upstream `usage` stays internal.
- `src/app/api/providers/[id]/models/discovery/providerModelsConfig.ts`, entry `nebius`: discovery is `GET https://api.tokenfactory.nebius.com/v1/models` with Bearer auth, parsed as `data.data || data.models`.

The entry is visible and reachable through `handleImageGeneration`. It is not disabled. The source's own tests use `nebius/black-forest-labs/flux-dev`, so any model ID passes through. The "no models serving" comment is an upstream statement about what Nebius serves. It does not disable the route. This port carries the wire contract and does not claim that any model is served.

## Fresh-main check

This worktree and `origin/main` at `fdbb72865a` were searched with `rg` and `git grep`:

- `open-sse/providers/registry/nebius.js` declares `serviceKinds: ["llm", "embedding"]` and `authType: "apikey"`. It has chat on `api.studio.nebius.ai` and `embeddingConfig` on `api.tokenfactory.nebius.com/v1/embeddings`. It has no `imageConfig`.
- `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) has no `nebius` key. No file names `api.tokenfactory.nebius.com/v1/images/generations` or `api.studio.nebius.com`.
- The generic `createOpenAIAdapter("nebius")` would find no `imageConfig.baseUrl`. It also has no fallback host, no fixed-origin or redirect refusal, and no handling for an uncertain submit. It is not an equivalent.

The whole delta was missing, so it was ported.

## What landed

All new files are under `open-sse/services/providerParity/native-nebius-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origins, paths, the source model and sizes, fallback statuses and gateway bounds. |
| `http.js` | Bounded abortable fetch, redirect and origin checks, bounded reads, `discoverNebiusModels`, `parseNebiusModelList` and `isSafeNebiusModelId`. |
| `image.js` | `buildNebiusImageRequest`, `normalizeNebiusImageItems`, `resolveNebiusImageCredential`, `resolveNebiusImageModel`, and `createNebiusImageAdapter`, a guarded `generate` adapter. |
| `index.js` | Exports and the default `nebiusImageAdapter`. |
| `registration.json` | Exports, IDs, models, endpoints, auth, accounting and integration points. |

Tests are in `tests/unit/native-nebius-image.test.js`. Nothing in production imports the module.

## Supported subset

- Canonical ID `nebius`. There are no extra aliases, because the source and local alias is also `nebius`. Service kind `image`.
- Auth uses the existing local API-key connection. The selected connection's `apiKey` is used, or its `accessToken` when there is no `apiKey`, matching the source order. The key is sent only as `Authorization: Bearer` to the two fixed origins. A connection `baseUrl` is ignored. The proxy comes from `resolveCredentialProxyOptions(credentials)`.
- Models: `nebius/` is stripped. Like the source, any model ID with safe syntax passes through. The registry lists only the source placeholder `black-forest-labs/flux-schnell`.
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
- Fallback: after a primary 404 or 410 only, the same body and key go once to `https://api.studio.nebius.com/v1/images/generations`. That request uses whatever remains of the total deadline and follows the caller's signal.
- Discovery: `discoverNebiusModels({ apiKey })` sends a bounded `GET /v1/models` with manual redirects and returns every safe model ID. The source does not mark which models produce images, so the list is not classified.

## Restrictions and deviations from the source

- Before anything is sent, these are refused with a 400:
  - input images (`image`, `image_url`) and masks
  - `background`, animation frames, `output_compression` and `partial_images`
  - `gif` and `svg` output
  - streaming
  - any other non-null field
  - malformed `n`, `size` or model values

  The source dropped such fields or forwarded them unchecked.
- The source also retried the fallback after 502 and 503. Those answers may follow work Nebius accepted, so they are never replayed here. They return a 502 with `acceptedJob` (`submit-unknown`).
- Redirects are refused (502) and never followed. An answer whose URL is on another origin is not trusted and carries `acceptedJob`.
- Each attempt has a submit deadline of 120 s, inside a total deadline of 180 s. Response bodies are limited to 40 MiB. Discovery has a 10 s deadline and a 2 MiB limit.
- Error messages never quote the upstream body or the key.

## Error and accounting contract

| Upstream outcome | Result |
| --- | --- |
| 401 or 403 | Passed through as an auth failure. No `acceptedJob`. |
| 402 | 402 with `quotaExhausted: true`, scoped to this connection. |
| 429 | 429 with the reset time from `Retry-After`. |
| 400 or 422 | Passed through with a generic message. |
| 404 or 410 after the fallback | 404 "does not serve this image model". |
| 5xx, a timeout or disconnect after send, or a caller abort mid-flight | `acceptedJob` with `jobState` `submit-unknown`. Never resent. |
| 2xx that is unreadable or has no usable image | 502 with `acceptedJob` `accepted`. |
| Pre-connect failure, or an abort before send | No `acceptedJob`. |
| Success | `nativeUnits.images` is the number of returned items. Upstream `usage` is recorded as internal accounting tokens and is not added to the response. Cost stays unknown unless the usage carries a USD receipt. |

## Registration (serial step, not done here)

1. Add `nebius: nebiusImageAdapter` to `IMAGE_ADAPTERS` in `open-sse/handlers/imageProviders/index.js`.
2. In `open-sse/providers/registry/nebius.js`, add `image` to `serviceKinds`, add `imageConfig.baseUrl` and the image model entry, and keep chat, embeddings and API-key auth unchanged.
3. List image for `nebius` in `docs/providers/catalog.mdx`.
4. Replace the isolated `staging state (isolated)` block in the test with positive registry identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-nebius-image.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 62 passed (62)
npx eslint open-sse/services/providerParity/native-nebius-image tests/unit/native-nebius-image.test.js
# exit 0
```

Every test uses closed mocks. No live Nebius call was made.
