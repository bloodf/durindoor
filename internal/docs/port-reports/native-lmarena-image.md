# Arena (lmarena) image (staged, no native source contract), 2026-11-27

Issue: #2034. Decision15 accepted this delta. The inventory row is `Image | lmarena | apikey / cookie / openai; endpoint https://arena.ai/nextjs-api/stream/create-evaluation | open-sse/config/imageRegistryData.ts -> handlers/imageGeneration.ts | MISSING (IMAGE_ADAPTERS)`.

**Outcome:** the local delta is real, because DurinDoor has no lmarena image route. The pinned source has no native Arena image contract to port, though. Its lmarena image entry falls through to the generic OpenAI image forwarder. That forwarder never sends the session cookie or the Arena request envelope. This port stages the exact catalog metadata, a fail-fast adapter and the evidence. It does not activate Arena image generation, and it does not invent an Arena image wire.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). A `git rev-parse HEAD` in `/tmp/omni-2034` confirmed that commit.

- `open-sse/config/imageRegistryData.ts`, `lmarena`: `id: "lmarena"`, `alias: "lma"`, `baseUrl: "https://arena.ai/nextjs-api/stream/create-evaluation"`, `authType: "apikey"`, `authHeader: "cookie"`, `format: "openai"`, `models: LMARENA_DIRECT_IMAGE_MODELS`, `supportedSizes: ["1024x1024", "1024x1792", "1792x1024"]`.
- `open-sse/config/providers/registry/lmarena/directModels.ts`: 75 Direct-chat rows. Of those, 27 have `category: "Image"`. Each row has a catalog id, an Arena UUID, a public name, a display name, an organization and a vision flag. `resolveLmarenaArenaId` strips `lmarena/`, `lma/` and `arena/` and matches by id or name (exact, then case-insensitive) or by UUID. The header comment says "Live HTML discovery is disabled". The list is a static scrape dated 2026-07-09.
- `open-sse/handlers/imageGeneration.ts`: `handleImageGeneration` has no `lmarena` branch and no `cookie` branch. Because the format is `openai`, it falls through to `handleOpenAIImageGeneration`.
- `open-sse/handlers/imageGeneration/openAiImageFetch.ts`: `fetchImageEndpoint` sends the request with plain `fetch` and parses an OpenAI image JSON answer.
- `open-sse/executors/lmarena.ts` and `executors/lmarena/{cookie,models,stream}.ts`: the only Arena transport, and it is chat only.

## Why the source is not a native image contract

`handleOpenAIImageGeneration` would send this to the create-evaluation URL:

```
POST https://arena.ai/nextjs-api/stream/create-evaluation
Content-Type: application/json

{ "model": "<catalog id>", "prompt": "...", "n"?, "size"?, "quality"?, "response_format"?, "style"? }
```

The request has these defects:

1. **No credential.** The handler sets `Authorization` only for `authHeader: "bearer"` and `x-api-key` only for `"x-api-key"`. Nothing in the image path handles `"cookie"`, so the `arena-auth-prod-v1` session is never sent.
2. **Wrong envelope.** create-evaluation is the Arena chat SSE endpoint. The executor sends `{ id, mode: "direct-battle", modelAId: <arena UUID>, userMessageId, modelAMessageId, userMessage: { content, experimental_attachments, metadata }, modality: "chat", recaptchaV3Token, cx? }` to it. The image body has none of these fields.
3. **Wrong model id.** The image body sends the catalog name (for example `gpt-image-1`), not the Arena UUID that `modelAId` needs.
4. **Wrong transport.** It uses plain `fetch`. The Arena executor goes through the Chrome-TLS client (`services/lmarenaTlsClient.ts`) because the host sits behind Cloudflare.
5. **Wrong answer parser.** The handler expects `{ data: [...] }` JSON. create-evaluation answers with an AI-SDK SSE stream, and `executors/lmarena/stream.ts` parses only text, thinking, heartbeat, error and done events. It has no image event.
6. **No image modality anywhere.** The executor only ever sends `modality: "chat"`. No file at this commit builds an Arena image request.

A working Arena image provider would need a modality, an envelope and a result-event shape that the source never defines or validates. This port does not guess them.

## What already existed locally

- `open-sse/handlers/imageProviders/index.js` `IMAGE_ADAPTERS`: no `lmarena` and no `lma` entry. Today the image core answers `400 Provider 'lmarena' does not support image generation`.
- `open-sse/providers/registry/lmarena.js`: `category: "webCookie"`, `authType: "cookie"`, cookie import of `arena-auth-prod-v1` and its numbered chunks, `serviceKinds: ["llm"]`, and seven chat models. It declares no image models.
- `open-sse/executors/lmarena.js`: chat only (`modality: "chat"`, an `ALLOW` map of six chat UUIDs). It reads the cookie as `cookie || apiKey || providerSpecificData.cookie`.

No equivalent exists under a generic config either, so this port duplicates nothing.

## What was staged

The bundle is `open-sse/services/providerParity/native-lmarena-image/`. Nothing in production imports it.

- `config.js`: the source registry fields verbatim. It also holds the 27 Image rows in source order (`id`, `arenaId`, `publicName`, `name`, `organization`, `vision`, `inputModalities`) and `resolveLmarenaImageModel`, which is the source resolver restricted to Image rows, so chat, search and unknown UUIDs return null. Finally it has `LMARENA_IMAGE_PROVIDER_METADATA` (`supported: false`, `supportedResponseFormats: []`) and the unsupported reason.
- `adapter.js`: a guarded `generate` adapter for `imageGenerationCore`'s generate branch:
  - an id outside the 27 Image rows gets `400 Unknown Arena (lmarena) image model`;
  - every other request gets `501` with `LMARENA_IMAGE_UNSUPPORTED_REASON`.

  The adapter does not read credentials, body media or the signal. It makes no network call and submits nothing. It returns no `acceptedJob`, usage or quota effect, and `onRequestSuccess` is never called. `responseFormats: ["url", "b64_json"]` exists only so the core's format check does not pre-empt the 501.
- `contract.js` holds dormant reference code that is never called:
  - `buildLmarenaSourceImageWire` reproduces the exact source request above, as evidence.
  - `LMARENA_SOURCE_WIRE_DEFECTS` lists the defects.
  - `resolveLmarenaImageCookie` and `reconstructLmarenaImageCookie` port the source cookie reader. Its precedence is `cookie`, `apiKey`, top-level `arena-auth-prod-v1[.N]`, `providerSpecificData.cookie`, then `providerSpecificData` chunks, with ordered chunk joining. A future native transport can reuse the existing cookie connection unchanged.
- `registration.json` holds the exports, the canonical id `lmarena`, the alias `lma`, the stripped prefixes, the 27 models with their Arena UUIDs, serviceKinds `["image"]`, auth mode `cookie`, the endpoint (never called), the evidence and the integration points.

## Supported subset

None. No request is forwarded. The only behaviours are the 400 for unknown models and the 501 diagnostic. `supportedSizes` is recorded but never honored. Edits, masks, input images, streaming, `b64_json` and `n > 1` all get the same 501 before any submission.

## Registration guidance

No registration is recommended while no native Arena image transport exists. Registering would only change the generic 400 into the 501 diagnostic. If that diagnostic is wanted, add both `lmarena: lmarenaImageAdapter` and `lma: lmarenaImageAdapter` to `IMAGE_ADAPTERS`, because `lookupMediaAdapter` does not resolve aliases. Keep `open-sse/providers/registry/lmarena.js` at `serviceKinds: ["llm"]`, and do not list Arena image models as working in `docs/providers/catalog.mdx`.

## Tests

`tests/unit/native-lmarena-image.test.js` runs in a closed network: `global.fetch` is a spy that throws, and every credential is synthetic. It covers:

- the exact registry entry, all 27 rows (ids, UUIDs, display names, vision, modalities) and the `registration.json` consistency;
- model resolution, including prefixes, display names, case and UUIDs, and the rejection of chat, search, unknown and malformed ids;
- the 501 for every recognised model with no fetch call, and the 400 for unknown models;
- two credentials (a whole cookie, and a chunked `providerSpecificData` cookie) getting byte-identical answers with neither cookie echoed;
- an aborted signal, credential getters and body-media getters left untouched;
- unsupported inputs refused before submission;
- passthrough of the 501 by `handleImageGenerationCore` through a mocked registry, without `onRequestSuccess`;
- the dormant source wire (no Cookie, an OpenAI body, the catalog id as model) and cookie chunk reconstruction.

The only unregistered-state assertions are in the isolated `staging state (pre-registration only)` block.

Evidence: `cd tests && node node_modules/vitest/vitest.mjs run unit/native-lmarena-image.test.js --maxWorkers=2` passes 18 of 18 tests. `npx eslint` on the bundle and the test is clean.
