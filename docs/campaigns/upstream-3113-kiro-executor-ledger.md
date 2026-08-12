# Upstream PR #3113 Port — Kiro `transformEventStreamToSSE` gaps (2026-08-11)

[`decolua/9router` #3113](https://github.com/decolua/9router/pull/3113) hardens the
Kiro EventStream → SSE translator in three places the fork's own version still
gets wrong. Each gap is reproduced with a regression test, then closed with the
smallest fork-correct change. Anchors live in
[`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| Gap | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| Tool-only turns report `completion_tokens: 0` | PORTED | Fork `open-sse/executors/kiro.js:520-567` only increments `state.totalContentLength` for `assistantResponseEvent` text and `reasoningContentEvent` reasoning — never for `toolUseEvent`. A pure-tool turn (no text, no reasoning) leaves `totalContentLength === 0` and the fallback estimate at line 825 yields `Math.max(1, Math.floor(0/4)) === 0`, under-billing Kiro credits. | On a new tool entry, add `toolName.length` to `state.totalContentLength`; on the args delta, add `argumentsStr.length`. Both happen before `controller.enqueue` so the count is consistent with the byte payload just sent. Test in `tests/unit/kiro-credit-usage.test.js` (`estimates non-zero tool-only output from function name and arguments`). |
| Context-window truncation drops the streamed response | PORTED | Fork final chunk at `open-sse/executors/kiro.js:806` and the failure-framing path at line 869 hardcode `state.hasToolCalls ? "tool_calls" : "stop"`. When Kiro ends with `stopReason: "model_context_window_exceeded"` after emitting real content, the terminal event triggers `state.rawTerminalSeen = true` and the consumer sees a `stop` finish reason with no path to recover. | Introduce `KIRO_TRUNCATION_STOP_REASONS = new Set(["model_context_window_exceeded", "max_tokens"])`, store the incoming `messageStopEvent.stopReason` on state, and in both terminal paths emit `finish_reason: "length"` for those reasons when at least one chunk has already been emitted (`chunkIndex > 0`). Other reasons keep `"stop"`. Test in `tests/unit/kiro-credit-usage.test.js` (`keeps streamed output and closes context-window truncation as length`). |
| Malformed tool entry crashes the whole `toolUseEvent` | PORTED | Fork `open-sse/executors/kiro.js:615-616` accessed `singleToolUse.toolUseId` directly inside `for (const singleToolUse of toolUses)`. A `null` element in a Kiro batched array throws `TypeError: Cannot read properties of null`, killing the SSE stream and dropping every sibling tool call that came in the same event. | Add an entry-level guard: skip non-object entries, then compute `argumentsStr` from the input (string passthrough, object via `JSON.stringify` inside its own `try/catch`, anything else skipped). One bad entry no longer costs the valid ones in the same frame. Test in `tests/unit/kiro-credit-usage.test.js` (`drops malformed tool entries while retaining valid calls in the same event`). |

## Adaptations

- **No upstream `emitTools` helper.** Upstream consolidates the per-tool work in
  one function with a buffered-fragments layer and a `toolValidationError`
  branch. The fork already streams the start/args deltas inline inside
  `toolUseEvent`, so the equivalent change is a two-line entry guard plus the
  byte-counting on the same emit path — no new helper, no buffered fragment
  layer. The fork still keeps the `seenToolIds` index so deltas for the same
  `toolUseId` in later frames patch the right `index`.
- **`state.stopReason` is a fork-internal field.** Upstream leans on
  `stopDisposition()` returning a `terminal_incomplete` flag. The fork
  classifies stop reasons at the terminal chunk instead, so we mirror the
  `Set` membership test in both terminal sites rather than centralising it in
  one branch. Same observable behaviour (`finish_reason: "length"`) on
  `model_context_window_exceeded` and `max_tokens` with prior output.
- **`try/catch` on `JSON.stringify`.** Upstream's per-call `try/catch` is
  preserved on the fork side, but its scope is narrower: the fork only
  serialises the tool input, not the surrounding chunk payload, so the catch
  is on `JSON.stringify(toolInput)` alone. That keeps the existing
  `controller.enqueue` happy path untouched.
- **No docs change beyond this ledger and the README link** required to keep
  `npm run check:docs` green. The behaviour change is observable through
  `finish_reason` and the usage estimate, which the existing translator
  contract already documents.

## Verification

- RED before source fix (`tests/unit/kiro-credit-usage.test.js`):
  - `estimates non-zero tool-only output from function name and arguments`
    — `AssertionError: expected 0 to be greater than 1` at
    `tests/unit/kiro-credit-usage.test.js:218`.
  - `keeps streamed output and closes context-window truncation as length`
    — `AssertionError: expected 'stop' to be 'length'` at
    `tests/unit/kiro-credit-usage.test.js:231`.
  - `drops malformed tool entries while retaining valid calls in the same event`
    — `TypeError: Cannot read properties of null (reading 'toolUseId')` at
    `open-sse/executors/kiro.js:613`.
- GREEN after source fix:
  - `tests/unit/kiro-credit-usage.test.js` — 21 passed (was 18 passed | 3 failed).
  - `tests/unit/kiro-thinking-strip.test.js`,
    `tests/unit/openai-to-kiro.test.js`,
    `tests/unit/kiro-outbound-validation.test.js`,
    `tests/translator/bugs-kiro.test.js`,
    `tests/translator/claude-kiro-direct.test.js`,
    `tests/translator/kiro-tool-index.test.js`,
    `tests/providers/kiro-opus5.test.js` — 55 passed | 2 expected fail (no new
    regressions).
