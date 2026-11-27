# Windsurf contract comparison for #2034

Compared at the pinned revisions below without provider traffic or credentials. This is a source comparison, not proof that either service accepts a particular account or model.

- [CLIProxyAPI at 6faa8d2](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d): the recursive repository tree contains no Windsurf-named implementation. This is a bounded filename finding, not proof that no plugin or indirect integration exists.
- [EasyCLIProxyAPI at e4223d5](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/README.md) manages the CLIProxyAPI core and routes requests through its unified endpoint; its listed built-in OAuth providers do not include Windsurf. Plugins can provide additional integrations, which were not assessed.
- [OmniRoute migration 151](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/src/lib/db/migrations/151_windsurf_to_devin_desktop.sql) moves the retired Windsurf provider identity to Devin Desktop. Its [OAuth provider](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/src/lib/oauth/providers/devin-desktop.ts) supports import and Devin CLI browser sign-in, with no refresh token. Its [executor](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/executors/devin-desktop.ts) uses GetUserJwt followed by a different chat contract, sending the raw model ID; its [registry](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/config/providers/registry/devin-desktop/index.ts) points to server.codeium.com.

DurinDoor retains its separate Windsurf import-token flow without refresh, and sends its account token and mapped model in a framed GetChatMessage request through the selected proxy. The upstream migration does not establish that an existing imported Windsurf credential is a Devin session credential or that a Devin browser login is valid for this transport. Accordingly neither migration nor session extraction is enabled here. Existing aliases and unknown-model passthrough are retained; account entitlement and current provider acceptance remain unverified. Tool and media support remain subject to the existing executor restrictions. The mock tests do not validate real sign-in, refresh, model availability, server responses, or cross-service credential compatibility.

### Request error disclosure

Windsurf HTTP error bodies can contain arbitrary upstream material. The executor's
error parser returns a fixed message to the gateway; the gateway still reads the
bounded original body for rate-limit evidence and retains the HTTP status. For
successful HTTP responses carrying gRPC errors, the executor retains a numeric
trailer status or a fixed message instead of returning the upstream message.
The existing 502 treatment of gRPC failures is unchanged. This intentionally
replaces the earlier runtime test contract that exposed `grpc-message` and error
chunk text. The parser's internal chunk decoder still exposes decoded material
for protocol parsing; it is not a public error or log contract.

### Typed failures, cancellation, and accepted work

Compared with the local Devin Desktop executor port
(`open-sse/executors/devin-desktop.js`, ported from OmniRoute
[4265bb2](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/devin-desktop.ts), MIT).
That source maps the Connect codes `unauthenticated`, `permission_denied`, and
`resource_exhausted` to 401, 403, and 429. It treats an error trailer before any
content as a plain failure that carries a status, and it does not refresh a rejected
session token. That source covers a different Connect transport. The pinned
revisions contain no Windsurf gRPC-web executor, so the numeric mapping below
follows the gRPC status code table. It is not a port.

- A trusted numeric `grpc-status` arrives in the gRPC-web trailer frame or, for
  a trailers-only response, in the HTTP headers. Before any output, 16
  (UNAUTHENTICATED) becomes a fixed 401 `Windsurf authentication failed`, and 8
  (RESOURCE_EXHAUSTED) becomes a fixed 429. `grpc-message` and error chunk text
  are never read into the result. 7 (PERMISSION_DENIED) keeps the existing 502
  contract that the runtime and error-boundary tests pin. The source maps it to
  403. DurinDoor does not, because a 403 starts the gateway's credential handling
  and nothing here shows the code means a bad credential rather than model
  entitlement.
- Imported Windsurf tokens have no refresh token. The executor declines the
  gateway's refresh-and-resend after a 401 or 403. Before this change, an
  upstream 401 sent the same request twice.
- Output means a content or usage frame. If output is followed by a non-OK
  trailer, a missing trailer, a truncated frame, or an error chunk, the work is
  accepted. A 200 body that fails while it is read is uncertain work. Both
  return 502 with the fixed code `upstream_outcome_unknown`. The single-model
  route then ends on the selected account. It does not cool the account down,
  does not move to a sibling, does not run the outer transient retry, and does
  not resend on a pinned account. This uses the same `upstreamPartialOutput`
  rule as the Antigravity and MiniMax Code paths. The executor's own response
  body keeps its earlier message and `upstream_error` code. The gateway gets
  the classification through `parseError`.
- A trailers-only failure with no output (for example 14 UNAVAILABLE) still
  moves to a sibling, as it did before.
- Cancellation before the send dispatches nothing. Cancellation while the send
  is pending aborts it. Cancellation after headers cancels the upstream body
  reader. Each case returns 499 after at most one send and tries no sibling.
- A success that passed the gRPC OK trailer check is marked `validated`. The
  gateway then settles quota as success and clears the account's stale failure
  state. Before this change, a Windsurf success never cleared that state.
  Failures record `FAILED <status>` and an error detail with zero tokens, and no
  usage row. The gateway records no usage for failures, even when the upstream
  sent a usage frame before failing.
- Successful streaming output is unchanged.

The shared combo guard now stops on `upstreamPartialOutput`. In the mocked
chat-route regression, one Windsurf account and a combo of `windsurf/swe-1.6`
and `windsurf/gpt-5.5` send once when the first reply contains text followed by
`grpc-status: 13`; the client receives `upstream_outcome_unknown` and no success
usage is recorded. With the predecessor's `combo.js`, the same regression sends
twice. A no-output refusal still permits sibling-account fallback. This is
mocked evidence for these scenarios, not proof of all protocol outcomes.

All evidence comes from mocked transports (`tests/unit/windsurf-gateway-accounting-2034.test.js` and
`tests/unit/windsurf-combo-replay-2034.test.js`).
It does not show that real Windsurf services send these status codes in these positions.
