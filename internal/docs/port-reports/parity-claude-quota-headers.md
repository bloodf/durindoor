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

The initial implementation returned header-only quota rows alongside the rate-limit message. Review 4 HIGH found that this blocks the consumer table; the correction below supersedes that behavior. Authentication and other hard failures remain visible. Partial observations do not assert a complete account inventory. Endpoint cache freshness remains 30 minutes, retention remains three hours, and polling timeouts, force behavior, coalescing and escalating cooldowns are unchanged. Observation state never writes shared or request-scoped cooldown state; the existing protocol classifiers remain unchanged.

## Evidence

Frozen offline-preferred dependency installs succeeded for root, CLI and tests without tracked dependency changes.

The final acceptance command ran with a private temporary HOME, DATA_DIR and cache directory, using an allowlisted environment containing no provider or publisher credentials:

```sh
cd tests && timeout 300 node node_modules/vitest/vitest.mjs run unit/claude-usage-response-headers.test.js unit/claude-usage-cache.test.js unit/claude-fable-quota.test.js unit/claude-parity-pass.test.js --maxWorkers=2
```

Result: **4 files passed, 49 tests passed, 0 failures**, 2026-11-27 at 11:41:47 UTC (13.69 seconds). The new file supplies 13 tests covering separate Week/Fable percentages, reset conversion, omission retention, independent expiry, endpoint and scoped-row precedence, cache and cooldown returns, joined forced polls, transient and legacy fallback, API-key exclusion, credential isolation, bounded storage, and intact bodies on success and scoped Fable rejection. Existing parity tests verify shared quota cooldown retention across models.

An initial run found an incorrect test assumption: an ordinary 429 with a non-credit body is not necessarily request-scoped. The fixture was corrected to use Fast mode; the final fixture explicitly reports scoped Fable rejection with healthy shared weekly quota. No production classifier was changed to satisfy the test.

`git diff --check` passed. No baseline edits, full suite, build, live provider calls, agents, pushes or GitHub mutations were performed. No remaining implementation gaps were found in this bounded unit. Full local CI and independent review remain merge prerequisites outside this work order.

## Gate correction

The independent gate rejected implementation commit `9732e2d1ab60971c053ef085236d34caebe24ac2` for one `anti-slop/no-runtime-typeof` diagnostic in the observer's header-method guard. Its scoped tests passed (97 files, 1,217 tests), as reported by the orchestrator. Replaced that guard with the existing `isFunction` utility; no lint exemptions or baseline changes were added.

Local correction validation: `timeout 300 pnpm run lint:anti-slop` passed with zero diagnostics across 3,226 files. The same four-file acceptance command above passed again with a private HOME/DATA_DIR/cache and credential-free environment: **49/49 tests, 4/4 files**, started 2026-11-27 11:45:11 UTC, duration 13.98 seconds. `git diff --check` passed. Full CI and independent merge review remain outside this work order.


## Review 4 HIGH correction: cold-start usage 429

DONE for `fix-observed-quota-rate-limit-message`, 2026-11-27.

- Upstream source remains OmniRoute #21406 at `6dae88bfe2b38403a86454c704f2adcedc5cb4f3`.
- Reported independent reproduction source: `69ad0cb83da7`.
- Exact local starting head: `8abc9ec64074617a3276e6a3c818c60c596abacd`.
- Exact implementation head: `548ddbb412a7fa1dde7d9f10c0d3bb144e54496b`. The following documentation commit records this evidence without further code changes.

`getClaudeUsage` returned both `message: "Rate limited, try again later."` and a fresh `weekly fable (7d)` row with `used: 80`. ProviderLimits copies `data.message` into quota state at `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js:942` and selects the message branch before the table at line 1615. A quota-map-only assertion missed the consumer contract.

The usage service now removes that specific blocking message only after adding a usable fresh observation. It returns partial quota rows without claiming endpoint success or a complete account inventory. No usable observation leaves the original rate-limit message intact. Authentication and other non-quota failures remain visible. No upstream body text is exposed by the 429 result. Endpoint polling state, escalating strikes, forced cooldown protection, endpoint cache timing and per-window observation TTLs are unchanged. No UI or routing code changed.

CodeGraph ownership query `getClaudeUsage --limit 5 --json` reported that this worktree is not initialized. Bounded reads of the usage service, named tests and ProviderLimits established the return contract. No index or host configuration was created.

Regression evidence before the fix: the response-header file ran 16 tests, with 15 passing and the new consumer-contract regression failing at `expect(result.message).toBeUndefined()`. Actual value was `Rate limited, try again later.` The regression calls the real observer and `getClaudeUsage` with a synthetic 429 fetch, without UI edits.

Final acceptance ran with private temporary HOME, DATA_DIR and cache paths and a credential-free allowlisted environment:

```sh
cd tests && timeout 300 node node_modules/vitest/vitest.mjs run unit/claude-usage-response-headers.test.js unit/claude-usage-cache.test.js unit/claude-fable-quota.test.js --maxWorkers=2
```

Result: **3 files passed, 31 tests passed, 0 failures**, started 2026-11-27 at 12:14:47 UTC, duration 5.02 seconds. Coverage includes usable cold-start observations, no observations, exact TTL expiry, newer general observations without extending Fable TTL, cold-start forced cooldown reads, retained 30-minute second-strike cooldown, body privacy, authentication failure and other non-quota failures. The existing Fable malformed-reset fixture emits its expected invalid-date diagnostic and passes. `git diff --check` passed. Frozen offline-preferred installs for root, CLI and tests succeeded.

Only the three authorized files changed across the implementation and evidence commits. No full suite/build, agents, GitHub writes, baseline changes or production calls were performed. Review 4 medium findings remain deferred: newer Fable cache precedence, reset invalidation, and nonstream/Responses alias accounting. Full local CI and independent review remain merge prerequisites outside this unit.
