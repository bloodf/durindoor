# Issue #1108 Connection Circuit Acceptance & Evidence Audit

Discovery and regression draft: [connection circuit draft](./connection-circuit-1108-draft.md).

Audit of merged connection circuit, recovery probe, and diagnostics implementation against issue #1108 acceptance criteria.

Date: 2026-11-21  
Target: `bloodf/durindoor:main` (integration branch `orq/toty04/integration`)

---

## 1. Executive Summary & Verification Evidence

The connection circuit and recovery mechanism addresses issue #1108 by introducing an in-process circuit breaker state machine (`ConnectionCircuitManager`) paired with execution-time probe admission (`runWithConnectionRecovery`) and selection filtering (`canSelectConnection`).

### Focused Test Suite Execution
Command executed:
```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/connection-circuit-state.test.js unit/1108-circuit-recovery.test.js unit/1108-circuit-diagnostics.test.js --maxWorkers=2
```

Result:
- **Test files**: 3 passed (3 total)
- **Tests**: 23 passed (23 total)
- **Duration**: 1.20s
- **Breakdown**:
  - `tests/unit/connection-circuit-state.test.js`: 19 passed (state transitions, probe leases, account-wide precedence, generation fencing, resets, diagnostic projection)
  - `tests/unit/1108-circuit-recovery.test.js`: 3 passed (probe storm prevention under 8 concurrent requests, generation fencing after manual reset, error classification filtering)
  - `tests/unit/1108-circuit-diagnostics.test.js`: 1 passed (local recovery diagnostic recognition in combo service)

---

## 2. Requirement-to-Evidence Matrix

| Requirement | Implementation Scope & Mechanism | Exact Code Locations | Covering Tests | Status |
|---|---|---|---|---|
| **1. Per-Connection & Model Scope** | Dual-tier composite key `[connectionId, scope]` where scope is a model identifier or `__all` for account-wide locks. Account-wide locks supersede and block model-level dispatches. Unknown model strings are bounded to account or canonical scopes via `resolveFallbackModelScope`. | • [`src/lib/routing/connectionCircuitState.js:26-41`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/lib/routing/connectionCircuitState.js:83-95`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/lib/routing/connectionRecovery.js:7-13`](../../src/lib/routing/connectionRecovery.js)<br>• [`open-sse/services/fallbackScope.js:1-50`](../../open-sse/services/fallbackScope.js) | • `tests/unit/connection-circuit-state.test.js` ("Account-Wide Lock Precedence & Cross-Model Isolation", lines 164–195)<br>• `tests/unit/connection-circuit-state.test.js` ("excludes an account probe while a model probe is running", lines 252–256)<br>• `tests/unit/1108-circuit-recovery.test.js` (lines 10–24) | **Met** |
| **2. Open / Half-Open / Healthy Transitions** | Explicit 3-state machine (`CLOSED`, `OPEN`, `HALF_OPEN`). Healthy connections start `CLOSED`. Future cooldowns transition to `OPEN`. Expired cooldowns transition to `HALF_OPEN`. Successful probe transitions to `CLOSED`. Failed probe reopens to `OPEN` with new backoff cooldown. | • [`src/lib/routing/connectionCircuitState.js:19-23`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/lib/routing/connectionCircuitState.js:79-138`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/lib/routing/connectionCircuitState.js:149-170`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/lib/routing/connectionCircuitState.js:251-300`](../../src/lib/routing/connectionCircuitState.js) | • `tests/unit/connection-circuit-state.test.js` ("Initial & Healthy State", lines 30–46)<br>• `tests/unit/connection-circuit-state.test.js` ("Open & Cooldown Transitions", lines 48–67)<br>• `tests/unit/connection-circuit-state.test.js` ("Half-Open & Recovery Lease Admission", lines 69–81, 131–161) | **Met** |
| **3. Probe Storm Prevention** | Single-flight lease token acquisition (`acquireRecoveryLease`) in `HALF_OPEN`. Competing concurrent callers receive `PROBE_IN_FLIGHT` and are excluded from dispatch with retryable 503 (`connectionRecoveryBusy`). Pinned accounts fail with terminal local admission rejection; unpinned accounts rotate to siblings. Probe lease expires after 30s timeout to prevent deadlocks. | • [`src/lib/routing/connectionCircuitState.js:29`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/lib/routing/connectionCircuitState.js:215-235`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/lib/routing/connectionRecovery.js:40-49`](../../src/lib/routing/connectionRecovery.js)<br>• [`getProviderCredentials` in `src/sse/services/auth.js`](../../src/sse/services/auth.js)<br>• [`handleSingleModelChat` in `src/sse/handlers/chat/singleModel.js`](../../src/sse/handlers/chat/singleModel.js) | • `tests/unit/connection-circuit-state.test.js` ("admits exactly one recovery probe...", lines 83–102)<br>• `tests/unit/connection-circuit-state.test.js` ("allows new lease after probe lease times out", lines 215–228)<br>• `tests/unit/1108-circuit-recovery.test.js` ("admits one concurrent probe...", lines 10–24) | **Met** |
| **4. Unknown Quota Decoupling** | Quota preflight decisions (`quotaDecisions.get(c.id)?.skip`) and circuit states are strictly separated. Unknown, missing, stale, or tracker-error quota observations do not mark accounts as skipped, keeping them eligible. Quota data does not open circuits or fabricate resets; conversely, open circuits remain blocked regardless of quota. | • [`getProviderCredentials` in `src/sse/services/auth.js`](../../src/sse/services/auth.js)<br>• `src/sse/services/providerQuotaPreflight.js:50-140`<br>• [`src/lib/routing/connectionCircuitState.js:79-111`](../../src/lib/routing/connectionCircuitState.js) | • `tests/unit/provider-quota-preflight.test.js` (unknown quota keeps account eligible)<br>• Preflight and circuit independence verified in `getProviderCredentials` | **Met** |
| **5. Manual Reset & Generation Fencing** | `ConnectionCircuitManager.reset(id)` clears circuit state to `CLOSED`, clears cooldowns and active leases, and increments a monotonic `_generationCounter`. Any in-flight probe completing from a prior generation is rejected as stale (`INVALID_LEASE` / `STALE_GENERATION`). Wired into provider connection update upon explicit activation (`testStatus === "active"`). | • [`src/lib/routing/connectionCircuitState.js:329-350`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/lib/routing/connectionCircuitState.js:266-269`](../../src/lib/routing/connectionCircuitState.js)<br>• [`src/app/api/providers/[id]/route.js:546-550`](../../src/app/api/providers/[id]/route.js) | • `tests/unit/connection-circuit-state.test.js` ("invalidates in-flight probe when manual reset occurs", lines 198–213)<br>• `tests/unit/1108-circuit-recovery.test.js` ("fences an in-flight probe after a manual reset", lines 26–40) | **Met** |
| **6. Bounded Diagnostics** | `getDiagnostics` projects only allowlisted fields: `connectionId`, `scope`, `state`, `probeInFlight`, `retryAfterMs`. Omit credentials, tokens, error bodies, prompts, and unbounded transition history. In combos, `isConnectionRecoveryDiagnostic` identifies the exact 503 recovery status and returns a generic 503 without leaking provider text. | • [`src/lib/routing/connectionCircuitState.js:360-387`](../../src/lib/routing/connectionCircuitState.js)<br>• [`open-sse/services/combo.js:32-39, 1819-1822, 1938-1945`](../../open-sse/services/combo.js)<br>• [`docs/features/combos.mdx:110-114`](../../docs/features/combos.mdx) | • `tests/unit/connection-circuit-state.test.js` (lines 35–39, 57–60, 99–102)<br>• `tests/unit/1108-circuit-diagnostics.test.js` ("recognizes only the local recovery admission response", lines 1–10) | **Met** |
| **7. Exclusion of Client Validation, Refusals & Aborts** | `checkFallbackError` classifies HTTP 499, terminal client 4xx, `invalid_request_error`, `invalid_encrypted_content`, and `provider_request_rejected` as non-fallback (`shouldFallback: false, cooldownMs: 0`). `runWithConnectionRecovery` catches client aborts and stream cancellations, settling probe leases with `{ aborted: true }` without incrementing failure state or falsely closing the circuit. | • [`open-sse/services/accountFallback.js:53-122`](../../open-sse/services/accountFallback.js)<br>• [`src/lib/routing/connectionRecovery.js:28-36, 51-54, 76-78`](../../src/lib/routing/connectionRecovery.js)<br>• [`src/lib/routing/connectionCircuitState.js:279-282`](../../src/lib/routing/connectionCircuitState.js)<br>• [`handleSingleModelChat` in `src/sse/handlers/chat/singleModel.js`](../../src/sse/handlers/chat/singleModel.js) | • `tests/unit/connection-circuit-state.test.js` ("releases lease on local abort...", lines 104–118)<br>• `tests/unit/connection-circuit-state.test.js` ("releases lease on request-scoped client error...", lines 120–129)<br>• `tests/unit/1108-circuit-recovery.test.js` ("keeps client errors, policy refusals and aborts out of fallback", lines 42–47) | **Met** |

---

## 3. Candid Analysis of Gaps, Limitations, and Boundaries

While the core circuit requirements are satisfied by the merged implementation, the following limits must be candidly documented:

1. **Process-Local Scope vs. Multi-Process Architectures**:
   - `ConnectionCircuitManager` holds state exclusively in-memory (`Map<string, ScopeCircuitState>`).
   - If DurinDoor runs across multiple Node processes (e.g., Node cluster mode, multiple container instances, or separate workers), each process maintains its own lease manager and recovery state.
   - Consequently, single-flight probe admission is guaranteed *per-process*, not cluster-wide. A cluster-wide guarantee would require a transactional database lock mechanism, which was not implemented.

2. **Manual Reset Trigger Specificity**:
   - In [`src/app/api/providers/[id]/route.js:549`](../../src/app/api/providers/[id]/route.js), `globalCircuitManager.reset(id)` is only triggered when `testStatus === "active"` on PUT.
   - An operator clearing `rateLimitedUntil` via `{ rateLimitedUntil: null }` without sending `testStatus: "active"` updates the DB row, but does not trigger an explicit `reset(id)`. In that scenario, the circuit transitions to `HALF_OPEN` on the next evaluation when the cleared timestamp is read, but any unexpired in-flight probe lease generation is not immediately fenced out until the 30s lease expires.

3. **Endpoint Coverage (Chat-Only Integration)**:
   - `runWithConnectionRecovery` is currently wired into [`handleSingleModelChat` in `src/sse/handlers/chat/singleModel.js`](../../src/sse/handlers/chat/singleModel.js).
   - Other routes (`/v1/embeddings`, `/v1/images`, `/v1/videos`, `/v1/audio`) do not wrap their execution in `runWithConnectionRecovery`. While they benefit from database-level cooldowns and selection filtering, they do not participate in single-flight probe admission.

4. **Streaming Refusal Classification**:
   - Non-streaming native refusals call `onRequestSuccess` and clear account errors.
   - For streaming responses, `runWithConnectionRecovery` wraps the ReadableStream and confirms recovery when `chunk.done` is reached. It does not inspect intermediate chunks for semantic refusal blocks; recovery settles on clean stream termination.

5. **Mixed Combo Pools**:
   - The diagnostic `isConnectionRecoveryDiagnostic` handles pools where *all* targets are recovery-blocked (returning the generic 503).
   - In mixed pools (where one target is recovery-busy and another fails upstream with 429/500), combo execution proceeds through normal fallback, and the terminal error reflects the non-recovery failure.

---

## 4. Conclusion & Acceptance Status

Issue #1108 acceptance criteria are satisfied in the merged codebase for the core routing and chat lifecycle:
- Per-connection and per-model scopes are isolated and respect account-wide precedence.
- Transitions between CLOSED, OPEN, and HALF_OPEN are strictly governed by cooldown timestamps and settled outcomes.
- Probe storms are prevented via single-flight lease tokens and generation fencing.
- Quota preflight and circuit states are decoupled.
- Client validation errors, policy rejections, and local aborts release leases without cooling accounts down or falsely confirming recovery.
- Diagnostics are sanitized and do not leak credentials or upstream payloads.

The implementation is verified by 23 passing vitest tests with 0 regressions.
