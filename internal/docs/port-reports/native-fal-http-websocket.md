# fal.ai HTTP over WebSockets (staged), 2026-11-27

Issue: #2034. The staged realtime port (`17f7b65912`) left out fal's `http-websocket` transport (`wss://ws.fal.run`) and the legacy endpoint aliases. This change adds both as a private, unregistered bundle. The frozen realtime bundle and its 43 tests are not changed.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT), read from the local object database with `git show`.

- `open-sse/handlers/fal/httpWebsocket.ts`: `connectFalHttpWebsocket` opens `wss://ws.fal.run/{canonicalFalEndpoint(endpoint)}`. `send` writes `JSON.stringify(input)` as one text frame. While an invocation is pending, another send gets a 409. Each send arms an invocation deadline. A reply violation fails the session with "Invalid or oversized Fal HTTP WebSocket response". `onClose` reports whether an invocation was still pending.
- `open-sse/handlers/fal/httpWebsocketReply.ts`: the reply state machine. A text frame whose JSON is a record with `type: "start"` or `type: "end"` is a control frame. Every other frame is body. `start` needs a pending invocation, a string `request_id`, object `headers`, and an integer status from 100 to 599. The body is capped at 32 MiB. An event-stream body is parsed as SSE. `end` must carry the same `request_id`. It emits `error` when either status is 400 or more. Otherwise it emits `http-end` for SSE and `final` for other bodies. A binary body becomes one artifact, named from `Content-Disposition`.
- `open-sse/handlers/fal/events.ts`: `createFalEventParser`, with an 8 MiB pending-event cap. A stream that ends partway through an event is an error.
- `open-sse/handlers/fal/socket.ts`: the shared `FalSocket` lifecycle. The realtime port already records it.
- `src/lib/fal/dispatch.ts`: resolves the proxy for `https://ws.fal.run`, takes the invocation deadline from `getConfiguredTimeout()` (120 s by default), and passes the artifact store.
- `src/app/api/v1/fal/run/route.ts`: an `http-websocket` request validates its input with the direct HTTP schema (`compileFalInput(definition, "direct")`).
- `open-sse/config/falEndpoint.ts`: `LEGACY_FAL_ENDPOINTS` (18 aliases), `isLegacyFalEndpoint`, and `canonicalFalEndpoint`.

## Why the realtime socket is not reused

`openFalRealtimeSocket` cannot carry this protocol on the wire:

- It sends binary frames. The source sends JSON as text frames.
- It maps each inbound frame to exactly one event. Here a frame can produce zero events (a body chunk) or many (SSE).
- It decides uncertainty by counting frames sent against frames received. Here the `start` frame arrives before the result, so only the open invocation is a correct signal.

The bundle therefore has its own bounded session in `httpWebsocket.js`, built on the same patterns. It reuses these realtime pieces read-only:

- `FalRealtimeError`
- `falRealtimeSseEvent` (byte-identical SSE framing)
- `falRealtimeToken`
- `normalizeFalRealtimeOutput` (identical to `normalizeFalOutput` for JSON values)
- the realtime id check `canonicalFalRealtimeEndpoint`
- the realtime schema validator, given the direct schema through a wrapped `x-fal-realtime.input_schema`

## What landed (private, unregistered)

| File | Role |
| --- | --- |
| `open-sse/services/providerParity/native-fal-http-websocket/config.js` | Provider id and alias, the fixed origin and proxy origin, limits, and metadata. |
| `.../endpoint.js` | The legacy alias table and `canonicalFalEndpoint`, `canonicalFalDefinition`, `isLegacyFalEndpoint`, and `falHttpWebsocketUrl`. |
| `.../realtimeAlias.js` | `connectFalRealtimeCanonical`, `falRealtimePathCanonical`, and `falRealtimeUrlCanonical`: the frozen realtime bundle with the definition's `endpoint_id` canonicalized first. |
| `.../schema.js` | Direct HTTP input-schema selection and its validator. |
| `.../reply.js` | The SSE parser and the start/body/end reply state. |
| `.../httpWebsocket.js` | `connectFalHttpWebsocket`: one bounded session. |
| `.../index.js` | Re-exports everything above. |
| `.../registration.json` | Exports, transport contract, and integration points for the serial registration change. |
| `tests/unit/native-fal-http-websocket.test.js` | 52 tests that use only synthetic sockets. |

No production code imports these modules.

## Supported transports

- **`http-websocket`** (new): `wss://ws.fal.run/{endpoint_id}`.
  - **Input:** one text frame holding `JSON.stringify(input)`, validated with the endpoint's direct HTTP schema. That schema is `POST /{endpoint_id}`, or else the only non-`/stream` POST without `{request_id}`. The realtime schema is never used.
  - **Invocations:** one at a time.
  - **Output:** SSE, with these events:
    - `http-start` carries the start frame.
    - Each native SSE event is forwarded as it arrives, followed by `http-end` with `{ http }`.
    - A JSON or text body produces `final` with `{ artifacts, output, http, partial: false }`.
    - Any other body produces `final` with `{ output: { file }, artifacts }`.
    - An HTTP status of 400 or more produces `error` with the same fields plus `error`. The session stays open after this.
- **`realtime`**: unchanged. `connectFalRealtimeCanonical` adds alias normalization so both transports accept the same endpoint ids.

## Restrictions

- **Fixed origins only.** The URL is always `wss://ws.fal.run/` followed by a canonical `owner/app[/subpath]`. Ids with a host, query, fragment, `//`, `.` or `..` segments, or more than 300 characters get a 400 before any key is used. Alias lookup is an own-property check, so `constructor` and `__proto__` are refused.
- **Auth:** `Authorization: Key <apiKey | accessToken>` of the selected connection. It is sent only on the upgrade request, with `followRedirects: false`. A redirect or a non-101 response fails the handshake with a fixed 502 and never opens a second socket. The key never appears in the URL, in events, or in errors.
- **Egress:** each call uses only its own connection's proxy. HTTP(S) proxies are supported. Any other scheme gets a 409, and a proxy that fails to start gets a 502.
- **Bounds:** handshake 15 s, frame 32 MiB, send buffer 1 MiB (429), response body 32 MiB, SSE event 8 MiB, input 8 MiB (413), invocation deadline 120 s (the route passes its configured timeout), output high water 1 MiB with pause and resume, queued output 64 MiB, idle 120 s with no invocation pending.
- **No reconnect, no replay.** An invocation that has no `end` when the session stops (abort, deadline, connection loss, protocol violation, or a failed send callback) emits `error` with `SUBMISSION_UNKNOWN`. In that case `onClose(true)` is called and later sends get a 410.

## Fork deviations

These match the realtime port:

- The session has a local handshake deadline.
- An abort before open returns 499. The source returns 504.
- An error with no invocation pending is reported as `FAILED`. The source reports `SUBMISSION_UNKNOWN`.
- The session has an idle timer and a cap on queued output.
- Validation happens in `send`, which also caps the input size.
- A sync send failure throws a fixed 502 and the session stays usable.
- Without an artifact hook, binary bodies become a data URI.

These are new:

- `request_id` is limited to 256 characters.
- Every protocol violation throws one fixed message.

## Not covered

- The process-local session registry, the artifact store, job and accounting rows, the prompt-injection guard, and the route itself. These are left to the registration change described in `registration.json`.
- Live fal sockets. Every test uses a synthetic socket.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-fal-http-websocket.test.js unit/native-fal-realtime.test.js --maxWorkers=2
```

Result: 95 passed (52 new and the 43 existing realtime tests, unchanged). Lint: `oxlint -c .oxlintrc.json` on the new bundle and its test reports no diagnostics.
