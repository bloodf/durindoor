# DeepInfra native video (staged), 2026-11-27

Issue: #2034. The inventory row for `deepinfra` video (registry → video dispatcher, format `deepinfra-video`) was missing. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `deepinfra`: id `deepinfra`, baseUrl `https://api.deepinfra.com/v1/inference`, authType `apikey`, authHeader `bearer`, format `deepinfra-video`. The models are `Wan-AI/Wan2.2-T2V-A14B` ("Wan 2.2 T2V A14B"), `Wan-AI/Wan2.2-TI2V-5B` ("Wan 2.2 TI2V 5B"), `Wan-AI/Wan2.7-T2V` ("Wan 2.7 T2V") and `Lightricks/LTX-2.3-Distilled` ("LTX 2.3 Distilled").
- `open-sse/handlers/videoGeneration.ts` dispatches `format === "deepinfra-video"` to `handleDeepinfraVideoGeneration`. It passes no `signal`.
- `open-sse/handlers/videoGeneration/deepinfraHandler.ts`:
  - Makes one synchronous `POST {baseUrl}/{model}` with `Authorization: Bearer <apiKey || accessToken>` and `Content-Type: application/json`.
  - Sends the body `{ prompt: String(prompt ?? "") }`, plus `negative_prompt` when it is a non-empty string, `image` (from `image` or else `image_url`) when it is a non-empty string, and `seed` when it is a finite number. It drops every other field silently.
  - A 2xx with a string `video_url` returns `{ created, data: [{ url, format: "mp4" }] }`. A 2xx without one returns a 502 whose message comes from `error`, `detail`, `message` or `inference_status.error`. A non-2xx returns its status with the same upstream message. A thrown error returns a 502.
  - It sets no timeout and no abort, does not check redirects or the result URL, and logs `{ videos_count: 1 }` with no cost.

The source has no dynamic model discovery for video. Its list is static.

## Fresh-main check

- `open-sse/providers/registry/deepinfra.js` exists with alias `deepinfra`, `authType: "apikey"` and a Bearer transport. That transport is the OpenAI chat path `https://api.deepinfra.com/v1/openai/chat/completions`. The entry has `models: []`, a chat `/v1/openai/models` fetcher, and no `serviceKinds`, which `chatCapability.js` reads as `["llm"]`.
- `getVideoGenerationAdapter("deepinfra")` is null, `supportsVideoGeneration("deepinfra")` is false and `getVideoConfig("deepinfra")` is null. Searching `open-sse/handlers` for `deepinfra` finds only a comment in `moderationsCore.js`.
- No adapter sends to `/v1/inference`. The source proves that host for rerank, but this fork does not carry a DeepInfra rerank config. The same-name registry entry speaks the OpenAI chat envelope, not the inference envelope (`POST /v1/inference/{model}` → `video_url`). It is not an equivalent, so the delta is real.

## What landed

All new files are under `open-sse/services/providerParity/native-deepinfra-video/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and inference URL, auth header and scheme, format id, model list (with `acceptsImage`), and bounds. |
| `request.js` | `buildDeepinfraVideoRequest`: validates the body and refuses anything unsupported with a 400. |
| `http.js` | A bounded, abortable fetch; redirect and foreign-origin checks; refused-answer mapping that never quotes the upstream text; the public https URL check; and accepted-work accounting. |
| `adapter.js` | `createDeepinfraVideoAdapter`, following the `VIDEO_GENERATION_ADAPTERS` contract. |
| `index.js` | Re-exports, plus the default `deepinfraVideoAdapter`. |
| `registration.json` | Exports, canonical ID, models, endpoint, auth and the registration steps. |

The tests are in `tests/unit/native-deepinfra-video.test.js`: 50 tests over a closed network. Nothing is registered. `videoProviders/index.js`, `providers/registry/deepinfra.js` and the docs catalog are unchanged. Only the isolated `staging state` test block asserts that.

## Supported subset

`POST https://api.deepinfra.com/v1/inference/{model}`. The headers are exactly `Authorization: Bearer <key>` and `Content-Type: application/json`, and redirects are set to `manual`.

- `{model}` must be one of the four source models. Ids are fixed, so the path is fixed.
- The body is `{ prompt, negative_prompt?, image?, seed? }`, as in the source.
  - `prompt` must be a non-empty string of at most 8,000 characters.
  - `negative_prompt` must be a string of at most 8,000 characters. An empty one is omitted, as in the source.
  - `seed` must be an integer from 0 to 2^32−1.
  - `image` or `image_url` is accepted only for `Wan-AI/Wan2.2-TI2V-5B`. It must be a public https URL without userinfo, or a base64 `data:image/(png|jpeg|webp)` URL of at most 10 MiB. If both are sent, they must match.
  - `n` must be 1, `response_format` must be `url`, and `stream` must be false. The gateway fields `model` and `user` are read and never forwarded.
- The answer is `{ created, data: [{ url, format: "mp4" }] }`. `video_url` must be https on a public host with no userinfo. It is returned and never fetched.
- Accounting has state `complete` and `nativeUnits.videos = 1`. `cost` is null and `costStatus` is `unknown`. `meta.requestId` keeps a well-formed `request_id`. `meta.providerMetadata` keeps the numeric `inference_status.runtime_ms` and `inference_status.cost` and a short `status`. The reported `cost` is not read as USD because the source never priced it and no receipt contract exists for it here.
- The key is the selected connection's `apiKey`, falling back to `accessToken` as in the source. A key with CR or LF is refused. The connection's proxy options are applied. A connection base URL is ignored, and the key goes only to `https://api.deepinfra.com`. Nothing is shared between calls, and a test covers two credentials.

## Errors, uncertainty and no replay

The adapter never resends. Every result whose work may have run, and may be billed, carries `acceptedJob` with unknown cost (`costSource: "accepted-job"`).

| Case | Result |
| --- | --- |
| Validation failure or missing key | 400 or 401 before any send. |
| Caller already aborted | 499, nothing sent. |
| Connection refused or DNS failure before connect | 502 without `acceptedJob`. |
| Caller abort or deadline after send | 499 or 504, `acceptedJob` `submit-unknown`. The socket is aborted. |
| Transport failure after connect | 502, `submit-unknown`. |
| 3xx | Refused and not followed. 502 without `acceptedJob`. |
| Answer from another origin, or marked `redirected` | 502, `submit-unknown`. |
| 401 or 403 | Passed through. |
| 402 | 402 with `quotaExhausted: true` (this connection only). |
| 429 | Rate limited, with `Retry-After` evidence when present. |
| Other 4xx | Status passed through. |
| 5xx | 502, `submit-unknown`. |
| 2xx that cannot be read, is not a JSON object, exceeds 256 KiB, or lacks a usable `video_url` | 502, `completed-unusable`. |
| 2xx with `inference_status.status` `failed` | 502, `failed-reported`. |
| Caller abort during the 2xx body read | 499, `accepted`. |

Upstream bodies (`detail`, `error`, `inference_status.error`) never reach a message. The messages are fixed strings plus the status, and credentials are redacted through `createErrorResult`.

One deadline, 600 s by default (`DEEPINFRA_VIDEO_TIMEOUT_MS`), covers the send, the render and the body read. The wait ends even when the transport ignores its signal.

## Remaining restrictions

- Only the four source models are supported, and there is no dynamic discovery. The provider's `/v1/openai/models` fetcher lists chat models and must not feed video.
- Only `url` output is supported. A `data:` `video_url`, which the source passed through, is refused as `completed-unusable`, because this fork does not inline or download results.
- Image input is limited to the TI2V model. Other DeepInfra video parameters (resolution, frames, steps, guidance) are refused because the source never sent them.
- Cost stays unknown until an operator tariff or a receipt contract for `inference_status.cost` exists.
- There is no `/v1/videos` async job or cancel route. The call is synchronous, as in the source.

## Registration (serial step)

The steps are in `registration.json` under `integrationPoints`:

1. Add `deepinfra: deepinfraVideoAdapter` to `VIDEO_GENERATION_ADAPTERS`.
2. Set `serviceKinds: ["llm", "video"]` and add the four video model rows to `providers/registry/deepinfra.js`, keeping the chat transport and fetcher.
3. List the DeepInfra video kind in `docs/providers/catalog.mdx`.

The staging test block then becomes positive identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-deepinfra-video.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 50 passed (50)
node scripts/check-anti-slop.mjs
# anti-slop gate OK (0 diagnostics)
```
