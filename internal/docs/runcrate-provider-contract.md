# Runcrate inference provider contract

Status: implemented. Tracking issue [#2034](https://github.com/bloodf/durindoor/issues/2034). Scope is the documented model inference API only: bearer API key, OpenAI-compatible chat completions, live model discovery. Runcrate instance creation, GPU provisioning, storage, reserved clusters, and every other Runcrate product surface stay out of this integration.

## Pinned sources

- First-party contract: [Runcrate chat API](https://www.runcrate.ai/chat-api) — one OpenAI-compatible endpoint at `https://api.runcrate.ai/v1/chat/completions`, `Authorization: Bearer <key>`, optional `stream: true` over server-sent events, standard OpenAI tools format and JSON mode. The page lists publisher-prefixed model IDs such as `deepseek-ai/DeepSeek-V3.2` and `Qwen/Qwen3.8-27B`; the live catalog is wider and changes faster than that page.
- Port source: OmniRoute `release/v3.8.55`, pinned to [`4624250231f49ed118fb4522a9d735e4894322c6`](https://github.com/cheaper-inference/OmniRoute/tree/4624250231f49ed118fb4522a9d735e4894322c6). Its [`runcrate` registry entry](https://github.com/cheaper-inference/OmniRoute/blob/4624250231f49ed118fb4522a9d735e4894322c6/open-sse/config/providers/registry/runcrate/index.ts) registers `id`/`alias` `runcrate`, `format: "openai"`, `executor: "default"`, `baseUrl: https://api.runcrate.ai/v1/chat/completions`, `authType: "apikey"`, `authHeader: "bearer"`, and the static catalog `CHAT_OPENAI_COMPAT_MODELS["runcrate"]` from [`open-sse/config/providers/shared.ts`](https://github.com/cheaper-inference/OmniRoute/blob/4624250231f49ed118fb4522a9d735e4894322c6/open-sse/config/providers/shared.ts). That composed executor is the generic default executor; there is no Runcrate-specific executor upstream.
- Upstream catalog mapping at that pin: `deepseek-ai/DeepSeek-V4.1-Flash`, `deepseek-ai/DeepSeek-V4.1-Flash-1017`, `zai-org/GLM-5.3`, `zai-org/GLM-5.3-Flash`, `Qwen/Qwen3.8-Flash`, `openai/gpt-oss-120b`. The upstream builder emits `{ id, name: id }` per ID; DurinDoor keeps the same IDs and adds readable names.

## DurinDoor-side implementation

- `open-sse/providers/registry/runcrate.js` — the only new runtime file. It declares the API-key category, the Bearer chat transport, `validateUrl` and `modelsFetcher` pointing at `https://api.runcrate.ai/v1/models`, the seeded upstream catalog, `passthroughModels: true`, and `serviceKinds: ["llm"]`.
- No executor was added. `getExecutor("runcrate")` resolves to the existing default OpenAI-compatible executor, so request shaping, Bearer auth, streaming passthrough, error surfacing, and usage accounting are the shared plumbing rather than a provider fork.
- Derived files were regenerated with the repository generators (`npm run gen:registry-index`, `npm run gen:agent-index`, `npm run gen:provider-catalog`); `open-sse/providers/registry/index.js` and `open-sse/AGENT-INDEX.md` were not hand-edited. `open-sse/AGENT-INDEX.md` also picked up two pre-existing generator rows (`adapta-web`, `adp-web`) that were already stale on the base commit.
- `tests/__baseline__/providers-baseline.json` and `tests/__baseline__/alias-baseline.json` received only the `runcrate` rows. The committed snapshots were already stale for many other providers, so they were not regenerated wholesale.

## Model IDs with slashes

The publisher prefix is part of the model ID, not a DurinDoor alias. `parseModel("runcrate/deepseek-ai/DeepSeek-V4.1-Flash")` splits on the first slash only, so the provider resolves to `runcrate` and the forwarded model keeps `deepseek-ai/DeepSeek-V4.1-Flash`. `passthroughModels: true` keeps an ID that is not in the seeded catalog routable, and discovery keeps the picker list current.

## Rejected alternatives

- A dedicated executor: rejected. Upstream uses the composed default executor, and the wire contract is plain OpenAI Chat Completions, so a provider-specific executor would fork shared streaming, error, and accounting behavior without a documented need.
- A `PROVIDER_MODELS_CONFIG` entry: rejected. The registry `modelsFetcher` already serves discovery through the generic fallback in `src/app/api/providers/[id]/models/fetchConnectionModels.js`, with the same Bearer probe headers the connection test uses. Adding a config entry would have required a matching story-picker eligibility update for no functional gain.
- `thinkingFormat: "openai"`: rejected. The first-party contract documents chat, streaming, tools, and JSON mode only; sending reasoning-control fields the upstream does not document risks HTTP 400 responses, so the provider keeps the default format handling.

## Verification limits

`tests/unit/runcrate-provider.test.js` is fully offline. Every HTTP call is a local mock through the injected `proxyAwareFetch`; synthetic keys only. The file proves registry shape, slash-ID routing, discovery success and failure, non-streaming request/response with usage, streaming request/response with `stream_options.include_usage`, upstream 401 and 500 propagation, and usage accounting from a Runcrate-shaped SSE stream. No Runcrate account, key, instance, GPU, shell, Docker, browser, or billed request was used. A registry entry is not proof that a real Runcrate account works, and live model availability, pricing, quotas, and the exact error envelope remain unverified.
