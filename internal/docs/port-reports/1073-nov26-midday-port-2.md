# November 26 midday candidates, port 2

**Status: COMPLETE** for this slice.

The slice is candidates 9-16 of [1073-nov26-midday.md](1073-nov26-midday.md), counting port-candidate rows in table order. That report has 10, so the slice has two rows. Both pull request heads were read again and still match the report. No live provider was called.

| # | PR | Exact head | Final disposition | Evidence |
|---:|---|---|---|---|
| 9 | [9router #3862](https://github.com/decolua/9router/pull/3862) | [`05a3ee02f4cd`](https://github.com/decolua/9router/commit/05a3ee02f4cd47aa8d24e709f64f519ed0087f40) | **Already present** | Landed before this slice as commit `3cd70901648`. [migrate.js](../../../src/lib/db/migrate.js) runs [the integrity check](../../../src/lib/db/helpers/integrityCheck.js) before any SQLite migration, backup, marker or version write, and `isFreshDb` rethrows a malformed image. [The guard test](../../../tests/unit/db-integrity-guard.test.js) passes. |
| 10 | [9router #3860](https://github.com/decolua/9router/pull/3860) | [`cdc474116270`](https://github.com/decolua/9router/commit/cdc4741162707741e91a2aff55060ac176671be6) | **Ported in this change** | Two cut-stream gaps are ported; the rest is covered below. Commits `02cb683a979` and `d48f5a200d5`; [test](../../../tests/unit/port9r-3860-anthropic-incomplete-terminal.test.js). |

## Corrections to the midday report

- #3862: the report says there is no startup `PRAGMA quick_check(1)`. The check is in `runIntegrityCheckOrThrow` and has no row limit. It stops startup on any reported problem, while the upstream change rethrows only errors that read as corruption.
- #3860: the report says there is no first-frame preflight before a single-model stream commits HTTP 200. `holdForEarlyEof` in [postProcess.js](../../../src/sse/handlers/chat/singleModel/postProcess.js) holds the stream before it is returned.

## 9router #3860 by behaviour

| Behaviour | Disposition | Evidence |
|---|---|---|
| Translated Claude stream cut before its end | **Ported in this change** | A probe before the change showed a Chat Completions upstream with no finish reason and no `[DONE]` reaching a Claude client as `end_turn` plus `message_stop`, with the request row marked `success`. [stream.js](../../../open-sse/utils/stream.js) now sends one `overloaded_error`, marks the row `error` and releases no buffered tool call. A finish reason or `[DONE]` still ends normally. |
| Native Claude stream cut before `message_stop` | **Ported in this change** | Before the change the response body failed with no error event. The transform still rejects the stream; [streamHandler.js](../../../open-sse/utils/streamHandler.js) now sends the in-band recovery frame. |
| Preflight before HTTP 200 | **Already present** | Single models use `holdForEarlyEof`: one sibling retry for a stream that ends or errors before content, inside `STREAM_EARLY_EOF_PEEK_MS` (default 10 s). Combos use [the content peek](../../../open-sse/utils/streamContentPeek.js). [The failover test](../../../tests/unit/stream-early-eof-failover.test.js) passes and requires the original stream when no sibling is left, where upstream returns 502 or 504. |
| Account success only after a real terminal | **Already present** | `onCoherentTerminal` in [streamingHandler.js](../../../open-sse/handlers/chatCore/streamingHandler.js) clears account state only for an upstream or validated terminal; [terminal tests](../../../tests/unit/stream-terminal-outcome.test.js) pass. |
| Separate first-byte and stall timeouts | **Already present** | `pipeWithDisconnect` takes both; [the first-byte test](../../../tests/unit/stream-first-chunk-timeout.test.js) passes. |
| A 2xx non-SSE reply is a failure | **Already present** | Reported as 502; [test](../../../tests/unit/port9r-http200-chat-outcome-5864.test.js). |
| Input-too-long does not lock the account | **Already present** | A temporary probe of `checkFallbackError` returned `requestScoped` with no fallback or cooldown for the Kiro `CONTENT_LENGTH_EXCEEDS_THRESHOLD` text and other context-length texts at status 400. [Combos advance past a request-scoped 400](../../../tests/unit/port-5cdcddf5-combo-request-scoped-4xx.test.js). |
| History trimming guard and Kiro Claude 4.5 limits | **Not applicable** | New history trimming inside upstream's capacity adapter. `open-sse/services/capacityAdapter.js` is absent. The added Kiro rows size that guard; here `resolveModelLimits` returns `known: false` for the three base Kiro Claude 4.5 ids and the one suffixed id probed. |
| `update-9router.sh` | **Not applicable** | Upstream deployment script. `update-9router.sh` is absent. |

## Open items

- **Owner decision, HTTP 413:** the same probe shows a 413 "Input is too long" without `requestScoped`, so a combo stops on it. [errorConfig.js](../../../open-sse/config/errorConfig.js) marks 413 `fallback: false` (9router #3386), and [a model fallback test](../../../tests/unit/review-b-fallback-timeout.test.js) requires the stop. Left unchanged.
- A translated Claude error is still followed by `data: [DONE]`, as other translated stream errors here are. Upstream sends Claude clients no `[DONE]`.
- In the native probe run before the change, the last text delta before the cut did not reach the client. The likely cause, not isolated here, is that a rejecting transform drops unread output. This change does not alter the rejection.
- A natively cut stream keeps its `cancelled` request row; upstream records `error`.
- Cut Chat Completions streams for Responses or Gemini clients, and cut Kiro, Ollama, Cursor or CommandCode upstreams, were not checked. The upstream change targets the Anthropic client contract.

## Checks

- The new test failed on its three gap cases before the change; its four normal-ending cases already passed. All seven pass now.
- The `scripts/checks-select.mjs` selection for the changed source and the new test passed: 167 files, 1979 tests.
- ESLint on the two changed source files and `pnpm run lint:anti-slop` passed. The full suite was not run.
