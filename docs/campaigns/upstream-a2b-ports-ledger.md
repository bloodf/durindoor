# Upstream A2-b Runtime-Correctness Ports — 2026-08-09

Runtime-correctness slice of the `6fcd27337..15223724c` sync window. Anchors and
the deferred list live in [`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| Commit | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| `41606a37` `fix(usage): don't lose cached tokens in the forced-SSE->JSON path` | PORTED | The fork's `sseToJsonHandler.js` dropped the Responses cache counters when a streamed response was folded into a single JSON body, so cached prompt tokens vanished from usage accounting. | Fold the cache counters and reattach usage on the forced JSON path. Regression fixture in `tests/unit/forced-sse-cache-tokens.test.js`. |
| `3292dfc1` `fix(github): hold monthly-exhausted accounts until reset` | PORTED | `open-sse/executors/github.js` had generic cooldown handling but no monthly-402 branch, so an exhausted account was retried immediately instead of being held until the UTC monthly reset. | Hold the account until the reset instant. Regression test in `tests/unit/github-monthly-usage-lock.test.js`. |
| `cd13d904` `fix(passthrough): detect codex-tui/Codex Desktop as native Codex client` | PORTED | `open-sse/utils/clientDetector.js` carried no `codex-tui`, `Codex Desktop`, or `codex_work_desktop` markers, so those clients took the non-native path and lost `reasoning.summary`. | Add the detection markers. Covered in `tests/unit/client-detector.test.js`. |
| `35f86e58` `fix(oauth): scope antigravity header fixes to loadCodeAssist/onboardUser` | PORTED | The fork sent `X-Goog-Api-Client` / `Client-Metadata` on Antigravity provisioning calls. Google fingerprints those headers and silently refuses to provision a `cloudaicompanionProject`, and the header set was shared with Gemini CLI, so fixing it in place would have changed the Gemini CLI fingerprint too. | Add `ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS` and select it by provider in `projectId.js` (both `loadCodeAssist` and `onboardUser`); thread `provider` through `getProjectIdForConnection` and its two callers; drop the fingerprint headers from the OAuth post-exchange and service paths; point the registry at the native IDE user agent. Tests in `tests/unit/antigravity-project-id-headers.test.js` cover both the Antigravity fix and the Gemini CLI non-regression. |

## Notes

- Upstream keeps Antigravity's OAuth provider in `src/lib/oauth/providers/antigravity.js`; this fork has a monolithic `src/lib/oauth/providers.js`, so the equivalent edit lands there.
- `getProjectIdForConnection` gained a trailing optional `provider` argument. It defaults to `null`, which preserves the shared Cloud Code headers for every existing caller.

## Verification

- Focused Vitest runs passed for each ported behavior.
- Every regression test was revert-proofed: reverting the source change turns the test red, restoring it turns the test green.
