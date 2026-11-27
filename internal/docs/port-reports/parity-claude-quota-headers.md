# Claude response-header quota port

DONE for the bounded implementation work order, 2026-11-27.

## Revisions and ownership

- OmniRoute #21406 refreshed PR head and reviewed source: `6dae88bfe2b38403a86454c704f2adcedc5cb4f3`.
- Refreshed `origin/main`: `f14f877ec13d6a9c58ed5a7d8f665526f748e76e`.
- Starting local integration HEAD: `43e836bd087afaef16e2972c413834129f268ced`. Main is its merge base. Inherited integration changes are outside this commit.
- Read the contributor contract, tooling guide, internal index, upstream census, current full-parity refresh, and `parity-claude-quota-review.md`.
- CodeGraph ownership query `fetchClaudeUsage` returned “CodeGraph not initialized” for this worktree. Bounded reads of the usage handler, base executor, protocol helper and named unit tests established ownership. No index or machine configuration was changed.
- The refreshed active local PR list contained 16 open PRs, without truncation. None identified a response-quota observer port; #2678 concerns effort settings, and #2627 is the separate upstream-review lane.

## Behavior

Native Claude OAuth responses now record `5h`, `7d`, and `7d_oi` utilization before response classification, including successful and refused requests. API-key and other-provider requests do not record observations. The observer reads headers only, adds no network calls and leaves response bodies available to their callers.

Observation storage holds at most 100 credential digests, each with at most three windows. Values normalize fractional utilization to percentages; malformed or negative values are ignored, finite values clamp to 100, and invalid reset dates become null. Each window keeps its own original observation timestamp and expires after 15 minutes. Responses omitting a window neither clear it nor extend its lifetime.

Every OAuth usage return passes through a read-time overlay. Newer general observations update cached totals; endpoint model rows take precedence, while omitted Fable rows can be supplemented by unexpired observations even after successful endpoint polls. The endpoint cache stores endpoint data only, so an overlay cannot persist through cache retention or refresh another window's expiry. `seven_day_overage_included` uses the existing Fable normalization, with `limits[]` still taking precedence.

Header-only quota rows can accompany the existing rate-limit message. Authentication and other hard failures remain visible. Partial observations do not assert a complete account inventory. Endpoint cache freshness remains 30 minutes, retention remains three hours, and polling timeouts, force behavior, coalescing and escalating cooldowns are unchanged. Observation state never writes shared or request-scoped cooldown state; the existing protocol classifiers remain unchanged.

## Evidence

Frozen offline-preferred dependency installs succeeded for root, CLI and tests without tracked dependency changes.

The final acceptance command ran with a private temporary HOME, DATA_DIR and cache directory, using an allowlisted environment containing no provider or publisher credentials:

```sh
cd tests && timeout 300 node node_modules/vitest/vitest.mjs run unit/claude-usage-response-headers.test.js unit/claude-usage-cache.test.js unit/claude-fable-quota.test.js unit/claude-parity-pass.test.js --maxWorkers=2
```

Result: **4 files passed, 49 tests passed, 0 failures**, 2026-11-27 at 11:41:47 UTC (13.69 seconds). The new file supplies 13 tests covering separate Week/Fable percentages, reset conversion, omission retention, independent expiry, endpoint and scoped-row precedence, cache and cooldown returns, joined forced polls, transient and legacy fallback, API-key exclusion, credential isolation, bounded storage, and intact bodies on success and scoped Fable rejection. Existing parity tests verify shared quota cooldown retention across models.

An initial run found an incorrect test assumption: an ordinary 429 with a non-credit body is not necessarily request-scoped. The fixture was corrected to use Fast mode; the final fixture explicitly reports scoped Fable rejection with healthy shared weekly quota. No production classifier was changed to satisfy the test.

`git diff --check` passed. No baseline edits, full suite, build, live provider calls, agents, pushes or GitHub mutations were performed. No remaining implementation gaps were found in this bounded unit. Full local CI and independent review remain merge prerequisites outside this work order.
