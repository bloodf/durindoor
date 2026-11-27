# DashScope native image for four Alibaba-family identities (staged), 2026-11-27

Issue: #2034. Four inventory rows were MISSING (`IMAGE_ADAPTERS`): `alibaba`, `qwen-cloud`, `qwen-cloud-token-plan` and `bailian-coding-plan` image. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`: four entries, each with authType `apikey` and authHeader `bearer`.

  | id | alias | format | baseUrl | models | supportedSizes |
  | --- | --- | --- | --- | --- | --- |
  | `alibaba` | `ali` | `alibaba-image` | `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | qwen-image-3.0-pro, qwen-image-2.0-pro-2026-06-22, qwen-image-2.0, z-image-turbo, wan2.6-t2i | 1024x1024, 1280x1280, 2048x2048 |
  | `qwen-cloud` | `qwc` | `qwen-cloud-image` | `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | wan2.7-image-pro, wan2.7-image, qwen-image-3.0-pro, qwen-image-2.0-pro-2026-06-22, qwen-image-2.0-2026-03-03, z-image-turbo | 1024x1024, 2048x2048 |
  | `qwen-cloud-token-plan` | `qct` | `qwen-token-plan-image` | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | wan2.7-image, wan2.7-image-pro | 1024x1024, 2048x2048 |
  | `bailian-coding-plan` | `bcp` | `bailian-coding-plan-image` | `https://coding-intl.dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation` | wan2.7-image, wan2.7-image-pro, qwen-image-2.0, qwen-image-2.0-pro | 1024x1024, 2048x2048 |

  Models without `inputModalities: ["text", "image"]` (z-image-turbo, wan2.6-t2i) are text-only.
- `open-sse/handlers/imageGeneration.ts`: all four formats dispatch to `handleAlibabaImageGeneration`.
- `open-sse/handlers/imageGeneration/providers/alibabaImage.ts`: a model outside the identity's own list is a 400 `Unsupported <provider> image model`. The key is `apiKey || accessToken`, else 401. The body is `{ model, input: { messages: [{ role: "user", content }] }, parameters? }`. `content` lists input images as `{ image }` and then `{ text }`. `parameters` holds `size` (`WxH` sent as `W*H`), `n`, then `negative_prompt`, `prompt_extend`, `watermark`, `seed`, `enable_sequential`, `thinking_mode` and `color_palette` when set. Images are read from `output.choices[].message.content[].image`. An answer without one is a 502.
- `src/shared/constants/alibabaProviderRegions.ts`: the global-sg media roots. `bailian-coding-plan` media stays on `coding-intl.dashscope.aliyuncs.com/api/v1` through `ALIBABA_PROVIDER_MEDIA_OVERRIDES`, although its chat traffic moved to the Token Plan host.
- Source tests for comparison: `tests/unit/alibaba-image-media.test.ts`, `qwen-cloud-image-media.test.ts`, `qwen-cloud-token-plan-media.test.ts` and `bailian-coding-plan-media.test.ts`. The adapter reproduces the source body of the Alibaba five-model test byte for byte.

## Fresh-main check

This worktree and `origin/main` at `e183a69458` were searched with `rg` and `git grep`:

- `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) has none of the four keys. No checkout file outside port reports names the `multimodal-generation` path.
- The local registry entries exist with the same aliases (`ali`, `qwc`, `qct`, `bcp`) and the same chat origins as the source media hosts. `alibaba` has `serviceKinds: ["llm", "video"]`. The other three have no `image` kind.
- `open-sse/services/alibabaVideo/` is the integrated Alibaba video port. Two of its helpers are reused read-only: `ALIBABA_DASHSCOPE_INTL_ORIGIN` and `alibabaVideoResultUrl` (https, public literal host, no userinfo). Its request builder, job client and handler are video-synthesis contracts. They are not used and not changed.

The whole delta was missing, so it was ported.

## What landed

All new files are under `open-sse/services/providerParity/native-dashscope-image/`:

| File | Role |
| --- | --- |
| `config.js` | The four identities: fixed origins, the shared path, source models and sizes, and gateway bounds. |
| `http.js` | Bounded abortable fetch, redirect and origin checks, and bounded reads. |
| `image.js` | `buildDashscopeImageRequest`, `resolveDashscopeImageModel`, `resolveDashscopeImageCredential`, `isDashscopeImageRegionSupported`, `normalizeDashscopeImageItems`, `dashscopeImageAccounting`, and `createDashscopeImageAdapter(providerId)`, a guarded `generate` adapter per identity. |
| `index.js` | Exports and one default instance per identity. |
| `registration.json` | Exports, identities, models, endpoints, auth, accounting and integration points. |

Tests are in `tests/unit/native-dashscope-image.test.js`. Nothing in production imports the module.

## Supported subset and deviations

Each identity is its own connection family. It has its own key, its own fixed origin and its own model list. The adapter never maps one identity's model, alias or host onto another's. A model prefixed with another identity's id or alias is refused. A bare id is checked only against the identity's own list.

These are refused with 400 before anything is sent (the source forwards or drops them):

- a raw `parameters` object, any unknown field, and an empty prompt;
- input images that are not https URLs on a public host (including `data:` URIs), more than nine of them, or any input image for a text-only model;
- a size that is not `WxH` or `W*H` with sides from 64 to 8192 (the source forwards other strings such as `2K`);
- `n` outside 1 to 10, a negative or fractional seed, booleans of the wrong type, and a malformed `color_palette`;
- `response_format` other than `url`, and streaming;
- a connection whose `providerSpecificData.region` is not a global-sg spelling. The source's china-beijing hosts are not ported.

The source honours a custom connection base URL. This port does not: each key goes only to its fixed origin.

After the send:

- Redirects are refused and never followed.
- The submit has a deadline inside a total one, and both follow the caller's signal. The total deadline also bounds the body read.
- Error messages never quote the upstream body or the key. Only a vendor `code` of a safe shape is kept.
- Result URLs must be public https and are never fetched. Duplicates are dropped, as in the source.

## Accounting

- Success: accounting is recorded once. `nativeUnits.images` is the count of returned URLs, never the requested `n`. Reported `input_tokens`, `output_tokens` and `total_tokens` become tokens. The numeric usage receipt (`image_count`, `width`, `height` included) stays in `meta.providerUsage`, so width and height are never priced as tokens. The cost is unknown.
- `acceptedJob` with `submit-unknown`: a timeout, abort or disconnect after the send, a 5xx, or an answer from another origin.
- `acceptedJob` with `accepted`: a 2xx that cannot be read, is too large, or has no safe image. Nothing is ever resent.
- 402, or 400/403 with code `Arrearage` or `AccessDenied.Unpurchased` (the codes in `accountFallback.js`): a 402 with `quotaExhausted` on this connection.
- 429: a rate limit with Retry-After evidence.
- 401/403: passed through, without `acceptedJob`.
- A proven pre-connect failure is a plain 502.

## Registration (serial step)

See `registration.json` `integrationPoints`:

1. Add the four keys to `IMAGE_ADAPTERS`.
2. Add `image` to each registry entry's `serviceKinds`, with that identity's image models. Several identities list the same image ids, so bare-id routing must be resolved explicitly.
3. List the subset in `docs/providers/catalog.mdx`.
4. Replace the isolated "staging state" test block with positive identity checks.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-dashscope-image.test.js --maxWorkers=2
```

The run passes 61 tests against closed mocks. No live account or provider was called.
