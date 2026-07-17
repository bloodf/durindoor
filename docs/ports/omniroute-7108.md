# Port: OmniRoute #7108 — MiniMax image-generation provider

## Source
- Upstream: `diegosouzapw/OmniRoute` PR #7108 (head `483080bfc8e2`, branch `fix/port-issue-2482-minimax-image`), upstream issue #2482.
- Title: `fix(providers): add MiniMax image-generation provider`.
- Substance ported (MiniMax changes only): `open-sse/handlers/imageGeneration/providers/minimax.ts` (new handler), the `minimax` `IMAGE_PROVIDERS` entry in `imageRegistry.ts`, and the `format === "minimax-image"` dispatch branch.
- Intentionally NOT ported (out of scope / unrelated to the fix): the KIE model-catalog extraction (`providers/registry/kie/imageModels.ts`), `changelog.d` entry, and the OmniRoute `mediaServiceKinds.ts` TS-only test churn.

## Problem
On durindoor `dev`, MiniMax was wired to the generic OpenAI-compatible image adapter (`createOpenAIAdapter("minimax")`) pointing at `https://api.minimaxi.com/v1/images/generations` with a `size`-based request and a `minimax-image-01` model id. MiniMax's real image endpoint is the dedicated synchronous `image_generation` API with an `aspect_ratio` request shape and a `data.image_urls` response — the generic adapter sends the wrong body and mis-parses the response. The source PR registers a native `minimax-image` provider; this port adapts it to durindoor's per-provider adapter architecture.

## Adaptation (TS → JS, OmniRoute architecture → durindoor architecture)
durindoor does not use a single `imageRegistry.ts` + format-string dispatch. It routes image requests through `open-sse/handlers/imageGenerationCore.js`, which resolves a per-provider adapter from `open-sse/handlers/imageProviders/index.js` and calls `buildUrl`/`buildHeaders`/`buildBody`/`normalize`. The upstream MiniMax handler was therefore ported as a dedicated adapter, preserving the exact request/response contract:

- Endpoint `https://api.minimax.io/v1/image_generation` (synchronous; not the OpenAI-compatible `/v1/images/generations`).
- Auth: `Authorization: Bearer <apiKey|accessToken>` (`authType: "apikey"`, `authHeader: "bearer"`).
- Request body `{ model, prompt, aspect_ratio, n, response_format }`.
  - `aspect_ratio` is derived from `size`:
    - Native MiniMax ratios (`"1:1"`, `"16:9"`, `"9:16"`, `"4:3"`, `"3:4"`, `"3:2"`, `"2:3"`, `"21:9"`) pass through unchanged.
    - OpenAI pixel sizes (e.g. `"1792x1024"`, `"1024x1024"`) are mapped to the closest supported ratio via `sizeToAspectRatio` from `_base.js`; an unrecognized size falls back to `"1:1"`.
  - `response_format` honors the client value: `"b64_json"` (OpenAI) is mapped to MiniMax `"base64"`, `"base64"` is passed through as-is, and everything else defaults to `"url"`.
- Response normalization:
  - When `response_format` is `"url"` (or defaulted), `data.image_urls[]` is normalized to OpenAI shape `{ created, data: [{ url, revised_prompt }] }`.
  - When `response_format` is `"base64"`, `data.image_base64[]` is normalized to OpenAI shape `{ created, data: [{ b64_json, revised_prompt }] }`.
- Content-filter handling (status_code `1026`):
  - A 200 response with `base_resp.status_code === 1026` means "Sensitive content detected in prompt". This is a **per-request content rejection**, not an account/auth/quota failure.
  - The adapter throws a `provider_request_rejected` error tagged with HTTP `422`. `imageGenerationCore` passes that explicit status through instead of hardcoding 502, and `accountFallback.checkFallbackError` treats the `provider_request_rejected` marker as non-fallback.
  - Result: the connection is **not** marked unavailable and no account-fallback cooldown is triggered for a single filtered prompt.
- A 2xx with empty images and **no** content-filter signal is still treated as a genuine upstream failure (502 using `base_resp.status_msg`), implemented via the adapter's `parseResponse` hook. Models `image-01` / `image-01-live` registered with `kind: "image"`.

## Files
- `open-sse/handlers/imageProviders/minimax.js` — new dedicated adapter (request shape, auth header, `response_format` mapping, `sizeToAspectRatio` use, `21:9` support, `parseResponse` 1026 → 422 + 502 guard, base64/URL `normalize`).
- `open-sse/handlers/imageProviders/index.js` — register `minimax` to the dedicated adapter (replacing the incorrect generic OpenAI adapter).
- `open-sse/handlers/imageGenerationCore.js` — honor an explicit `status` on a thrown parse/validation error so adapters can return client errors (e.g. 422) instead of always mapping to 502.
- `open-sse/providers/registry/minimax.js` — `imageConfig` (dedicated endpoint, auth, `format: "minimax-image"`, models, `supportedSizes` including `"21:9"` and `"1024x1024"`) and the `image-01` / `image-01-live` model rows (replacing stale `minimax-image-01`).
- `open-sse/services/accountFallback.js` — `checkFallbackError` returns `shouldFallback: false` for `provider_request_rejected` so content-filter rejections never lock the connection or enter the cooldown chain.
- `tests/unit/image-generation.test.js` — focused MiniMax tests: dispatch+auth+request shape, `21:9` passthrough, pixel-size mapping, `b64_json` → `base64` mapping and response normalization, aspect-ratio fallback, upstream-error (401) surface, 2xx-empty → 502, and content-filter 1026 → 422.
- `tests/unit/minimax-content-filter-fallback.test.js` — dedicated guard: content-filter responses return 422 and never trigger `markAccountUnavailable` / account fallback, while genuine 502 failures still fall back.

## Verification
Command (worktree `tests/`, Node 20.20.2):
```
PATH=~/.local/node20/bin:$PATH ~/.local/node20/bin/node node_modules/vitest/vitest.mjs run --config vitest.config.js unit/image-generation.test.js unit/minimax-content-filter-fallback.test.js
```
Result: 28 passed, 0 failed (2 test files). Lint: 0 errors, 168 warnings. commitlint: clean. `check:registry-index` and `check:agent-index` clean.

Coverage present in the files below:
- `tests/unit/image-generation.test.js`: MiniMax dispatch + auth + request shape, `21:9` passthrough, pixel-size mapping, `b64_json` → `base64` mapping and response normalization, aspect-ratio fallback, upstream-error (401) surface, 2xx-empty → 502, and content-filter 1026 → 422.
- `tests/unit/minimax-content-filter-fallback.test.js`: dedicated guard asserting content-filter responses return 422, never trigger `markAccountUnavailable` / account fallback, and that genuine 502 failures still fall back.

Test cases (expected, pending run):
- `generates image with MiniMax native format (dispatch + auth + request shape)` — asserts exact URL `https://api.minimax.io/v1/image_generation`, `Authorization: Bearer`, and body `{model:"image-01",prompt,aspect_ratio:"16:9",n:2,response_format:"url"}`; normalizes `data.image_urls` → `data[].url`.
- `passes 21:9 aspect ratio through unchanged` — `size:"21:9"` → `aspect_ratio:"21:9"`.
- `maps OpenAI pixel size 1792x1024 to the nearest MiniMax ratio` — `size:"1792x1024"` → `aspect_ratio:"16:9"`.
- `maps public b64_json response_format to upstream base64` — `response_format:"b64_json"` → `response_format:"base64"`, and `data.image_base64` → `data[].b64_json`.
- `falls back to 1:1 aspect ratio for unsupported pixel sizes` — `1024x1024` → `"1:1"`, model `image-01-live` forwarded.
- `surfaces MiniMax upstream errors through the core error path` — 401 → `{success:false,status:401}`.
- `returns 502 when MiniMax returns 200 with no image_urls and no filter signal` — empty `image_urls` + `base_resp.status_msg` → 502.
- `returns 422 (not 502) when MiniMax content-filters a prompt (status_code 1026)` — 1026 → 422, error contains `provider_request_rejected`, no account fallback.

Red-checks: temporarily forcing `aspect_ratio:"WRONG"` made the dispatch test fail (`1 failed`); temporarily removing the 1026 branch made the content-filter test fail (`1 failed`); reverting restored green. Registry index intentionally not regenerated (parent orchestrator runs `gen:registry-index`). `imageConfig.models` uses `{id,name}` objects per `schema.js` MediaConfig contract.
