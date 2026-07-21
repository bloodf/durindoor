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

## 5. Upstream decolua/9router ports (Tier 1 + Tier 2)

CORRECTION: the plan's upstream PR numbers are OPEN (unmerged) pull requests
against decolua/9router:master, not merged commits. An earlier draft of this
ledger wrongly concluded they did not exist because it searched merged history
(`git log --grep`) instead of open PRs; each was then re-verified OPEN via the
GitHub PR API. Every listed PR's live diff was read and compared against the
current fork before deciding to port or record DUPLICATE.

### Ported (genuine gaps, with tests)
| PR | Change |
|----|--------|
| #1570 | Bound proxy ProxyAgent connect/headers timeouts (env-tunable); bodyTimeout:0 so long SSE survives a slow proxy. |
| #2709 | Request-log dirs 0o700 / files 0o600 (logs hold masked-but-sensitive request data). |
| #2706 | `ensureThinkingSignature` quirk on minimax/minimax-cn + empty-signature injection on unsigned Anthropic thinking-block starts in stream.js. |
| #2705 | Skip reasoning_content injection in DefaultExecutor when the runtime transport speaks Claude. |
| #2658 | Fold Claude cache tokens into OpenAI prompt_tokens via new `claudeUsageToOpenAI()` in the non-stream Claude usage mapping. |
| #2663 | Reconcile Claude tool_result blocks against the immediately-previous tool_use; demote unpaired results to user text. |
| #2686 | Show non-media combo kinds on the combos page (was filtering to `llm` only). |
| #2697 | Bare `k3` capability pattern → 1M K3 window instead of the 200K default. |
| #2667 | Codex 400 invalid_encrypted_content one-shot recovery (strip encrypted reasoning, retry same account) + non-fallback classification. |
| #2689 | Combo empty-200 body retry (non-streaming only, to avoid consuming a live stream). |

### DUPLICATE (already present in the fork; verified, not re-ported)
| PR | Evidence |
|----|----------|
| #2747 | `nextOutputIndex`/`msgOutputIndexes`/`funcOutputIndexes` already allocated in openai-responses.js + index.js. |
| #2657 | `injectMessagesSystem` already has the `m.type === "message"` guard + input_text developer-message creation. |
| #2691 | `applyParamRenames` already renames max_tokens→max_completion_tokens for o1/o3/o4 + gpt-5.x (azure calls it). |
| #2279 | claude-to-openai already keeps string tool input; openai-to-claude already has `deduplicateDoubledJson`. |
| #1488 | build-cli.js already has the nested-standalone `server.js` discovery. |
| #2731 | kiro.js already lacks the transport-coupled REPAIR_INSTRUCTIONS/short-final heuristics this PR removes. |
| #2652 | `*claude*fable*` pattern already uses `claude-adaptive`. |

### Verified GAP but DEFERRED to dedicated follow-up PRs
These are real gaps, but each is a large multi-file FEATURE (not a targeted fix)
that deserves its own focused PR with full testing per the one-PR-per-concern
discipline in AGENTS.md §6. Bundling them into this campaign branch would produce
an unreviewable mega-diff and risk correctness in hot paths. Subagent parallelism
was unavailable (quota-exhausted), so they are queued rather than rushed.

| PR | Scope | Why deferred |
|----|-------|--------------|
| #1819 | codex workspace-account binding (7 files, new `codexAccount.js`) | new shared service + usage/quotaAutoPing wiring + new API route |
| #2664 | kiro confirmed-credit-exhaustion cooldown (errorConfig + kiro executor + auth cooldown math) | touches the security-sensitive `markAccountUnavailable` reset-cap math |
| #2688 / #2681 | kiro malformed/nested tool_call wrapper repair (large kiro executor additions) | flagged dirty in the plan; large transport-repair logic, re-evaluate upstream completeness first |
| #2647 | grok-cli Responses codec (new 551-line `grok-cli-compat.js`) | large standalone codec module |
| #2453 | per-key daily token limits (17 files: usage repos, UI, pricing) | large cross-cutting feature |
| #2454 | exact cost/tier/cache usage accounting (large) | large cross-cutting usage feature |
| #2698 | move headroom compression before translation | hot-path reorder entangled with rtk/caveman/ponytail/pxpipe + event/logging plumbing; needs careful restructuring |
| #2710 | provider-request correlation/observability (12 files, requestId threading) | large cross-cutting observability feature |
| #2713 / #2666 / #2736 | OpenAI Responses stream reconstruction + keep-alive + cache-affinity (streaming refactors, ordering-constrained) | large interdependent streaming refactors; #2713→#2666→#2736 ordering |
| #2343 | media remote-JSON size caps + provider hardening (large) | large media-subsystem feature |
| #2723 / #2724 | usage dashboard UI: denser tracker, daily request usage (UI + repos) | UI feature; #2723 must not pull globals.css until UI approved |
| #2725 | bind dev/start to 127.0.0.1 | DurinDoor uses a custom server (next-owner-server.cjs / custom-server.js), NOT `next dev/start`; the PR's package.json flag does not apply — bind behavior must be verified/fixed in the custom server instead |

If the maintainer wants any deferred item pulled into this branch or a dedicated
follow-up, they can be ported next with the same verify-then-implement discipline.
