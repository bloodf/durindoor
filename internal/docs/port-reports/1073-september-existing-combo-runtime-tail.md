# #1073 September existing combo runtime tail

## Scope and comparison method

Reviewed the four named OmniRoute commit heads and their enclosing merge commits where the merge also carried the relevant implementation. For #14949, the PR head is a changelog-fragment rename; the runtime patch is the combo-scoped diff in enclosing merge `dbd62ec5f43ef2574bd22ed93a415b3f4d9d2271`. The other heads contain their implementation changes directly. Public references are pinned to those immutable commits.

The local implementation is in `open-sse/services/combo.js` and supporting JS modules, rather than the newer TypeScript module layout in these patches. The offline tests under `tests/unit/` exercise this implementation. No change to combo selection policy, configured access checks, or provider error behavior is warranted by this review.

## Current local behavior and evidence

- Existing combo round-robin is sticky per combo and advances according to its configured limit. `tests/unit/combo-routing.test.js` covers default and sticky rotation, and `tests/unit/combo-rr-fallback-advance.test.js` verifies that a fallback winner advances the same sticky counter. `tests/unit/combo-access-control.test.js` protects member access boundaries. These behaviors should remain intact.
- Existing fallback tests exercise provider failures, quota-shaped responses, retry-after handling, empty streams, and upstream errors, including `tests/unit/combo-patches.test.js`, `tests/unit/combo-retry-after-port.test.js`, `tests/unit/combo-empty-stream-3463.test.js`, and `tests/unit/combo-upstream-200-error.test.js`.
- In this source tree, `rg` found no combo LKGP persistence helper, persisted-skip bypass metric, or response-quality validator equivalent to the three source-only runtime changes below. Current coverage therefore demonstrates the existing round-robin and failure paths, but does not demonstrate equivalent LKGP warning context, per-combo persisted-skip metrics, or reasoning-ratio completion policy.
- Circuit breaker primitives have standalone coverage in `tests/unit/connection-circuit-state.test.js`. Combo tests cover retry-after/fallback behavior, but the reviewed local combo source and fixtures do not establish OmniRoute's all-targets-open diagnostic (`all_targets_cooling_down`, per-target breaker reasons and probe delay). This is a narrow operator-response difference, not a reason to change selection or bypass access/provider gates.

## PR dispositions

### OmniRoute #14934 — retain as source-only observability

Head [`b827668dcdbe84985c8a12e02777911df8932fd5`](https://github.com/cheaper-inference/OmniRoute/commit/b827668dcdbe84985c8a12e02777911df8932fd5), enclosing merge [`3db38364e00a2218d0b2db36cd3905e49f2405b0`](https://github.com/cheaper-inference/OmniRoute/commit/3db38364e00a2218d0b2db36cd3905e49f2405b0). The patch extracts non-blocking LKGP writes into `recordLkgpPin`, keeps both execution-key and combo-level writes, and logs combo/provider/connection context if persistence fails. It does not alter the successful target, fallback order, or pin recovery decision. No equivalent LKGP write path exists in the current local combo implementation, so this observability-only extraction has no narrow port target. **Disposition: defer; no local change.** If LKGP persistence is introduced in a separate approved behavior task, ordinary offline coverage should prove both keys are written, a failed write resolves without blocking routing, and the warning carries combo and execution-key context.

### OmniRoute #14949 — narrow diagnostic gap in enclosing merge

PR head [`7ba409d818f4aa12c3aaaa57fdfd7caac4fbe1a3`](https://github.com/cheaper-inference/OmniRoute/commit/7ba409d818f4aa12c3aaaa57fdfd7caac4fbe1a3) only renames the changelog fragment. The runtime change is in merge [`dbd62ec5f43ef2574bd22ed93a415b3f4d9d2271`](https://github.com/cheaper-inference/OmniRoute/commit/dbd62ec5f43ef2574bd22ed93a415b3f4d9d2271): when every combo target is skipped by an OPEN provider/connection circuit breaker, return a breaker-specific 503 with affected targets, `Retry-After`, and a `wait` recovery action; mixed exclusion causes keep the generic skipped-target response. It does not dispatch around the breaker or relax account/member access. The local standalone circuit-breaker fixture does not establish that combo terminal response. **Disposition: defer the changelog-only head; accept the narrow all-targets-open response gap for a future isolated port.** Ordinary offline acceptance should use synthetic local breaker state, assert zero provider calls and the breaker-specific status/body/headers when all targets are open, and assert existing generic behavior for a mixed pool. Preserve current ordering, access checks, and provider failure classification.

### OmniRoute #15004 — source-only metrics correction

Head [`001499add1b5938c99d929fc1da74cc2c2bff188`](https://github.com/cheaper-inference/OmniRoute/commit/001499add1b5938c99d929fc1da74cc2c2bff188), enclosing merge [`d2e8e46ad4a1b705c8d43268c793fc0757215e08`](https://github.com/cheaper-inference/OmniRoute/commit/d2e8e46ad4a1b705c8d43268c793fc0757215e08). This scopes persisted-cooldown bypass counts to combo names and clears them on per-combo reset/TTL eviction. It corrects metrics attribution, not attempt eligibility or ordering. There is no equivalent persisted-skip counter in the local source tree. **Disposition: source-only; no local change.** If that metric is added independently, ordinary offline acceptance should increment two synthetic combos, verify isolated views, and cover per-combo/global reset and cleanup without changing gate outcomes.

### OmniRoute #15020 — source-only response-quality policy

Head [`88e159900bda69db2f70b435b6f90d8afa195123`](https://github.com/cheaper-inference/OmniRoute/commit/88e159900bda69db2f70b435b6f90d8afa195123), enclosing merge [`81c9b6da9114b59d76483e608a55bec6ba443123`](https://github.com/cheaper-inference/OmniRoute/commit/81c9b6da9114b59d76483e608a55bec6ba443123). The patch trusts `finish_reason: stop` over the 90% reasoning-token heuristic when visible content is empty, while retaining the heuristic if the provider supplies no finish reason. This changes response-quality classification and potentially whether a combo retries another target. The current local combo source has no matching quality validator or reasoning-ratio retry path; its offline tests cover empty streams and token-limit terminal handling instead. **Disposition: source-only and not ported; no inferred quality policy added.** If a quality validator is later introduced, ordinary offline acceptance should cover clean stop with high reasoning ratio, missing finish reason with high ratio, and truncation/length signals, with expected retry behavior asserted explicitly.

## Summary

Only #14949 demonstrates a narrow local runtime gap: clearer terminal diagnostics when every combo candidate is blocked by an open circuit breaker. The other three heads concern source-only persistence instrumentation, source-only metrics, or a quality policy absent from this tree. No code or tests are changed by this report.
