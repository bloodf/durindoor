# Gemini and Antigravity replay, enum cleaning and native errors — #2034

## Sources

Pinned public sources from router-for-me/CLIProxyAPI (MIT), read at head
`dbe641f286a489ecb39e3c041c554371e6add864`. Attribution: CLIProxyAPI contributors.
The grouping order, the enum rule and the Google RPC error shape below are adapted
from these files. No live account was used.

| Commit | Files | Disposition |
| --- | --- | --- |
| [`13e0642`](https://github.com/router-for-me/CLIProxyAPI/commit/13e06420967b8d1762c7422d689583a1d3b6c6a0) group and align split Gemini functionResponse turns | [`gemini_gemini_request.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/translator/gemini/gemini/gemini_gemini_request.go), its test, `antigravity_reasoning_replay_test.go` | Ported |
| [`54ed2ba`](https://github.com/router-for-me/CLIProxyAPI/commit/54ed2ba2016642abd897456f48d84b9f0fee6632) strip empty, whitespace-only and null enum values (#8571) | [`gemini_schema.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/util/gemini_schema.go), its test | Ported, without description hints |
| [`249ea68`](https://github.com/router-for-me/CLIProxyAPI/commit/249ea68d71857bcdbca41f65d5d9bc4ed9db96ee) Google RPC APIError JSON for post-commit SSE errors | [`gemini_handlers.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/sdk/api/handlers/gemini/gemini_handlers.go), [`gemini_handlers_stream_error_test.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/sdk/api/handlers/gemini/gemini_handlers_stream_error_test.go) | Ported |
| [`66f3ad1`](https://github.com/router-for-me/CLIProxyAPI/commit/66f3ad17c6bb6c3ead080b3d10388fbe47074fe8) reduce allocations when normalizing Gemini tool responses | [`antigravity_request_format.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/translator/antigravity/gemini/antigravity_request_format.go), its test | Not ported |

The post-thought `MALFORMED_FUNCTION_CALL` message comes from
[`gemini_zero_output.go`](https://github.com/router-for-me/CLIProxyAPI/blob/dbe641f286a489ecb39e3c041c554371e6add864/internal/runtime/executor/helps/gemini_zero_output.go)
at the same head, as exercised by the Antigravity case in the 249ea68 test file.

EasyCLIProxyAPI `29567ead8164a00724dfdc2087f02a23895636ee` is unchanged. The six-commit
OmniRoute `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` delta is docs and catalog checks only,
with no auth runtime change. Neither needs a port in this lane.

## Existing behavior checked first

- The OpenAI to Gemini translator already places each reply right after its model turn,
  keyed by call id, so an id-carrying split history reached a Gemini upstream in order.
  The new route test keeps that guard.
- The `/v1beta` bridge paired idless replies by name with the calls of the turn just before
  them (#1089). It did not read snake_case `function_response` parts. It turned a split
  history with a text turn between the replies into tool, user, tool messages, which an
  OpenAI upstream rejects.
- `dropEmptyEnumValues` already dropped `""` and `null` in the cleaned Gemini schema path.
  It kept whitespace-only values. The direct Claude to Gemini translator did no empty-value
  cleaning.
- The Antigravity empty-stream guard retried an empty attempt in place, even after thought
  frames had reached the client. The native `/v1beta` Antigravity stream then emitted
  `data: {"error":{message,type,code:"stream_error"}}` plus `data: [DONE]`. The
  OpenAI-bridged `/v1beta` stream dropped in-stream error chunks and closed as if done.
- Pre-commit retry of an empty attempt, the `#1089` pairing tests, and `[DONE]`-free
  native success streams were correct and are unchanged.

## Changes

- `groupGeminiFunctionResponses` (`open-sse/translator/formats/gemini.js`) follows 13e0642.
  It runs only when a split, interleaved or misordered reply set follows a model turn with
  calls. Matching order is exact id+name, then id, then name, then nameless replies, then
  client order. Unmatched and excess replies are appended. Non-response turns move after the
  grouped turn. An empty, non-array or call-bearing turn is a boundary left in place, so
  incomplete or corrupt histories still reach provider pairing validation. Both camelCase
  and snake_case parts are read and kept as sent.
- The `/v1beta` bridge groups before it pairs ids and reads snake_case parts. A nameless,
  idless reply takes the next unanswered call of the preceding turn by position, the
  bridge form of CLIProxyAPI's empty-name backfill, which 13e0642 extends to snake_case.
  The Antigravity executor groups before tool-name aliasing and thought-signature backfill.
- Gemini-only enum cleaning drops whitespace-only strings too. The Claude to Gemini
  translator now runs the same rule before its numeric-enum lift. Valid values keep their
  exact spelling, including surrounding spaces. Other keywords and formats are untouched.
- Native Google stream errors after commit are one raw Google RPC JSON object with an
  integer `code`, `message` and a canonical `status`. There is no `data:`, `event:` or
  `[DONE]` framing, matching 249ea68 for the Go and JS genai readers. Upstream RPC status
  and object `details` entries are kept after the existing credential redaction. OpenAI
  string codes fall back to 500 `INTERNAL`. This covers the native Antigravity path
  (`open-sse/utils/stream.js`) and the OpenAI-bridged path (`geminiBridge.js`).
- For native Gemini clients, `createEmptyRetryStream` gets `replayCommitted: false`. Once a
  forwarded frame carried output (thinking included), an empty attempt is not replayed. It
  ends with the held upstream error, or with 502 `UNAVAILABLE`
  `upstream returned zero output with finishReason <reason>`. Other clients keep the
  existing retry policy.

## Not ported

- 66f3ad1 is allocation work inside CLIProxyAPI's Antigravity wire normalizer, plus two
  edge rules (object-shaped `parts`, duplicate `result` keys). That normalizer rewrites a
  lone string `functionResponse.response.result` to `output`. DurinDoor's Antigravity wire
  contract keeps `result` (`wrapFunctionResult`, upstream #5529), so there is no matching
  code path to port into.
- 54ed2ba appends `Empty string "" allowed` / `(nullable)` hints to descriptions. Those
  change tool descriptions and are left out.

## Evidence

`tests/unit/cpa-gemini-replay-parity.test.js` uses real translators (with
`translator/registerAll.js`), the real public `/v1beta` route and `handleChatCore`. Only
the upstream executor is mocked. Without the source changes, 15 of its 17 tests fail. The
two that pass guard behavior that was already correct.

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/cpa-gemini-replay-parity.test.js --maxWorkers=2
```

Existing Gemini, Antigravity, empty-stream, enum and `/v1beta` suites were rerun
unchanged, including `v1beta-gemini-gateway-conformance-1089.test.js`.
