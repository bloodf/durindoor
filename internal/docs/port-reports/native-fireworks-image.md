# Fireworks image contract review — #2034

Checked **2026-11-27**. Disposition: **blocked-source-unresolved, unregistered**.
Native supported subset: **empty**. No account, key, upload, browser, inference,
paid call or provider API probe was used. Public documentation and GitHub source
were fetched read-only. A live account is **not** an acceptance requirement.

## Pinned source and the mismatch

Read the pinned OmniRoute (MIT) files at
`c71f0065a7efe9230ec23b96a12253b050c4d7ad`:

- [imageRegistryData.ts](https://github.com/cheaper-inference/OmniRoute/blob/c71f0065a7efe9230ec23b96a12253b050c4d7ad/open-sse/config/imageRegistryData.ts)
  declares `fireworks`, Bearer API-key auth, format `openai`,
  `https://api.fireworks.ai/inference/v1/images/generations`, five model IDs
  below, and sizes `1024x1024` / `512x512`.
- [imageGeneration.ts](https://github.com/cheaper-inference/OmniRoute/blob/c71f0065a7efe9230ec23b96a12253b050c4d7ad/open-sse/handlers/imageGeneration.ts)
  dispatches that format through `handleOpenAIImageGeneration`. It builds
  `{model,prompt}`, adds prepared output options and caller-supplied `n`, `size`,
  `quality`, `response_format`, `style`. Its reference-image allow-list uses bare
  Kontext names, so none of these source Fireworks IDs match it.
- [openAiImageFetch.ts](https://github.com/cheaper-inference/OmniRoute/blob/c71f0065a7efe9230ec23b96a12253b050c4d7ad/open-sse/handlers/imageGeneration/openAiImageFetch.ts)
  expects an OpenAI `data[]` envelope containing URLs/base64.

This proves what OmniRoute sends, not what Fireworks supports. No primary source
found establishes that compatibility URL with these exact IDs and envelope.
The previous 33 closed tests proved local behavior against that assumption;
they did not establish vendor acceptance.

## Primary Fireworks evidence

The current [official documentation index](https://docs.fireworks.ai/llms.txt)
was available but contained no image-generation API reference. Direct reads of
all three reference pages below, and their `.md` variants, returned HTTP 404.
Search still returns older indexed copies (crawled approximately 6–9 months ago).
The indexed material is useful historical evidence, not proof of current support:

- [Schnell generation](https://docs.fireworks.ai/api-reference/generate-a-new-image-from-a-text-prompt):
  POST `/inference/v1/workflows/accounts/fireworks/models/flux-1-schnell-fp8/text_to_image`,
  Bearer key, JSON prompt; optional `aspect_ratio`, `guidance_scale`,
  `num_inference_steps`, `seed`. `Accept: image/jpeg` or `image/png` returns
  binary and `Finish-Reason` / `Seed` headers. JSON example has `id`, `base64`
  **array of data URIs**, `finishReason`, `seed`; its field description instead
  calls `base64` a **string**. This is not OpenAI `data[]`. No current source
  resolves the JSON shape or establishes the source ID missing `/models/` as
  an accepted alias. The binary historical example alone does not establish
  current availability or validate OmniRoute's generic route.
- [Kontext submission](https://docs.fireworks.ai/api-reference/generate-or-edit-image-using-flux-kontext):
  POST `/inference/v1/workflows/accounts/fireworks/models/{model}` with bare
  `flux-kontext-pro` or `flux-kontext-max` in the path. Bearer key, JSON
  `prompt`; optional `input_image`, `seed`, `aspect_ratio`, `output_format`
  (`jpeg`/`png`), webhook fields, prompt upsampling and safety tolerance.
  Success is `{request_id:string}`, not a completed image.
- [Kontext result](https://docs.fireworks.ai/api-reference/get-generated-image-from-flux-kontex):
  path ends in `/{model}/get_result`. Heading says **GET**; example performs
  **POST** with JSON `{id:request_id}`. Status enum: `Task not found`, `Pending`,
  `Request Moderated`, `Content Moderated`, `Ready`, `Error`. The result field
  is typed **any**, with no usable artifact schema. Choosing GET/query versus
  POST/body, a result URL key, or an artifact download format would be guessing.

The official Python SDK was inspected at exact commit
[`e09df11e25c2b0e1548c5d3e5e765111a6438986`](https://github.com/fw-ai-external/python-sdk/tree/e09df11e25c2b0e1548c5d3e5e765111a6438986).
Its [`src/fireworks/_client.py`](https://github.com/fw-ai-external/python-sdk/blob/e09df11e25c2b0e1548c5d3e5e765111a6438986/src/fireworks/_client.py)
exposes no image-generation/workflow resource. The recursive tree's image files
are chat input and training types, not image generation. A history lookup for
`src/fireworks/client/image.py` in this repository returned no commits; it cannot
substitute for the old `fireworks.client.image.ImageInference` implementation.
The SDK establishes Bearer authentication but does not resolve these contracts.

## All five source rows and aliases

Every public model page linked below also returned 404 on the checked date.
That is **not retirement evidence**. All five exact source IDs remain in
`FIREWORKS_IMAGE_MODELS` and manifest `sourceModels`; none is advertised or sent.
No `/models/` prefix repair or bare-name alias is inferred.

| Exact OmniRoute ID | Primary model/source evidence | Disposition |
| --- | --- | --- |
| `accounts/fireworks/flux-kontext-max` | [Model page](https://fireworks.ai/models/fireworks/flux-kontext-max); historical Kontext submit/result references above use bare `flux-kontext-max` | Unresolved artifact/poll contract and alias; retained |
| `accounts/fireworks/flux-kontext-pro` | [Model page](https://fireworks.ai/models/fireworks/flux-kontext-pro); same references use bare `flux-kontext-pro` | Unresolved artifact/poll contract and alias; retained |
| `accounts/fireworks/flux-1-schnell-fp8` | [Model page](https://fireworks.ai/models/fireworks/flux-1-schnell-fp8); historical Schnell workflow reference above | Unresolved current contract and alias; retained |
| `accounts/fireworks/models/flux-1-dev-fp8` | [Model page](https://fireworks.ai/models/fireworks/flux-1-dev-fp8); [official 2024 launch](https://fireworks.ai/blog/flux-1-schnell-dev-image-generation) links Dev/Schnell and describes historical availability, not a current request/result schema | Unresolved current contract; retained |
| `accounts/fireworks/models/stable-diffusion-xl-1024-v1-0` | [Model page](https://fireworks.ai/models/fireworks/stable-diffusion-xl-1024-v1-0); [official SDXL article](https://fireworks.ai/blog/new-in-fireworks-image-to-image-and-controlnet-support-for-ssd-1b-and-sdxl?rp=4) uses old `ImageInference(model="stable-diffusion-xl-1024-v1-0").text_to_image`, with `cfg_scale`, `height`, `width`, `sampler`, `steps`, `seed`, `safety_check`, returning an SDK `Answer.image` | Historical SDK example does not establish current wire endpoint/schema; retained |

No explicitly retired/unsupported row was established. No row was deleted on
the basis of absence, and no new model was added. Old blog pricing is not used;
cost remains unknown in retained accounting helpers.

## Private implementation and batch08 handoff

`buildFireworksImageRequest` now throws 400; both the default adapter and factory
return a guard that rejects **every** request before credential access or fetch.
There is no supported endpoint, model, response format or size. No submit, poll,
uncertain replay, upload or artifact download can occur. A refused request has
no `acceptedJob` because no work was sent. This replaces the unestablished
OpenAI wire path instead of substituting a guessed workflow contract.

`registration.json` has `activationAllowed:false`, empty `models.image`, empty
endpoints and integration steps, and `acceptance.liveAccountRequired:false`.
**Batch08 must skip registration and image advertisement.** The source catalog,
source URL and historical constants are evidence only; adapter capability lists
are empty. Production imports and shared registry files are unchanged.

The bounded transport primitives remain private, with closed tests for caller
abort, header/body deadlines, byte bounds, redirects, public HTTPS result URLs,
credential separation, auth/quota/rate/account statuses, unknown-cost accounting,
and unsent versus uncertain transport failures. They are not vendor fixtures.
The old OpenAI success/format tests are superseded by prebilling guards because
that success format is unestablished; no mock is labeled a native acceptance
fixture. Concurrent account and unsupported-input tests assert zero dispatch.

To unblock, provide a current primary source with exact accepted IDs/aliases,
method/path, request schema, result/artifact format, status semantics and polling
contract where needed. Implement only that supported subset privately and test
its source-backed fixtures and safety properties. **Source review and closed
mocks are the acceptance route; no live API/account check is required.**

## Verification

Root, CLI and tests dependencies were installed with frozen lockfiles and
`--prefer-offline`. Required evidence command (offline, synthetic fixtures):

```sh
cd tests && test -f unit/fireworks-image-source-contract.test.js && node node_modules/vitest/vitest.mjs run unit/fireworks-image-source-contract.test.js unit/native-fireworks-image.test.js --maxWorkers=2
```

Result: **2 files, 43 tests passed**. The check also passed with an empty child
environment except PATH, CI and private HOME/DATA_DIR/cache paths; no provider or
publisher credentials were inherited. Root `pnpm run lint` passed (0 errors,
349 warnings; anti-slop: 0 diagnostics). `git diff --check` passed.
Full local CI and independent PR review
remain separate merge gates; this report claims neither.
