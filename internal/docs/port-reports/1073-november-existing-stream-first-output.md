# #1073 November: existing stream first-output ownership

## Pins and scope

This audit compares the supplied public PR identities with the installed local routing and fixture evidence. The requested public mirror was unavailable in this checkout; the public PR pages and pinned commit pages were used to identify each patch and avoid attributing unrelated changes from enclosing merges. PR-level patch details below are limited to the public PR descriptions and pinned commit metadata, not a local object-level diff.

| PR | Exact PR head | Enclosing merge | Public patch scope |
| --- | --- | --- | --- |
| [OmniRoute #18404](https://github.com/cheaper-inference/OmniRoute/pull/18404) | [`441459303a3fccd30461a61d7afb93e3d1151de9`](https://github.com/cheaper-inference/OmniRoute/commit/441459303a3fccd30461a61d7afb93e3d1151de9) | `05b3d412d53afb521e4554062ba30a1c8b2afb67` | Scale direct response-start window by request payload size. The PR describes raising the flat direct-header floor for larger bodies, composing with existing raises. |
| [OmniRoute #18624](https://github.com/cheaper-inference/OmniRoute/pull/18624) | [`4c73c50976db87423c631f1430d4faab4541c30e`](https://github.com/cheaper-inference/OmniRoute/commit/4c73c50976db87423c631f1430d4faab4541c30e) | `c9ed276e1122afde000fbc8bdac62be62e775f9a` | Recognize Gemini `finishReason` as a terminal marker in stream recovery, for raw Gemini-family streams lacking generic terminal frames. |
| [OmniRoute #19310](https://github.com/cheaper-inference/OmniRoute/pull/19310) | [`b706fa611e87e870d407d0d3bd3e900c06e6213f`](https://github.com/cheaper-inference/OmniRoute/commit/b706fa611e87e870d407d0d3bd3e900c06e6213f) | `783dece04c9f536ab2e3a6d4726462975d7d2611` | Treat Claude thinking block starts as first output for a combo target gate, preventing a silent-stream target timeout during hidden thinking. |

The PR links above identify each specific patch, while each commit link pins its supplied PR head. The enclosing merge IDs are recorded for provenance only; no unrelated merge-range changes are considered in these dispositions.

## Existing local ownership and fixture evidence

`open-sse/utils/streamHandler.js` owns disconnect-aware piping. It imports `STREAM_FIRST_CHUNK_TIMEOUT_MS` and `STREAM_STALL_TIMEOUT_MS`; `pipeWithDisconnect` applies a shorter first-upstream-byte deadline before any bytes arrive and a raw-upstream-activity stall deadline afterward. The timeout is upstream-byte based, so translated/client silence while upstream bytes continue (including buffered binary/reasoning streams) does not count as a stall. Its timeout path aborts upstream work and reports through the stream controller. The installed chat/Responses path in `open-sse/handlers/chatCore/streamingHandler.js` resolves the connection/provider/global stall budget and routes abort terminal bytes by emitted client format, including `response.failed` for Responses passthrough and an in-band error for formats without a terminal tracker.

`tests/unit/stream-first-chunk-timeout.test.js` is deterministic offline fixture evidence for the ownership boundary: it checks a shorter deadline on no data, counts an empty chunk as no first byte, and verifies the first non-empty upstream bytes clear the TTFT timer. `tests/unit/responses-abort-terminal.test.js` checks Responses `response.failed` plus `[DONE]` after an upstream error and confirms non-Responses streams do not receive a Responses terminal. `tests/unit/stream-abort-inband-error.test.js` checks error framing for Gemini and an Ollama upstream error. `tests/unit/antigravity-terminal-drain-bound.test.js` covers bounded drain after terminal, including duplicate terminal handling. These are fixture assertions; this audit did not exercise a provider or external service.

The current tree therefore already has bounded watchdog and timeout seams for client cancellation, first upstream bytes, subsequent upstream inactivity, and terminal recovery. They do not establish all provider-specific notions of meaningful first output: first byte is deliberately transport-level, and the shared timeout does not inspect Claude thinking block semantics or Gemini finish markers for a recovery holdback classifier.

## Dispositions

### #18404 — no port

This is a response-start timing policy tier based on request payload size. Existing connection-specific/provider/global bounded timeout resolution is present, but the reviewed local fixtures do not establish a demonstrated large-payload direct-header floor gap. A payload-dependent multiplier and cap would be new policy, not a missing cancellation or first-byte ownership primitive. Keep current watchdog ownership; do not port the policy on this evidence.

### #18624 — no port on current evidence

Gemini terminal recognition matters only when a recovery wrapper buffers/replays upstream output and needs to distinguish a complete Gemini candidate from truncation. The current installed chat/Responses path has terminal tracking and timeout error framing; inspected local fixtures verify Gemini-format timeout framing and bounded Antigravity terminal drain, but do not show a local Gemini recovery holdback path that misclassifies `finishReason`. This is not a request-cancellation gap. Do not add a recovery subsystem or transport abstraction based on the public description alone.

### #19310 — narrow demonstrated semantic gap; ordinary offline acceptance

The local first-chunk watchdog resolves arrival of upstream bytes, not meaningful Claude output. Thus Claude thinking frames may satisfy that transport deadline while a combo target gate (if used) could still decide that no meaningful output has started. Local fixtures prove thinking blocks and thinking deltas are represented and preserved (`tests/unit/forced-sse-claude-json.test.js`, `tests/unit/omni-oct-combo-semantic-terminal.test.js`), but there is no corresponding local target-gate implementation under `open-sse/services/combo/` or fixture that demonstrates Claude thinking counting as target output. This narrow semantic distinction is the only candidate gap from these patches; do not transplant the wider policy/recovery systems.

If/when a local combo first-output gate is present, acceptable ordinary offline coverage is a deterministic synthetic stream fixture showing that Claude `thinking` and `redacted_thinking` block starts count as target output and prevent the target timeout, while `signature_delta` alone does not; also retain visible-text/tool-start and cancellation/timeout controls. No live provider, malformed exposure, timing-sensitive network case, or paid API is needed. Until such a gate exists, no code change is demonstrated by this audit.

## Verification boundary

This is a documentation-only audit. The specified local public mirror path could not be accessed from this checkout, so exact source-level patch hunks were not independently inspected there. No product code or tests were changed, and no provider traffic, exploit reproduction, or external service was exercised.
