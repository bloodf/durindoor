# #1073 Late June existing usage classification

## Scope and pins

Compared the public PR patches at their exact head commits with current DurinDoor source and ordinary offline fixtures. The enclosing merge pins are included to identify the integrated upstream changes; conclusions below follow the PR head patch or the specific upstream behavior named in the merge when the merge adds implementation beyond that head.

| PR | Exact head | Enclosing merge | Patch and local comparison |
| --- | --- | --- | --- |
| [OmniRoute #4435](https://github.com/cheaper-inference/OmniRoute/pull/4435) | [`3a9e801c7ca2a80582c26e0bc1387cf55b2750c0`](https://github.com/cheaper-inference/OmniRoute/commit/3a9e801c7ca2a80582c26e0bc1387cf55b2750c0) | [`c3fd2b9aa1f220c6a32eaecae8bea5dc49ba89b5`](https://github.com/cheaper-inference/OmniRoute/commit/c3fd2b9aa1f220c6a32eaecae8bea5dc49ba89b5) | Head adds `kimi-coding-apikey` to dashboard and auto-fetch source-of-truth lists and tests the API-key vs OAuth headers. The enclosing merge also contains the Kimi API-key usage switch/header implementation. Local `open-sse/services/usage.js` already dispatches both Kimi Coding variants through the quota handler; `tests/unit/kimi-usage.test.js` checks API-key weekly quota, `x-api-key`, OAuth Bearer/device headers, and credential precedence. |
| [OmniRoute #4754](https://github.com/cheaper-inference/OmniRoute/pull/4754) | [`5e4edf1dd5592e73ce0cb322a64ea724dae8597a`](https://github.com/cheaper-inference/OmniRoute/commit/5e4edf1dd5592e73ce0cb322a64ea724dae8597a) | [`dbca0e0df0bdf255aefef34b6effeaf0f4a05d08`](https://github.com/cheaper-inference/OmniRoute/commit/dbca0e0df0bdf255aefef34b6effeaf0f4a05d08) | Adds extraction of Ollama's final raw NDJSON `done: true` counters (`prompt_eval_count` / `eval_count`) and ignores non-final chunks. Local `extractUsage` in `open-sse/utils/usageTracking.js` already extracts those counters and additionally exposes bounded `prompt_eval_cached_count` as cache detail. `tests/unit/ollama-cached-tokens.test.js` covers ordinary extraction, cache inclusion, and invalid/out-of-range cache values; `tests/unit/usage-concern.test.js` covers normalized Ollama counters and cache detail. |
| [OmniRoute #4785](https://github.com/cheaper-inference/OmniRoute/pull/4785) | [`f193877a1cd1d76e77c7a2f9c1792b2831fefd88`](https://github.com/cheaper-inference/OmniRoute/commit/f193877a1cd1d76e77c7a2f9c1792b2831fefd88) | [`27133a7ac620f8c2ee52eb0c50b69ee65ff06ae3`](https://github.com/cheaper-inference/OmniRoute/commit/27133a7ac620f8c2ee52eb0c50b69ee65ff06ae3) | Adds the `response.usageMetadata` fallback for Antigravity stream chunks. Local `extractUsage` already selects top-level `usageMetadata` or the wrapped `response.usageMetadata`, preserving prompt, candidate, total, cached and reasoning counters. `tests/unit/request-detail-usage.test.js` fixtures the wrapped envelope and checks all corresponding output counters; `tests/unit/chat-usage-total-reconcile.test.js` checks Gemini counters through `extractUsage` and accounting reconciliation. |

## Current behavior and accounting boundary

The three compared behaviors are gateway usage extraction, provider quota display, and their associated provider metadata. All are represented locally already. Quota usage returned by `getUsageForProvider` is a provider-facing display/preflight result; it is separate from per-request chat usage. The Ollama and Antigravity shapes feed the existing `extractUsage` pipeline, which normalizes counters before stream accounting and persistence. Existing cache-inclusive prompt totals and reasoning accounting are retained: cached counters are details/subsets and are not added again to totals; reasoning is normalized according to the existing Gemini accounting convention.

These changes do not establish a gap in local totals, persistence, or billing. No changes are warranted to those paths. Other provider-specific quota mechanisms, account subsystems, or source-only service behavior outside the named public patch are not inferred from these usage-extraction diffs.

## Disposition

- **#4435 — Already covered locally; do not port.** The local provider handler and ordinary fixtures already cover Kimi Coding API-key quota display and auth selection. The upstream head's wiring concern is resolved in the current local implementation.
- **#4754 — Already covered locally; do not port.** Local extraction recognizes the final Ollama NDJSON usage frame, with extra cache handling and offline fixtures. No narrow gap demonstrated.
- **#4785 — Already covered locally; do not port.** The wrapped Antigravity envelope is extracted and fixture-tested. No narrow gap demonstrated.

## Ordinary offline acceptance

No new acceptance case is needed because each proposed behavior is already exercised by local offline fixtures: `tests/unit/kimi-usage.test.js`, `tests/unit/ollama-cached-tokens.test.js`, `tests/unit/usage-concern.test.js`, `tests/unit/request-detail-usage.test.js`, and `tests/unit/chat-usage-total-reconcile.test.js`. There is no remaining narrow gap for a new fixture to demonstrate. This comparison used source and fixture inspection only; it made no provider requests and accessed no credentials or quotas.
