# #1073 November: existing quota cooldown parsing

## Pins and method

Offline comparison used the pinned OmniRoute Git objects and current DurinDoor source and unit fixtures. The PR pages identify these heads:

| PR | Exact head | Enclosing merge | Compared patch |
|---|---|---|---|
| [OmniRoute #18770](https://github.com/cheaper-inference/OmniRoute/pull/18770) | `29b9a4fd87ca59b563ce9244bf1c43a7cef74ad3` | `41843d89b44233b177d0c151febbc327caff5b55` | The merge's credit-exhaustion change only; the enclosing release merge contains unrelated changes. [Pinned merge patch](https://github.com/cheaper-inference/OmniRoute/commit/41843d89b44233b177d0c151febbc327caff5b55) |
| [OmniRoute #19022](https://github.com/cheaper-inference/OmniRoute/pull/19022) | `a5a56dcde49e1ecdb046e4a50062fee5299083f5` | `afe94b6d4dfa4a2bb50c0b9f2821cd76a8b84e44` | Head commit patch: `accountFallback.ts` and the capped Retry-After fixture. [Pinned head patch](https://github.com/cheaper-inference/OmniRoute/commit/a5a56dcde49e1ecdb046e4a50062fee5299083f5) |
| [OmniRoute #20292](https://github.com/cheaper-inference/OmniRoute/pull/20292) | `42e9fdd4fc9c09a0cc476e323c8f6e9dc0d743e5` | `fbd339668384803bc3a9d42370fc413a55e013d5` | Head commit patch: reset parsing/provenance and its focused fixture. [Pinned head patch](https://github.com/cheaper-inference/OmniRoute/commit/42e9fdd4fc9c09a0cc476e323c8f6e9dc0d743e5) |

Scope is existing credit/quota classification, Retry-After deadlines, and cooldowns. Account setup/sign-in and newly proposed quota-sharing controls are excluded. This is a source and fixture comparison; no live provider, API, browser, Docker, or end-to-end execution was used.

## Current local behavior and fixture evidence

DurinDoor's [`checkFallbackError`](../../../open-sse/services/accountFallback.js) checks provider rules and explicit `parseRateLimitEvidence` before generic error backoff. An exhausted 429 with a known reset cools for the parsed deadline, capped by `MAX_RATE_LIMIT_COOLDOWN_MS` (7 days); resetless exhaustion retains its exhausted evidence and short fallback cooldown. An ordinary transient 429 without exhausted evidence follows exponential backoff. Existing [`apikey-429-quota-exhausted.test.js`](../../../tests/unit/apikey-429-quota-exhausted.test.js) freezes time and covers a 3-day reset, resetless exhaustion, ordinary transient and bare 429s, a 14-day reset capped at the configured maximum, and an absurd Retry-After treated as resetless by policy. Its later cases check durable evidence propagation through `markAccountUnavailable`.

For terminal credit errors, [`account-fallback-request-scoped-4xx.test.js`](../../../tests/unit/account-fallback-request-scoped-4xx.test.js) covers credit exhaustion on 400/402, verifies terminal cooldown behavior, and protects ordinary request-scoped 400 handling. [`kiro-credit-cooldown-2664.test.js`](../../../tests/unit/kiro-credit-cooldown-2664.test.js) covers provider-specific credit cooldown caps. The local contract deliberately preserves billing and account authorization behavior.

The cited local fixture inventory contains no positive fixture for the exact `credit_balance_exhausted` code, no TPD-specific Retry-After cap case, and no focused malformed-ISO/prose-precedence regression case. The first two public patches therefore do not demonstrate an ordinary local acceptance gap: corresponding generic credit and quota cap behavior is already present, but the precise public edge inputs are not directly locked by fixtures. The third patch highlights parser behavior that is not established by the inspected local focused fixtures; do not infer a gap in runtime behavior solely from missing fixture coverage.

## Dispositions

### #18770 — explicit `credit_balance_exhausted`

**Disposition: no port.** The exact public change adds `credit_balance_exhausted` as a recognized explicit credit-exhaustion signal and tests terminal classification. Local source already routes terminal billing/credit rules through account fallback, and existing fixtures establish the terminal cooldown semantics and protect request-scoped errors. The named code is not in the inspected local fixture set, but that alone does not establish a behavior gap requiring a new matcher. Keep admission, billing, and authorization rules unchanged.

### #19022 — cap TPD Retry-After

**Disposition: no port.** The exact patch clamps a TPD quota's `retry-after`-derived cooldown to OmniRoute's 30-day provider cap and adds normal/100-year header fixtures. DurinDoor's explicit quota evidence path caps reset-derived cooldown at its existing seven-day `MAX_RATE_LIMIT_COOLDOWN_MS`; its fixture already checks absurd Retry-After rejection and an ordinary long quota reset cap. A new 30-day cap is not applicable to the local configured policy. Do not widen the local cap or change its exhaustion classification.

### #20292 — validate ISO reset date and retain selected-hint provenance

**Disposition: no port; ordinary offline acceptance would be appropriate only if a local parser gap is independently demonstrated.** The public patch rejects impossible calendar dates before treating an ISO timestamp as a reset and prevents an unrelated ISO timestamp from relabeling a selected relative weekly countdown as uncapped ISO provenance. The inspected local path uses `parseRateLimitEvidence` in `open-sse/utils/error.js`, with the existing seven-day cap, and fixture coverage establishes quota deadline and cap behavior. There is no focused local fixture for the public malformed-date and mixed-hint inputs, so current available evidence is insufficient to claim either behavior is absent or to justify a code change. If further offline source/fixture inspection demonstrates a narrow gap, accept it with an ordinary unit fixture covering impossible dates and selected-hint precedence while preserving existing admission, billing, and account authorization behavior.

## Result

No demonstrated narrow code gap from these exact patches. The public cases are recorded against the current local policy and available fixtures; no product code or tests were changed.
