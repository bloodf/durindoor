# Issue #1129 Acceptance Evidence & Operational Metrics Audit

Audit of merged operational metrics, admission queue observation, event-loop latency tracking, and runtime pressure diagnostics against GitHub issue #1129 (consolidating issue #1132).

**Date**: 2026-11-21  
**Target**: `bloodf/durindoor:main` (integration branch `orq/toty04/integration`)  
**Canonical Issue**: [#1129: feat(observability): expose authenticated operational metrics and runtime pressure](https://github.com/bloodf/durindoor/issues/1129)  
**Consolidated Issue**: [#1132: feat(observability): report event-loop stalls and runtime pressure](https://github.com/bloodf/durindoor/issues/1132)  

---

## 1. Executive Summary & Verification Evidence

Issue #1129 delivers an authenticated Prometheus operational metrics surface and bounded runtime pressure diagnostics across four incremental deliveries:
1. **[PR #1629](https://github.com/bloodf/durindoor/pull/1629)** (`985ddaf1a`): Authenticated aggregate metrics endpoint (`GET /api/monitoring/metrics`) and base exporter.
2. **[PR #1645](https://github.com/bloodf/durindoor/pull/1645)** (`f0c21bf6e`): Concurrency gate queue depth observation (`durindoor_admission_queued_requests`) and authorization boundaries.
3. **[PR #1656](https://github.com/bloodf/durindoor/pull/1656)** (`f925fd8f9`): HTTP outcome counters, duration histogram, provider connection state gauges, client admission denial tracking, and route-level wrappers.
4. **[PR #2139](https://github.com/bloodf/durindoor/pull/2139)** (`fddf5bf76`): Bounded event-loop stall recorder, monotonic excess drift detection, admission failure correlation, tolerant early timer tick handling, and Node boot integration in `src/instrumentation.node.js`.

### Focused Verification Execution

Focused test execution command:
```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/1129-operational-metrics.test.js unit/1129-runtime-pressure.test.js --maxWorkers=2
```

Execution Result:
- **Test Files**: 2 passed (2 total)
- **Tests**: 4 passed (4 total)
- **Duration**: 267ms
- **Regressions**: 0 failures, 0 skipped

#### Test Breakdown
1. **[`tests/unit/1129-operational-metrics.test.js`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-operational-metrics.test.js)** (3 tests):
   - `rejects unauthorized scrapes before reading active requests`: Validates that unauthorized requests return HTTP 401 with `Cache-Control: no-store` immediately without invoking `getActiveRequests()` or exposing any `durindoor_` metric lines.
   - `exports observed outcomes, latency, provider snapshot and queue without identifiers`: Verifies HTTP outcomes (`completed`, `http_error`), latency histogram buckets, provider health snapshot (`healthy: 2`, availability gauge `1`), queue depth transitions (`1` while blocked, `0` upon release), and strictly asserts zero leakage of private identifiers (`expect(body).not.toContain("private-")`).
   - `exports bounded stall diagnostics and admission correlation`: Validates simulated stall detection (> 5s drift), counter increments, peak stall duration export (`durindoor_event_loop_stall_max_seconds`), simultaneous admission failure correlation (`durindoor_event_loop_last_stall_admission_failures`), and enforces the 16-event ring buffer capacity cap.
2. **[`tests/unit/1129-runtime-pressure.test.js`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-runtime-pressure.test.js)** (1 test):
   - `accepts early timer ticks and correlates a later stall with gate failures`: Proves that a timer firing slightly early (990ms elapsed) is accepted as a usable reading (`durindoor_runtime_sampler_reading_available 1`) without warning, and subsequent stalls correctly record excess drift (6s) and correlate with gate failure counts without console warning spam.

---

## 2. Requirement-to-Evidence Matrix

| Acceptance Criterion | Implementation Scope & Mechanism | Exact Code Locations | Covering Tests | Status |
|---|---|---|---|---|
| **1. Define counters, histograms, gauges and label limits** | Implements standard Prometheus 0.0.4 text export: HTTP request totals and transport outcomes (`completed`, `http_error`, `stream_error`, `cancelled`, `handler_error`); cumulative duration histogram with 12 finite bucket bounds + `+Inf`; concurrency admission rejections (`timeout`, `aborted`); client admission denials (`auth_missing`, `auth_invalid`, `policy`, `client_limit`); in-flight request gauges (`durindoor_active_requests`, `durindoor_http_active_requests`); queue depth (`durindoor_admission_queued_requests`); provider health state snapshot (`healthy`, `degraded`, `down`, `blocked`, `unconfigured`, `unknown`); process metrics (`uptime`, `rss`, `event_loop_delay_p99_seconds`); and stall recorder metrics. All labels are strictly bounded to small frozen sets with zero dynamic user strings. | • [`open-sse/services/operationalMetrics.js:5-8, 243-280`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L5-L8)<br>• [`src/app/api/monitoring/metrics/route.js:29-45`](../../orq-toty04-n1129-audit--8080d2100d6166fb/src/app/api/monitoring/metrics/route.js#L29-L45)<br>• [`docs/operations/operational-metrics.mdx:10-35, 44-48`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L10-L35) | • `tests/unit/1129-operational-metrics.test.js:42-68`<br>• `tests/unit/operational-metrics-http-boundary.test.js`<br>• `tests/unit/operational-metrics-admission.test.js`<br>• `tests/unit/operational-metrics.test.js` | **Met with Route Gaps** |
| **2. Apply management authorization and document scraping configuration** | Route `GET /api/monitoring/metrics` guards execution via `isAdminScopedKey(request)` (admin API key), `hasValidCliToken(request)` (CLI token), or `hasValidToken(request)` (admin session cookie). Unauthorized callers receive HTTP 401 with `Cache-Control: no-store` without database or metric access. Anonymous loopback requests are explicitly blocked even when dashboard login is disabled. Documentation details scraper configuration, secret handling via bearer token files, TLS requirements, and 503 error semantics. | • [`src/app/api/monitoring/metrics/route.js:11-15`](../../orq-toty04-n1129-audit--8080d2100d6166fb/src/app/api/monitoring/metrics/route.js#L11-L15)<br>• [`docs/operations/operational-metrics.mdx:6-9`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L6-L9) | • `tests/unit/1129-operational-metrics.test.js:33-40`<br>• `tests/unit/operational-metrics-auth.test.js:1-75` | **Met** |
| **3. Test reset/restart semantics and zero raw credentials/session text** | State is held in-memory in `globalThis.__durindoorOperationalMetrics`. Process restarts clear all counters, active requests, health projections, and stall history. Metrics scraping is read-only and monotonic; usage history resets do not clear operational metrics. HMR/module reloads preserve counters via `??=`. `WeakMap` storage guarantees automatic GC of Request/Response associations. No request paths, URLs, query parameters, prompt/completion text, auth tokens, session cookies, or raw error messages are stored or exported. | • [`open-sse/services/operationalMetrics.js:10-33, 37-48, 160-170, 243-280`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L10-L33)<br>• [`docs/operations/operational-metrics.mdx:44-52`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L44-L52) | • `tests/unit/1129-operational-metrics.test.js:42-68`<br>• `tests/unit/operational-metrics-runtime.test.js` | **Met with Verification Limitations** |
| **4. Check existing latency probes and sampling overhead** | Event-loop latency sampling reuses Node.js native `perf_hooks.monitorEventLoopDelay({ resolution: 20 })` with process-wide singleton lifecycle. The stall recorder runs an unref'd 1-second `setInterval` timer without per-request timers. HTTP duration tracking records `performance.now()` and uses a zero-highwater-mark `ReadableStream` wrapper (`{ highWaterMark: 0 }`) without intermediate buffering or JSON payload parsing. Scrapes do not trigger upstream provider health checks, reading cached projections only. | • [`open-sse/services/operationalMetrics.js:2, 82-158, 188-195, 201-238`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L82-L158)<br>• [`docs/operations/operational-metrics.mdx:16, 34, 40-42, 50`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L40-L42) | • `tests/unit/1129-operational-metrics.test.js:4-6, 56, 70-84`<br>• `tests/unit/1129-runtime-pressure.test.js:3, 13-29` | **Met with Verification Limitations** |
| **5. Add bounded diagnostic events and correlate pressure with admission failures** | Diagnostic event ring buffer is capped strictly at 16 entries in `metrics.events` via FIFO eviction. Excess monotonic drift > 5000ms triggers a stall event recording simultaneous metrics: `delaySeconds`, `active` HTTP requests, `admissionFailures` (sum of concurrency gate timeouts and aborts), and process `rss`. Exposes metrics `durindoor_event_loop_stalls_total`, `durindoor_event_loop_stall_max_seconds`, and latest stall gauges. Diagnostic inspection is available via `getOperationalDiagnostics()`. | • [`open-sse/services/operationalMetrics.js:160-170, 201-241, 272-278`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L160-L170)<br>• [`docs/operations/operational-metrics.mdx:40-43, 52`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L40-L43) | • `tests/unit/1129-operational-metrics.test.js:70-84`<br>• `tests/unit/1129-runtime-pressure.test.js:13-29`<br>• `tests/unit/operational-metrics-runtime.test.js` | **Met** |
| **6. Handle unusable sampler readings without repeated log spam** | Timer drift calculation accepts slightly early timer ticks (elapsed < 1000ms but > 0) as usable. Non-finite or backwards clock values (`elapsed < 0`) mark readings as unavailable (`durindoor_runtime_sampler_reading_available 0`). Emits `console.warn("[metrics] Runtime sampler reading unavailable")` at most once per process lifetime via `warnedSampler` latch. Valid subsequent ticks automatically restore `readingAvailable = 1` without warning or log churn. Unusable RSS leaves memory values omitted. | • [`open-sse/services/operationalMetrics.js:26, 208-231, 271`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L208-L231)<br>• [`docs/operations/operational-metrics.mdx:42-43`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L42-L43) | • `tests/unit/1129-runtime-pressure.test.js:13-29`<br>• `tests/unit/operational-metrics-runtime.test.js` | **Met** |

---

## 3. Detailed Audit by Acceptance Criterion

### Criterion 1: Define counters/histograms/gauges and their label limits
- **Implementation State**:
  The metrics surface adheres to the Prometheus 0.0.4 text format with fixed `# TYPE` declarations.
  - **HTTP Metrics**:
    - `durindoor_http_requests_total` (counter): handler entry points wrapped by `observeHttpRequest`.
    - `durindoor_http_active_requests` (gauge): in-flight requests under active observation.
    - `durindoor_http_requests_completed_total{outcome="…"}` (counter): exactly 5 fixed labels (`completed`, `http_error`, `stream_error`, `cancelled`, `handler_error`).
    - `durindoor_http_errors_total` (counter): aggregate of `http_error`, `stream_error`, and `handler_error`.
    - `durindoor_http_request_duration_seconds` (histogram): 12 fixed buckets (`0.01` to `300` seconds) plus `+Inf`, `_count`, and `_sum`.
  - **Admission Metrics**:
    - `durindoor_admission_queued_requests` (gauge): process-wide sum of pending concurrency gate queues.
    - `durindoor_admission_failures_total{reason="…"}` (counter): concurrency rejections (`timeout`, `aborted`).
    - `durindoor_client_admission_failures_total{reason="…"}` (counter): local client denials reaching EOF (`auth_missing`, `auth_invalid`, `policy`, `client_limit`).
  - **Health & Runtime Metrics**:
    - `durindoor_provider_health_snapshot_available` (gauge): `1` if valid cache exists, `0` otherwise.
    - `durindoor_provider_connections{state="…"}` (gauge): 6 fixed connection states (`healthy`, `degraded`, `down`, `blocked`, `unconfigured`, `unknown`).
    - `durindoor_event_loop_delay_p99_seconds` (gauge): process lifetime p99 event loop latency.
    - `durindoor_event_loop_stalls_total` (counter) and stall duration/correlation gauges.
  - **Label Cardinality**:
    Strictly bounded. Only five metrics have labels (`outcome`, `le`, `reason` [concurrency], `reason` [client admission], `state`). No variable or user-controlled label dimensions exist.
- **Evidence References**:
  - Implementation: [`open-sse/services/operationalMetrics.js:5-8, 243-280`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L5-L8)
  - Scrape route: [`src/app/api/monitoring/metrics/route.js:29-45`](../../orq-toty04-n1129-audit--8080d2100d6166fb/src/app/api/monitoring/metrics/route.js#L29-L45)
  - Focused Test: [`tests/unit/1129-operational-metrics.test.js:42-68`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-operational-metrics.test.js#L42-L68)
- **Status**: **Met with Route Gaps** (see Section 4 for uninstrumented lifecycle routes).

---

### Criterion 2: Apply management authorization and document scraping configuration
- **Implementation State**:
  - `GET /api/monitoring/metrics` evaluates authorization synchronously before processing the request:
    - Verifies whether the request supplies an admin-scoped API key (`isAdminScopedKey`), a CLI bearer token (`hasValidCliToken`), or an authenticated dashboard cookie (`hasValidToken`).
    - Standard non-admin API keys fail authorization with HTTP 401.
    - Anonymous access on loopback is rejected even if `REQUIRE_API_KEY=false`.
    - Returns `Cache-Control: no-store` on all responses (401, 200, 503).
  - Documentation in [`docs/operations/operational-metrics.mdx:6-9`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L6-L9) specifies:
    - Scrape endpoint URL and supported credentials.
    - Instruction to keep credentials out of scrape URLs and Prometheus target labels.
    - Error handling: collection errors return HTTP 503 with a fixed message.
- **Evidence References**:
  - Route handler: [`src/app/api/monitoring/metrics/route.js:11-15`](../../orq-toty04-n1129-audit--8080d2100d6166fb/src/app/api/monitoring/metrics/route.js#L11-L15)
  - Documentation: [`docs/operations/operational-metrics.mdx:6-9`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L6-L9)
  - Focused Test: [`tests/unit/1129-operational-metrics.test.js:33-40`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-operational-metrics.test.js#L33-L40)
  - Auth test: [`tests/unit/operational-metrics-auth.test.js:1-75`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/operational-metrics-auth.test.js#L1-L75)
- **Status**: **Met**

---

### Criterion 3: Test reset/restart semantics and zero raw credentials/session text
- **Implementation State**:
  - **Reset Semantics**: All metric counts and states reside in `globalThis.__durindoorOperationalMetrics`.
    - Process restart resets all counters to 0, drops active request tracking, clears provider health projection, and resets stall history.
    - Scrapes never reset or clear counters (counters are strictly monotonically increasing).
    - Usage history resets (such as clearing SQLite/Postgres usage tables) do not affect in-memory operational metrics.
    - Module reloads in dev/HMR preserve counters via `globalThis.__durindoorOperationalMetrics ??= ...`.
  - **Zero Raw Credentials / Privacy**:
    - HTTP observation stores only weak references in `WeakMap` objects (`requests` and `responseAdmission`).
    - No header values, bearer tokens, cookie strings, prompt text, user IDs, or API key values are copied into metrics or diagnostics.
    - The diagnostic ring buffer records only numeric timestamps, counts, and enum strings.
- **Evidence References**:
  - State setup: [`open-sse/services/operationalMetrics.js:10-33`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L10-L33)
  - Focused Test: [`tests/unit/1129-operational-metrics.test.js:42-68`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-operational-metrics.test.js#L42-L68) (verifies `expect(body).not.toContain("private-")`)
  - Runtime test: [`tests/unit/operational-metrics-runtime.test.js`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/operational-metrics-runtime.test.js)
- **Status**: **Met with Verification Limitations** (tested in unit environment; live OS daemon restart untested).

---

### Criterion 4: Check existing latency probes and sampling overhead
- **Implementation State**:
  - Node.js event-loop latency probe uses `monitorEventLoopDelay({ resolution: 20 })`. It is enabled once and never reset or replaced.
  - The runtime pressure sampler runs a single unref'd `setInterval` timer (1s interval) created in `startOperationalMetricsRuntime()`. It adds zero timers per HTTP request.
  - HTTP observation adds minimal per-request overhead:
    - A `performance.now()` timestamp at request start and finish.
    - A zero-highwater-mark `ReadableStream` wrapper (`{ highWaterMark: 0 }`) that passes chunks directly without decoding, regex inspection, or JSON parsing.
    - Single abort event listener removed when finished.
  - Scrape overhead:
    - Pure string concatenation of pre-calculated in-memory numbers and cached health projections.
    - Does not trigger database queries or live provider health probes on scrape.
- **Evidence References**:
  - Sampler implementation: [`open-sse/services/operationalMetrics.js:188-195, 201-238`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L188-L195)
  - Documentation statement: [`docs/operations/operational-metrics.mdx:50`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L50)
  - Focused Tests: [`tests/unit/1129-operational-metrics.test.js`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-operational-metrics.test.js), [`tests/unit/1129-runtime-pressure.test.js`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-runtime-pressure.test.js)
- **Status**: **Met with Verification Limitations** (no formal benchmark profiling under high QPS saturation committed to repo).

---

### Criterion 5: Add bounded diagnostic events and correlate pressure with admission failures
- **Implementation State**:
  - **Bounded Ring Buffer**: `metrics.events` array stores at most 16 entries; oldest entries are evicted via `shift()` upon adding the 17th item.
  - **Stall Detection**: The 1-second interval checks `delay = elapsed - 1000`. If `delay > 5000` (5 seconds excess drift), a stall event is registered.
  - **Correlation**:
    - Simultaneously captures `delaySeconds`, `active` HTTP requests, `admissionFailures` (cumulative sum of concurrency gate `timeout` + `aborted`), and `rss` memory.
    - Saves event to ring buffer: `{ kind: "stall", uptimeSeconds, delaySeconds, rss, active, admissionFailures }`.
    - Updates `durindoor_event_loop_stalls_total` (counter) and `durindoor_event_loop_stall_max_seconds` (gauge).
    - Emits snapshot gauges: `durindoor_event_loop_last_stall_active_requests`, `durindoor_event_loop_last_stall_admission_failures`, and `durindoor_event_loop_last_stall_resident_memory_bytes`.
- **Evidence References**:
  - Implementation: [`open-sse/services/operationalMetrics.js:160-170, 220-238, 272-278`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L160-L170)
  - Documentation: [`docs/operations/operational-metrics.mdx:40-43, 52`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L40-L43)
  - Focused Test: [`tests/unit/1129-operational-metrics.test.js:70-84`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-operational-metrics.test.js#L70-L84)
- **Status**: **Met**

---

### Criterion 6: Handle unusable sampler readings without repeated log spam
- **Implementation State**:
  - Clock sanity validation:
    - Measures `elapsed = now - runtime.lastTick`.
    - Early ticks (e.g. 990ms) are accepted as valid without warning (`runtime.readingAvailable = true`).
    - Negative drift (`elapsed < 0`) or non-finite values mark the sampler as unavailable (`runtime.readingAvailable = false`).
  - Warning Suppression:
    - If reading is unavailable, checks `metrics.warnedSampler`.
    - If `false`, logs `console.warn("[metrics] Runtime sampler reading unavailable")` and sets `warnedSampler = true`.
    - If `true`, suppresses further console warnings, preventing log spam across subsequent ticks.
  - Recovery:
    - When the clock returns to valid monotonic progression, `runtime.readingAvailable` is restored to `true` (`durindoor_runtime_sampler_reading_available 1`).
    - No additional logging occurs on recovery or on repeated unavailable readings.
- **Evidence References**:
  - Implementation: [`open-sse/services/operationalMetrics.js:26, 208-231`](../../orq-toty04-n1129-audit--8080d2100d6166fb/open-sse/services/operationalMetrics.js#L208-L231)
  - Focused Test: [`tests/unit/1129-runtime-pressure.test.js:13-29`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/1129-runtime-pressure.test.js#L13-L29)
  - Runtime Test: [`tests/unit/operational-metrics-runtime.test.js`](../../orq-toty04-n1129-audit--8080d2100d6166fb/tests/unit/operational-metrics-runtime.test.js)
- **Status**: **Met**

---

## 4. Concrete Remaining Gaps & Verification Limitations

While the core mechanics of all 6 criteria are merged and verified by unit tests, several concrete limitations and remaining gaps prevent marking issue #1129 as fully closed:

1. **Route Lifecycle Coverage Exclusions**:
   - As documented in [`docs/operations/operational-metrics.mdx:18`](../../orq-toty04-n1129-audit--8080d2100d6166fb/docs/operations/operational-metrics.mdx#L18), observation is explicitly applied to inference routes but excludes:
     - Root model listing (`/v1/models` and `/models/info`)
     - Provider plugin manifest (`/v1/provider-plugins`)
     - Image artifact file downloads
     - Management translation and send diagnostics
     - Internal realtime auth/control endpoints
     - WebSocket upgrade requests, sessions, and turn frames
     - Edge middleware denials occurring before reaching route handlers (`src/proxy.js` / `src/dashboardGuard.js`)

2. **Incomplete Client Admission Denial Coverage**:
   - Client admission denial counters (`durindoor_client_admission_failures_total`) only capture 4 fixed reasons (`auth_missing`, `auth_invalid`, `policy`, `client_limit`).
   - The following rejections remain unannotated and contribute zero to client admission counters:
     - Native resource owner, billing, or epoch refusals
     - Provider capacity exhaustion / selection failures
     - Upstream provider 503 unavailability
     - Pre-handler middleware 401/403 denials

3. **Absence of High-QPS Benchmark and Overhead Evidence**:
   - The repository contains unit tests verifying mock event-loop probes and timer intervals, but does not include formal load-test results or micro-benchmarks measuring CPU/memory overhead under high-throughput conditions (e.g. 5,000–10,000 req/sec).
   - Documented in `docs/operations/operational-metrics.mdx:50`: *"Runtime overhead and the complete lifecycle coverage still require authorized validation before issue #1129 can close."*

4. **Process-Local Scope vs Multi-Process / Clustered Deployments**:
   - Metrics are stored entirely in process memory (`globalThis.__durindoorOperationalMetrics`).
   - In containerized multi-instance or Node cluster deployments, each process maintains its own independent metrics. Aggregation is left entirely to the Prometheus scraper without cross-worker aggregation or cluster-wide queue visibility.

5. **OS Sleep / Monotonic Drift False Positives**:
   - The 1-second drift sampler checks monotonic elapsed time. If a host system hibernates or suspends, monotonic time advances across the sleep interval, causing an apparent >5s event-loop stall when the process wakes.

6. **Permanent Warning Latch for Unusable Sampler**:
   - `warnedSampler` is set to `true` on the first invalid reading and never reset to `false`. If a host experiences transient clock instability that resolves and later reoccurs, no subsequent console warning is logged; detection relies solely on the scraped `durindoor_runtime_sampler_reading_available` gauge.

---

## 5. Conclusion & Ticket Closure Verdict

**Recommendation**: **Keep Issue #1129 OPEN**.

In accordance with the issue delivery contract:
> *"Closure rule: this canonical issue remains open until every original and transferred acceptance criterion passes. Linked PRs and focused checks are progress evidence, not release acceptance."*

- **Progress Achieved**:
  - All 6 subtasks from #1129 and #1132 have functional implementations merged into `main` (`PR #1629`, `PR #1645`, `PR #1656`, `PR #2139`).
  - Unit test evidence is complete and passing (`tests/unit/1129-operational-metrics.test.js` and `tests/unit/1129-runtime-pressure.test.js`).
  - Authorization, label limits, reset semantics, privacy boundaries, and log spam protections are in place.
- **Pending Closure Blockers**:
  - Complete lifecycle route coverage (WebSocket, middleware denials, model listing).
  - Extended client admission denial annotations (native billing/epoch, provider capacity).
  - Formal high-QPS sampling overhead verification under saturated production loads.
  - Independent full gate checkpoint authorization.
