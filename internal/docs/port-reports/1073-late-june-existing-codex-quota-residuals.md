# #1073: Late-June existing Codex quota residuals

## Scope and exact pins

This review compares only account-independent quota read/display behavior and supported quota metadata mapping/limits. It preserves existing billing and selection policy and excludes subscription additions, authorization/sign-in, and new provider calls or paid APIs.

| OmniRoute PR | Exact PR head | Enclosing merge |
| --- | --- | --- |
| [#4493](https://github.com/cheaper-inference/OmniRoute/pull/4493) | [`9db3c03faa59c3eb11a626726b65e221e07df3b8`](https://github.com/cheaper-inference/OmniRoute/commit/9db3c03faa59c3eb11a626726b65e221e07df3b8) | [`cd45943015501cdb673ec2b8848e6f3f57743ca2`](https://github.com/cheaper-inference/OmniRoute/commit/cd45943015501cdb673ec2b8848e6f3f57743ca2) |
| [#4494](https://github.com/cheaper-inference/OmniRoute/pull/4494) | [`61cbd9b23027e34137b4d150fcf0918b7eae9adc`](https://github.com/cheaper-inference/OmniRoute/commit/61cbd9b23027e34137b4d150fcf0918b7eae9adc) | [`a37ee2fac5ff21bdd27d5d64d4176f766fddf021`](https://github.com/cheaper-inference/OmniRoute/commit/a37ee2fac5ff21bdd27d5d64d4176f766fddf021) |
| [#4512](https://github.com/cheaper-inference/OmniRoute/pull/4512) | [`ccacc272526939ec17ee716b1d90b75e186ba12d`](https://github.com/cheaper-inference/OmniRoute/commit/ccacc272526939ec17ee716b1d90b75e186ba12d) | [`3a0c40bb5e2b63f5a7168013972c0dc275ed255f`](https://github.com/cheaper-inference/OmniRoute/commit/3a0c40bb5e2b63f5a7168013972c0dc275ed255f) |

The PR heads above were inspected directly. The #4494 and #4512 enclosing merge commits include other PR history; their dispositions below rely on the exact PR-head changes, not the full enclosing merge diffs.

## Current behavior and fixture evidence

### #4493 — numeric-string reset timestamps

The pinned patch treats digit-only reset strings as Unix seconds below `1e12` and milliseconds at or above that threshold in both upstream parsers. Current local `open-sse/services/usage/shared.js` already applies that rule for shared usage display parsing. The current quota ingestion path independently supports numeric-string epoch timestamps, including decimal forms, through `parseQuotaTimestamp` in `open-sse/services/quota/normalize.js`; Codex window reset metadata goes through that parser in `open-sse/services/quota/providers/codex.js`.

Offline fixtures exercise seconds as number, milliseconds as number, ISO strings, and numeric-string seconds in `tests/unit/provider-quota-normalizers.test.js` (`normalizes timestamp`). Thus reset display and stored quota reset metadata already cover the demonstrated public behavior; no account lookup or provider request is needed for parsing.

**Disposition: already covered; no port.** The exact patch adds no distinct supported behavior missing from current local parsing.

### #4494 — Codex review secondary window and fallback descriptor

The pinned patch exposes the review secondary window and locates review quotas in `additional_rate_limits` when the dedicated review block is absent. Locally, `appendCodexQuotaWindows` in `open-sse/services/usage/codex.js` maps primary and secondary windows under review-scoped keys, preserving classified window duration. Its `getCodexReviewRateLimit` accepts the dedicated block, indexed limit-id blocks, or review descriptors in `additional_rate_limits`. The persisted quota normalizer `open-sse/services/quota/providers/codex.js` has the corresponding mapping, accepts snake/camel metadata aliases, and records finite `windowSeconds` while retaining the existing `feature:code-review` resource scope.

Offline fixture evidence in `tests/unit/provider-quota-normalizers.test.js` covers dedicated review primary and secondary windows, a review descriptor fallback, camel-case aliases, exact account-independent output, duration classification, and malformed-input rejection. `tests/unit/port-2853-codex-usage-windows.test.js` separately checks displayed review quota normalization and preserved window duration. Existing quota policy fixtures (`tests/unit/provider-quota-policy.test.js`) retain selection semantics; this review proposes no policy change.

**Disposition: already covered; no port.** The current mapper handles the narrow window and fallback behavior without adding a model alias, changing account binding, or altering billing/selection.

### #4512 — Kiro auth-error message

The exact PR-head change modifies Kiro quota error presentation for social-auth accounts after a 401/403. It does not add account-independent quota reads, display mapping, or quota metadata/limits. It is outside this report's authorized scope.

**Disposition: out of scope; no port.** No Kiro auth behavior was changed or proposed.

## Acceptance

There is no demonstrated narrow quota gap among the in-scope changes, so no product or test change is proposed. Existing offline fixture evidence cited above is the acceptance basis; no live provider traffic, credentials, or paid APIs are required.
