# NVIDIA catalog reconciliation (#1072)

Source: https://github.com/decolua/9router/pull/5780, head `3b2341aa6eb0236b2171959ce418e0ce7f3166e2`; compared with local base `0a95887394726b8fbabb3eafddf4fd45d5b9ee28`. The PR remains open at that head. Its changes also include request whitelisting, content flattening and reasoning translation; those are outside this catalog-focused port and are not assumed safe from model names alone.

NVIDIA's hosted chat examples establish the exact IDs added to the existing registry:

- [`stepfun-ai/step-5-preview`](https://build.nvidia.com/stepfun-ai/step-5-preview): text and image input, reasoning and tools; 1M context on the page.
- [`minimaxai/minimax-m3.1-flash`](https://build.nvidia.com/minimaxai/minimax-m3.1-flash): text and image example, tools and reasoning. Its page and model card give differing context values, so no numeric cap is added.
- [`z-ai/glm-5.3-flash`](https://build.nvidia.com/z-ai/glm-5-3-flash/build): chat example, text/image, reasoning and tools; 1M context on the page.
- [`nvidia/nemotron-3.5-super-vl-120b-a12b`](https://build.nvidia.com/nvidia/nemotron-3.5-super-vl-120b-a12b): chat example with image, reasoning and tools. Hosted page says 262K; model card says up to 1M, so no cap is added.
- [`mistralai/mistral-large-4-1t-a52b`](https://build.nvidia.com/mistralai/mistral-large-4-1t-a52b): chat example, text/image, reasoning and tools; hosted page says 262K.

The sixth proposed ID, [`moonshotai/kimi-k3.1-pro`](https://build.nvidia.com/moonshotai/kimi-k3_1-pro), is currently explicitly unavailable for programmatic API access despite its catalog listing; it is not registered. No aliases, pricing, numeric limits or capability overrides are added: catalog descriptions do not establish all upstream endpoint-specific values, and NVIDIA's free trial is not a per-token price. Third-party partner prices on NVIDIA pages are not NVIDIA NIM prices. Existing pricing and capabilities remain unchanged.

Local evidence: `open-sse/providers/registry/nvidia.js` already supplies the registered models and transport; `src/app/api/providers/[id]/models/modelsConfig.js` already configures the authenticated NVIDIA `/v1/models` discovery endpoint. `fetchConnectionModels.js` uses that configuration, while `getProviderModels` retains the registry fallback. NVIDIA [documents model listing for NIM](https://docs.nvidia.com/ccluster/resources/nim) with bearer authentication. The upstream unauthenticated suggested-model fetcher and its ID-heuristic filter are not adopted: vendor evidence here does not establish anonymous access to the hosted catalog or a complete chat classification, and adding it would change discovery and fallback behavior. Mixed catalog fixture coverage preserves the existing parser rather than inventing classification. No provider requests were made.
