# #1073: late-June existing response framing tail

Review compares the exact public PR patches with this checkout. The #5124 PR head is a changelog-only commit; its enclosing merge is used as the named public PR diff so the runtime changes are not lost. No provider traffic or exploit fixture is involved.

## Pins

| OmniRoute PR | PR head | Enclosing merge / reviewed public diff |
| --- | --- | --- |
| [#4942](https://github.com/cheaper-inference/OmniRoute/pull/4942) | `7f08078a85e915c158842ef79bd755e51e3fbfa5` | `2ddf714c2b9cb2860240e549dbac0545488db97e` |
| [#5124](https://github.com/cheaper-inference/OmniRoute/pull/5124) | `26ff2d0618921eba5be03c119f78eac4844f8465` | `9e2c2817da8bfcec5f4a19dcc99789cbe3bd863f` |
| [#5416](https://github.com/cheaper-inference/OmniRoute/pull/5416) | `b650b95c1e87c1f808c9ce451481c21f1a47412a` | `e9c739184eb308b951673a1d305a3b6f8c724356` |

## Findings and dispositions

### #4942 — malformed HTTP-200 translated nonstream bodies

The PR adds a post-translation check for empty Chat choices or Responses output and reports a sanitized `[MALFORMED-200]` diagnostic before returning 502. Its patch explicitly defers streaming parser return-shape, abort-reason, and Responses terminal/text accumulation work; its synthesized stream error helpers are not wired into a stream path in this patch.

DurinDoor already validates the raw upstream body with `isCoherentNonStreamingResponse` in [nonStreamingHandler.js](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) and then checks translated output with `hasUsefulContent` (same file). That second guard rejects empty choices and empty translated Responses/message shapes, while allowing tool calls, reasoning-only Chat results, valid Claude refusals, token-limited completions and the trusted Antigravity empty-stop case. The first guard rejects malformed/missing upstream terminals before usage success is recorded. Ordinary offline fixtures include [non-streaming-forced-client-sse.test.js](../../../tests/unit/non-streaming-forced-client-sse.test.js) (valid and malformed post-translation output) and [stream-terminal-outcome.test.js](../../../tests/unit/stream-terminal-outcome.test.js) (format-specific terminal validity).

**Disposition: behavior already covered; no follow-up.** The named patch's additive structured stdout telemetry is not evidence of a missing response-framing behavior. Do not transplant its broad heuristic or its unwired synthetic stream-error helpers; the current output-shape exceptions and terminal/accounting checks are intentional.

### #5124 — long streams, cancellation and JSON/SSE framing

The #5124 head is a changelog entry. The enclosing merge's runtime diff adds a successful-stream completion guard, classifies client disconnects as `client_disconnected`, adds `application/json` body sniffing for actual SSE in `jsonBodyToSse.ts`, and carries additional reasoning fields through JSON-to-SSE conversion. It also changes stream failure finalization and disconnect-aware cancellation.

Local control flow has equivalent protections for important state transitions: [streamingHandler.js](../../../open-sse/handlers/chatCore/streamingHandler.js) finalizes disconnects as cancelled, records partial usage with cancelled status and stops the upstream; [stream.js](../../../open-sse/utils/stream.js) owns terminal/usage finalization; [streamTerminal.js](../../../open-sse/utils/streamTerminal.js) distinguishes provider terminal outcomes. Fixtures [streaming-interrupted-detail.test.js](../../../tests/unit/streaming-interrupted-detail.test.js), [stream-terminal-outcome.test.js](../../../tests/unit/stream-terminal-outcome.test.js), and [omni-response-mask-reasoning-shape.test.js](../../../tests/unit/omni-response-mask-reasoning-shape.test.js) cover cancellation bookkeeping, terminal classification, and preservation of structured reasoning data. JSON completions requested as streams are framed locally, and the reverse direction accepts complete JSON documents under event-stream media type; see [stream-absent-json-response-port.test.js](../../../tests/unit/stream-absent-json-response-port.test.js) and [omni-json-under-sse-media-type.test.js](../../../tests/unit/omni-json-under-sse-media-type.test.js).

One narrow gap is demonstrated in [streamingHandler.js](../../../open-sse/handlers/chatCore/streamingHandler.js): for an OpenAI target, an upstream `application/json` body is read and passed directly to `JSON.parse` before completion framing. If those bytes are actually SSE (a content-type mismatch covered by the upstream patch), this path returns invalid-JSON failure instead of preserving the frames. Existing fixtures prove the JSON-completion and JSON-under-SSE directions, but do not cover SSE bytes mislabeled as JSON on this streaming path.

**Disposition: narrow gap; accept only bounded SSE sniff-and-preserve handling for the OpenAI streaming path.** Ordinary offline acceptance should supply chunked SSE bytes with an `application/json` header, show that complete frames reach the client unchanged and the response is event-stream, then cancel during a pending read and assert upstream cancellation and one cancelled usage/finalization record. Also retain a normal JSON completion case and an unknown/malformed body case that remains an error. The sniff must not reinterpret arbitrary JSON or alter provider terminal, usage, or cancellation accounting.

### #5416 — ordinary JSON response byte framing

The PR serializes the translated nonstream response once, then sets `Content-Length` from the UTF-8 byte length while retaining caller headers. Local [nonStreamingHandler.js](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) serializes the translated object into a JSON `Response`, but does not set `Content-Length`; its ordinary JSON fixture [nonstream-trailing-done-5384.test.js](../../../tests/unit/nonstream-trailing-done-5384.test.js) checks the body and conversion, not byte framing. The streamed response/header fixtures are separate and do not cover this ordinary JSON path.

**Disposition: narrow gap; adopt explicit byte-accurate framing at the ordinary JSON response boundary.** Ordinary offline acceptance should assert `Content-Length === Buffer.byteLength(await response.clone().text())` with a non-ASCII JSON value, preserve `Content-Type` and existing response headers, and continue to assert valid parsed JSON. This helper must remain on the nonstream branch; it must not affect SSE framing, streaming usage finalization, or cancellation.

## Scope

These dispositions concern the three pinned patches and the mapped current paths only. The two proposed acceptances are ordinary local fixtures with synthetic in-memory bodies; neither needs a live transport, credentials, provider request, exploit-shaped input, or relaxed treatment of unknown response shapes.
