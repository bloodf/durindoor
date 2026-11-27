# Fireworks AI native image (staged), 2026-11-27

Issue: #2034. The inventory row for `fireworks` image (`IMAGE_ADAPTERS`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `fireworks`:
  - id `fireworks`, baseUrl `https://api.fireworks.ai/inference/v1/images/generations`, authType `apikey`, authHeader `bearer`, format `openai`.
  - Models `accounts/fireworks/flux-kontext-max`, `accounts/fireworks/flux-kontext-pro`, `accounts/fireworks/flux-1-schnell-fp8`, `accounts/fireworks/models/flux-1-dev-fp8`, `accounts/fireworks/models/stable-diffusion-xl-1024-v1-0`. The ids are copied exactly. Three of them have no `/models/` segment in the source either.
  - `supportedSizes` `1024x1024`, `512x512`.
- `open-sse/handlers/imageGeneration.ts`: format `openai` reaches `handleOpenAIImageGeneration`.
  - The body is `{ model, prompt }` plus the options from `prepareImageGenerationOptions`. A provider other than openai gets only `output_format` and the GIF frame controls.
  - It then adds `n`, `size`, `quality`, `response_format`, and `style`, each one only when the caller sent it.
  - It forwards `image_url` only for the model ids in `OPENAI_IMAGE_TO_IMAGE_MODELS`. That set holds the bare `flux-kontext-*` ids, so no Fireworks id matches and the source never forwards reference images for Fireworks.
  - `openai` is not in `SINGLE_IMAGE_FANOUT_FORMATS`, so `n` goes upstream in one request.
- `open-sse/handlers/imageGeneration/openAiImageFetch.ts`: one POST with `Authorization: Bearer <key>`.
  - The deadline covers the body read as well as the headers.
  - A non-2xx answer passes through with its status.
  - A 2xx answer needs `data[]` with at least one item that has a `url` or `b64_json`. Without one it becomes a 502.
- Dynamic discovery: the source keeps a static image list. `fireworks` is in `HARDCODED_MODELS_CONFIG_IDS`, which only feeds the chat `/v1/models` list.

## Fresh-main check

- `open-sse/providers/registry/fireworks.js` declares `serviceKinds: ["llm", "embedding"]`, an API-key connection, and no `imageConfig`.
- `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) has no `fireworks` key and no alias that resolves to one.
- `rg -i fireworks open-sse/handlers` finds only the embedding allow-list.
- No local adapter or registry entry targets `api.fireworks.ai/inference/v1/images/generations`.
- A generic `createOpenAIAdapter("fireworks")` would not be an equivalent: with no `imageConfig` it has no URL, and it would default `n` and `size` where the source forwards them only when given.

So the delta is real. Nothing was activated and no existing entry was changed.

## What landed

`open-sse/services/providerParity/native-fireworks-image/`:

- `config.js` holds the pinned registry fields, the catalog, the sizes, and the bounds.
- `http.js` holds the bounded fixed-origin transport, the redirect refusal, the refused-answer mapping, and the accepted-job accounting.
- `image.js` holds `buildFireworksImageRequest` and `createFireworksImageAdapter`. The adapter is a guarded `generate` adapter with `responseFormats`. `handleImageGenerationCore` already dispatches that kind of adapter.
- `index.js` exports the module and `fireworksImageAdapter`.
- `registration.json` describes the exports, ids, models, endpoint and auth, and the integration points.

Tests: `tests/unit/native-fireworks-image.test.js`, 33 tests with closed fetch mocks. The only test that depends on the unregistered state is in the isolated `staging state (isolated)` block.

## Supported subset

- Text-to-image only, with one synchronous POST to the fixed origin. The connection's `apiKey` (or `accessToken`) is sent as a Bearer token.
- The model must be one of the five catalog ids, used as `fireworks/<id>`.
- `size` must be `1024x1024` or `512x512` when given. `n` must be an integer from 1 to 10 when given.
- `quality` and `style` are forwarded as short strings.
- `output_format` and the frame controls are validated by the local `prepareImageOutputOptions`, which mirrors the source's `prepareImageOutputOptions`.
- `response_format` must be `url` or `b64_json`. A requested format must be the one the answer contains: a URL is never downloaded, and base64 is never re-hosted.
- Accounting comes from `mediaAccounting` and counts returned images. Cost stays `unknown`, because the source has no Fireworks image price.

## Deviations and restrictions

The adapter refuses these inputs with a 400 before it sends anything:

- An unknown model, or a size outside the catalog.
- An `n` out of range.
- `stream`, or binary output.
- Any reference-image or mask field, and chat `image_url` parts. The source dropped these silently, which would have billed a prompt-only image.
- A non-string `quality` or `style`.

Transport and answer handling:

- Connection base URLs are ignored, and the key goes only to `https://api.fireworks.ai`.
- Redirects are refused and never followed. A followed redirect to another origin is flagged `submit-unknown`.
- One deadline covers the headers and the body, 180 s by default. The caller's signal aborts the socket.
- Upstream bodies are never quoted. Only the status, a vendor code of a safe shape, and a bounded `Retry-After` remain:
  - 401/403 report an auth error.
  - 402, and a 403/429 with a quota code, set `quotaExhausted`.
  - 412 means Fireworks has suspended the account. It keeps its status, which is account-scoped in `errorConfig.js`.
  - Any other 429 is a rate limit with a reset time.
  - A 5xx becomes a 502 with `acceptedJob` (`submit-unknown`).
- `acceptedJob` with unknown cost marks every case where the work may have run:
  - a transport failure after the send started
  - a timeout or abort after the send
  - an unreadable or stalled 2xx body (`completed-unread`)
  - a 2xx with no usable image (`completed-unusable`)
- A failure that provably happened before the send (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) does not carry `acceptedJob`. Nothing is ever resent.
- Result URLs must be public `https` without userinfo, checked with `isBlockedHost`. Unsafe items are dropped. `b64_json` must be valid base64 within `MAX_IMAGE_BYTES`.

## Unverified

- Closed mocks only; no live call was made.
- Fireworks' current public image API for FLUX uses `/inference/v1/workflows/...` routes, and Kontext models work asynchronously. Whether the OpenAI-compatible `/images/generations` route in the source accepts these five ids is not verified. The port follows the pinned source contract exactly. Before registration, check the route against a test account.

## Registration (serial, later)

See `registration.json` `integrationPoints`:

1. In `IMAGE_ADAPTERS`, add `fireworks: fireworksImageAdapter`.
2. In `registry/fireworks.js`, add `image` to `serviceKinds`, add the five image model rows, and add `imageConfig`.
3. Update the catalog docs.
4. Regenerate `AGENT-INDEX.md`.
5. Replace the isolated staging block with positive identity assertions.
