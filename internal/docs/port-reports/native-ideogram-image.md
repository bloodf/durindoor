# Ideogram native image (staged), 2026-11-27

Issue: #2034. The inventory row for `ideogram` image (`IMAGE_ADAPTERS`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `ideogram`:
  - id `ideogram`, baseUrl `https://api.ideogram.ai/generate`, authType `apikey`, authHeader `Api-Key`, format `ideogram-image`.
  - Models `V_3` (Ideogram V3) and `V_2A` (Ideogram V2A).
  - `supportedSizes` `1024x1024`, `1024x1792`, `1792x1024`.
- `open-sse/handlers/imageGeneration.ts`: format `ideogram-image` reaches `handleIdeogramImageGeneration`.
- `open-sse/handlers/imageGeneration/providers/ideogram.ts`:
  - One POST with `Content-Type: application/json` and `Api-Key: <credentials.apiKey>`.
  - The body is `{ prompt, aspect_ratio: "ASPECT_16_9", model: model || "V_3" }`. Size, style, seed, reference images and other fields are never read.
  - A non-2xx answer returns its status with the raw upstream text.
  - A 2xx answer reads `data[0].url`, downloads it with `downloadUpstreamMedia`, and returns `{ created, data: [{ b64_json }] }`. A 2xx with no `data` is a 502.
  - No timeout and no abort signal reach the fetch.
- `open-sse/handlers/imageGeneration/fanOut.ts`: `ideogram-image` is in `SINGLE_IMAGE_FANOUT_FORMATS`. A request for `n` images runs `n` single-image calls (clamped to 10, 4 at a time). It is all-or-nothing and stops at the first failure.
- `open-sse/config/providers/registry/ideogram/index.ts` (chat-side row, alias `ideo`, same base origin and `Api-Key` header). Ideogram has no chat API, so this row does not carry a chat contract.
- Dynamic discovery: none. The source keeps the static two-model list.

## Official wire contract (checked 2026-11-27)

The pinned source's flat body is not Ideogram's documented contract, so the port follows the official documentation for the wire and the source for everything else. Sources, all fetched with public GET requests on 2026-11-27:

- Ideogram API v1 OpenAPI spec, `https://developer.ideogram.ai/openapi/ideogram-api-v1.json`. It is OpenAPI 3.1 with `info.version` `1.0.0` and sha256 `cccc26abe61c34e4f70661939cef8a7fbb60e9ce1f19306bba0ad7bb075833a2`. Its server is `https://api.ideogram.ai`, and its `ApiKeyAuth` scheme is the `Api-Key` header.
- Reference pages:
  - `https://developer.ideogram.ai/v1/api-reference/legacy-endpoints/generate`
  - `https://developer.ideogram.ai/v1/api-reference/generate-images/generate-v3`
  - `https://developer.ideogram.ai/v2/ideogram-api/deprecations`
- Ideogram publishes no official SDK package, per the v2 docs page "SDKs and Client Libraries". There is no SDK to port from.

What the spec documents:

| Model | Operation | Request |
| --- | --- | --- |
| `V_2A` | `POST /generate`, operationId `generate_post_generate_image` ("Generate (legacy)") | `application/json` `GenerateImageRequest`. It requires `image_request`, an `ImageRequest` whose only required field is `prompt`. `aspect_ratio` uses the `ASPECT_*` enum. `model` uses `ModelEnum`: `V_1`, `V_1_TURBO`, `V_2`, `V_2_TURBO`, `V_2A`, `V_2A_TURBO`, `AUTO`. |
| `V_3` | `POST /v1/ideogram-v3/generate`, operationId `generate_post_generate_image_v3` ("Generate with Ideogram 3.0") | `multipart/form-data`. `prompt` is required. `aspect_ratio` uses `AspectRatioV3` (`16x9`, ...). There is no model field. |

- Both answer `{ created, data: [{ prompt, resolution, is_image_safe, seed, url, ... }] }`. `url` is nullable and empty when `is_image_safe` is false.
- 422 means "Prompt failed the safety check" and carries `{ error: string }`.
- `V_3` is not in the `/generate` model enum. The source would send it to an operation that does not list it.
- Neither operation is deprecated. Both have v2 successors: `/v2/image/generate/ideogram-4-5` for `/generate` and `/v2/image/generate/ideogram-3` for the 3.0 operation. They signal this with a `Link: rel="successor-version"` header and a JSON `notice`, which the adapter ignores.

The adapter therefore sends:

- `V_2A` to `POST https://api.ideogram.ai/generate` with `Content-Type: application/json`, `Api-Key`, and the body `{ "image_request": { "prompt", "aspect_ratio": "ASPECT_16_9", "model": "V_2A" } }`.
- `V_3` to `POST https://api.ideogram.ai/v1/ideogram-v3/generate` as a multipart form with the fields `prompt` and `aspect_ratio=16x9`. The only header it sets is `Api-Key`; the form sets its own boundary.

Both stay on the fixed origin, so the origin, redirect, timeout, cancellation, accounting, and result-download guards are unchanged.

## Fresh-main check

- `open-sse/providers/registry/ideogram.js` already exists: id `ideogram`, alias `ideo`, `authType: "apikey"`, models `V_3`/`V_2A` with kind `image`, `serviceKinds: []`, `hiddenKinds: ["image"]`, and `imageConfig { baseUrl: "https://api.ideogram.ai", authHeader: "Api-Key" }`. A comment says it stays hidden until an image adapter is registered.
- `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) has no `ideogram` or `ideo` key. `getImageAdapter` looks up keys directly, so the registry alias does not resolve to an adapter either.
- These other Ideogram rows are not equivalents. Each one is another vendor's hosted Ideogram model on that vendor's endpoint and auth:
  - `fal-ai/ideogram/v2` in `registry/fal-ai.js`
  - `ideogram-ai/ideogram-4-fp8` in `registry/huggingface.js`
  - `ideogram/ideogram-3.0` and `ideogram/ideogram-4.0` in `registry/together.js`
  - `ideogram/v3-*` in the staged kie module

  None of them posts to `api.ideogram.ai/generate` with `Api-Key`.
- A generic `createOpenAIAdapter("ideogram")` would not be an equivalent either. It would post an OpenAI body with Bearer auth to the base origin.

So the delta is real. Nothing was activated and no existing entry was changed.

## What landed

`open-sse/services/providerParity/native-ideogram-image/`:

- `config.js` holds the pinned registry fields, the catalog, the source sizes, the accepted subset, and the bounds.
- `http.js` holds the bounded fixed-origin transport, the redirect refusal, the refused-answer mapping, the result URL check, and the accepted-job accounting.
- `image.js` holds `buildIdeogramImageRequest` and `createIdeogramImageAdapter`. The adapter is a guarded `generate` adapter with `responseFormats: ["b64_json"]` and `defaultResponseFormat: "b64_json"`. `handleImageGenerationCore` already dispatches that kind of adapter. Its `responseFormats` check refuses `url` and `binary` before anything is sent.
- `index.js` exports the module and `ideogramImageAdapter`.
- `registration.json` describes the exports, ids, alias, models, endpoint and auth, and the integration points.

Tests use closed fetch mocks:

- `tests/unit/native-ideogram-image.test.js` has 50 behavior tests. Its request assertions were moved from the source's flat body to the documented bodies above. The only test that depends on the unregistered state is in the isolated `staging state (isolated)` block.
- `tests/unit/ideogram-native-request-contract.test.js` has 11 independent contract tests. They use synthetic, docs-shaped wire fixtures and check the adapter's actual outgoing URL, headers, and body, plus the result, against the enums and property lists copied from the spec.

## Supported subset

- Text-to-image only. Each image takes one POST to the documented operation for its model (see above). The selected connection's `apiKey` is the only credential read, as in the source.
- The model must be `V_3` or `V_2A`, used as `ideogram/<id>` (`ideo/<id>` through the registry alias). An empty model becomes `V_3`, as in the source.
- `size` may be omitted or `1792x1024`. `aspect_ratio` may be omitted, `16:9`, `16x9`, or `ASPECT_16_9`. The wire ratio is always 16:9: `ASPECT_16_9` for `V_2A` and `16x9` for `V_3`. Ideogram picks the pixel resolution for that ratio (for example `1312x736`).
- `n` must be an integer from 1 to 10. It runs that many independent single-image calls, one after another.
- The output is `b64_json` only. The adapter downloads the returned URL, as the source did.
- Accounting comes from `mediaAccounting` and counts returned images. Cost stays `unknown`, because the source has no Ideogram price.

## Deviations and restrictions

The adapter refuses these inputs with a 400 before it sends anything:

- An unknown model.
- `1024x1024` and `1024x1792`. The source listed them but always sent 16:9, so it returned the wrong shape.
- Any other aspect ratio, or an `n` out of range. The source clamped `n` silently.
- `stream`, `url` output, or binary output.
- Fields the source dropped silently:
  - reference-image and mask fields, and chat `image_url` parts
  - `quality`, `style`, `style_type`, `seed`, `negative_prompt`, `magic_prompt_option`, `color_palette`, `resolution`
  - `output_format`, `output_compression`, `background`
- A missing key, or a key that contains a line break, gets a 401.

Transport and answer handling:

- Connection base URLs are ignored, and the key goes only to `https://api.ideogram.ai`.
- Redirects are refused and never followed. A followed redirect to another origin is flagged `submit-unknown`.
- Each call has its own deadline of 120 s, which covers the submit, the answer body, and the result download. The whole request also has a deadline of 300 s. The caller's signal aborts the socket and the download. The fan-out never starts a call after the total deadline or after an abort.
- The JSON answer is read with a 1 MB cap. Only `data[0].url` is used, and it must be public `https` without userinfo.
- The download uses the local `fetchImageAsBase64`, which applies:
  - a pinned public IP
  - manual redirects, so a redirect fails
  - a 10 MB cap
  - a magic-byte image check

  The key is never sent to the result host.
- Upstream bodies are never quoted. Only the status, a vendor code of a safe shape, and a bounded `Retry-After` remain:
  - 401/403 report an auth error.
  - 402, and a 403/429 with a quota or credit code, set `quotaExhausted`.
  - Any other 429 is a rate limit with a reset time.
  - Other 4xx codes, such as 422 for a safety refusal, keep their status.
  - A 5xx becomes a 502 with `acceptedJob` (`submit-unknown`).
- `acceptedJob` with unknown cost marks every case where work may have run:
  - a transport failure after the send started
  - a timeout or abort after the send
  - an unreadable or stalled 2xx body (`completed-unread`)
  - a 2xx without a usable URL (`completed-unusable`)
  - a failed or aborted download (`completed-unread`)
  - a fan-out that stopped after some calls finished (`partial-completed`, with `completedCalls` and `requestedCalls`)
- A failure that provably happened before the send (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) does not carry `acceptedJob`. Nothing is ever resent or replayed.
- Fan-out calls run one after another instead of four at a time. A failure then stops further billable calls at once.

## Unverified

- Closed mocks only; no live call was made.
- The wire bodies follow the official spec, not a live answer. No account was used. If Ideogram changes either operation, the adapter maps the resulting 4xx without quoting it.
- The result URLs from Ideogram are short-lived. The adapter downloads them at once, as the source did.

## Registration (serial, later)

See `registration.json` `integrationPoints`:

1. In `IMAGE_ADAPTERS`, add `ideogram: ideogramImageAdapter`, plus `ideo` like `agy`/`horde`.
2. In `registry/ideogram.js`:
   - set `serviceKinds: ["image"]`
   - drop `hiddenKinds` and its comment
   - point `imageConfig.baseUrl` at `IDEOGRAM_IMAGE_URL` and add `supportedSizes: IDEOGRAM_IMAGE_SIZES`
3. Update the catalog docs.
4. Regenerate `AGENT-INDEX.md`.
5. Replace the isolated staging block with positive identity assertions.
