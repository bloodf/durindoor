# Upstream PR Port — #3175 Stream Finalization (2026-08-11)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3175](https://github.com/decolua/9router/pull/3175) `fix(stream): finalize interrupted streaming request details` | PORTED | `handleStreamingResponse` creates a stable-ID placeholder detail before forwarding SSE bytes. A client disconnect, stall timeout, or mid-stream error previously left that row with `[Streaming in progress...]`, zero tokens, and `success` forever. | `buildOnStreamComplete` now provides guarded `onStreamAbandoned(reason)`, which replaces the stable-ID placeholder with one `cancelled` interrupted-stream detail. `chatCore` invokes it for disconnects and errors. Tests: `tests/unit/streaming-interrupted-detail.test.js`. |

## Adaptation

This fork's `createStreamController` invokes disconnect with `{ reason, duration }`, unlike upstream's raw reason. The port extracts its string `reason`; error reasons retain fork-specific stall classification (`stall_timeout`) and generic stream failures (`stream_error`). Existing quota and provider lifecycle callbacks remain unchanged.

## Verification

- RED: `TypeError: onStreamAbandoned is not a function` in both interruption and completion-race cases.
- GREEN: `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/streaming-interrupted-detail.test.js` — 1 file, 2 tests passed.
