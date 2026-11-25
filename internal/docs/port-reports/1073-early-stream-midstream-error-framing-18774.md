# #1073: Early SSE reader error framing

[OmniRoute #18774](https://github.com/cheaper-inference/OmniRoute/pull/18774), head `2c70bade6e17f97313c0eba4e47445bbb5e7dcc1`, enclosing merge `09675f166d042c06b812040b1928c846b362a1cb`, distinguishes a completed event from a cut event when the upstream reader fails. The prior local comparison is in [the existing early keepalive report](1073-november-existing-early-keepalive.md).

The slow-path wrapper tracks the forwarded byte suffix across chunks. The wrapper examines only the last four bytes of each chunk and a bounded previous suffix, recognizing each of the two line endings independently (LF or CRLF), including mixed endings split across chunks. A reader failure after a complete event boundary retains the existing generic protocol-shaped error and clean EOF. A failure inside an event errors the body with a generic message, without appending an invalid frame or exposing the upstream error. Clean EOF and cancellation retain their existing handling. This does not change the provider blank-frame filter, retry or timeout policy.

Offline evidence: `test -s internal/docs/port-reports/1073-early-stream-midstream-error-framing-18774.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-early-stream-midstream-error-framing.test.js unit/messages-early-stream-keepalive.test.js unit/keepalive-error-frame-status.test.js unit/omni-stream-buffering-response-headers.test.js)`.

Refs #1073
