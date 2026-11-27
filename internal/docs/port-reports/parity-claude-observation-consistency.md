# Claude observation consistency

DONE. Bounded freshness and reset follow-up to merged #2686, 2026-11-27.

## Source, base, and ownership

- Source: OmniRoute #21406 at `6dae88bfe2b38403a86454c704f2adcedc5cb4f3`. Read the source diff and the preceding `parity-claude-quota-review.md` and `parity-claude-quota-headers.md` reports. The settled matching-window contract remains consistent with the source; no new contradiction was found.
- Exact starting HEAD and `origin/main`: `f7514b9ba3d0b341e0b5b422486049cf4f851a17`. A read-only `git ls-remote origin refs/heads/main` confirmed the same remote head. The usage handler had no diff against main before this work.
- Resulting head is the commit containing this report on `orq/tp5znk/claude-observation-consistency-a1`, subject `fix(claude): reconcile observed quota freshness and reset invalidation`. Its exact SHA is reported with the handoff. Verified code blob: `9bfad1045c4f6e57cfa895770bc5654dbe3711bb`; test blob: `8513de964bb1a59389e1ba60bc2d5a3cf9987c02`.
- Read AGENTS.md, the internal documentation index, and the tooling guide. CodeGraph query `getClaudeUsage --limit 5 --json` returned "CodeGraph not initialized". Used bounded reads of the named service, tests, and reports without creating an index or changing host settings.
- The read-only active PR query returned 17 open PRs. No title or branch identifies this observation/reset follow-up. #2678 remains the separate Claude effort lane; #2627 remains the upstream review lane. This is metadata evidence, not a review of every open diff.

## Behavior

Credential digests and canonical native windows remain the observation identity. For matching `5h`, `7d`, and `7d_oi` rows, an unexpired observation replaces the endpoint row only when that window's own observation timestamp is strictly newer than the endpoint cache timestamp. The endpoint wins ties and newer endpoint reads. The special permanent precedence for the endpoint Fable row is removed. Distinct endpoint-only model windows survive. Fresh observations still supplement omitted rows, preserving partial-window semantics without inventing unused capacity.

Observation timestamps and independent 15-minute TTLs are unchanged. Reporting another window does not renew an older one. Observation overlays never mutate the endpoint snapshot.

Only `res.ok && data.result === "reset"` invalidates the matching credential's endpoint cache and observations. Failed HTTP responses and successful HTTP responses with other results retain both. Other credentials retain their data. Polling cadence, force protection, in-flight coalescing, strikes, routing cooldowns, and authentication-error visibility are unchanged. Completed quota-header and native endpoint ports remain intact.

## Regression and validation evidence

Frozen offline-preferred dependency installs succeeded for root, CLI, and tests. No tracked dependency files changed.

Before changing the service, the response-header tests ran with the new assertions: **18 passed, 5 failed, 23 total**, starting 14:18:06 UTC. Failures proved that newer Fable observations returned old endpoint values, successful reset still exposed all three old observations, and unsuccessful resets discarded the endpoint snapshot. Existing authentication-error tests passed. Only the obsolete permanent Fable precedence assertion was updated to the settled freshness contract.

After the fix, the exact requested acceptance command ran from `tests/`:

```sh
timeout 300 node node_modules/vitest/vitest.mjs run unit/claude-usage-response-headers.test.js unit/claude-usage-cache.test.js unit/claude-fable-quota.test.js unit/claude-usage.test.js --maxWorkers=2
```

Result: **4 files passed, 54 tests passed, 0 failures**, starting 14:18:31 UTC, duration 5.09 seconds. Coverage includes older, tied, and newer observations for all three native windows; per-window timestamp and expiry isolation; omitted rows; distinct endpoint model rows; successful and failed reset; credential isolation; cached and forced reads; transient and rate-limit fallback; and authentication failures. The existing malformed-reset-date fixture emits its expected diagnostic and passes.

Both runs used an allowlisted child environment containing PATH, private temporary HOME/DATA_DIR/XDG_CACHE_HOME/TMPDIR, and NODE_ENV=test, with no provider or publisher credentials. All provider fetches in these tests are mocks. Raw before/after and lint logs are retained outside the repository in `/srv/work/tmp/claude-observation-6psddgbn` as described in the handoff evidence location.

Scoped oxlint using `.oxlintrc.json` on the two changed JavaScript paths exited 0 with zero warnings/errors. Its configured exclusions select one source file. `git diff --check` passed.

## Limits

No live provider calls, agents, GitHub writes, full suite/build, baseline edits, generated-file edits, production operations, or machine-setting changes ran. Full local CI and independent review remain merge prerequisites outside this bounded work order. Nonstream/Responses alias accounting remains a separate deferred finding.
