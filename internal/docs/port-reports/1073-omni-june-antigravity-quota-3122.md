# #1073 OmniRoute #3122: June Antigravity quota and retry audit

## Source pins and scope

Compared the requested OmniRoute commits:

- [`0f433e06c61e6edc31b8b6d1121861a7b8e6ba20`](https://github.com/cheaper-inference/OmniRoute/commit/0f433e06c61e6edc31b8b6d1121861a7b8e6ba20), `fix(429): drop over-broad /quota reached/ pattern, keep specific matches`. This pin removes the generic “quota reached” matcher because it would convert transient per-minute limits into long quota locks.
- [`84b5caeeb946d12223bee891c82ce640b46e6542`](https://github.com/cheaper-inference/OmniRoute/commit/84b5caeeb946d12223bee891c82ce640b46e6542), PR #3122, `fix(sse): bound Antigravity 429 retry loop and lock quota-exhausted accounts for full reset window`. Its first-parent diff is `656e73e1f02f73e90d39062861aac20ba3f65761..84b5caeeb946d12223bee891c82ce640b46e6542` in the supplied `source.git`. This change increments the per-URL retry counter in the short Retry-After branch, recognizes the specific “Individual quota reached” / “enable overages” evidence, parses “Resets in XhYmZs”, and caps parsed reset durations at 30 days. It adds focused executor, classifier, and fallback tests.

The two requested pins are separate commits, not an ancestor pair. The #3122 first-parent patch itself carries the narrow quota-classification rule and the regression preventing generic “quota reached” from matching transient limits. Scope here is runtime parity and a narrow offline-acceptance recommendation; auth/sign-in and new quota features are excluded.

## Current integration behavior

- **Short retries are counted and finite.** `open-sse/providers/registry/antigravity.js` configures three 429 retries. `open-sse/executors/base.js` checks the per-URL attempt count before invoking the Antigravity retry-delay hook, increments the same counter, and falls through after exhaustion. The hook’s 429 delay is capped at 10 seconds in `open-sse/executors/antigravity.js`. This means the source’s unbounded `urlIndex--` loop is not present in the current executor path: retry budget is centralized in `BaseExecutor.tryRetry`. The configured retry count is per endpoint; there is one registry base URL today.
- **Quota cooldown is model-scoped and bounded.** A 429 is parsed by `parseUpstreamError` into redacted `rateLimitEvidence` before the client-facing message is normalized. `parseRateLimitEvidence` recognizes “Individual quota reached” as explicit exhaustion, and parses “Resets in 164h27m24s” via its case-insensitive English `resets? in` duration clause. `markAccountUnavailable` persists a `modelLock_<model>`; `tests/unit/antigravity-capacity-fallback.test.js` already verifies an Antigravity quota lock survives account selection and permits a secondary account. The current hard ceiling is seven days (`MAX_RATE_LIMIT_COOLDOWN_MS`), rather than OmniRoute’s 30 days. The source example, 164h27m24s (592,044,000 ms; about 6.85 days), is below the local cap and should retain its reset deadline.
- **Parsing and locale.** The source and current implementation both target English wording and compact Latin duration units. Current parsing also accepts ordinary English unit names. It is case-insensitive and bounded, and rejects ambiguous multiple duration clauses. No localization behavior is added or established by #3122. The Antigravity executor’s own retry-delay parser only recognizes “reset after …”; the account cooldown path uses the broader shared evidence parser, which recognizes “Resets in …”.
- **Deadline and retries.** Each fetch has a connect/header timeout and respects the request’s abort signal; retry-body inspection is bounded to 64 KiB and two seconds. The shared retry counter bounds the number of retries, but there is no separate total wall-clock deadline across the whole request in this path. #3122 likewise changes retry count and cooldown parsing, not an overall request deadline.
- **Transport retries remain independent.** Antigravity’s executor-level 429 retry policy runs inside one selected account/request. Account selection and the persisted model lock are the later fallback layer. The current retry hook tests cover delay selection, retry-after caps, cancellation, and body bounds, while provider rate-limit tests cover exhausted evidence and redaction; they do not exercise one persistent 429 response through the full executor retry loop.

## Recommendation

No product-code port is indicated from these pins: current integration already has a finite per-endpoint 429 budget and parses the pinned English quota reset into bounded model-scoped evidence. The narrow remaining gap is deterministic offline acceptance coverage that joins those existing behaviors. Add a test-only follow-up that feeds the exact pinned Antigravity message through the 429 parser and verifies an exhausted model lock at the expected reset (subject to the seven-day cap), plus a persistent short-retry 429 executor case that proves the configured three retries are exhausted and control returns to account fallback. Use fake fetch and fake timers; no provider traffic or credentials are needed. Keep a transient “Request quota reached, retry in 60s” case classified as cooldown/rate-limit so the exact quota match cannot over-lock it.

## Local evidence

Implementation and tests inspected in the current integration:

- `open-sse/providers/registry/antigravity.js`: retry budget (429 attempts: 3) and single configured base URL.
- `open-sse/executors/base.js`: per-URL attempt check/increment and shared retry scheduling.
- `open-sse/executors/antigravity.js`: bounded retry-after handling; executor-local parser wording.
- `open-sse/utils/error.js`: explicit quota classification, bounded duration parsing, seven-day maximum, redacted error evidence.
- `open-sse/services/accountFallback.js`: quota evidence to cooldown and account/model lock persistence.
- `tests/unit/antigravity-retry-hook.test.js`: delay caps and cancellation/body-inspection bounds; no persistent-429 execute-loop assertion.
- `tests/unit/provider-rate-limit-evidence.test.js`: generic English duration parsing, exhaustion state, redaction, and Antigravity content-rejection carve-out; no exact “Resets in 164h27m24s” fixture.
- `tests/unit/antigravity-capacity-fallback.test.js`: model-lock persistence and account rotation for a supplied long Antigravity reset; no parser-to-lock end-to-end reset fixture.

No local tests were run; this report-only change is assessed with the requested file and identity checks.
