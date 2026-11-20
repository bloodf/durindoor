# 1073: Existing provider request residuals

Compared on 2026-11-20. Open-source qualification below reflects the GitHub state at inspection; all three open PRs were non-draft, mergeable, clean, with no failing or pending checks. The two merged PRs qualify by merged state.

- [OmniRoute #15566](https://github.com/cheaper-inference/OmniRoute/pull/15566), merged, head `5ad99cb631406aaad1621a53d9f091809089ac26`: already addressed by a different contract. `open-sse/translator/concerns/thinkingSuffix.js` strips only parenthesized controls, not hyphenated tiers; `open-sse/config/providerModels.js` retains literal catalog upstream IDs, and `open-sse/providers/registry/antigravity.js` explicitly maps the tiered IDs. `tests/unit/antigravity-model-catalog.test.js` passes. No new catalog synthesis is needed.
- [OmniRoute #15543](https://github.com/cheaper-inference/OmniRoute/pull/15543), merged, head `efd217ad472e85c68bfc4c86f9bf73a118684529`: inapplicable endpoint contract. Upstream targets `/provider/v1/messages`; this fork's existing `open-sse/executors/commandcode.js` and `open-sse/providers/registry/commandcode.js` use `/alpha/generate` and its native format. Adding the upstream endpoint is outside this work order. `tests/unit/commandcode-executor.test.js` passes for the existing contract.
- [OmniRoute #19666](https://github.com/cheaper-inference/OmniRoute/pull/19666), open, head `8d19909af0dc529f2e7411d74bc6ef8ff18c569e`: request identity ported. `open-sse/shared/kiroHeaders.js` already derives a stable hashed identity, and `open-sse/executors/kiro.js` now identifies the inference API as `codewhispererstreaming` while retaining the current version and endpoints. Catalog and validation keep their runtime identity. No sign-in, refresh, credential extraction or host migration was ported. `tests/unit/kiro-client-identity.test.js`, `kiro-models-api-key.test.js`, and `kiro-session-affinity.test.js` pass.
- [OmniRoute #20590](https://github.com/cheaper-inference/OmniRoute/pull/20590), open, head `9396d4e3c7a8e988555ebb50c4e2dc1a73e00f8f`: the proactive clamp already exists in `open-sse/executors/default.js`. The upstream learned-capability framework does not exist here; `open-sse/executors/base.js` instead retries once on the specific Cohere 422 suggestion when a non-high effort reached the wire, under the transport-attempt ceiling described below. This does not create persistent learned caps. `tests/unit/cohere-422-recovery.test.js` exercises mocked success and unrelated errors; `cohere-reasoning-effort-port.test.js` verifies the existing clamp.
- [OmniRoute #20482](https://github.com/cheaper-inference/OmniRoute/pull/20482), open, head `095a37cfb9c16598ccfa265821c93abfb3a15f5e`: Bun-specific transport is inapplicable to this fork's supported Node runtime (`package.json` requires Node 24). The fork uses guarded Undici dispatchers in `open-sse/utils/outboundUrlGuard.js` and `open-sse/utils/proxyFetch.js`; `tests/unit/outbound-url-guard-dns-pinning.test.js` exercises the Node guard. No Bun shim or dependency change was introduced.

## Cohere 422 recovery: transport budget and original status

`open-sse/executors/base.js` retries a Cohere 422 once when the provider names its
supported `reasoning_effort` tier in the error body. Two contracts are enforced
at that seam:

- **Transport attempt budget.** The recovery re-dispatches on the SAME base URL,
  so it is a transport attempt like any other and spends the same per-URL budget
  as the generic in-place retry path. `requestPolicy.maxTransportAttempts`
  counts the first try, so a URL may carry at most `maxTransportAttempts - 1`
  additional dispatches. The ceiling is enforced BEFORE the recovery: with a
  one-attempt ceiling the original 422 is returned unchanged and nothing is
  re-dispatched; with room left, the one-time recovery still runs. Without a
  `requestPolicy` there is no ceiling and the implicit pre-port behavior is
  unchanged (the recovery still runs exactly once, and the generic retry
  counters keep their previous values).
- **Optional probe.** The error body is read from a clone and only to match the
  provider's suggestion. A body that cannot be read (stream error, disturbed
  body, oversized payload) is a NON-MATCH: the original response and its status
  are preserved, and the read failure never surfaces as a transport error that
  would discard the upstream 422. A caller abort during the probe still
  propagates, because a cancelled request must not be downgraded into a
  successful-looking response.

Unchanged by this repair: the generic retry policy (which statuses retry and how
many attempts each gets), cancellation, connect-timeout classification, the
rate-limit and base-URL cooldown path, and the 400 field-strip seam. The 400
field-strip probe now shares the optional-probe contract above; it keeps its own
dispatch behavior and stays outside the Cohere recovery budget.

Focused offline tests use mocked provider routes; the full suite is reserved for
the integration gate.

- `tests/unit/cohere-422-transport-budget.test.js` — budget ceiling, budget
  remaining, implicit behavior, shared budget, probe failure, abort, timeout,
  and the 429 base-URL failover.
- `tests/unit/cohere-422-recovery.test.js` — mocked success and unrelated errors.
- `tests/unit/base-executor-retry.test.js` — generic retry, fallback, and
  cancellation behavior.

