# OmniRoute #21340: translated EOF text in call logs

**Verdict: concrete missing behavior, low severity.** The translated EOF path can lose the final text event from the completion snapshot used by request detail/call logs, although the event still reaches the client through translation. This is narrower than the existing #20279 stream-tail port, which records provider-format content.

## Source and revision scope

Read-only GitHub API metadata on 2026-11-27: PR [#21340](https://github.com/cheaper-inference/OmniRoute/pull/21340), state **open**, base `release/v3.8.55` at `16e2c146fb5b8e4ee6364fb679ffe412880757fb`, head `fix/20279-translated-eof-text` at `a02ff2bbf2a049cb6f2f0db61a47a4ffe226f6e0`.

Changed files: `changelog.d/fixes/stream-translated-eof-call-log-content.md`, `open-sse/utils/stream.ts`, new `open-sse/utils/streamTranslatedText.ts`, `open-sse/utils/translateFlushTail.ts`, and new `tests/unit/stream-translated-eof-call-log-content.test.ts`. The new test sends two chunks for Claude, Gemini, and OpenAI Responses; the second is unterminated at EOF and asserts it appears in the completion snapshot once while remaining on the wire.

## DurinDoor trace

Compared source from `origin/main` (`29490b783e83176d4d6a4162f76ee3dc79db66ea`) and frozen train integration head `d27f288cb59be43a4c1068ac314076cde0297413` (also checked `train/2`, `32a783d76d45d90bf0517015442f43fadd96106c`). The relevant `open-sse/utils/stream.js` behavior is identical at all three refs.

At `open-sse/utils/stream.js:2047-2050`, the unterminated EOF payload is passed to `recordCompletionData(parsed, { trackUsage: false, content: true })`. That collector at `:610-631` appends only OpenAI `choices[].delta` text/reasoning and Gemini candidate text. It does not collect Claude `delta.text` or Responses `response.output_text.delta`. The EOF path then translates that parsed provider event at `:2052-2053` and emits the translated item, but does not feed that translated item into the accumulated completion snapshot. `getAccumulatedCompletion` at `:536-540` builds the snapshot solely from those accumulated chunks, which `onStreamComplete` supplies at EOF (`:1986-1993`).

Consequently a final unframed Claude or Responses text delta can be present in the client-visible translated stream and absent from `onComplete(...).responseBody` / call-log content. A matching source-level regression trace is the upstream fixture shape: a complete first `data:` frame followed by a second `data:` text delta with no terminating newline or blank line; at EOF assert that the second text appears exactly once in the wire and in the completion snapshot. Use `createSSEStream` with `mode: "translate"`, `targetFormat: "claude"` or `"openai-responses"`, `sourceFormat: "openai"`, and an `onComplete` callback capturing `responseBody` (adapt the exact option names to the local helper contract). This is a source trace only; no product command or test was run.

Existing ownership evidence: `internal/docs/port-reports/1073-nov22-port-20279.md` records the earlier EOF/accounting port, but its documented content handling is provider-format collection. The current parity ledger row O0068 in `internal/docs/port-reports/2026-11-27-full-parity-refresh.md` was unrecorded and required review. No active implementation owner or duplicate claim for this translated completion-snapshot gap was found in the inspected reports. The stated sync-lane issues are left untouched.
