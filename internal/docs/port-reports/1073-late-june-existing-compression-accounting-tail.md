# #1073 Late-June compression selector and reporting bounds

Scope: Review of three late-June 2026 OmniRoute patches against current DurinDoor source and offline test fixtures. The comparison assesses existing local compression engine selection, no-op statistics tracking, and reporting boundaries, separating new analytics features from unchanged code extractions while preserving raw provider inputs and existing budgets without introducing data collection, credentials, or external requests.

## Exact source pins

- [OmniRoute #5270](https://github.com/cheaper-inference/OmniRoute/pull/5270): `fix(compression): keep quantumlock selector under cap`
  - PR head: [`6191a54bd53f006eb19f5dd851d26b8bfd99e047`](https://github.com/cheaper-inference/OmniRoute/commit/6191a54bd53f006eb19f5dd851d26b8bfd99e047)
  - Enclosing merge: [`58f9e3d8d3285f0330252b63b7791b1485a0e694`](https://github.com/cheaper-inference/OmniRoute/commit/58f9e3d8d3285f0330252b63b7791b1485a0e694)
  - Patch base: `b7b9b84b17b04c7c542a06de6c088855ec5789a6`
  - Enclosing merge evaluation: The enclosing merge parent is `955fed0bc35d83ad022d36fa003f5bc843babfd4`, which incorporated 24 files with unrelated release changes (including Kilocode anonymous fallback, Grok-CLI OAuth, proxy fallback cache keys, and translator tests). The exact PR patch is evaluated strictly against base `b7b9b84b17b04c7c542a06de6c088855ec5789a6`, touching only `open-sse/services/compression/cacheAwareConfig.ts` and `open-sse/services/compression/strategySelector.ts`.

- [OmniRoute #5277](https://github.com/cheaper-inference/OmniRoute/pull/5277): `fix(compression): record no-op compression runs so Stacked is visible in analytics (#4268)`
  - PR head: [`3a0a0f5461f81b93f1bf39b1ba9bb7b5948cf63a`](https://github.com/cheaper-inference/OmniRoute/commit/3a0a0f5461f81b93f1bf39b1ba9bb7b5948cf63a)
  - Enclosing merge: [`bc00e32b15194fe954cf09e0daa63ab0ff2ad24a`](https://github.com/cheaper-inference/OmniRoute/commit/bc00e32b15194fe954cf09e0daa63ab0ff2ad24a)
  - Patch base: `ba38e31ff43dbc8856ee73e2dae2d67b0e48eb3e` (head commit and enclosing merge are tree-identical).

- [OmniRoute #4794](https://github.com/cheaper-inference/OmniRoute/pull/4794): `refactor(chatCore): extrai writeCavemanOutputAnalytics (#3501)`
  - PR head: [`540ecf920d096aaf1710677a43a5b7db5b180dc6`](https://github.com/cheaper-inference/OmniRoute/commit/540ecf920d096aaf1710677a43a5b7db5b180dc6)
  - Enclosing merge: [`d4a0b8d0a2ad5f3ce48f2e68b4764037b3715c51`](https://github.com/cheaper-inference/OmniRoute/commit/d4a0b8d0a2ad5f3ce48f2e68b4764037b3715c51)
  - Patch base: `e2a0201d0fcbcdf85537474b099e5134b4795e75` (head commit and enclosing merge are tree-identical).

## Architecture comparison

### Compression engine selection

In upstream OmniRoute, compression mode and execution strategy flow through `selectCompressionStrategy` in `strategySelector.ts` and entrypoint wrappers in `entrypointWrap.ts`. Upstream dynamic strategy resolution inspects caching provider contexts (`cachingAware.ts`) and wraps executions with QuantumLock volatile-span protection and risk-gate filters.

In DurinDoor, compression planning and engine execution follow a deterministic, settings-driven pipeline:
1. Plan derivation: [`deriveDefaultPlan(engines, masterEnabled)`](../../../open-sse/services/compression/deriveDefaultPlan.js) resolves the configured `compressionEngines` toggle map into `{ mode: "off" | singleMode | "stacked", stackedPipeline }` according to engine catalog priorities.
2. Adaptive resolution: [`resolveAdaptivePlan`](../../../open-sse/services/compression/adaptiveCompression/resolveAdaptivePlan.js) computes context targets and selects available engines without dynamic strategy mutation.
3. Execution seam: [`runCompressionSeam`](../../../open-sse/handlers/chatCore/compressionHook.js) runs in-process at [`handleChatCore`](../../../open-sse/handlers/chatCore.js). It executes registered engine `apply` methods sequentially, enforcing step-level fail-open rollback and the text invariant fidelity gate ([`fidelityGate.js`](../../../open-sse/services/compression/fidelityGate.js)).
4. System prompt preservation: Unlike upstream's runtime `resolveCacheAwareConfig` toggle override, DurinDoor establishes system prompt preservation statically: `DEFAULT_COMPRESSION_CONFIG.preserveSystemPrompt = true` and `preserveSystemPromptMode = "always"` in [`types.js`](../../../open-sse/services/compression/types.js). The fidelity gate rejects any engine step that alters protected system blocks, and the Lite engine skips system messages unconditionally. Upstream QuantumLock wrappers are erased ([`types.js:5`](../../../open-sse/services/compression/types.js)).

### Compression statistics and reporting bounds

In upstream OmniRoute, compression executions write per-request analytics rows into a SQLite database table (`compression_analytics`) via `writeCompressionAnalytics`, `writeCompressionSkip`, and `writeCavemanOutputAnalytics`. Summary statistics and skip counts are aggregated via `getCompressionAnalyticsSummary` and rendered in the web dashboard's `CompressionAnalyticsTab.tsx`.

In DurinDoor:
1. In-memory no-op tracking: [`open-sse/services/compression/stats.js`](../../../open-sse/services/compression/stats.js) defines token estimation heuristics and `createCompressionStats`, but `trackCompressionStats(stats)` is explicitly a no-op in production (`// Compression stats tracking — no-op in production (use structured logging if needed)`).
2. No database persistence: DurinDoor contains no `compression_analytics` table, no database repository for compression metrics, no skip-row storage, and no dashboard analytics tab.
3. Client signaling via response headers: Compression impact is surfaced exclusively to clients through the `X-DurinDoor-Compression` HTTP header (`<engineIds>|<savingsPercent>%`). In [`runCompressionSeam`](../../../open-sse/handlers/chatCore/compressionHook.js), an engine is credited only when it reports `compressed === true` AND changes the serialized body content (`stepOutSerialized !== JSON.stringify(stepInput)`). If no engines produce net savings or if the final output equals the input, `runCompressionSeam` returns `headerValue: null`, and [`handleChatCore`](../../../open-sse/handlers/chatCore.js) attaches no header to the streaming or non-streaming response.
4. Privacy and budget preservation: Raw provider request bodies, system prompts, and tool outputs remain unlogged. No SQLite write transactions or analytics retention policies exist in the request path, preventing database bloat and unbounded disk I/O under high load.

## Separation of new analytics features and unchanged extractions

- **New analytics features (#5277)**: OmniRoute #5277 introduces persistent database accounting for no-op runs: when compression runs but saves nothing, it inserts a row into SQLite `compression_analytics` with `skip_reason = "no_savings"` and `tokens_saved = 0`. It alters the SQLite schema to add `skip_reason`, modifies aggregation queries with `skip_reason IS NULL`, surfaces `totalSkipped` and `bySkipReason`, and adds UI badges to the dashboard. This is a functional feature expansion of an upstream database reporting subsystem that does not exist in DurinDoor.
- **Unchanged code extractions (#5270, #4794)**:
  - OmniRoute #5270 extracted `resolveCacheAwareConfig` out of `strategySelector.ts` into `cacheAwareConfig.ts` to satisfy a repository file-size baseline cap (`config/quality/file-size-baseline.json`). The extracted function logic was byte-identical.
  - OmniRoute #4794 extracted `writeCavemanOutputAnalytics` from `chatCore.ts` into a leaf file `open-sse/handlers/chatCore/cavemanOutputAnalytics.ts` as part of the Phase 9 `chatCore` god-file decomposition (#3501). The extracted database call was byte-identical.

## Dispositions

### [OmniRoute #5270](https://github.com/cheaper-inference/OmniRoute/pull/5270) — Disposition: Do not port (upstream-only file-size refactoring)

- **Rationale**: #5270 is an upstream refactoring motivated by a local file-size check after upstream added QuantumLock (#5260). DurinDoor does not implement QuantumLock, does not maintain `strategySelector.ts` or `cacheAwareConfig.ts`, and does not have the upstream file-size constraint on this module. DurinDoor's system prompt protection is statically enabled by default (`preserveSystemPrompt: true`, `preserveSystemPromptMode: "always"`) and enforced by the fidelity gate. No behavioral or structural gap exists in DurinDoor.

### [OmniRoute #5277](https://github.com/cheaper-inference/OmniRoute/pull/5277) — Disposition: Do not port (analytics feature exclusion / budget and privacy preservation)

- **Rationale**: #5277 adds database tracking of attempted-but-no-op compression runs (`writeCompressionSkip`) and adds `skip_reason` filtering to the SQLite `compression_analytics` store. DurinDoor intentionally maintains a lightweight, privacy-preserving gateway architecture: `trackCompressionStats` is a no-op, no `compression_analytics` database table exists, and no request-level compression telemetry is collected. Storing skip records would introduce schema additions, disk writes, and unwanted telemetry collection contrary to the contract to preserve raw provider inputs and avoid new data collection. Client signaling already correctly omits the `X-DurinDoor-Compression` header on no-op runs.

### [OmniRoute #4794](https://github.com/cheaper-inference/OmniRoute/pull/4794) — Disposition: Do not port (unchanged extraction of absent analytics writer)

- **Rationale**: #4794 extracts `writeCavemanOutputAnalytics` from `chatCore.ts` into a separate helper module. In DurinDoor, Caveman output mode prompt injection (`cavemanEnabled && cavemanLevel`) is handled directly in [`handleChatCore`](../../../open-sse/handlers/chatCore.js) via `injectCaveman` ([`open-sse/rtk/caveman.js`](../../../open-sse/rtk/caveman.js)), which appends a transformer tag to logging (`xf.push(...)`) without database writes. Because DurinDoor has no `compression_analytics` database writes for Caveman output mode, the extracted helper has no target or utility locally.

## Existing fixture evidence

Current DurinDoor test fixtures independently verify compression planning, execution, token estimation bounds, and no-op reporting boundaries:

1. **No-op compression reporting bounds**:
   - [`tests/unit/compression-chatcore-f1b.test.js`](../../../tests/unit/compression-chatcore-f1b.test.js):
     - `"engine reporting compressed:true with identical cloned body yields null header"`: verifies that an engine returning an identical body yields `headerValue: null`.
     - `"header value lists only engines that compressed and overall input/output savings"`: verifies that an engine that does not reduce body size is omitted from the header.
     - `"disabled passthrough returns same reference, null header, touches nothing"`: verifies reference identity and absence of header when disabled.
   - [`tests/unit/compression-chatcore-header.test.js`](../../../tests/unit/compression-chatcore-header.test.js):
     - `"enabled but seam returns null header -> no header on response"`: verifies that when `runCompressionSeam` returns `headerValue: null`, no `X-DurinDoor-Compression` header is attached to the HTTP response.
     - `"enabled + seam reports header -> streaming final response carries X-DurinDoor-Compression"` and `"enabled + seam reports header -> non-streaming (JSON) final response carries X-DurinDoor-Compression"`: verify header attachment only on actual savings.

2. **Bounded token estimation & input preservation**:
   - [`tests/unit/compression-token-estimate.test.js`](../../../tests/unit/compression-token-estimate.test.js):
     - Verifies `estimateCompressionTokens` heuristic bounded at 50,000 characters (`MAX_EXACT_TOKEN_COUNT_CHARS`), ensuring hostile multi-MB payloads use raw `length / 4` fallback without per-character linear scanning overhead.
     - Validates base64 image data URI stripping without corrupting surrounding text or non-image content.

3. **Tool preservation & settings compatibility**:
   - [`tests/unit/omni-safe-compression-tool-output.test.js`](../../../tests/unit/omni-safe-compression-tool-output.test.js): 43 offline test cases confirming ordinary tool results, signed thinking, and encrypted reasoning survive uncompressed across Lite, Caveman, and stacked runs.
   - [`tests/unit/compression-settings-compat-1073.test.js`](../../../tests/unit/compression-settings-compat-1073.test.js): verifies partial setting writes preserve sibling engines and unavailable catalog engines remain uninvoked.

## Ordinary offline acceptance for no-op reporting bounds

No functional gap is demonstrated in runtime engine selection, system prompt preservation, or no-op header suppression.

If an offline acceptance fixture is ever desired to explicitly pin no-op reporting bounds for stacked pipelines on pre-compacted text, it can be added to [`tests/unit/compression-chatcore-f1b.test.js`](../../../tests/unit/compression-chatcore-f1b.test.js) under ordinary offline test conditions (synthetic request body, no live providers, no database, no network):
- Input: A structured Chat Completions or Responses body where text is already minimal/compact.
- Configuration: `compressionEnabled: true`, `engines: { rtk: { enabled: true }, caveman: { enabled: true } }` (Stacked mode).
- Assertions:
  1. `runCompressionSeam` executes without throwing.
  2. The returned `body` is structure- and content-identical to the input.
  3. `headerValue` is strictly `null`.
  4. Passing the result through `handleChatCore` results in a response without `X-DurinDoor-Compression`.
  5. Zero disk, file, or database write side-effects occur.
