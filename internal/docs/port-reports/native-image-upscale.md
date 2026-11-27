# Native image upscale contracts (staged, #2034)

Source: OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad`, read-only checkout.

- `open-sse/config/upscaleRegistry.ts`: `UPSCALE_PROVIDERS` holds `adobe-firefly` (alias `firefly`), `stability-ai`, `topaz` and `syntx` (alias `stx`). It also defines the model rows (`factors`, `supportsCreativity`, `supportsPrompt`, `promptRequired`), `parseUpscaleModel` and the `getAllUpscaleModels` catalog.
- `open-sse/handlers/imageUpscale.ts`: `POST /v1/images/upscale`. It parses the model and dispatches by provider format.
- `open-sse/handlers/imageUpscale/{shared,topaz,stability,syntx,adobeFirefly}.ts`: the vendor handlers.
- `open-sse/services/syntxMedia.ts`, `syntxAuth.ts`, `syntxMediaCatalog.ts`: the SYNTX upload, chat, design/generate and poll protocol, and the upscale rows.

The framework and adapters are staged at `open-sse/services/providerParity/native-image-upscale/` and are not registered. `registration.json` records the route, auth, catalog, usage and discovery requirements, and lists the integration points. No shared production module imports this staging. A test checks this with `git grep`.

## Local evidence: the gap is real

- DurinDoor has no `/v1/images/upscale` route. No upscale handler or upscale registry exists either.
- `native-topaz-image/registration.json` already lists the source's upscale handler as `notPorted`. It is a separate endpoint and request contract.
- `topaz` and `stability-ai` exist as API-key connections (`open-sse/providers/registry/`). They declare image generation only.
- No SYNTX connection exists in this checkout. Its identity is staged separately (`native-syntx-chat-auth`), and this staging does not edit or import it.

## Providers

| Provider | Status | Endpoint(s) | Auth |
|---|---|---|---|
| `topaz/topaz-enhance` | active | `POST https://api.topazlabs.com/image/v1/enhance` (sync, raw image answer) | `X-API-Key` (apiKey, else accessToken) |
| `stability-ai/{fast,conservative,creative}` | active | `POST https://api.stability.ai/v2beta/stable-image/upscale/<model>`; creative polls `GET /v2beta/results/{id}` | `Authorization: Bearer` (apiKey, else accessToken) |
| `syntx`/`stx` `{magnific/magnific, topaz_ai/topaz, ideogram/upscale}` | active adapter | `chats/upload-files`, `chats`, `design/generate?ai_name=`, `chats/{uuid}/messages` on `https://api.syntx.ai` | scoped `{ token }` JWT plus the source's browser-shaped headers |
| `adobe-firefly`/`firefly` `{topaz, topaz-standard, topaz-bloom}` | unavailable (501) | none | none read |
| `adobe-firefly-api/*` | unavailable (501) | none | none read |

### Adobe Firefly disposition

The source upscales through the consumer firefly-3p `/v2/3p-images/upsample` job, using a firefly.adobe.com session (JWT, Cookie and ARP). DurinDoor keeps `adobe-firefly` and `firefly` unregistered and accepts no consumer cookie or web token. This staging keeps that guard in place and never presents a Services credential as a consumer session.

The supported Firefly Services provider (`adobe-firefly-api`) is pinned to an OpenAPI contract with these operations: `images/generate-async`, `status`, `cancel` and `videos/generate`. That contract has no documented upscale operation equivalent to the Topaz upsample job.

Both IDs return a fixed 501 with `unavailable: true`. The response comes before any credential is read or any request is sent. The bare source model IDs (`topaz`, `topaz-standard`, `topaz-bloom`) resolve to the same disposition. These rows are not listed in the catalog.

## Ported semantics

- **Model resolution.** A `provider/` or `alias/` prefix is resolved first, then an unambiguous bare ID. An unknown provider or model returns 400 with the source message. The catalog is the source `{ id, name, provider, format }` row for every provider ID and alias. `describeImageUpscaleModel` adds factors, creativity and prompt flags.
- **Source image.** Fields are read in the source's order: 14 body aliases, then the same keys under `provider_options`, then chat `messages` image parts. Inputs are capped at 20 MiB (50 MiB for SYNTX `data:` input). Remote sources for Topaz and Stability are fetched by the gateway. SYNTX passes remote URLs to SYNTX.
- **Factor aliases.** The accepted names are `factor`, `scale`, `upscale_factor`, `upscaleFactor`, `upsampler_factor` and `upsamplerFactor`. Values may be `2`, `"2"`, `"2x"` or `"x2"`.
- **Topaz.** Form fields are sent in this order: image (file name `image`), `output_format` (png, jpeg or webp; `jpg` maps to jpeg; png by default), `output_width`/`output_height`, `model` (`topaz_model`), `sharpen`, `denoise`, `fix_compression`, `face_enhancement`, `face_enhancement_creativity` and `face_enhancement_strength`.
  - The output size is the source dimensions times the factor (default 2), or an explicit `size`/`output_size`.
  - Strength values are rounded to 2 decimals. A creativity value from 0 to 100 is divided by 100.
  - The `Accept` header is `image/<output_format>`.
- **Stability.**
  - Fast is a fixed 4x upscale.
  - Conservative and creative require `prompt`. Their creativity ranges are 0.2–0.5 (default 0.35) and 0–0.35 (default 0.3).
  - A creativity value between 0 and 1 is treated as a native float. Any other value is a percentage, mapped linearly into the range and rounded to 2 decimals.
  - Creative runs as an async job. The adapter polls every 3 s, waits on 202, retries on 429 and 5xx, and stops after 300 s or `timeout_ms`.
  - A `CONTENT_FILTERED` result is an error. The success response includes `seed`.
- **SYNTX.**
  - A `data:` source is uploaded with the source's exact multipart form: `files`, named `source.png`, plus `destination=uploaded`, `check_duplicates=true` and an empty `model_type`. The adapter reads the URL from `files[0].url`, or `data.files[0].url` as a fallback.
  - The adapter creates the chat with `{ title, scope: "image" }`. The title is the whitespace-collapsed prompt, cut to 60 characters.
  - The generate request is `{ chat_uuid, prompt, settings }`. `settings` holds `model_type` and `image_url: [url]`. It also holds `scale_factor` and `creativity` when they were sent as numbers, and `mode: "upscale"` for Ideogram. The prompt defaults to `"upscale"`.
  - These are SYNTX wire options, not dashboard settings. The local `providerOptions` name keeps that namespace distinct while the parser and outgoing payload retain the `settings` key.
  - Polling starts at 2 s and grows 1.5× per round up to 5 s, with a 600 s deadline. Five consecutive non-2xx answers fail the job. The adapter waits for the latest assistant message (`author_id` −1) to complete, then returns the first image URL. If the chat holds no media, it falls back to URLs from the generate answer.
  - With `url`, the result URL is returned as-is. With `b64_json`, the image is downloaded with a limit of 3 redirects and 50 MiB.
- **Envelope.** The response is `{ created, data: [{ url } | { b64_json }], upscale: { provider, model, factor, … } }`.

## Fork deviations (intentional)

- **Nothing is dropped silently.** The following are refused with 400 before any network call:
  - an unknown field or a non-image `provider_options` entry
  - more than one distinct source image (the source used the first)
  - a non-image chat part
  - a factor the model does not offer (the source snapped 3x to 4x)
  - factor or creativity aliases that disagree
  - `size` together with a factor, which the source ignored
  - a Topaz output larger than 16000 px on an edge (the source clamped it)
  - a factor on a source with unreadable dimensions (the source dropped it)
  - a strength or creativity value that is out of range or not numeric (the source clamped it or used the default)
  - Topaz creativity or strength without face enhancement
  - a prompt on a model that does not take one (Topaz, Stability fast)
  - an unknown `output_format` (the source used png) or `response_format` (the source used url)
  - `n` ≠ 1 or streaming
  - a SYNTX factor or creativity sent as a non-number, or a factor or creativity alias that SYNTX does not read
- Stability endpoint docs were used where the source sent fields to every model. Fast takes only the image and `output_format`, and conservative takes no `style_preset`. Seeds must be integers from 0 to 4294967294. The results answer is read from `image`, with `result` accepted as the results-endpoint name.
- **Remote source images.**
  - Topaz and Stability sources are fetched with `fetchPublic` over `guardedProbeFetch("public-only")`, the local safe media transport. The request carries no credential, cookie or vendor header. Each hop is re-validated, with at most 3 redirects. Connection-time DNS answers are pinned and checked. The fetch has a 30 s deadline, follows the caller's signal and is capped at 20 MiB.
  - SYNTX sources must be https on a public literal host. The gateway does not fetch them. SYNTX `data:` input must be a data URI; the source sent bare base64 on as a URL.
- **Image validation.** Inputs must sniff as PNG, JPEG or WebP, and a contradicting `data:` MIME type is refused. The upload uses the sniffed type.
- **Strict output fidelity.** Topaz and Stability bytes must sniff as the requested output format. They are returned unchanged, labeled with the sniffed MIME type. A SYNTX URL must be https on a public host. A SYNTX `b64_json` result must sniff as an image.
- **Transport.** Vendor calls go to fixed origins only, with manual redirects. Redirects and answers from a foreign origin are refused. Each call has a deadline and an abort path, and body reads are bounded. Upstream bodies are never quoted, and credential values are redacted.
- **Accounting.**
  - A successful upscale is recorded with `mediaAccounting` plus `nativeUnits.images`.
  - `acceptedJob` marks work the vendor may bill: a billable submit with an unknown outcome (`submit-unknown`), any failure after a 2xx billable submit (`accepted`, with the Stability job ID or the SYNTX chat UUID), and a Stability filter result (`filtered`). Such work is never resent.
  - 402 sets `quotaExhausted`. 429 carries `Retry-After`. Non-billable SYNTX setup calls (upload and chat) never carry `acceptedJob`.
- The SYNTX factor is reported as sent, or `null` when SYNTX chose it; the source always reported 2. The catalog keeps the source flags exactly: `conservative` does not advertise creativity, although its handler maps it. The local `stability` alias is not added, because the source upscale registry has none.

## Tests

`tests/unit/native-image-upscale.test.js` runs 131 cases with closed synthetic mocks and no live accounts. It covers:

- the catalog and model resolution
- the Firefly guard, with no reads and no network
- source intake and the guarded remote fetch, including redirect limits and private-hop refusal
- the exact Topaz, Stability and SYNTX wire shapes
- the refusal tables
- async polling without resubmission
- `acceptedJob` states and redaction
- abort and deadline paths

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-image-upscale.test.js --maxWorkers=2
```

## Gate retry preservation

The retry carries forward candidate `5758b90c61e5247c6d567583f436adc98c62426c`
(including the original implementation from `995093a29f`) and all 131 regression
cases unchanged. Its evidence and selected tests passed; the separate checks step
failed on six anti-slop diagnostics. Optional source transport and result metadata
properties now use explicit assignments, and recursive SYNTX URL extraction uses
the shared record predicate plus the array predicate. These are syntax-only lint
repairs: no vendor contract, guard, payload, result or accounting behavior changes.

Retry validation: the focused upscale file passes all 131 tests unchanged;
`sh scripts/checks.sh unit` with the 13 candidate paths selected passes 51 files
and 1746 tests, including the security-related selections. The anti-slop gate
reports zero diagnostics. Root `pnpm run lint` exits 0 (349 existing ESLint
warnings, no errors). Website dependencies were installed from the local
pnpm store to satisfy a selected dashboard fixture import; no fixture or test
was changed.
