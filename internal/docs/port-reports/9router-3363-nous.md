# 9router #3363: Nous Research, staged

Source: [decolua/9router #3363](https://github.com/decolua/9router/pull/3363), exact head `b08f006324ebc5e355a871fb46f8f5bd34f1acce` (parent `699edac3273e13d4744bc46f6082618f08560702`).

Status: staged and not registered. Auth #2034 cleared a Nous-only implementation. Public promotion belongs to auth register-auth-06. **Nothing has been validated against the real provider.** Every contract below comes from the pinned source and is tested only against offline mocks.

## Canonical provider ID

The source registers `id: "nous"` with aliases `nous-portal` and `nous-research`. DurinDoor already registers Nous Research:

- `open-sse/providers/registry/nous-research.js` declares `id: "nous-research"`, `alias: "nous"`, category `apikey`, the same endpoint `https://inference-api.nousresearch.com/v1/chat/completions`, and models `Hermes-4-405B` and `Hermes-4-70B`. It was added by `port(omniroute)` #980.
- `open-sse/executors/default.js` (`applyNousAttribution`) tags `nous-research` requests. This came from the upstream #5707 port.

The source identity is the inverse of the registered one, so it would collide with both the ID and the alias. The canonical ID stays **`nous-research`** and the alias stays `nous`. This lane does not add a second provider, a shadow alias or `registry/nous.js`. Existing connections (`provider: "nous-research"`) and `nous/<model>` routes are unchanged.

## What is staged

| Path | Role |
| --- | --- |
| `open-sse/providers/staging/nous.json` | Data-only metadata: source pin, registered identity, endpoints, seed models, capability rows and verification status. It is JSON, so the unreachable-module inventory (`tests/unit/executor-staging-manifest.test.js`) is unaffected. |
| `open-sse/services/nous.js` | Runtime contracts: catalogue fetch and parsing, local key checks, thinking and request shaping, and `NousExecutor`. No production module imports it. |
| `internal/docs/port-reports/9router-3363-nous-registration-manifest.json` | Contracts and registration requirements for the promotion change. |
| `tests/unit/port9r-3363-nous-provider.test.js` | Offline boundary tests. |

This lane leaves the registry, the registry index, `AGENT-INDEX.md`, `executors/staged.json`, `STAGED_PROVIDERS`, the shared capability and thinking tables, the models, test and validate routes, OpenRouter discovery, OAuth, the dashboard, the website, the CLI and the test baselines untouched. No generated index needed regenerating.

## Contracts

- **Chat request.** `POST https://inference-api.nousresearch.com/v1/chat/completions` with an OpenAI body. `NousExecutor` extends `DefaultExecutor("nous-research")`, so the registry endpoint, auth header, attribution tags, proxy routing and redirect refusal for credentialed sends stay as they are. It pins the endpoint: a connection `baseUrl` is ignored, and `execute` drops any `runtimeTransport` override (base URL, suffix, headers, auth or format) before the inherited execution path, without modifying the caller's object. The key only goes to the fixed Nous URL, and OpenAI wire handling such as tool-error normalization always applies. It also adds the Nous body shaping and refuses to send without a well-formed API key. It is not in the executor map.
- **Model IDs.** One leading `nous/` and any `(level)` suffix are removed before sending. Live catalogue IDs are routed as `nous/<upstream id>`, with `upstreamModelId` kept.
- **Thinking.** Only the Hermes 4 rows (`nousresearch/hermes-4-70b`, `-405b`; tools false, 131072 context, 32000 output) can reason.
  - When enabled, the body gets `reasoning: { enabled: true, effort }` with effort low, medium or high. Minimal becomes low; xhigh, max and ultra become high; auto, adaptive and unknown levels become medium; a budget goes through `budgetToLevel` and is then clamped.
  - When disabled, `reasoning` is omitted.
  - `reasoning_effort`, `thinking`, `enable_thinking`, `thinking_budget` and `think` are always removed.
  - Models that cannot reason never receive a reasoning field.
  - Intent comes from the existing `captureThinking` and `parseSuffix`. `translateToNousRequest` captures it before running the shared translator.
- **Catalogue.** An unauthenticated `GET https://inference-api.nousresearch.com/v1/models` (the endpoint is public), with `redirect: "error"`, a 10 s timeout and a 4 MiB bounded read. It goes through the selected connection's proxy route.
  - Parsing accepts the `data`, `models` and `results` shapes or a bare array. It drops non-object, ID-less, duplicate and non-text entries. `nousresearch/` models sort first.
  - HTTP errors and malformed JSON raise `NousCatalogError`.
  - The free filter keeps models with an explicit zero prompt and completion price (the number 0 or a decimal zero string), text output and at least 200K context. Null, blank, boolean, array, object and other malformed prices fail closed.
- **Usage.** The source has no usage or quota endpoint. The OpenAI `usage` object is passed through unchanged.

## Key verification

The source proves a key with a one-token chat completion. That is inference, so it is not ported. Nous serves `/models` without authentication and documents no read-only authenticated endpoint. Verification is therefore unsupported:

- A key is checked locally only: a string, trimmed, 1 to 4096 visible ASCII characters, no whitespace.
- A well-formed key returns `saved-unverified`. The network is never contacted.
- `saveNousConnection` calls `persist` only for a well-formed key, with `testStatus: "unknown"`.

## Tests

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/port9r-3363-nous-provider.test.js --maxWorkers=2
```

The tests run offline. They cover:

- the staged JSON against the service constants and the registered entry
- that the registry has exactly one Nous entry and `nous-portal` is absent
- shared capabilities left unchanged
- catalogue parsing with malformed payloads, HTTP errors, the exact URL and method, no `Authorization` header, and redirect refusal
- per-connection proxy isolation for the catalogue and the executor
- invalid keys never persisted, and no network calls during verification
- thinking and non-thinking bodies
- Claude, OpenAI and Responses translation
- the exact executor endpoint, headers and body
- the fixed host, no credential following a redirect, and refusal without a key

The staging inventory tests (`executor-staging-manifest`, `provider-staging-ownership`, `arch-a2311`) and the neighbouring Nous and redirect suites (`nous-attribution`, `tier-a-apikey-providers`, `review-x-redirect-default`) pass unchanged. The tested head is the commit that adds this report. Its exact SHA is given in the unit handoff.
