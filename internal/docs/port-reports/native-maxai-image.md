# MaxAI native image (staged), 2026-11-27

Issue: #2034. The inventory row for `maxai` image (`IMAGE_ADAPTERS`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/imageRegistryData.ts`, entry `maxai`: alias `mx`, baseUrl `https://api.maxai.me/gpt/get_image_generate_response`, authType `apikey`, authHeader `bearer`, format `maxai-image`. It lists six models: `gpt-image-1`, `dall-e-3`, `flux-1-schnell`, `flux-1-dev`, `flux-1-pro` and `sd3-medium`. Its `supportedSizes` are `1024x1024`, `1024x1536`, `1536x1024`, `1024x1792` and `1792x1024`.
- `open-sse/handlers/imageGeneration.ts`: format `maxai-image` dispatches to `handleMaxaiImageGeneration`.
- `open-sse/handlers/imageGeneration/providers/maxaiImage.ts`: path, body `{ prompt, style, size, n, model_name }`, style default `vivid`, n cap 4, strict size buckets for `gpt-image-1` and `dall-e-3`, model aliases, `png_url` > `webp_url` > `url` extraction, `status: "OK"` check, 401/418 as rotatable session failures.
- `open-sse/executors/maxai/signing.ts`, `credentials.ts`, `protocol.ts`: the `X-Authorization` signer, the access token / device id / user id triple and the static Firefox-150 headers.

## Fresh-main check

`origin/main` at `fdbb72865a` and this worktree were searched with `git grep` / `rg`:

- `open-sse/providers/registry/maxai.js` exists for chat only. It declares `serviceKinds: ["llm"]`, `authType: "cookie"` (webCookie with `cookieImport`) and `transport.baseUrl` `https://api.maxai.me/gpt/cwc/chat`.
- `open-sse/executors/maxai.js` is the chat executor. It already has the same signer, the cookie credential precedence and a public-bundle constants loader, but all three are module-private.
- `IMAGE_ADAPTERS` has no `maxai` or `mx` key, and no file mentions `get_image_generate_response`.
- A generic OpenAI image adapter does not match MaxAI. MaxAI needs a per-request signed `X-Authorization` blob bound to the device and user, uses a `model_name` body field, and returns `{ status, data: [{ png_url, webp_url }] }`.

The whole delta was missing, so it was ported.

## What landed

All new files are under `open-sse/services/providerParity/native-maxai-image/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origins, path, models, aliases, sizes and gateway bounds. |
| `signing.js` | The source signer (`buildMaxaiSignedHeaders`, `computeMaxaiProof`, `maxaiAesEncrypt`), static headers, and `resolveMaxaiImageCredential` with the local cookie-connection precedence. |
| `http.js` | Bounded abortable fetch, origin and redirect checks, bounded reads, `discoverMaxaiConstants` and `createMaxaiConstantsSource`. |
| `image.js` | `buildMaxaiImageRequest`, `extractMaxaiImageUrls`, `createMaxaiImageAdapter` (a guarded `generate` adapter). |
| `index.js` | Exports and the default `maxaiImageAdapter`. |
| `registration.json` | Exports, IDs, aliases, models, endpoints, auth, accounting and integration points. |

Tests are in `tests/unit/native-maxai-image.test.js`.

## Supported subset

- Models: the six source models, with a `maxai/` or `mx/` prefix accepted. The aliases `stable-diffusion-v3` and `stable-diffusion-3-medium` resolve to `sd3-medium`, and `flux-1-schneil` resolves to `flux-1-schnell`.
- Request fields: `prompt`, `size`, `n` (1 to 4), `style` (default `vivid`), `response_format: "url"`, `user` (not sent) and `stream: false`.
- Sizes: `gpt-image-1` takes `1024x1024`, `1024x1536`, `1536x1024` or `auto`. `dall-e-3` takes `1024x1024`, `1024x1792` or `1792x1024`. The flux models and `sd3-medium` take `WxH` with each side from 256 to 2048. The default is `1024x1024`.
- Output: `{ created, data: [{ url }] }`, using public https URLs only. URLs are returned as they are and are never downloaded.
- Auth: the selected connection's triple goes in `Authorization: Bearer` with the signed `X-Authorization`. The token goes only to `https://api.maxai.me`. The webCookie connection mode is unchanged.
- Signing constants are resolved in this order:
  1. The connection's saved `providerSpecificData.maxaiSigningConstants`, the same field the chat executor reads.
  2. An injected set.
  3. An in-process memo.
  4. Discovery from `https://www.maxai.co/app/` and its same-origin `_next` chunks. Discovery sends no credentials and refuses redirects. Each request has an 8 s limit, the whole discovery has a 30 s limit, and the caller's signal can abort it.

## Fork deviations and restrictions

- **Refused before signing or sending.** The source snapped some inputs, clamped others or passed them through. Here these are refused instead: unknown models, sizes outside a strict bucket, sizes that are not `WxH`, an `n` above 4 or not an integer, `mask`, input images, `quality` and other output options, streaming, and `b64_json`.
- **Errors never quote the upstream body.**
  - 401 and 403 pass through as they are.
  - 418 and 3xx become 401 (session rejected).
  - 402 sets `quotaExhausted` for this connection only.
  - 429 keeps a bounded `Retry-After`.
  - Other 4xx pass through. None of these carry `acceptedJob`.
- **Uncertain outcomes carry `acceptedJob` and are never resent.**
  - `submit-unknown`: 5xx, a timeout, abort or disconnect after the send, or an answer from another origin.
  - `accepted`: a 2xx that cannot be read, has a status other than `OK`, or has no public https image URL.
- **Proven-unsent failures carry no `acceptedJob`.** These are pre-connect errors such as `ECONNREFUSED` and an abort before the send.
- **Cost stays unknown.** On success, `nativeUnits.images` counts the returned URLs and `costStatus` is `unknown`.
- **Bounds.** The submit has a 120 s limit and the whole call a 180 s limit. Answers are capped at 256 KiB and at most 16 URLs are kept.
- **Not ported.** Image edits and variations, `b64_json`, binary output, image downloads, OmniRoute's settings-store persistence of constants, its daily constants refresh, and `docIdKey`, which only the document upload uses.
- **Duplicated signer.** The local chat executor keeps its signer private, so this module has its own copy of the same algorithm. Registration can export one shared signer from `open-sse/executors/maxai.js` and pass it through the `constantsSource` option.

## Registration (serial step)

See `registration.json` `integrationPoints`:

1. Add `maxai` and `mx` to `IMAGE_ADAPTERS` (`open-sse/handlers/imageProviders/index.js`) as `maxaiImageAdapter`.
2. Add `image` to `serviceKinds` in `open-sse/providers/registry/maxai.js`, and list the six image models. Keep the cookie auth and the chat transport.
3. Optionally, deduplicate the signer and constants loader with `open-sse/executors/maxai.js`.
4. Replace the isolated "staging state" block in the test with positive registry identity checks.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-maxai-image.test.js --maxWorkers=2
# 47 passed
node node_modules/oxlint/dist/cli.js -c .oxlintrc.json open-sse/services/providerParity/native-maxai-image tests/unit/native-maxai-image.test.js
# 0 diagnostics
```

All tests use an injected fetch with closed mocks and synthetic tokens. They make no live calls and use no browser.
