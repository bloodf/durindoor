# #1073: Historical Codex executor controls

## Scope and pins

This comparison covers the three requested public patches and current local Codex executor behavior. For #246 and #257, the merge commits contain unrelated changes, so the comparison uses the PR head against its first parent (the PR base), not the entire merge diff. #457 is a non-merge commit; its first parent is the patch base.

| PR | Exact patch | Base | Enclosing merge / patch commit |
|---|---|---|---|
| [OmniRoute #246](https://github.com/cheaper-inference/OmniRoute/pull/246) | [`1c2f553a7c43737fac8689b4df3b443217593e43`](https://github.com/cheaper-inference/OmniRoute/commit/1c2f553a7c43737fac8689b4df3b443217593e43) | [`049ddff6fee19e0656dd5651276569fd8725f490`](https://github.com/cheaper-inference/OmniRoute/commit/049ddff6fee19e0656dd5651276569fd8725f490) | [`8e4873d53ef3c8eea28f65a26d07b8e74e9d4683`](https://github.com/cheaper-inference/OmniRoute/commit/8e4873d53ef3c8eea28f65a26d07b8e74e9d4683) |
| [OmniRoute #257](https://github.com/cheaper-inference/OmniRoute/pull/257) | [`59a8b8db358c05d5bf2c929ff0e27dd213dd9f2e`](https://github.com/cheaper-inference/OmniRoute/commit/59a8b8db358c05d5bf2c929ff0e27dd213dd9f2e) | [`2ba46a622b4fca78a585c8693636603b91f96bf1`](https://github.com/cheaper-inference/OmniRoute/commit/2ba46a622b4fca78a585c8693636603b91f96bf1) | [`2348680a2b641d5e960b35d13645cdf2868b053b`](https://github.com/cheaper-inference/OmniRoute/commit/2348680a2b641d5e960b35d13645cdf2868b053b) |
| [OmniRoute #457](https://github.com/cheaper-inference/OmniRoute/pull/457) | [`5d9e1aeff6757ac4d066ac835d4c8c75965e1b20`](https://github.com/cheaper-inference/OmniRoute/commit/5d9e1aeff6757ac4d066ac835d4c8c75965e1b20) | [`1b68deb0f6bc6a62aa420ff127c0d5303a263b0a`](https://github.com/cheaper-inference/OmniRoute/commit/1b68deb0f6bc6a62aa420ff127c0d5303a263b0a) | [`8420e565d4943277b2f3dafa3c931b3e1196cc89`](https://github.com/cheaper-inference/OmniRoute/commit/8420e565d4943277b2f3dafa3c931b3e1196cc89), supplied as the enclosing commit pin; the inspected object has one parent and is the patch commit. |

## Current behavior and fixture evidence

- **Reasoning selection and wire shaping:** `open-sse/executors/codex.js` splits recognized model effort suffixes, then resolves explicit `reasoning.effort` before legacy `reasoning_effort`, model suffix, and default. Semantic effort conversion is model-aware through `resolveOpenAiEffort`; Codex wire aliases are applied afterward. Explicit reasoning remains authoritative. `tests/unit/codex-fast-capacity.test.js` covers nested and legacy effort normalization, suffix stripping, defaults, and model-specific aliases. The fixture matrix also proves explicit values survive where applicable.
- **Compact controls:** request context marks compact requests; executor routing targets `/responses/compact`. Compact shaping removes streaming, storage, context-management, include, and other unsupported fields while retaining supported request fields. `tests/unit/codex-compact-chatcore.test.js`, `tests/unit/codex-executor.test.js`, and `tests/unit/codex-compact-route.test.js` provide offline evidence for context propagation, retry stability, compact URL/body behavior, and route handling.
- **Response/control behavior:** regular Codex Responses requests remain SSE-oriented; compact requests use the unary compact contract. Existing local tests exercise the compact request and response route. The reviewed local executor path only derives the Codex endpoint plus the compact suffix; no fixture or executor routing was found for arbitrary Responses subpaths such as `/responses/items/history`.

## Per-PR disposition

### #246 — Reasoning-effort clamp: already covered semantically; do not port the historical clamp

The patch adds a fixed model cap table and clamps values after selecting reasoning. Current local code instead resolves effort against the current model capability matrix. The old table is incomplete for the current model set and its enum omits current semantic levels such as `minimal`, `max`, and `ultra`. Reintroducing that cap risks changing explicit reasoning decisions and conflicts with the established precedence/model-aware resolver. Existing offline fixtures establish current suffix, legacy, explicit, and model-aware behavior. **Disposition: no change.**

### #257 — Codex token refresh: out of requested scope

The Codex-only refresh override is authentication/credential refresh behavior. Authentication and sign-in work is expressly excluded from this comparison. Current code uses the shared OAuth credential manager; no conclusion about parity or a port is made here. **Disposition: exclude from this request; no change.**

### #457 — Responses subpath passthrough: narrow demonstrated gap

The patch routes arbitrary request paths below `/responses` and adjusts stream handling for `/responses/compact`. Current local fixtures prove compact endpoint support, and current shaping handles compact's non-streaming fields; they do not prove arbitrary subpath forwarding. The historical added behavior for `/responses/items/history` is therefore a narrow, separately testable gap if that endpoint is in scope. **Disposition: do not port as part of this report-only task; record as a candidate follow-up.**

Ordinary offline acceptance for a follow-up should use a mocked executor/fetch and fixture requests only: verify `/v1/responses/items/history` reaches the matching upstream `/responses/items/history` path, the body and response control flow are preserved for that route, and compact remains unary with no `stream` or `stream_options`. Include a plain `/v1/responses` control case and assert no provider request occurs. No live provider traffic is needed.
