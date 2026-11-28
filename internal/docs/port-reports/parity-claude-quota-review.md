# Claude observed quota freshness reconciliation

## Disposition and revisions

DONE_WITH_CONCERNS. OmniRoute #21406 has a verified missing behavior. This report completes the reconciliation; implementation remains a separate unit. Historical providers-only exclusions do not apply to this full-parity review.

- Source: [OmniRoute #21406](https://github.com/cheaper-inference/OmniRoute/pull/21406), exact reviewed commit `6dae88bfe2b38403a86454c704f2adcedc5cb4f3`, `fix(oauth): retain Claude Fable weekly quota from response headers`.
- Refreshed upstream default branch `release/v3.8.55`: `c71f0065a7efe9230ec23b96a12253b050c4d7ad`. Both `git ls-remote omniroute-upstream HEAD` and an explicit branch fetch confirm this head. The reviewed PR commit is not an ancestor of that head, so this is PR-head parity, not a claim that the patch has landed upstream.
- Local reviewed HEAD: `83d0694c238042c61cff5671d1a57c1fbbc5c10a`.
- Refreshed `origin/main`: `f14f877ec13d6a9c58ed5a7d8f665526f748e76e`. The usage handler, protocol helper, base executor, chat handler, and error parser have no differences between these two local revisions.
- Census: [2026-11-27-full-parity-refresh.md](2026-11-27-full-parity-refresh.md), targeted reconciliation item 3 and O0015. Observation time: 2026-11-27, approximately 11:33 UTC.

The read-only active-PR query returned 16 open DurinDoor PRs without truncation. No title or branch identifies an observed-quota implementation. [#2678](https://github.com/bloodf/durindoor/pull/2678) owns synced Claude effort settings, while [#2627](https://github.com/bloodf/durindoor/pull/2627) owns upstream review fixes. Neither should be repurposed. This ownership check uses PR metadata, not a claim that every active diff was reviewed. No GitHub writes were made.

## Source behavior at the reviewed SHA

`git show 6dae88bfe2b38403a86454c704f2adcedc5cb4f3` changes exactly these source files:

- `open-sse/services/usage/claude.ts`: `ObservedClaudeUsage`, `UNIFIED_WINDOWS`, `observeClaudeUsageHeaders`, and `preferNewerObservedUsage`.
- `open-sse/services/usage/claudeQuota.ts`: `LEGACY_MODEL_DISPLAY_NAMES`.
- `tests/unit/claude-usage-response-headers.test.ts`: two new behavioral cases.

The patch extends an existing upstream observer with `7d_oi`, normalized as `seven_day_overage_included` and displayed as `weekly fable (7d)`. Header utilization is a fraction, converted to percentage used. Header resets are epoch seconds, converted to ISO timestamps. Missing, blank, negative, and nonfinite utilization does not create a window.

Each window has its own `windowObservedAt`. A later response that omits Fable retains its previous value and timestamp only while that window remains fresh. Reading observations also filters each window against `CLAUDE_USAGE_SUCCESS_TTL_MS`, which is 15 minutes in this source. New general-week observations cannot extend Fable's lifetime.

`getClaudeUsage` applies `preferNewerObservedUsage` after the endpoint promise resolves. A newer observation replaces older general plan windows. Recent endpoint-only model windows and extra usage survive that merge. A newer successful endpoint read can still omit Fable, so a fresh header-only Fable row supplements that read, with endpoint model rows taking precedence on a matching key. Header-only results do not claim a complete account inventory. Authentication and other non-quota failures remain visible.

The added upstream tests assert separate Week and Fable percentages, retention after a non-Fable response, expiry despite later general observations, preservation across a successful endpoint read, and credential isolation. These tests were read as source evidence, not executed in DurinDoor.

## Local path and preserved behavior

CodeGraph query was attempted first. It reported that this worktree is not initialized. Bounded searches and direct reads supplied the following ownership evidence without creating an index.

| Path and symbol | Observed behavior | Parity conclusion |
| --- | --- | --- |
| `open-sse/services/usage.js:52`, Claude handler | Passes token, proxy, auth type, force, and provider data to `getClaudeUsage` | Existing usage entry point is reusable |
| `open-sse/services/usage/claude.js:199`, `getClaudeUsage` | Returns endpoint cache, retained cooldown fallback, or joined endpoint poll | No response-header overlay or per-window observation state |
| Same file, `pollClaudeOAuthUsage`, lines 238–305 | Normalizes `five_hour`, `seven_day`, legacy `seven_day_*`, and `limits[]` into the existing flat `quotas` map | Endpoint Fable support already exists and must remain |
| Same file, `modelDisplayNames`, line 269 | Maps `fable_5_1` and `fable_5`; has no `overage_included` alias | That legacy field currently becomes `weekly overage_included (7d)`, not the Fable row |
| `open-sse/executors/base.js:499`, `:571`, `:599` | Receives responses, finishes headers, then classifies Claude request-scoped failures | Headers are available, but no usage observer is called |
| `open-sse/handlers/chatCore.js:1492`, `executeProvider` | Executes the provider and validates its response result | No quota observation hook follows validation |
| `open-sse/utils/claudeProtocol.js:75`, `claudeUnifiedQuotaRejected` | Reads `7d_oi-status` as part of refusal classification | Stateless refusal evidence does not retain usage values |
| Same file, `claudeUnifiedResetAt`, line 106 | Reads rejected `5h`, `7d`, and `7d_oi` resets with a bounded deadline | Reset support is already present |
| `open-sse/utils/error.js:657` | Uses explicit shared-quota rejection to set connection scope and reset evidence | Preserve this routing authority |

Bounded search for `observeClaudeUsageHeaders`, `observedQuota`, observed-quota phrases, `recordClaude`, and `7d_oi` across local routing code and unit tests found no equivalent observer. The existing `streamTerminal.js` function named `observeClaude` observes stream chunks, not quota headers. A similarly named function alone is not parity evidence.

The local cache has a 30-minute fresh TTL, three-hour stale retention, token-digested keys, in-flight coalescing, and escalating 429 cooldowns from 15 minutes to two hours. Forced reads honor cooldowns. Successful endpoint polls clear endpoint strikes. None of these controls should change as a side effect of quota observations.

## Bounded implementation unit

Proposed owner: one Claude observed-quota implementation lane. No implementation is assigned or performed by this report. Recheck active ownership before starting it.

Owned files would be `open-sse/services/usage/claude.js`, `open-sse/executors/base.js`, and a new `tests/unit/claude-usage-response-headers.test.js`. A short behavior note next to the handler satisfies the documentation requirement. `claudeProtocol.js`, `utils/error.js`, shared cooldown stores, and the existing UI need no changes.

1. Add a bounded, credential-digested observer in the usage handler for `5h`, `7d`, and `7d_oi`. Store each valid window's value and original observation time. Use an explicit observation TTL of 15 minutes for source parity, independent of the local endpoint cache's 30-minute TTL. Add the `overage_included` Fable alias while preserving existing `limits[]` precedence.
2. Observe native Claude OAuth response headers in the base executor before its response classification and early returns. Include successful and refused responses. Exclude API-key and other-provider traffic. Observation must leave the response body untouched and perform no network calls.
3. Apply a read-only overlay to every OAuth usage return path, including cache hits, cooldown fallback, and completed polls. Merge into DurinDoor's existing flat `quotas` map. Preserve endpoint-only metadata and authentication failures. Retain omitted windows only until their own TTL expires. A header update must not clear endpoint strikes, bypass polling cooldown, or refresh an endpoint cache timestamp.
4. Add behavior tests for Week/Fable separation, omitted-window retention, exact TTL expiry despite newer general headers, newer endpoint reads that omit Fable, endpoint precedence on matching rows, malformed headers, credential isolation, and API-key exclusion. Drive an executor response through `getClaudeUsage` to prove the hook works. Verify unchanged force/coalescing behavior and shared-versus-request-scoped cooldown decisions.

Do not duplicate endpoint Fable support, add another budget or routing engine, or promote a Fable observation into account-wide rejection. `claudeUnifiedQuotaRejected` and `claudeUnifiedResetAt` retain their existing semantics.

## Executed evidence

Dependencies were linked with frozen, offline-preferred installs in the root, `cli`, and `tests`. All succeeded without tracked dependency changes.

Commands ran from `tests/` with a five-minute timeout and two workers:

```sh
timeout 300 node node_modules/vitest/vitest.mjs run unit/upstream-intake-ledger.test.js --maxWorkers=2
timeout 300 node node_modules/vitest/vitest.mjs run unit/claude-usage-cache.test.js unit/claude-usage.test.js unit/claude-parity-pass.test.js unit/port-2848-claude-usage-poll-timeout.test.js --maxWorkers=2
timeout 300 node node_modules/vitest/vitest.mjs run unit/claude-fable-quota.test.js --maxWorkers=2
```

Results: ledger 33/33, scoped cache/usage/protocol/timeout evidence 48/48, existing Fable behavior 10/10. All six files passed. These checks prove the existing behavior, not the missing observer. In particular, `claude-parity-pass.test.js` covers shared quota rejection retaining cooldown across models; `claude-fable-quota.test.js` covers actual `weekly_scoped` usage, omission, malformed rows, and legacy windows.

Only this report is changed. No product or test edits, full-suite runs, builds, baseline edits, or GitHub writes are part of this unit. Remaining gap: implement and test the bounded response-header observation path before marking #21406 parity complete.
