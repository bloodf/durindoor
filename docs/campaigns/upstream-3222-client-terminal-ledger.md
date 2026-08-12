# Upstream PR Port — #3222 Client-Facing Terminal Tracker (2026-08-11)

One `decolua/9router` PR still OPEN when ported. Verified against this fork
before implementing, matching the D1/D2/D3 batches' bar rather than waiting for
the merged diff. Anchors live in
[`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3222](https://github.com/decolua/9router/pull/3222) `fix(streaming): client-facing terminal tracker for SSE EOF recovery` | PORTED | `open-sse/utils/streamTerminal.js` only exposed `createUpstreamTerminalTracker`, which observes **raw provider** frames for account-health accounting. Nothing tracked **translated client** frames, so a real upstream EOF with no real client terminal flowed through to the wire silently and left SDKs waiting on a chunk that never arrived. | Add `createTerminalTracker(format)` that observes outgoing client frames (`OpenAI`, `OpenAI Responses`, `Claude`) and, on EOF without a terminal, injects the format-appropriate error + terminator before closing. Threaded through `createDisconnectAwareStream` and `pipeWithDisconnect` in `open-sse/utils/streamHandler.js`, and wired in `open-sse/handlers/chatCore/streamingHandler.js`. Responses **passthrough** keeps the existing `buildAbortedResponsesTerminalBytes` abort helper and opts out of the new tracker. Tests in `tests/unit/client-terminal-tracker.test.js`. |

## Two trackers, one stream

The repo now carries **two** terminal trackers, by design:

- **`createUpstreamTerminalTracker`** — unchanged, still observes the **raw
  provider** frames as they enter the translator. Its job is account health:
  did this upstream response end cleanly, or did it die mid-stream so we
  should mark the connection degraded? Client-synthesized and recovery
  terminals are explicitly excluded (see the in-source comment).

- **`createTerminalTracker`** (new) — observes the **translated outgoing
  client** frames. Its job is the inverse one: did the bytes we are about to
  send the client contain a real terminal? If not, and the upstream just
  ended, we owe the client a proper error + terminator so SDKs do not hang.

Same stream, two audiences, two roles. Conflating them would either poison
health accounting with client-only frames or let the wire stay silent on a
real disconnect.

## Adaptations

- **Ambiguous formats return `null`.** The new tracker is opt-in for
  `FORMATS.OPENAI`, `FORMATS.OPENAI_RESPONSES`, and `FORMATS.CLAUDE`. Other
  formats (Gemini, vertex, etc.) keep their existing EOF behaviour.
- **OpenAI detection.** A partial frame carrying
  `data: {"choices":[{"delta":{"content":"…"},"finish_reason":null}]}\n\n`
  must **not** be treated as a terminal. The check requires a
  non-null `finish_reason` value (`/"finish_reason"\s*:\s*"[^"\n]+"/`) and
  an `error` object (`/"error"\s*:\s*\{/`) rather than the bare string
  match used upstream.
- **Responses passthrough.** The Lite-passthrough branch keeps its existing
  `buildAbortedResponsesTerminalBytes` abort helper and disables the new
  tracker; Responses recovery bytes are produced by the same helper the
  abort path already uses, so a fresh wire shape was not invented here.
- **Threading.** `createDisconnectAwareStream` and `pipeWithDisconnect` both
  take an optional `terminalTracker` as the **last** parameter, defaulting
  to `null`. No other call site is affected.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/client-terminal-tracker.test.js`:
  `Test Files  1 passed (1)`, `Tests  5 passed (5)`.
- Regressions: `stream-terminal-outcome.test.js`,
  `stream-completion-usage.test.js`, `relay-stream-lifecycle.test.js` —
  `Test Files  3 passed (3)`, `Tests  62 passed (62)`.
- Revert proof, each confirmed red then green: revert the
  `finish_reason`-value fix and the partial-OpenAI test fails on
  `expected … to contain 'upstream_stream_incomplete'`; revert the EOF
  path in `createDisconnectAwareStream` and the missing-terminal tests
  fail with the recovery bytes not present in the recorded output.
