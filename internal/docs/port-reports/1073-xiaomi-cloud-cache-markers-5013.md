# #1073 Preserve cache markers on the existing Xiaomi cloud bridge (OmniRoute #5013)

## Source comparison

Inspected OmniRoute PR [#5013](https://github.com/cheaper-inference/OmniRoute/pull/5013) at exact head [`b1258aef07d6184718a153fb36cc00e8ea2d38ed`](https://github.com/cheaper-inference/OmniRoute/commit/b1258aef07d6184718a153fb36cc00e8ea2d38ed) and enclosing merge [`c5c8db77dad51e1c756a4c8baa78c84ed68fbec6`](https://github.com/cheaper-inference/OmniRoute/commit/c5c8db77dad51e1c756a4c8baa78c84ed68fbec6) (patch base [`ac8bd72e917ce5a20ab1b997b3bb083c49b937ac`](https://github.com/cheaper-inference/OmniRoute/commit/ac8bd72e917ce5a20ab1b997b3bb083c49b937ac)), together with [1073-existing-xiaomi-explicit-cache-wire.md](1073-existing-xiaomi-explicit-cache-wire.md).

Upstream PR `#5013` retains caller-supplied explicit `cache_control` breakpoints during Claude-to-OpenAI translation and final OpenAI filtering only for providers in `OPENAI_FORMAT_CACHE_CONTROL_PROVIDERS` (`alibaba`, `alibaba-cn`, `xiaomi-mimo`), while excluding implicit prefix-cache providers (`openai`, `codex`, `azure`) and non-caching providers (`groq`). Locally, DashScope providers (`alicode`, `alicode-intl`, `alibaba`, `alitp-intl`) already opt in via `quirks.preserveCacheControl`, while `xiaomi-mimo` lacked an opt-in on its cloud OpenAI bridge.

## Route qualification and implementation boundary

Unlike OmniRoute's provider-wide allowlist check on `xiaomi-mimo`, DurinDoor's [Xiaomi MiMo executor](../../../open-sse/executors/xiaomi-mimo.js) serves two distinct endpoints:

- **Cloud OpenAI transport (`https://api.xiaomimimo.com/v1/chat/completions`)**: carries API-key (`sk-...`) connections and non-account models.
- **Desktop account-service route (`https://mimo-server-<region>.xiaomimimo.com/api/route/chat/completions`)**: handles v2.6 models (`mimo-v2.6-pro`, `mimo-v2.6-flash`, `mimo-v2.6-pro-ultraspeed`) when `providerSpecificData.mimoPassToken` resolves a session cookie in `XiaomiMimoExecutor.execute()`. Neither upstream `#5013` nor local fixtures establish explicit `cache_control` support on the account-service endpoint.

To avoid opting the account-service path into an unproven wire feature:

1. **Transport-scoped registry quirk** in [xiaomi-mimo.js](../../../open-sse/providers/registry/xiaomi-mimo.js): added `quirks: { preserveCacheControl: true }` only on the `format: "openai"` entry of `transports[]`, leaving top-level `transport` and the `claude` transport unchanged. Because `open-sse/providers/index.js` keeps `PROVIDERS["xiaomi-mimo"].quirks` empty, `xiaomi-mimo` does not advertise a provider-wide quirk.
2. **Request-local cloud route gate** in [index.js](../../../open-sse/translator/index.js): `shouldPreserveOpenAICacheControl` preserves `cache_control` for `targetFormat === FORMATS.OPENAI` when either the provider declares `quirks.preserveCacheControl: true` (preserving DashScope) or its `openai` transport declares `quirks.preserveCacheControl: true`. For `xiaomi-mimo`, `isDefiniteXiaomiCloudOpenAIRoute` requires request-local proof that the request stays on the cloud OpenAI API (`sk-` key or attached cloud `runtimeTransport` without session ambiguity):
   - Any v2.6 account model carrying `__mimoAccountCookie` or `providerSpecificData.mimoPassToken` (whose final route is not decided until `XiaomiMimoExecutor.execute()` runs the cookie handshake) returns `false` and keeps prior marker-stripping behavior.
   - Session-only OAuth credentials without an `sk-` key, Claude transports, and empty/`null` credentials also return `false`.
   - No auth/session lookup, extra provider request, or credential access was added to translation.
3. **Unchanged boundaries**: Xiaomi native Messages (`FORMATS.CLAUDE -> FORMATS.CLAUDE`) bypasses OpenAI conversion; unmarked blocks collapse normally without inventing metadata; implicit-cache providers (`openai`, `codex`, `azure`), `groq`, other Xiaomi variants (`xiaomi-tokenplan`, `xiaomi-mimo-token-plan`, `mimo-free`, `mimocode`), and DashScope (`alicode`, `alicode-intl`, `alibaba`, `alitp-intl`) remain unchanged.

## Verification

Added [omni-xiaomi-cloud-cache-markers.test.js](../../../tests/unit/omni-xiaomi-cloud-cache-markers.test.js) exercising `resolveRequestTransport`, `translateRequest`, and `XiaomiMimoExecutor.execute` against mocked `mimoAccount` and `proxyAwareFetch` boundaries with synthetic fixtures.

Evidence command:

```sh
test -s internal/docs/port-reports/1073-xiaomi-cloud-cache-markers-5013.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-xiaomi-cloud-cache-markers.test.js unit/dashscope-claude-cache.test.js unit/alicode-cache-control-2069.test.js unit/xiaomi-mimo-executor.test.js)
```
