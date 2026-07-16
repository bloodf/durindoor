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
- Request body `{ model, prompt, aspect_ratio, n, response_format: "url" }`; `size` is mapped to an aspect ratio and any unsupported value (e.g. `1024x1024`) falls back to `"1:1"`.
- Response `data.image_urls[]` normalized to OpenAI shape `{ created, data: [{ url, revised_prompt }] }`.
- A 2xx with empty `data.image_urls` is treated as an upstream failure (502 using `base_resp.status_msg`), implemented via the adapter's `parseResponse` hook (core maps a parse throw to 502). Models `image-01` / `image-01-live` registered with `kind: "image"`.

## Files
- `open-sse/handlers/imageProviders/minimax.js` — new dedicated adapter (request shape, auth header, `parseResponse` 502 guard, `normalize`).
- `open-sse/handlers/imageProviders/index.js` — register `minimax` to the dedicated adapter (replacing the incorrect generic OpenAI adapter).
- `open-sse/providers/registry/minimax.js` — `imageConfig` (dedicated endpoint, auth, `format: "minimax-image"`, models, supportedSizes incl. `1024x1024`) and the `image-01` / `image-01-live` model rows (replacing stale `minimax-image-01`).
- `tests/unit/image-generation.test.js` — focused MiniMax tests: dispatch+auth+request shape, aspect-ratio fallback, upstream-error (401) surface, and 2xx-empty → 502.

## Verification
Command (worktree `tests/`, Node 20.20.2):
```
cd tests && PATH=~/.local/node20/bin:$PATH npm ci && ~/.local/node20/bin/node node_modules/vitest/vitest.mjs run --config vitest.config.js unit/image-generation.test.js
```
Result: `Test Files 1 passed (1)`, `Tests 20 passed (20)` — 16 unchanged cases + 4 MiniMax cases (the 1 stale generic-OpenAI MiniMax test was replaced by the 4 below):
- `generates image with MiniMax native format (dispatch + auth + request shape)` — asserts exact URL `https://api.minimax.io/v1/image_generation`, `Authorization: Bearer`, and body `{model:"image-01",prompt,aspect_ratio:"16:9",n:2,response_format:"url"}`; normalizes `data.image_urls` → `data[].url`.
- `falls back to 1:1 aspect ratio for unsupported pixel sizes` — `1024x1024` → `"1:1"`, model `image-01-live` forwarded.
- `surfaces MiniMax upstream errors through the core error path` — 401 → `{success:false,status:401}`.
- `returns 502 when MiniMax returns 200 with no image_urls` — empty `image_urls` + `base_resp.status_msg` → 502.

Red-check: temporarily forcing `aspect_ratio:"WRONG"` in the adapter made the dispatch test fail (`1 failed`); reverting restored green. Registry index intentionally not regenerated (parent orchestrator runs `gen:registry-index`). `imageConfig.models` uses `{id,name}` objects per `schema.js` MediaConfig contract.
