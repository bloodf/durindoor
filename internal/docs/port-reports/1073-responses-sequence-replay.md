# #1073 Responses sequence replay suppression

Compared 2026-11-20 against DurinDoor base `9d5b613a7` and OmniRoute [#15510](https://github.com/cheaper-inference/OmniRoute/pull/15510), merged as commit `408b4f2bd868497aedf95d0a486f2e0c9ff689db` (`fix(sse): drop a replayed responses event when the sequence is a string`, 2026-10-06).

| Source | Disposition and local evidence |
| --- | --- |
| [OmniRoute #15510](https://github.com/cheaper-inference/OmniRoute/pull/15510), merged, head `408b4f2bd868497aedf95d0a486f2e0c9ff689db` | **Ported, adapted.** The upstream commit widens the `isDuplicateResponsesSequence` helper in `open-sse/utils/stream.ts` from numeric-only to decimal-string `sequence_number` values and rejects anything that is not a safe integer. DurinDoor had no sequence-number replay detection at all, so the whole mechanism is adapted rather than patched: `open-sse/utils/responsesSequenceReplay.js` owns the normalization and the watermark, and `open-sse/utils/stream.js` applies it in both Responses paths. The upstream commit's own tests are `tests/unit/streaming-reasoning-dedup-5786.test.ts`; the local equivalent is `tests/unit/responses-sequence-replay.test.js`. |

## Upstream mechanism and the local counterpart

Upstream #15510 extends the #5786 watermark that upstream already had. Upstream keeps one `lastSeenResponsesSequenceNumber` per stream and consults it at two call sites: the passthrough branch drops a `response.*` payload whose `sequence_number` was already forwarded, and the translate branch drops any parsed chunk whose `sequence_number` was already forwarded while the upstream format is Responses.

The local fork never carried that watermark, so the counterexample was absent rather than partial: `open-sse/utils/stream.js` (`createSSEStream`) forwarded every Responses frame it received, and a reconnect that replayed the tail of a Responses stream glued duplicated text into the client stream and doubled that text in the completion summary.

Local paths that carry Responses frames:

- **Translated** — `createSSEStream` in TRANSLATE mode with `targetFormat === FORMATS.OPENAI_RESPONSES` (around lines 1241-1256). The upstream speaks Responses; the client receives either the same-format Responses re-emit or the OpenAI/Claude translation.
- **Passthrough** — `createSSEStream` in PASSTHROUGH mode with `targetFormat === FORMATS.OPENAI_RESPONSES` (around lines 803-870). The upstream and the client both speak Responses and the frames are forwarded unchanged (the codex-cli user agent path).

## Local adaptation

`open-sse/utils/responsesSequenceReplay.js` is new and holds both halves of the rule:

- `normalizeResponsesSequenceNumber` accepts a number that is a non-negative safe integer, or a canonical decimal string (`0`, `7`, `42`) that converts to one. A missing, fractional, negative, non-canonical (`01`, `1.5`, `1e3`) or out-of-safe-range value is invalid and stays untracked, so such a frame is forwarded unchanged.
- `createResponsesSequenceReplayTracker` keeps the highest `sequence_number` already forwarded. An event at or below that watermark was already forwarded and is a reconnect/retry replay.

Four local rules narrow the upstream behavior, each with its own reason:

1. **Explicit Responses events only.** The tracker keys off a `response.*` payload type. Upstream's translate call site drops any chunk of a Responses upstream that carries a `sequence_number`; a chunk that does not declare itself a Responses event is left unchanged here.
2. **One upstream response per watermark.** A changed `response.id` starts a fresh numbering and resets the watermark, so a second response inside the same stream is never mistaken for a replay of the first. Upstream keeps one watermark for the whole stream and would suppress the second response's frames.
3. **Terminals, usage and `[DONE]` are never suppressed.** Upstream suppresses a terminal or usage frame like any other event. Here `isOpenAIResponsesTerminalEvent` and the presence of a usage payload mark an event as protected, so a repeated `response.completed` is delivered again rather than lost, the token accounting survives, and the `[DONE]` sentinel is untouched (`data: [DONE]` carries no sequence number). The cost is a repeated terminal event on the wire.
4. **A dropped frame loses its event label.** The Responses passthrough forwards the upstream framing verbatim, and the `event:` label of a frame is written before its payload. The label is therefore held in the existing `pendingSSEFields` buffer until the frame is known to be forwarded, and a suppressed frame drops the label with it (around lines 795-812 and 1188-1200). Upstream keeps this in its own passthrough event-prefix helper.

The translated path applies the check before `upstreamTerminal.observe`, `recordCompletionData`, the terminal flag and `translateResponse` (around lines 1248-1256), so a replayed frame reaches neither the client nor the completion summary nor the accounting. The passthrough path applies it to the parsed frame (around lines 855-862) and to an unterminated final frame in the flush handler (around lines 1516-1524).

## Local compatibility

- Other provider protocols are untouched. The tracker only reacts to a `response.*` payload, and the passthrough change is limited to `targetFormat === FORMATS.OPENAI_RESPONSES`, so the OpenAI, Claude, Gemini, Ollama and Kiro passthrough paths keep their exact bytes. The OpenAI chat passthrough forwards the same `sequence_number` twice without complaint.
- Usage accounting is unchanged in shape: `mergeUsage` in `open-sse/utils/usageTracking.js` is a field-wise max-merge, so a repeated usage frame cannot inflate the recorded counts.
- Cancellation and single completion accounting are unchanged. The completion callback still fires once per stream (`onStreamCompleteFired` in `open-sse/utils/stream.js`), the interruption path in `open-sse/handlers/chatCore/streamingHandler.js` is untouched, and a client disconnect still ends the stream without a second completion report.
- The synthesized `response.failed` that the Responses passthrough appends after `[DONE]` when the upstream terminal tracker has not confirmed success is pre-existing behavior. It was verified to be byte-identical before and after this port.

## Verification

`tests/unit/responses-sequence-replay.test.js` (12 tests) covers the repeated frame and the out-of-order frame in the translated and the passthrough path, decimal-string and numeric counters, a counter past the safe integer range, invalid and missing counters, the single-response scoping, the protected terminal, usage and `[DONE]`, a repeated frame in a Claude translation, another provider protocol, and the client-disconnect path.

Focused evidence: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/responses-sequence-replay.test.js unit/openai-responses-stream-tool-identity.test.js unit/stream-completion-chunks.test.js` from `tests/`: 3 files, 19 tests passed. Root lint passes (`eslint src` clean of errors, anti-slop gate 0 diagnostics across 2679 files). A scoped regression sweep over the stream, passthrough, SSE, Responses and terminal suites (48 files, 371 tests) passed; the full suite remains with the integration gate.

Verification limits: the runs are offline and synthetic. No real provider, credential, paid API, Docker or browser path was used, and no live reconnect was observed; the replay is reproduced with synthetic frames that carry the sequence numbers a reconnecting upstream would re-send. The shared dependency pool on this machine has a stale top-level `node_modules/vite` link, so the focused runs used a scratch-only ESM resolver outside the repository; nothing in the repository and nothing in `node_modules` was modified for it.
