# Pollinations native image (staged), 2026-11-27

Issue: #2034. The inventory row for `pollinations` image (`IMAGE_ADAPTERS`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `pollinations`:
  - id `pollinations`, alias `pol`, baseUrl `https://gen.pollinations.ai/v1/images/generations`, authType `apikey`, authHeader `bearer`, format `openai`.
  - Models `klein`, `flux`, `zimage`, `qwen-image`, `wan-image`, `gpt-image-2`, `gptimage-large`, `gptimage`, with the source's display names.
  - `supportedSizes` `1024x1024`, `512x512`.
  - The image-model alias `pollinations/kontext` in the same file resolves to `black-forest-labs` / `flux-kontext-pro`. It does not route to Pollinations, so it is not part of this port.
- `open-sse/handlers/imageGeneration.ts`: format `openai` reaches `handleOpenAIImageGeneration`.
  - The body is `{ model, prompt }` plus the options from `prepareImageGenerationOptions`. A provider other than openai gets only `output_format` and the GIF frame controls.
  - It then adds `n`, `size`, `quality`, `response_format`, and `style`, each one only when the caller sent it.
  - It forwards the first reference image as `image_url` only for ids in `OPENAI_IMAGE_TO_IMAGE_MODELS`. Of the Pollinations ids, only `qwen-image` is in that set. Any further images are dropped silently.
  - With a key, it sends `Authorization: Bearer <key>`. Without one, `handlers/imageGeneration/pollinationsAnonAuth.ts` (#8085) merges headers from an anonymous fingerprint session pool, and falls back to a bare request when the pool is exhausted.
- `open-sse/handlers/imageGeneration/openAiImageFetch.ts`: one POST. The deadline covers the body read. A non-2xx answer passes through with its status. A 2xx answer needs `data[]` with an item that has a `url` or `b64_json`, otherwise it is a 502.
- Dynamic discovery: the image list is static. `pollinations` is in `NAMED_OPENAI_STYLE_PROVIDERS` (`src/app/api/providers/[id]/models/discovery/providerSets.ts`), which only feeds the live chat `/v1/models` list.

## Fresh-main check

- `open-sse/providers/registry/pollinations.js` has the `pol` alias, `noAuth: true`, `authModes: ["apikey"]`, and only the chat transport `https://gen.pollinations.ai/v1/chat/completions`. It declares no image service kind and no `imageConfig`.
- `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) has no `pollinations` or `pol` key. `lookupMediaAdapter` does no alias resolution.
- `open-sse/executors/pollinations.js` is chat-only.
- `g4f-pollinations` is a different provider (the `g4f.space` proxy) and is chat-only.
- No local adapter targets `gen.pollinations.ai/v1/images/generations`.

So the delta is real. Nothing was activated and no existing entry was changed.

## What landed

`open-sse/services/providerParity/native-pollinations-image/`:

- `config.js` holds the pinned registry fields, the catalog (with `inputModalities`), the sizes, and the bounds.
- `http.js` holds the auth classification, the bounded fixed-origin transport, the redirect refusal, the refused-answer mapping, and the accepted-job accounting.
- `image.js` holds `buildPollinationsImageRequest` and `createPollinationsImageAdapter`, a guarded `generate` adapter with `responseFormats`. `handleImageGenerationCore` already dispatches that kind of adapter.
- `index.js` exports the module and `pollinationsImageAdapter`.
- `registration.json` describes the exports, ids, aliases, models, endpoint and auth, and the integration points.

Tests: `tests/unit/native-pollinations-image.test.js`, 43 tests with closed fetch mocks. The only test that depends on the unregistered state is in the isolated `staging state (isolated)` block.

## Supported subset

- One synchronous POST to the fixed origin. The model must be one of the eight catalog ids, used as `pollinations/<id>` (or `pol/<id>` once registered).
- Auth follows the existing connection modes:
  - A saved `apiKey` (or `accessToken`) is sent as a Bearer token.
  - The public no-auth credential (`noauth` connection, `public` token), the `sk_durindoor` placeholder, or no key sends no Authorization header. This is the same rule `open-sse/executors/pollinations.js` uses for chat.
  - A key with CR/LF or only whitespace is refused before sending.
- `qwen-image` accepts exactly one reference image, which must be a public `https` URL. It is sent as `image_url`, like the source.
- `size` must be `1024x1024` or `512x512` when given. `n` must be an integer from 1 to 10 when given.
- `quality` and `style` are forwarded as short strings. `output_format` and the frame controls are validated by the local `prepareImageOutputOptions`.
- `response_format` must be `url` or `b64_json`. A requested format must be the one the answer contains.
- Accounting comes from `mediaAccounting` and counts returned images. Cost stays `unknown`, and `meta.authScope` records `apikey` or `anonymous`.

## Deviations and restrictions

Refused with a 400 before anything is sent:

- An unknown model, or a size outside the catalog. An `n` out of range.
- `stream`, or binary output.
- Reference images on any model other than `qwen-image`, more than one reference image, a `data:` URI or private/non-https reference, `mask`, `mask_url`, `images`, `input_image`. The source dropped extra and unsupported images silently, which would have billed a prompt-only image.
- A non-string `quality` or `style`.

Not ported: the anonymous fingerprint session pool (`pollinationsAnonAuth.ts`). This fork has no session-pool service, and the pool exists to make keyless traffic look like distinct browser sessions. Keyless requests are sent bare, which is the source's own behavior when the pool is exhausted.

Transport and answer handling:

- Connection base URLs are ignored, and the key goes only to `https://gen.pollinations.ai`.
- Redirects are refused and never followed. A followed redirect to another origin is flagged `submit-unknown`.
- One deadline covers the headers and the body, 180 s by default. The caller's signal aborts the socket.
- Upstream bodies are never quoted. Only the status, a vendor code of a safe shape, and a bounded `Retry-After` remain:
  - With a key: 401/403 report an auth error. 402, and a 403/429 with a quota code, set `quotaExhausted` on that connection. Any other 429 is a rate limit with a reset time.
  - Without a key: 401/402/403 answer 401 "requires an API key", and 429 is a plain rate limit. `quotaExhausted` is never set, because the public credential is shared and not an account.
  - A 5xx becomes a 502 with `acceptedJob` (`submit-unknown`).
- `acceptedJob` with unknown cost (and `authScope`) marks every case where the work may have run: a transport failure after the send started, a timeout or abort after the send, an unreadable or stalled 2xx body (`completed-unread`), and a 2xx with no usable image (`completed-unusable`).
- A failure that provably happened before the send (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) does not carry `acceptedJob`. Nothing is ever resent.
- Result URLs must be public `https` without userinfo, checked with `isBlockedHost`. Unsafe items are dropped. `b64_json` must be valid base64 within `MAX_IMAGE_BYTES`.

## Unverified

- Closed mocks only; no live call was made.
- Which ids need a key (`requiresApiKey`) for images is not in the source. Keyless refusals surface as a 401 asking for a key.
- The source comment (#8085) says Pollinations rejects bare keyless image requests with 401. If that holds, keyless image generation works only with a saved key. Check against a test account before registration.

## Registration (serial, later)

See `registration.json` `integrationPoints`:

1. In `IMAGE_ADAPTERS`, add `pollinations: pollinationsImageAdapter` and `pol: pollinationsImageAdapter`.
2. In `registry/pollinations.js`, add the `image` service kind, the eight image model rows, and `imageConfig`. Keep `noAuth`, `authModes`, and the chat transport.
3. Update the catalog docs.
4. Regenerate `AGENT-INDEX.md`.
5. Replace the isolated staging block with positive identity assertions.
