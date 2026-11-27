# TTOken staging — Refs #2034

Source: MIT-licensed cheaper-inference/OmniRoute PR #21441, head 7ec5270551bdda0c0a692c7aea9b9ee0fd0ccc77; the source diff is available at the PR link. Its live checks are claims, not evidence. No registration is made by this staging file.

## Registration handoff (register-native-19)

Place ttoken.js in open-sse/providers/registry/ and run pnpm run gen:registry-index and pnpm run gen:agent-index. Registry is a default export; open-sse/providers/index.js builds PROVIDERS, PROVIDER_MODELS and PROVIDER_MEDIA, and src/shared/constants/providers.js derives AI_PROVIDERS. Confirm ordering preserves existing providers' bare model precedence, and add independent positive tests after registration. No executor or native messages/responses transport should be registered. Check validateUrl actually drives API-key validation before claiming support. Key-scoped model discovery requires an authenticated, no-store, redirect-safe request, preserving 401, 403, 429 and 5xx distinctions. Public catalog/seed is not key verification. Wrong-product 403 must not be classified as exhausted quota.

The generic fetchRegistryFetcherModels currently passes neither cache: no-store nor redirect: manual and uses only its own timeout, not the caller's signal. It requires remediation or an existing safe route before registration; do not assume this staged definition satisfies the security contract. Verify separate keys cannot share cached lists. Inspect validation separately.

The upstream seed has ttoken/auto literally. Do not infer whether that upstream string is a router-prefixed identifier. First-slash parsing must preserve ttoken/ttoken/auto as provider ttoken plus model ttoken/auto. Preserve vendor prefixes and passthrough; verify bare-ID precedence against the existing catalog.

User docs after registration: explain Gateway-product key, fixed chat lane, supported client translation, key-scoped discovery and its errors, vendor-prefixed IDs, literal auto example with qualification, and offline seed versus authenticated list. Do not claim free tier, fixed prices, gated models, or account verification from public catalog.

Outstanding verification: focused isolated contracts must exercise real executor/translation/discovery with mocked transports, OpenAI and Anthropic requests and streaming, tools and image blocks, usage, two keys, 401/403/429/5xx, cancellation, redirect handling, and ID precedence. No test results are claimed here.
