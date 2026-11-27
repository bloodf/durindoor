# Native Hyperbolic image generation (staged, unregistered)

Issue: #2034. Source: OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT), read-only checkout verified at that HEAD.

## Source contract

| Source file | Contract |
| --- | --- |
| `open-sse/config/imageRegistryData.ts` | `hyperbolic`: `baseUrl` `https://api.hyperbolic.xyz/v1/image/generation`, `authType: "apikey"`, `authHeader: "bearer"`, `format: "hyperbolic"`, models `[SDXL1.0-base]`, `supportedSizes: ["1024x1024"]`, followed by the upstream note "Curruntly no models serving" |
| `open-sse/handlers/imageGeneration.ts` | `format === "hyperbolic"` dispatches to `handleHyperbolicImageGeneration` |
| `open-sse/handlers/imageGeneration/providers/hyperbolic.ts` | `POST` JSON `{ model_name, prompt, height, width, backend: "auto" }`, `Authorization: Bearer <apiKey \|\| accessToken>`; answer `{ images: [{ image: <base64> }] }` mapped to `{ created, data: [{ b64_json, revised_prompt: prompt }] }` |
| `open-sse/handlers/imageGeneration/fanOut.ts` | `hyperbolic` is a single-image format: `n > 1` becomes `n` separate upstream calls |

## Local state before this change

- `open-sse/handlers/imageProviders/index.js` `IMAGE_ADAPTERS` has no `hyperbolic` or `hyp` entry, so image generation for this provider was missing.
- `open-sse/providers/registry/hyperbolic.js` is an API-key chat provider (`/v1/chat/completions`) with no `serviceKinds` or `imageConfig`.
- The only other Hyperbolic media path is TTS (`open-sse/handlers/ttsProviders/genericFormats.js`, `POST { text } -> { audio }`). It uses a different endpoint and envelope, so it is not an equivalent.
- The source entry is registered and dispatched, not disabled. Its own note says no models were serving at the pinned commit, so live availability of `SDXL1.0-base` is unproven. This port is checked against closed mocks only.

## What was staged

`open-sse/services/providerParity/native-hyperbolic-image/` exports a guarded `generate` adapter (`hyperbolicImageAdapter`, `createHyperbolicImageAdapter`) plus pure helpers. `registration.json` lists the exports, identity (`hyperbolic`, alias `hyp`, service kind `image`, auth mode `apikey`), the endpoint, bounds, accounting and integration points. Nothing in production imports it.

## Supported subset

- Model: `SDXL1.0-base` (also `hyperbolic/SDXL1.0-base`, `hyp/SDXL1.0-base`).
- `prompt` (required, trimmed, at most 8000 characters), `size` `1024x1024` (default), `n` = 1, `response_format` `b64_json` (default), `user` (not sent), `stream: false`.
- Wire request: exact source URL, headers and body field order. The key comes from the selected connection (`apiKey`, then `accessToken`). The connection `baseUrl` is ignored and the connection proxy is honored.
- Output: `{ created, data: [{ b64_json, revised_prompt }] }`. Each image must be strict base64 of a PNG, JPEG or WebP. At most 4 images are kept.

## Refused before any billable request (source dropped or reshaped these)

Unknown models; any other size (the source parsed any string and turned `NaN` sides into 1024); `n != 1` (the source fan-out bills one call per image, and partial failures were not accounted); `mask`, `image` and other input images; `negative_prompt`, `seed`, `steps`, `cfg_scale` and other sampler options; `quality`, `style` and `output_format`; streaming; `response_format` `url` or `binary`.

## Safety and accounting

- Fixed origin and `redirect: "manual"`. A 3xx or an answer from another origin is refused and never followed with the key.
- Submit deadline of 120 s, capped by a 180 s total deadline. The body read is bounded by the remaining deadline and 24 MB. The caller's signal aborts the socket, and the wait ends even when a transport ignores the signal.
- No retries or replay. An uncertain submit carries `acceptedJob`:
  - `submit-unknown`: timeout, mid-flight abort or disconnect, 5xx, redirect, foreign origin.
  - `accepted`: an unreadable 2xx, or a 2xx with no valid image.
- A pre-connect failure or an abort before send has no `acceptedJob`.
- 401/403 pass through. 402 sets `quotaExhausted` on this connection. 429 keeps Retry-After evidence. Other 4xx pass the status only. Error messages never include the upstream body or the key.
- Success sets `nativeUnits.images` to the number of returned images. Cost stays unknown because Hyperbolic returns no usage field.
- Dynamic discovery: the source has no image model discovery. `/v1/models` remains the chat list used by `src/app/api/providers/[id]/models`.

## Registration (later, serial)

1. `IMAGE_ADAPTERS`: add `hyperbolic` and `hyp` mapped to `hyperbolicImageAdapter`. `imageGenerationCore` already enforces `responseFormats` and calls `adapter.generate`.
2. `open-sse/providers/registry/hyperbolic.js`: set `serviceKinds: ["llm", "image"]` and `imageConfig.baseUrl` to the image endpoint, and add the `SDXL1.0-base` image model. Keep `apikey` auth and the chat transport.
3. `tests/unit/native-hyperbolic-image.test.js`: turn the isolated "staging state" block into positive identity checks. No other test depends on the unregistered state.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-hyperbolic-image.test.js --maxWorkers=2`: 48 tests pass using closed mocks only. ESLint reports nothing on the staged module or the test.
