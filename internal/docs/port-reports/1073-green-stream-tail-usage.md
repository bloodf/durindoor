# 1073: stream tail usage inventory

Compared at DurinDoor base `fcc5d0be2184c9b730b735330e91f15ad9156832` on 2026-11-20.

## OmniRoute #20279

https://github.com/cheaper-inference/OmniRoute/pull/20279 remained open at `d3132e501a1ed3e240cd5450fbf7240d1689a587`; GitHub REST reported mergeable and clean. The latest CI Gate completed successfully (earlier cancelled runs and failed gates also remain in the history). Its diff covers partial usage receipts, unterminated tails, translated terminal usage, cache counters, estimates and accounting. It also introduces upstream-specific accounting machinery; that machinery is not imported here.

DurinDoor already handles several pieces: `open-sse/utils/stream.js` merges extracted receipts, consumes buffered unterminated passthrough and translated lines, guards the completion callback, and preserves protocol-specific terminal handling. `tests/unit/stream-completion-usage.test.js` covers trailing receipts in passthrough and translation, unterminated passthrough metadata, and native terminal summaries. `tests/unit/passthrough-usage-trailer.test.js` covers real versus estimated usage and sentinel handling. `tests/unit/omni-green-stream-tail-usage.test.js` independently exercises synthetic ordinary streams on both paths, with one completion callback and a single terminal frame. The callback is evidence of exactly-once completion, not by itself proof of exactly-once durable persistence.

**Residual, not ported:** `open-sse/translator/response/openai-to-claude.js` emits `message_delta` and `message_stop` on a finish chunk and returns before processing a later choices-empty usage chunk. Thus accounting can see a later receipt while the Claude client terminal has already been emitted. Deferring it changes existing immediate-finish behavior exercised by `tests/translator/port-2279-claude-finish-guard.test.js` and interacts with translated stream finalization and failure paths in `stream.js`. The upstream change is broader than an isolated replacement; a safe port needs the complete terminal, partial receipt, drain and failure matrix verified together. Earlier in-band usage can also cause `open-sse/translator/response/openai-responses.js` to complete at finish before a later receipt. No claim of full parity is made.

## OmniRoute #20291

https://github.com/cheaper-inference/OmniRoute/pull/20291 adds SI `buyer_cost_micro` per-call settlement and a database column. No corresponding SI buyer settlement surface or `buyer_cost_micro` field was found in local `open-sse/` or `src/`. Out of scope: do not introduce a settlement product or schema solely for this change. Local quota reservation settlement is a separate existing surface.

## Focused evidence

On 2026-11-20 the requested report checks and `unit/omni-green-stream-tail-usage.test.js` passed (2 tests) with a private `DATA_DIR` and Vitest cache disabled. This verifies callback counts and captured trailing usage, not the usage in the translated Claude terminal or durable writes. No behavioral change was made; the residual above remains open.
