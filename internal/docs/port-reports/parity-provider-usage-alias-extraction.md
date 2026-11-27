# Provider usage alias extraction

## Reviewed null canonical suppression correction, 2026-11-27

Reproduced the reviewer and orchestrator finding on base `a9a5deb4f2a`.
For `{ prompt_tokens: 100, completion_tokens: 5,
cache_creation_input_tokens: null, cache_creation_tokens: 30 }`, direct
`canonicalizeUsage` returned cache write 0 while canonicalizing `extractUsage`
returned 30. The exclusive-cache discriminator treated null creation as present
and bypassed the existing nullish alias fallback.

Changed only that canonical creation presence check to `!= null`. Null now
follows the existing nullish field precedence. Numeric canonical zero and
positive values retain precedence and exclusive accounting; alias validation
still requires a finite nonnegative number. Other canonical-field validation
and the cache-read discriminator are unchanged.

Added the regression before the production edit. From `tests/`, under a
credential-free environment containing only PATH, locale and private HOME,
DATA_DIR, XDG_CACHE_HOME and TMPDIR, the red command was:

```sh
node node_modules/vitest/vitest.mjs run unit/provider-usage-alias-extraction.test.js --maxWorkers=2
```

It exited 1: 4 failed, 145 passed. The failures were direct Chat, direct
Responses, nonstream Chat and nonstream Responses. Bare Responses extraction
and response.completed/done/incomplete already passed. Each failure reported
write 0 instead of 30, with input 100, output 5, total 105 and read 0.

After the correction and two additional no-read numeric precedence controls,
the final targeted command was:

```sh
node node_modules/vitest/vitest.mjs run unit/provider-usage-alias-extraction.test.js unit/parity-stream-cache-creation-alias.test.js unit/claude-openai-cache-usage.test.js unit/cached-token-usage.test.js unit/omni-cache-write-usage-alias.test.js unit/usage-cost-total.test.js --maxWorkers=2
```

It exited 0: 6 files, 226 tests passed, including 151 extraction tests.
The no-read fixture returns input 100, output 5, total 105, write 30 and read 0
across all eight entry paths. Existing stream, alias-validation and token/cost
accounting checks passed. Both commands had a 300-second subprocess timeout.
Root, CLI and test dependencies were installed with the requested frozen-lockfile,
prefer-offline commands before test execution.

Scoped Oxlint with `.oxlintrc.json` and the two changed JavaScript paths exited
0 with zero warnings and errors; its configuration selected one file.
`git diff --check` also exited 0.

No full suite, build, live provider call, GitHub write, baseline change or
machine/production operation was performed. Full CI and independent review
remain outside this scoped correction.

Disposition: DONE. Implemented 2026-11-27 as the #2686 review4 deferred extraction follow-up.

## Source and ownership

- Candidate/base and refreshed origin/main: `f7514b9ba3d0b341e0b5b422486049cf4f851a17`.
- Refreshed 9router master: `5ae63d22847e07042e235b40e1d926b65e509013`.
- Refreshed [9router #5904](https://github.com/decolua/9router/pull/5904) head: `b2b7ce1c6f9437ea344c9e05d1cd743d79892eea`, still open. Its typed-validation and precedence differences remain intentional local adaptations.
- Result head is the commit containing this report; the handoff records its exact SHA.

Read AGENTS.md, internal/docs/ai-tooling.md, internal/docs/README.md, parity-stream-usage-review.md and parity-stream-cache-creation-alias.md. The CodeGraph ownership query for extractUsageFromResponse returned "CodeGraph not initialized". Bounded searches of usageTracking.js, requestDetail.js and the named tests supplied ownership evidence.

The refreshed open local PR census contained 17 PRs. Titles and bodies claim no duplicate alias extraction implementation. Complete diffs for the broad overlapping lanes #2627 at `f339a2575870d4ae462e36c2f5f1cda4951fb1a7`, #2688 at `bdb60a60b3fd84975ea9ee7ef74de19fe54b1783`, and #2689 at `dcf41df94a29002570f8f6d904f457534efe1b8c` contain no changes to usageTracking.js or requestDetail.js. This is a sequential point-in-time check, not a reservation or merge approval.

## Behavior

Canonicalization accepts finite numeric cache_creation_tokens >= 0, using the already imported isNumber predicate. Canonical cache_creation_input_tokens and cache_write_tokens retain priority, including explicit zero. Numeric strings, negative numbers, nonfinite values, booleans and objects do not become creation counts through this alias.

Responses extraction forwards the alias and existing creation fields to normalizeUsage instead of selecting creation fields before normalization. Its existing canonical creation detail marker remains, so canonical creation stays inclusive even without cache reads. No new helper or requestDetail edit is required.

Real extractUsageFromResponse calls for Chat and Responses JSON, plus extractUsage calls for bare Responses usage and response.completed, response.done and response.incomplete, retain prompt 100, completion 5, read 20 and write 30. Literal expected objects cover total 105, precedence, zero, malformed aliases and existing nested aliases. Stream timing, terminal handling, pricing and budgets are unchanged.

## Regression and scoped evidence

Installed root, CLI and test dependencies with frozen lockfiles and prefer-offline. No lockfile changed.

Before the fix, the final 104-case extraction matrix against base usageTracking.js exited 1: 12 failed and 92 passed. The six real extraction routes lost alias 30 and incorrectly preferred nested 30 over top-level alias zero. An earlier probe also tried prompt_tokens_details on Responses events, which is not an existing supported nested spelling there; final coverage uses input_tokens_details for those events and both existing spellings for nonstream extraction.

After the fix, the exact required command from tests/ exited 0 with 127 tests across three files:

```sh
timeout 300 node node_modules/vitest/vitest.mjs run unit/provider-usage-alias-extraction.test.js unit/parity-stream-cache-creation-alias.test.js unit/claude-openai-cache-usage.test.js --maxWorkers=2
```

This includes three additional checks preserving canonical Responses creation without cache reads. The unchanged stream suites verify inline/trailing usage and Claude cache forwarding. Child runs used an empty environment with PATH, locale, private HOME, DATA_DIR, XDG_CACHE_HOME and TMPDIR. No provider or publisher credentials were passed. Temporary red/green logs are disposable; assertions in the committed test are the durable evidence.

Anti-slop lint and git diff --check passed. The lint command rebuilt its generated plugin; that generated change was restored and is excluded from this commit. No full suite, build, service operation, live provider call, GitHub write or baseline change ran. Full local CI and independent cross-family review remain later PR gates outside this work order.
