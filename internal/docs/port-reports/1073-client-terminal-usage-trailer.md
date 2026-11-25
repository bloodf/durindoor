# 1073: client terminal usage trailers

Compared against OmniRoute [#20279](https://github.com/cheaper-inference/OmniRoute/pull/20279) at `d3132e501a1ed3e240cd5450fbf7240d1689a587`. On 2026-11-20 it was open, ready, clean, and its required CI and Quality gates passed. Earlier cancelled and failed runs remain in its history. The upstream change covers broader accounting and translation work; this is a narrow local adaptation.

An OpenAI finish can precede a choices-empty usage receipt. The standalone Claude translator emits its terminal immediately, and accounting can subsequently record a receipt that the client cannot see. The wrapper now projects an immediately adjacent, complete, same-response-ID usage frame already present in the current read into the existing Claude or Responses terminal. It does not wait for another read, change the standalone translator, or emit another terminal. Matching IDs and adjacency prevent borrowing a neighbouring response's receipt. Normal accounting still consumes the receipt in order.

Receipts arriving in a later read remain an explicit residual: the request body is not a reliable advertisement of the actual upstream request because executors can add or remove `stream_options`. Waiting for an unconfirmed receipt would change normal finish timing; transport chunking alone provides no promise that a later read will arrive. The existing Responses-specific timeout is not extended to Claude. The buffered optimization does not claim general late-trailer parity or durable exactly-once persistence.

Focused synthetic tests exercise the client terminal, response identity and completion callback alongside the existing stream and translator regressions. They do not use live providers.
