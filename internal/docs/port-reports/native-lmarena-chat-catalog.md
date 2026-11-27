# Arena (lmarena) chat catalog and model routing (staged), 2026-11-27

Issue: #2034. This report reconciles DurinDoor's Arena chat catalog and model routing with the pinned source.

**Outcome:** local and source are not equivalent. The source's chat catalog has 48 models. DurinDoor lists 7 and maps only 6 of them to Arena UUIDs. This port stages the 48-row catalog, the source resolver limited to chat rows, provider metadata and integration instructions. It does not change production wiring. The cookie, TLS, reauth, challenge, session-isolation, quota and privacy behaviour in `open-sse/executors/lmarena.js` stays as it is.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). A `git rev-parse HEAD` in `/tmp/omni-2034` confirmed that commit.

- `open-sse/config/providers/registry/lmarena/directModels.ts`: a static Direct-chat scrape dated 2026-07-09. It has 75 rows: 42 `Text`, 6 `Search` and 27 `Image`. Catalog ids and UUIDs are all unique. `LMARENA_DIRECT_CHAT_ENTRIES` keeps only Text and Search. `LMARENA_DIRECT_MODELS`, the registry `models`, maps each of those rows to `{ id: catalogId, name: displayName, supportsVision? }`. The Image rows go to the image registry.
- `open-sse/config/providers/registry/lmarena/index.ts`: `id: "lmarena"`, `alias: "lma"`, `format: "openai"`, `executor: "lmarena"`, `baseUrl: https://arena.ai/nextjs-api/stream/create-evaluation`, `authType: "apikey"`, `authHeader: "cookie"` and `models: LMARENA_DIRECT_MODELS`.
- `open-sse/executors/lmarena/models.ts`: `getLMArenaModels` serves Text and Search rows only. It sets input `text` (plus `image` when vision is true) and output `text` (plus `web` for Search). Live HTML discovery is disabled. `resolveLMArenaModelId` strips `lmarena/`, `lma/` or `arena/`. It returns a UUID-shaped id unchanged, then tries `resolveLmarenaArenaId`, then `pickLMArenaModelId`. If both fail, it returns the raw name.
- `resolveLmarenaArenaId` checks all 75 rows. It returns the first row whose catalog id, public name or display name matches exactly or case-insensitively.
- `open-sse/executors/lmarena.ts` `transformRequest`: `{ id, mode: "direct-battle", modelAId, userMessageId, modelAMessageId, userMessage: { content, experimental_attachments: [], metadata: {} }, modality: "chat", recaptchaV3Token, cx? }`. Search rows use the same envelope; only `modelAId` changes.
- `executors/lmarena/cookie.ts` and `stream.ts` handle cookie chunk joining and SSE parsing. They have nothing to do with model routing.

### Chat, not all 75 rows

The 27 Image rows are not chat models. The native-lmarena-image report shows that the source image flow has no native Arena transport. Two source quirks follow from that:

- The source resolver also checks Image rows, so `gpt-image-1` resolves to its UUID and is sent with `modality: "chat"`.
- `grok-4.3` is the public name of both `grok-4.3/text` and `grok-4.3/search`. Source order picks the Text row.

## Local state before this port

- `open-sse/providers/registry/lmarena.js` lists 7 models: `amazon.nova-pro-v1:0`, `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `deepseek-v4-pro-thinking`, `gemini-3.1-pro-preview`, `gpt-oss-120b` and `gpt-5.2-high`. All 7 are among the 48 source chat rows, and their vision flags match. They use local display names and `contextLength`, which the source does not declare. `passthroughModels` is `true`.
- `open-sse/executors/lmarena.js` builds `ALLOW` with 6 catalog ids, and their UUIDs match the source. It sends `ALLOW[model] || model` as `modelAId`. Before staging, a mocked-TLS run showed these behaviours:
  - `deepseek-v4-pro-thinking` is listed in the registry but missing from `ALLOW`, so its raw name is sent.
  - The executor does not strip prefixes and does not match by public name, by display name or case-insensitively. For example, `Claude-Sonnet-5-High` is sent raw.
  - Unknown names and Image ids such as `gpt-image-1` are sent raw with `modality: "chat"`.
- The 6 ids that `ALLOW` covers already resolve exactly as the source resolves them.

This port therefore adds the missing source behaviour and does not duplicate an existing catalog.

## What was staged

The bundle is `open-sse/services/providerParity/native-lmarena-chat-catalog/`. Nothing in production imports it.

- `config.js`:
  - the 48 source chat rows in source order: `id`, `arenaId`, `publicName`, `name` (the display name), `organization`, `vision`, `category`, `inputModalities` and `outputCapabilities`;
  - `LMARENA_CHAT_SOURCE_REGISTRY_MODELS`, in the source `LMARENA_DIRECT_MODELS` shape;
  - `buildLmarenaChatRegistryModels(localModels)`, which returns the 48 rows in source order and keeps the local `name` and `contextLength` for the 7 ids the local registry already lists;
  - the provider metadata.
- `resolver.js`, `resolveLmarenaChatModel(requested, { allowUnknownUuid = true })`. It applies the source rules to the chat rows only:
  - it strips one leading prefix and trims;
  - a UUID is matched case-insensitively against the chat rows and resolves to the canonical lowercase id (`uuid-catalog`). An Image UUID is refused. Any other UUID is passed through unchanged (`uuid-passthrough`), as the source does; `allowUnknownUuid: false` refuses it;
  - a name resolves to the first chat row whose catalog id, public name or display name matches exactly or case-insensitively. The result's `via` field reports which one matched.
- `resolver.js` refusals return `400` with a fixed message and one of these codes: `lmarena_invalid_model`, `lmarena_image_model_not_chat` or `lmarena_unknown_model`. They never echo the request, read credentials or make a network call. `lmarenaChatRefusalResponse` builds the 400.
- `contract.js`, `buildLmarenaSourceChatWire`: dormant evidence of the source envelope that pins the `modelAId` mapping. It never sends anything and creates or solves no reCAPTCHA token. The local executor sends the token only when the operator supplied one, and never sends `cx`. The source sends `null` when no token is set.
- `registration.json`: the source and local evidence, resolution rules, models and integration points.

### Intentional deltas from the source

1. Image ids, names and UUIDs are refused instead of being sent with `modality: "chat"`, because the image flow is unsupported.
2. An unknown non-UUID name is refused instead of being sent raw. create-evaluation needs an Arena UUID, and this port does not guess one.
3. A known UUID in a different case resolves to the canonical lowercase id.

## Integration instructions (serial batch 11)

1. In `open-sse/providers/registry/lmarena.js`, set `models` to `buildLmarenaChatRegistryModels(models)`. Keep `cookieCaptureProfile`, `cookieImport`, `authType: "cookie"` and `serviceKinds: ["llm"]` as they are. Consider setting `passthroughModels` to `false` once the resolver refuses unknown names.
2. In `open-sse/executors/lmarena.js` `runChat`, call `resolveLmarenaChatModel(model)` before reading the cookie.
   - When the result has `ok: false`, return `{ response: lmarenaChatRefusalResponse(result), url: URL, headers: {}, transformedBody: null }` without sending anything.
   - Otherwise, pass `result.arenaModelId` to `upstreamBody` in place of `ALLOW[model] || model`, then delete `ALLOW`.
   - Leave the cookie, TLS client, proxy scope, billing, abort and stream code unchanged.
3. In `docs/providers/catalog.mdx`, list the 48 chat models only. Never list the Image rows there.
4. Once wired, update the `staging state` block in the test.

## Tests

`tests/unit/native-lmarena-chat-catalog.test.js` runs 23 tests. `global.fetch` is a spy that throws, `tlsFetchLMArena` is mocked, and every cookie is synthetic. The tests cover:

- **Catalog:** all 48 source rows verbatim, in order. They also check that the 48 chat rows and 27 Image rows total 75, with no shared id or UUID; the modality and capability derivation; the source registry shape; the merge with the local registry (names, `contextLength`, vision); the metadata; and consistency with `registration.json`.
- **Resolution:** each of the 48 rows is resolved by catalog id, public name and display name, in each case variant and with each prefix. A transcribed copy of the source resolver must give the same answer every time. The tests also cover chat UUIDs in any case, the `grok-4.3` source-order tie, display-only aliases, unknown-UUID passthrough and opt-out, and single-prefix stripping.
- **Refusals:** every Image row is refused by id, name and UUID. Unknown, empty and non-string ids are refused. The 400 body is fixed and does not echo a cookie-shaped request. No resolution makes a fetch or TLS call.
- **Wire:** the source envelope with the resolved `modelAId` for every row, Search included. Only an operator-supplied reCAPTCHA token is forwarded.
- **Local executor comparison:** the 6 `ALLOW` ids match the resolver. The tests record the gaps for `deepseek-v4-pro-thinking`, case-insensitive and display-name requests, and image ids. A missing cookie still returns 401 without a send.

Evidence: `cd tests && node node_modules/vitest/vitest.mjs run unit/native-lmarena-chat-catalog.test.js --maxWorkers=2` passes 23 of 23 tests. `npx eslint` on the bundle and the test is clean.
