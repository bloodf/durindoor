# Native Topaz Labs image enhance (staged, #2034)

Source: OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (verified `git rev-parse HEAD` of the read-only checkout).

- `open-sse/config/imageRegistryData.ts`: `topaz` with `baseUrl: "https://api.topazlabs.com"`, `authType: "apikey"`, `authHeader: "x-api-key"`, `format: "topaz"`, model `topaz-enhance` (`inputModalities: ["image"]`), `supportedSizes: ["1024x1024"]`.
- `open-sse/handlers/imageGeneration.ts`: format `topaz` dispatches to `handleTopazImageGeneration`.

Staged at `open-sse/services/providerParity/native-topaz-image/` and not registered. `registration.json` lists the exports and the serial registration steps.

## Local evidence: the delta is real

- `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) has no `topaz` entry, so `mediaTransportSupport("image", "topaz")` is `"unsupported"`. `tests/unit/1136-media-discovery.test.js` and `tests/unit/media-routes.test.js` use that fact as their example.
- `open-sse/providers/registry/topaz.js` declares the API-key connection and `serviceKinds: ["image"]`, but it has no models, transport or `imageConfig`.
- The `topaz` namespace in `native-fal-ai-video/config.js` is a fal.run model family. It uses another origin and credential, so it is not an equivalent.
- The source entry is registered and dispatched, not disabled.

## Wire contract (ported)

| | |
|---|---|
| Endpoint | `POST https://api.topazlabs.com/image/v1/enhance` (fixed origin; connection `baseUrl` ignored) |
| Headers | `Accept: image/jpeg`, `X-API-Key: <apiKey, else accessToken>`; no explicit Content-Type (fetch sets the multipart boundary) |
| Body | multipart: `image` (Blob, file name `image.png`), then `output_width` / `output_height` when `size` is `WxH` |
| Answer | raw image bytes |
| Output | `{ created, data: [{ url: "data:<type>;base64,…" , revised_prompt }] }` (default) or `{ b64_json, revised_prompt }` |
| Discovery | none in the source; the model list is static (`topaz-enhance`) |

## Supported subset

- Model `topaz-enhance` (also `topaz/topaz-enhance`).
- Exactly one inline input image, given in `image`, `image_url`, `image_urls[]` or `imageUrls[]` as a `data:` URI or bare base64. The bytes must sniff as PNG, JPEG or WebP and be no larger than 20 MiB.
- Optional `size` `WxH`, with integer sides from 1 to 8192.
- `n` = 1.
- `response_format` `url` (default) or `b64_json`.
- `prompt` is optional. It is echoed as `revised_prompt` and never sent.
- `user` is accepted and not sent. `stream` must be false.

## Deviations and restrictions (fork-side)

- **Remote image URLs are refused.** The source fetched them through its SSRF-guarded fetcher. This staging never contacts a host the caller chose.
- The adapter refuses all of the following before anything is sent:
  - a missing input
  - more than one distinct input
  - GIF, TIFF, SVG or non-image input
  - a `data:` MIME that contradicts the bytes
  - a malformed or oversized `size`; the source fell back to 1024
  - `n` ≠ 1, streaming or binary output
  - `mask`, chat `messages` and any unknown field
  - the upscale-only options: `output_format`, `topaz_model`, `sharpen`, `denoise`, `fix_compression` and `face_enhancement*`
- The upload uses the sniffed MIME type. The data: URL output uses the sniffed type of the answer, not the upstream `Content-Type`.
- Error messages never quote the upstream body. Credentials never appear in results.
- Not ported: `config/upscaleRegistry.ts` with `handlers/imageUpscale/topaz.ts` (`topaz-upscale` on `/v1/images/upscale`). DurinDoor has no upscale route, and that path uses a different request contract.

## Safety, accounting, and failure handling

- The submit times out at 180 s, and the whole request at 240 s. The adapter also follows the caller's `AbortSignal`. The wait ends even when the transport ignores its signal.
- The response body read is bounded to 48 MiB and to the same deadline.
- `redirect: "manual"`. A 3xx response, or an answer from another origin, is refused and the key is never re-sent.
- `acceptedJob` (`costSource: "accepted-job"`) is set whenever the outcome is unknown:
  - `submit-unknown`: a timeout, abort or disconnect after the send, a 5xx, a redirect, or a foreign-origin answer.
  - `accepted`: a 2xx that cannot be read, is too large, or is not a PNG, JPEG or WebP image.
  - Nothing is ever resent.
- Auth and quota results:
  - 401 or 403 is an auth failure.
  - 402 sets `quotaExhausted` on the selected connection only.
  - 429 keeps the `Retry-After` header.
  - Any other 4xx passes its status through without the body.
- On success, `nativeUnits.images = 1` and the cost is unknown, because the answer carries no usage data.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-topaz-image.test.js --maxWorkers=2`: 65 tests passed with closed mocks only. They cover the exact headers and form, two credentials, the refusals, quota and authentication, redirect and origin checks, deadlines, aborts, the no-replay rule, and malformed or unsafe outputs. The `staging state (isolated)` block is the only part that depends on the unregistered state.

## Registration (serial, later)

1. Add `topaz: topazImageAdapter` to `IMAGE_ADAPTERS`.
2. Add the `topaz-enhance` image model to `open-sse/providers/registry/topaz.js`. Add no `imageConfig`, because it would derive an edits passthrough that this adapter does not support.
3. In the two discovery tests above, replace `topaz` with another provider that has no adapter. Then regenerate the catalog and the agent index.
4. Promote the isolated staging block to positive identity assertions.
