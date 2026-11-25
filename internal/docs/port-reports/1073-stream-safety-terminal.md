# #1073: provider safety stops stay terminal on existing stream routes

Source: [OmniRoute #18760](https://github.com/cheaper-inference/OmniRoute/pull/18760), `fix(sse): keep in-stream provider safety stops terminal`, merged 2026-11-03, pinned head `90daaf0148b4d4fd735b329cca42fe77b9794453`. It supersedes the "unresolved" row for #18760 in [the November row dispositions](1073-november-01-19-row-dispositions.md). The source diff was read in full (read-only metadata and diff; no provider traffic).

Disposition: **partial port, adapted to local contracts.** The part of the source that applies to DurinDoor's existing stream routes is ported. The part that depends on the unported #17049 classifier and feature flag is not.

## What the source changes

The source is a follow-up to OmniRoute #17049 and runs only with `PROVIDER_SAFETY_STOPS_TERMINAL` on. A provider safety stop that arrives inside a 200 stream was escaping as a retryable failure in four places:

1. Combos (priority, round-robin, nested) classified it as a quality failure and re-sent the conversation to a sibling.
2. The `/v1/responses` early keepalive wrote a bare `type: "error"` frame after the 200 was committed.
3. Stream readiness classified an error-only frame plus close as `STREAM_EARLY_EOF` 502, retried, and failed over.
4. A `response.failed` snapshot replaced an earlier specific root error with a generic one.

All four use `classifyProviderSafetyError` (`open-sse/utils/providerSafety.ts`), which matches provider error codes such as `misalignment_policy_violation`.

## Local trace

| Source path | Local owner | Finding |
| --- | --- | --- |
| Combo stream failure | `open-sse/services/combo.js` via `peekStreamForContent` | **Gap.** The peek only recognised text, reasoning and tool output. A stream whose first meaningful frame was a structured stop (OpenAI `finish_reason: content_filter` or `delta.refusal`, Claude `stop_reason: refusal`, Responses `response.refusal.done` or `response.incomplete` with `content_filter`, Gemini or Antigravity `SAFETY`-family finish or `promptFeedback.blockReason`) counted as an empty stream, so the combo dispatched the sibling. The non-stream path (`isBodyEmpty`, `combo.js`) already treats the same fields as a valid response. |
| Stream readiness / early EOF | `holdForEarlyEof` in `src/sse/handlers/chat.js`, same peek | **Same gap.** An `empty` outcome marked the attempt failed and failed over to another account. DurinDoor has no `streamReadiness` module; this peek is its readiness gate. |
| Passthrough terminal | `createEmptyTerminalGuard` in `open-sse/utils/emptyStreamTerminal.js` | **Gap.** A refusal-only OpenAI, Claude or Responses stream with no usage was held and replaced by a synthetic `Provider returned empty content` error. Claude refusal was already exempted later by `isEmptyCompletion`; OpenAI `delta.refusal` and Responses refusal events were not. `content_filter` finishes and `response.incomplete` were already released. |
| Antigravity guard | `open-sse/handlers/chatCore/emptyStreamGuard.js` | Already covered. Content-filter finishes and `promptFeedback.blockReason` are forwarded as terminal and never retried. Untouched. |
| Claude to OpenAI translation | `claude-to-openai.js` | Already covered (`claude-refusal-stream*.test.js`): `refusal` maps to `content_filter` and carries the explanation. Untouched. |
| Keepalive error frame | `open-sse/utils/earlyStreamKeepalive.js` | Emits a bare `error` event. Changing it needs the code classifier. Not ported. |
| Root error under `response.failed` | no `responsesSnapshot` equivalent | No local owner for the source's `pickResponsesSnapshot`. Not ported. |

## Change

- New `open-sse/utils/safetyStopFrame.js`: `isSafetyStopPayload(parsed)` recognises only structured stop fields. It reuses the existing `OPENAI_FINISH`, `CLAUDE_STOP` and `GEMINI_CONTENT_FILTER_FINISH_REASONS` constants, so it matches the non-stream rule and the Antigravity guard.
- `streamContentPeek.js`: a safety stop before content settles as the new outcome `safety_stop` with `hasContent: true`. The consumed bytes are replayed unchanged. Combo and early-EOF failover therefore treat it as the provider's terminal answer.
- `emptyStreamTerminal.js`: a safety stop counts as output, so its terminal is forwarded instead of being replaced by an empty-content error.

Disclosure is unchanged: the refusal text, `stop_details` and finish reasons reach the client exactly as the provider sent them, and the existing sanitisation on error envelopes is not touched. Nothing here reads, adds or bypasses moderation.

## Deliberately not changed

- **Error-envelope safety codes.** DurinDoor has no `providerSafety` classifier, no `PROVIDER_SAFETY_STOPS_TERMINAL` flag and no safety latch; #17049 is still an unresolved row in [the October dispositions](1073-october-16-23-row-dispositions.md). An in-stream `error` frame, including `invalid_request_error`, keeps the local #2068 contract ([combo pre-content errors](1072-combo-precontent-errors.md)): it is kept as a request-scoped candidate and a later member may still serve. Porting code matching would be a new feature plus flag, which is outside this task.
- Empty streams, transport errors and retryable error envelopes keep their existing fallback and health behavior. Controls in the test assert this.
- Keepalive `response.failed` shape, `response.failed` root-error preservation, round-robin and nested combo latch handling: not ported, since they all depend on the classifier. A follow-up needs the #17049 classifier decision first.

## Verification

Offline only, using synthetic frames and mock providers:

```bash
test -s internal/docs/port-reports/1073-stream-safety-terminal.md && \
  (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-stream-safety-terminal.test.js)
```

`tests/unit/omni-stream-safety-terminal.test.js` has 70 cases covering all eight stop shapes through the recogniser, the peek, priority, smart-scoring and round-robin combos, `holdForEarlyEof`, and the passthrough guard, plus controls for empty, retryable-error, request-scoped-error, ordinary-stop and mid-stream cases. With the two production edits reverted, 44 of them fail; with them applied all 70 pass. Adjacent combo, stream, early-EOF, refusal, content-filter and empty-stream files (64 files, 690 tests) also pass.

Limits: no real provider, credential, browser, Docker or whole-suite run. Nested combo-ref units are not exercised separately; they reach the same `combo.js` peek call site. The source's Codex CLI replay check was not reproduced. Dependencies for the run were installed from the frozen lockfiles into this worktree only (`pnpm install --frozen-lockfile --offline --ignore-scripts` in the root and in `tests/`, plus a local `vite` link). No shared install was used.
