# Issue #1111 Provider Readiness Acceptance & Evidence Audit

Audit of merged provider readiness, capability provenance, and transient error resilience implementation against GitHub issue #1111 acceptance criteria.

Date: 2026-11-21  
Target: `bloodf/durindoor:main` (branch `orq/toty04/n1111-audit-a1-l3`)  
Issue Reference: [bloodf/durindoor#1111](https://github.com/bloodf/durindoor/issues/1111)  
Outcome Target: Provide truthful readiness and blockers for providers, separating catalog listings from dispatchable executors, authenticated credentials, and actual live inference, while preventing transient errors from auto-disabling credentials.

---

## 1. Executive Summary & Verification Evidence

Issue #1111 addresses the finding from [`internal/docs/provider-expansion-audit.json`](../../orq-toty04-n1111-audit--218fc8784afb352d/internal/docs/provider-expansion-audit.json) where 273 retained provider rows had inference marked `NOT_EXERCISED`. A catalog listing or dispatch configuration must never be misrepresented as verified live inference. The merged implementation establishes a four-tier readiness hierarchy (`catalog`, `dispatch`, `authentication`, `inference`), exposes read-only local readiness via `GET /api/providers/[id]/readiness` and dashboard UI components, tracks modality/tool capability declaration provenance, and ensures transient upstream errors (network drops, HTTP 5xx, rate limits) do not auto-disable valid credentials.

### Mandatory Verification Suite Execution

Command executed:
```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/1111-provider-readiness.test.js unit/1111-readiness-ui.test.js --maxWorkers=2
```

Result:
- **Test files**: 2 passed (2 total)
- **Tests**: 6 passed (6 total)
- **Duration**: ~4.55s
- **Breakdown**:
  - [`tests/unit/1111-provider-readiness.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/1111-provider-readiness.test.js): 3 passed
    - separates catalog and configured chat dispatch from live evidence (`catalog: LISTED`, `chatDispatch: CONFIGURED`, `authentication.status: UNKNOWN`, `inference.status: UNKNOWN`)
    - does not treat blocked or unknown providers as dispatchable (`devin` -> `UNSUPPORTED`, `missing-provider` -> `NOT_LISTED`)
    - reports only configured native kinds, including websocket routes (`gemini` -> `live`, `codex` -> `[]`)
  - [`tests/unit/1111-readiness-ui.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/1111-readiness-ui.test.js): 3 passed
    - shows local configuration separately from unknown live evidence (`Listed`, `Configured, not verified`, `Unknown — no fresh timestamped evidence`, `Unknown — no account, model and operation-bound evidence`, `Unlisted native operations are unsupported`, `Missing or stale evidence`)
    - fails closed for missing data and identifies unsupported dispatch
    - starts in a loading state without making a server-side request

### Extended Related Test Suite Execution

All 11 related unit suites covering provider readiness, UI evidence, transient error preservation, and capability provenance pass without regressions (126 tests passed in 13.83s):
- [`tests/unit/1111-provider-readiness.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/1111-provider-readiness.test.js) (3 tests)
- [`tests/unit/1111-readiness-ui.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/1111-readiness-ui.test.js) (3 tests)
- [`tests/unit/native-provider-readiness.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/native-provider-readiness.test.js) (4 tests)
- [`tests/unit/native-provider-readiness-render.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/native-provider-readiness-render.test.js) (1 test)
- [`tests/unit/provider-readiness-switch.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/provider-readiness-switch.test.js) (16 tests)
- [`tests/unit/provider-readiness-ui.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/provider-readiness-ui.test.js) (16 tests)
- [`tests/unit/provider-validation-transient.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/provider-validation-transient.test.js) (9 tests)
- [`tests/unit/provider-validation-unavailable-route.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/provider-validation-unavailable-route.test.js) (35 tests)
- [`tests/unit/provider-validation-unavailable-ui.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/provider-validation-unavailable-ui.test.js) (15 tests)
- [`tests/unit/provider-test-unavailable-contract.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/provider-test-unavailable-contract.test.js) (17 tests)
- [`tests/unit/model-auto-sync-route.test.js`](../../orq-toty04-n1111-audit--218fc8784afb352d/tests/unit/model-auto-sync-route.test.js) (7 tests)

---

## 2. Requirement-to-Evidence Matrix

| # | Acceptance Criterion | Implementation Scope & Mechanism | Exact Code Locations | Covering Tests | Status |
|---|---|---|---|---|---|
| **1** | **Separate catalog metadata, dispatchable executor, authenticated validation and actual inference results** | • Four-tier readiness separation in `providerReadiness`: `catalog` (`LISTED` / `NOT_LISTED`), `chatDispatch` (`CONFIGURED` / `UNSUPPORTED` / `UNKNOWN`), `authentication` (`UNKNOWN`), `inference` (`UNKNOWN`).<br>• `GET /api/providers/[id]/readiness` endpoint serves read-only local configuration without network calls.<br>• `nativeProviderReadiness` utility decouples catalog presence from native dispatch routes and saved validation history.<br>• `InferenceStatus` component displays session-scoped inference outcomes (`not tested`, `passed`, `failed`, `skipped`) decoupled from connection status. | • [`src/shared/services/providerReadiness.js:6-32`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/shared/services/providerReadiness.js#L6-L32)<br>• [`src/app/api/providers/[id]/readiness/route.js:1-8`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/providers/[id]/readiness/route.js#L1-L8)<br>• [`src/shared/utils/nativeProviderReadiness.js:11-23`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/shared/utils/nativeProviderReadiness.js#L11-L23)<br>• [`src/app/(dashboard)/dashboard/providers/[id]/ReadinessEvidence.jsx:30-45`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/ReadinessEvidence.jsx#L30-L45)<br>• [`src/app/(dashboard)/dashboard/providers/[id]/NativeProviderReadiness.jsx:4-21`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/NativeProviderReadiness.jsx#L4-L21)<br>• [`src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.jsx:1-10`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/InferenceStatus.jsx#L1-L10)<br>• [`docs/features/provider-readiness.md:1-11`](../../orq-toty04-n1111-audit--218fc8784afb352d/docs/features/provider-readiness.md#L1-L11) | • `tests/unit/1111-provider-readiness.test.js` (lines 5–22)<br>• `tests/unit/1111-readiness-ui.test.js` (lines 7–31)<br>• `tests/unit/native-provider-readiness.test.js` (lines 5–39)<br>• `tests/unit/native-provider-readiness-render.test.js` (lines 6–24)<br>• `tests/unit/provider-readiness-switch.test.js` (lines 68–83, 94–100)<br>• `tests/unit/provider-readiness-ui.test.js` (lines 10–19) | **Met** |
| **2** | **Surface stale evidence and unsupported modality/tool limits in provider detail and discovery** | • Provider detail exposes explicit disclosures: saved validations lack timestamps; missing or stale evidence remains UNKNOWN.<br>• Native operation kinds are enumerated; unlisted native operations are documented as unsupported on the native route.<br>• `ModelRow.js` renders `declaredCaps` via `getDeclaredModelCapabilities`, distinguishing "declared supported", "declared unsupported", and "UNKNOWN" without conflating missing metadata with negative claims.<br>• Auto-sync model discovery preserves declaration snapshots (`discoveredCapabilities`) and provenance (`metadataSources`), preventing synthetic defaults from corrupting declared capability state. | • [`src/app/(dashboard)/dashboard/providers/[id]/NativeProviderReadiness.jsx:15-17`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/NativeProviderReadiness.jsx#L15-L17)<br>• [`src/app/(dashboard)/dashboard/providers/[id]/ReadinessEvidence.jsx:42-43`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/ReadinessEvidence.jsx#L42-L43)<br>• [`src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js:8-13, 68-75`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js#L8-L13)<br>• [`src/app/api/models/auto-sync/route.js:21-25, 55-56`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/models/auto-sync/route.js#L21-L25)<br>• [`src/app/(dashboard)/dashboard/providers/page.js:430, 822`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/page.js#L430) | • `tests/unit/1111-readiness-ui.test.js` (lines 7–19)<br>• `tests/unit/provider-readiness-ui.test.js` (lines 28–82)<br>• `tests/unit/model-auto-sync-route.test.js` (lines 54–60)<br>• `tests/unit/native-provider-readiness.test.js` (lines 27–39) | **Met** |
| **3** | **Do not auto-disable a valid credential because of transient provider errors** | • `providerProbe.js` categorizes network failures (`status: null`) and upstream HTTP 5xx responses as `unavailable: true` with error `"Provider unavailable - try again later"`.<br>• `testSingleConnection` detects `result.unavailable === true` and returns early without calling `updateProviderConnection`, keeping `testStatus` unchanged.<br>• OAuth test probes classify 429, 5xx, `TimeoutError`, and `AbortError` as `unavailable: true`, preserving saved tokens, `testStatus`, and metadata.<br>• `providerValidationOutcome` strictly distinguishes `unavailable` from `failed`.<br>• Batch connection tests aggregate `unavailable` separately from `failed` in summaries and notifications. | • [`src/app/api/providers/providerProbe.js:14, 70, 392, 430-439, 441, 448, 454, 462`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/providers/providerProbe.js#L14)<br>• [`src/app/api/providers/[id]/test/testUtils.js:482-484, 501-503, 513-515, 1138-1140, 1167-1171`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/providers/[id]/test/testUtils.js#L1167-L1171)<br>• [`src/app/api/providers/validate/route.js:892-894`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/providers/validate/route.js#L892-L894)<br>• [`src/app/api/providers/test-batch/route.js:72, 88, 120-121`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/providers/test-batch/route.js#L72)<br>• [`src/shared/utils/providerValidationOutcome.js:1-4`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/shared/utils/providerValidationOutcome.js#L1-L4) | • `tests/unit/provider-validation-transient.test.js` (lines 8–25)<br>• `tests/unit/provider-validation-unavailable-route.test.js` (lines 54–100)<br>• `tests/unit/provider-validation-unavailable-ui.test.js` (lines 35–45, 47–62, 98–101)<br>• `tests/unit/provider-test-unavailable-contract.test.js` (lines 14–26, 28–41, 76–100) | **Met** |

---

## 3. Deep-Dive Analysis of Acceptance Criteria

### Criterion 1: Separation of Catalog, Dispatch, Authentication, and Inference

The baseline problem identified in the retained provider expansion audit was conflating a catalog listing with functional, verified inference. 

The implementation enforces a strict 4-level separation:
1. **Catalog Metadata**: Checked via `REGISTRY.find(item => item.id === providerId)`. If present, reported as `"LISTED"` (`"Listed"` in UI); if absent, `"NOT_LISTED"`. Being in the catalog confers no guarantee of executor presence or credential validity.
2. **Dispatchable Executor / Transport**: Checked via `getExecutor(providerId)` and `entry.transport`. If the provider maps to `UnsupportedOmniRouteWebSessionExecutor` or lacks transport/specialized executor, it returns `"UNSUPPORTED"`. If an executor or transport is present, it returns `"CONFIGURED"` (`"Configured, not verified"` in UI). In native provider routes, `nativeRoutes` checks `NATIVE_OPERATIONS` and `NATIVE_WEBSOCKETS`, reporting `"Configured, not verified"` vs `"No dedicated native route configured"`.
3. **Authenticated Validation**: The endpoint `GET /api/providers/[id]/readiness` returns `{ status: "UNKNOWN", evidence: "No timestamped authentication evidence available" }`. In `nativeProviderReadiness`, saved connection validations are counted, but accompanied by the explicit warning: *"These records have no validation timestamp and do not prove current authentication or inference."*
4. **Actual Inference Results**: Returned by `providerReadiness` as `{ status: "UNKNOWN", evidence: "No account, model and operation-bound inference evidence available" }`. In the provider detail dashboard, model inference outcomes are tracked by `InferenceStatus` per-session only upon explicit user testing, completely isolated from catalog presence and connection validation.

### Criterion 2: Surfacing Stale Evidence and Modality/Tool Limits

1. **Stale Evidence Disclosures**:
   - Both [`NativeProviderReadiness.jsx`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/NativeProviderReadiness.jsx#L15-L17) and [`ReadinessEvidence.jsx`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/ReadinessEvidence.jsx#L42-L43) explicitly warn operators that saved validations carry no timestamp and that missing or stale evidence remains `UNKNOWN`.
   - On the top-level providers page ([`src/app/(dashboard)/dashboard/providers/page.js:430`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/page.js#L430)), a banner emphasizes: *"Connection status and catalog listings do not establish live inference. Open a provider for local readiness evidence and modality limits."* Free/no-auth providers display a neutral badge (`"Enabled"`) rather than claiming to be `"Ready"`.
2. **Modality & Tool Limits in Provider Detail**:
   - In [`ModelRow.js:8-13`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js#L8-L13), `getDeclaredModelCapabilities` inspects `model.discoveredCapabilities ?? (model.metadataSources ? {} : model.capabilities)` combined with overrides.
   - Vision and tools metadata are explicitly rendered as `"declared supported"`, `"declared unsupported"`, or `"UNKNOWN"`. Missing capability metadata remains `"UNKNOWN"` rather than being presumed unsupported.
3. **Discovery Provenance Preservation**:
   - In [`src/app/api/models/auto-sync/route.js:22-24, 55-56`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/models/auto-sync/route.js#L22-L24), `modelRows` preserves `discoveredCapabilities` and `metadataSources` through model auto-sync to ensure the UI does not misrepresent default/fallback pattern matches as authoritative provider declarations.

### Criterion 3: Transient Provider Error Handling & Credential Preservation

1. **Error Classification**:
   - In [`src/app/api/providers/providerProbe.js:14`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/providers/providerProbe.js#L14), `temporaryFailure` constructs `{ valid: false, unavailable: true, status, error: ... }`.
   - Upstream HTTP status codes 500, 502, 503, 504 and network disconnects (`status: null`) are classified as `unavailable: true`.
   - Only definite authentication rejections (HTTP 401, 403) are classified as invalid credentials (`valid: false`, `unavailable: false`).
2. **Fencing Connection State Mutation**:
   - In [`src/app/api/providers/[id]/test/testUtils.js:1167-1171`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/providers/[id]/test/testUtils.js#L1167-L1171):
     ```javascript
     if (result.unavailable) {
       return { valid: false, unavailable: true, error: resultError, refreshed: false, latencyMs, testedAt: new Date().toISOString() };
     }
     ```
     When `unavailable` is true, `testSingleConnection` returns immediately without executing `updateProviderConnection(id, updateData)`. The connection's existing `testStatus` (e.g., `"active"`) is preserved.
3. **OAuth Resilience**:
   - Transient OAuth probe responses (HTTP 429, 5xx, `TimeoutError`, `AbortError`) return `{ valid: false, unavailable: true, error: ... }`. The database row is not touched, preserving tokens, expiration timestamps, and previous test metadata.
4. **UI and Batch Isolation**:
   - `providerValidationOutcome(data)` returns `"unavailable"` (never `"failed"`) when `data.unavailable === true`.
   - Batch testing ([`src/app/api/providers/test-batch/route.js:120-121`](../../orq-toty04-n1111-audit--218fc8784afb352d/src/app/api/providers/test-batch/route.js#L120-L121)) tracks `unavailable` separately from `failed`, ensuring toast notifications report `"0/2 passed, 1 failed, 1 unavailable"` and only the genuine failure triggers a database update.

---

## 4. Concrete Outstanding Gaps, Verification Limitations & Architectural Boundaries

While the contracts mandated by #1111 are implemented and verified offline, the following concrete limitations, boundaries, and gaps must be documented candidly:

### 1. Verification Limitations: Hermetic / Offline Execution Only
- **No Live Provider Testing**: In strict accordance with the issue delivery contract and execution instructions, live providers (`RUN_REAL=1`) were not contacted. All test assertions run with mocked transports or synthetic responses.
- **273 Retained Audit Rows Remain NOT_EXERCISED**: The 273 provider audit rows in [`internal/docs/provider-expansion-audit.json`](../../orq-toty04-n1111-audit--218fc8784afb352d/internal/docs/provider-expansion-audit.json) retain `inferenceStatus: "NOT_EXERCISED"`. The implementation satisfies #1111 by *truthfully exposing* that inference is unknown rather than claiming support, but actual live verification of those 273 rows remains unperformed.
- **Headless UI Simulation**: Front-end components were verified using Node static SSR (`renderToStaticMarkup`) and `happy-dom`. No live browser render, CSS visual regression check, or manual browser interaction was performed.

### 2. Endpoint Coverage Scope (Chat and Native Routes Only)
- `GET /api/providers/[id]/readiness` reports `chatDispatch` and `nativeKinds`.
- Other gateway routes (`/v1/embeddings`, `/v1/images`, `/v1/videos`, `/v1/audio`) are not evaluated by the readiness service. While the provider registry and media handlers may route requests for these modalities, the readiness endpoint itself does not surface dedicated dispatch status for non-chat endpoints.

### 3. Uniform UNKNOWN State & Absence of Persistent Inference Receipts
- `providerReadiness(providerId)` unconditionally sets `authentication.status = "UNKNOWN"` and `inference.status = "UNKNOWN"`.
- There is currently no persistent database table or receipt ledger storing timestamped, account-and-model-bound inference verification records that could promote a provider from `"UNKNOWN"` to `"VERIFIED"`.
- Front-end model testing via `InferenceStatus.jsx` is ephemeral to the active browser session; navigating away or refreshing resets all model inference states to `"Inference not tested"`.

### 4. Declared Capabilities vs. Upstream Runtime Reality
- `ModelRow.js` surfaces `declaredCaps` (vision/tools) based on catalog discovery (`discoveredCapabilities`) or manual user overrides.
- Declared capability support reflects provider metadata claims, not verified execution. An upstream provider or model may declare tool or vision support in its models endpoint, but fail at runtime due to account tier restrictions, regional gating, or model deprecation.

### 5. Network Outage Ambiguity & Failure Modes
- Any generic network failure (DNS resolution error, timeout, aborted socket) in `providerProbe.js` results in `unavailable: true`.
- If an invalid API key causes an upstream reverse proxy or CDN to drop the connection or timeout rather than returning a clean 401/403, the probe treats the event as a transient outage, preventing the credential from being marked invalid. While this prevents false negatives, it requires manual inspection if a connection remains indefinitely in an `"unavailable"` state.

---

## 5. Conclusion & Acceptance Status Summary

The acceptance criteria defined in GitHub issue #1111 are **Met** in the codebase:
1. **Four-Tier Readiness Separation**: Catalog metadata, chat executor dispatch, authenticated validation, and live inference are cleanly decoupled in both the local API (`/api/providers/[id]/readiness`) and UI components (`NativeProviderReadiness`, `ReadinessEvidence`, `InferenceStatus`).
2. **Surfacing Stale Evidence and Limits**: Explicit disclosures surface that saved validations lack timestamps and that missing evidence remains `UNKNOWN`. Modality and tool declarations are distinguished between declared supported, declared unsupported, and unknown.
3. **Transient Error Resilience**: Network errors, timeouts, and HTTP 5xx responses are classified as `unavailable: true`, preventing connection updates from disabling valid credentials or corrupting OAuth metadata.

The implementation is verified by 6 passing vitest tests in the primary evidence suites (`unit/1111-provider-readiness.test.js` and `unit/1111-readiness-ui.test.js`), and supported by 120 additional passing tests across 9 related unit suites with zero regressions.
