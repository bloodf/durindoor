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

Tests: `tests/unit/native-ideogram-image.test.js` has 49 tests that use closed fetch mocks. The only test that depends on the unregistered state is in the isolated `staging state (isolated)` block.

## Supported subset

- Text-to-image only. Each image takes one POST to `https://api.ideogram.ai/generate` with exactly the source body and headers. The selected connection's `apiKey` is the only credential read, as in the source.
- The model must be `V_3` or `V_2A`, used as `ideogram/<id>` (`ideo/<id>` through the registry alias). An empty model becomes `V_3`, as in the source.
- `size` may be omitted or `1792x1024`. `aspect_ratio` may be omitted, `16:9`, or `ASPECT_16_9`. The wire ratio is always `ASPECT_16_9`.
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
- Ideogram's public legacy `POST /generate` reference wraps the fields in `image_request: { prompt, aspect_ratio, model }`. The pinned source sends them flat. The port follows the pinned source contract exactly. Before registration, check against a test account whether the flat body is accepted. If it is not, the answer is a non-billable 4xx refusal that the adapter maps without quoting.
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
