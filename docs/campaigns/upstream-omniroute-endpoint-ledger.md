# Campaign ledger: upstream + OmniRoute ports, OAuth durability, endpoint fix, capabilities audit

Branch: `campaign/upstream-omniroute-endpoint` (based on `origin/main` @ `2e3794bac`, which contains squash-merged PR #365).

This ledger records every unit of the campaign: what was ported, what was already
present (DUPLICATE), and what was found to be not-applicable or non-existent, with
the evidence behind each verdict. Verdicts follow the plan's own mandate to verify
each candidate against the *live* source before porting and to record duplicates
and rejections rather than padding the port count.

## 1. Endpoint page regression (Section 4/5) — DONE

`src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js` (renamed to `.jsx`).

- Restored the `editKeyPolicy` / `setEditKeyPolicy` `useState` binding that commit
  `2ff1c49b7` clobbered with the new external-tunnel state (Edit-API-Key modal and
  its save handler still referenced it -> ReferenceError on open).
- Fixed the two Tailscale `updateReachable(...)` calls that passed a nonexistent
  `setTunnelEverReachableRef` / the tunnel setter instead of `setTsEverReachable`.
- Renamed the file to `.jsx` (repo convention for JSX-heavy client components; the
  single importer is extensionless) so the regression test can import it under
  vitest's JSX transform.
- Test: `tests/unit/endpoint-page-client-regression.test.js` (source-invariant guard;
  a render test cannot reach these state-/effect-driven paths and the repo has no
  jsdom/testing-library harness). Verified red pre-fix, green post-fix for both bugs.

## 2. OAuth reconnect durability (Section 3) — DONE (gaps only; rest DUPLICATE)

Much of Section 3 was already implemented on `origin/main`:
- `serializeRefresh` wrapping in `refreshAndUpdateCredentials` — DUPLICATE (present).
- `quotaAutoPing` rotation-group guard — DUPLICATE (present).
- concurrent-winner reconciliation + compare-and-swap secret preservation — DUPLICATE.

Genuine gaps ported:
- `open-sse/services/oauthCredentialManager.js::refreshProviderCredentials` (reactive
  401 path used by Codex/gemini-cli/grok-cli/qwen) now wraps the network refresh in
  `serializeRefresh` by rotation group (was per-token dedup only).
- `src/shared/services/providerQuotaTracker.js::execute` now skips proactive refresh
  for rotation-group providers (`rotationGroupFor(...) !== null`), mirroring quotaAutoPing.
- `src/shared/services/providerCredentials.js` now persists a durable
  `testStatus:"reauth_required"` + `errorCode:"REAUTH"` state on an unrecoverable
  refresh (after reconciliation finds no newer credential), preserving tokens and
  leaving `isActive` untouched.
- Both fallback-state clear paths (`connectionsRepo.clearProviderConnectionFallbackState`
  and `auth.clearAccountError`) now refuse to clear a pinned `reauth_required` state,
  so ordinary request success cannot silently revive a dead account.
- `getStatusVariant` marks `reauth_required` as an error; `ConnectionRow` renders a
  per-row Reconnect action for OAuth rows in that state; the OAuth flow threads an
  optional `connectionId` (authorize route -> flow payload -> `saveOAuthConnection`),
  which replaces the failed row in place (validated: exists, same provider, oauth)
  instead of creating a duplicate.
- Tests: `provider-credentials.test.js` (durable write), `provider-quota-tracker.test.js`
  (rotation-group skip), `connection-status.test.js` (status variant),
  `oauth-reconnect-replacement.test.js` (create-vs-update decision).
- Process-locality: `serializeRefresh` is process-local; `durindoor.service` is a single
  Node process (custom-server.js never imports cluster/worker_threads), so this is safe.
  Upgrade path if ever multi-process: SQLite-backed group lease (documented in
  `refreshSerializer.js`).

## 3. Context-window capabilities audit (Section 6) — DONE (2 real bugs; plan numbers corrected)

Audited `open-sse/providers/capabilities.js` against models.dev api.json. The plan's
Section 6 was written against an older tree; most entries already existed and several
of the plan's target numbers were WRONG against the authoritative source.

Real bugs fixed:
- `claude-opus-4.6/4.7 -thinking` (dot + dash forms) resolved to the generic 200K
  budget floor (no exact row; `*claude*opus-4.6*` pattern does not match the dash form
  and carries no contextWindow). Added the four exact 1M/128K rows.
- `glm-5 / glm-5.1 / glm-5-turbo` carried a wrong 1M exact override; official z.ai /
  models.dev window is 200K. Corrected to 200000 (glm-5.2 normalized to the official 1M).

Plan numbers DROPPED as incorrect vs models.dev:
- MiniMax M2.x = 262144 (plan) — reality is 204800; existing pattern already correct.
- GPT-5.5/5.6 = 400000-as-a-bug (plan) — they already resolve to 400000 via the
  `*gpt-5*` pattern; the speculative exact rows guard a non-existent future edit (YAGNI).
- The `denormalizeModelId` / dozens of gpt-5/kimi/minimax exact rows were speculative
  hardening; those ids already resolve correctly, so no change.
- Test: `capabilities-context-window.test.js` pins the resolved windows.

## 4. OmniRoute ports

| PR | Verdict | Notes |
|----|---------|-------|
| #7919 | PORTED | `reasoning_text` added to the shared resolver; non-stream OpenAI->Claude routed through it (fixes empty-content Copilot 502). |
| #7912 | PORTED | `open-sse/utils/reasoningPlaceholder.js` sentinel + `isInternalReasoningPlaceholder`; suppressed from streaming Chat<->Responses, transformer, and OpenAI->Claude. |
| #7906 | PORTED | One-shot Anthropic thinking-signature recovery on the exact `400 Invalid signature in thinking block`, active tool cycle preserved. |
| #7908 | PORTED | `isLocalStreamLifecycleError` classifier; single-model + combo cooldown accrual skip client aborts. DurinDoor has no provider-wide breaker (that half N/A). |
| #7905 | PARTIAL | Ported the two behavior-fixing units (type:custom schema normalization; non-stream custom_tool_call input). The streaming custom_tool_call lifecycle was already DUPLICATE. The additional_tools/namespace flattening + customToolNames Set threading was NOT ported: DurinDoor's Responses translator has no additional_tools/namespace intake, so no failing behavior to fix. |
| #7933 | NOT APPLICABLE | DurinDoor has no request-size combo compatibility filter (`evaluateContextLimit`) to attach a persisted context override to; the mismatch the PR fixes cannot reproduce. Porting would require adding a structural feature, not a bug fix. |

## 5. Upstream decolua/9router ports (Tier 1 + Tier 2) — NOT ACTIONABLE

The plan listed 35 upstream PR numbers (#2713, #2666, #2736, #2723, #2724, #2725,
#2710, #2709, #2454, #2453, #2747, #2667, #2663, #2647, #1819, #2658, #2657, #1570,
#2652, #2686, #1488, #2731, #2279, #2691, #2705, #2706, #2689, #2697, #2698, #1717,
#2343, plus the Tier-2 UI set).

Verification against the live `upstream/master` (decolua/9router):
- `git fetch upstream` then `git log upstream/master --grep "(#N)"` for every listed PR.
- Upstream uses the `(#N)` squash-merge subject format (273 such refs in history).
- The **highest PR number present in upstream/master is #2596**. Every listed PR
  >= #2647 therefore cannot exist upstream, and the in-range lower ones (#1488, #1570,
  #1717, #1819, #2279, #2343, #2453, #2454, #2647, #2652, #2658, #2663, #2667, ...)
  produce ZERO matches with the exact `(#N)` format.

Conclusion: none of the plan's 35 upstream PR numbers correspond to real merged
commits in the actual upstream. There is no source diff to port from. Per the delivery
contract (no fabricated outputs) and the plan's own §67 ("if a real-life repo check
reveals a different number of port-acceptable PRs, record the delta in the campaign
ledger"), this section is recorded as NOT ACTIONABLE rather than fabricating ports.

If the maintainer can supply the real upstream PR identifiers or the intended
behaviors, they can be re-scoped and ported in a follow-up.
