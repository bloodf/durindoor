# fal.ai native realtime transport (staged), 2026-11-27

Issue: #2034. Decision15 accepted this delta: `src/lib/fal/dispatch.ts` → `open-sse/handlers/fal/realtime.ts` and `config/falEndpoint.ts`. The transport and its adapter are staged together. They implement fal's own MessagePack WebSocket protocol. This is not a chat-backed text bridge. OpenAI Realtime is not added because no reachable source supports it.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout at `/tmp/omni-2034` was confirmed to be at that HEAD.

- `src/lib/fal/dispatch.ts`: `openSocket` resolves the proxy for `https://fal.run`. It connects with `falRealtimePath(definition)`, registers the session with `compileFalInput(definition, "realtime")`, sends the first input, and returns `connection.output` as `text/event-stream`. `failure` closes the session. A failure after dispatch counts as uncertain.
- `src/lib/fal/realtime.ts`: a process-local session map. `sendFalRealtime` validates each follow-up input before it sends. It also has the artifact store.
- `src/lib/fal/runtime.ts`: the token is `apiKey || accessToken` of the selected connection. A relay proxy is refused.
- `open-sse/handlers/fal/realtime.ts`: `connectFalRealtime` opens `wss://fal.run/{path}`. `send` writes `encode(input)`. Each frame goes through `decode` and then `normalizeFalOutput`. Binary file objects become artifacts, either as a data URI or a stored URL, and other bytes become `{ binary_base64 }`. A frame that fails to decode ends the session with "Invalid fal realtime output".
- `open-sse/handlers/fal/socket.ts`: `FalSocket` sends `Authorization: Key`, with `followRedirects: false`, a 15 s handshake, a 32 MiB `maxPayload`, and an HTTP(S) proxy only. Any other proxy gets a 409. Each event goes out as SSE. Backpressure is handled with pause and resume. An abort or close during an uncertain state yields `SUBMISSION_UNKNOWN`. The send buffer is capped at 1 MiB (429). A send after close gets a 410. Close runs once.
- `open-sse/handlers/fal/output.ts`: `normalizeFalOutput`.
- `open-sse/handlers/fal/schema.ts` and `realtimeSchema.json`: selection of the realtime input schema and validation that does not mutate the input.
- `open-sse/config/falEndpoint.ts`: `canonicalFalEndpoint`, `DOCUMENTED_REALTIME`, and `falRealtimePath`.
- `tests/unit/fal-transports.test.ts`: the realtime cases. Their input shape, validation errors, MessagePack round trip, abort behavior, and path-only override rule are carried into the local suite.

## What already existed locally

No fal realtime transport existed:

- `open-sse/providers/registry/fal-ai.js` defines `fal-ai` (alias `fal`, API key) with the service kinds image, video, and music. It has no realtime config.
- `open-sse/handlers/realtimeCore.js` and `nativeRealtimeRelay.js` relay OpenAI-, Gemini-, and xAI-style JSON realtime sockets for chat models. Their protocol, authorization, and framing (JSON text) differ from fal's, so they are not equivalents. Neither file is changed.
- No MessagePack codec is installed. `@msgpack/msgpack` is not a dependency, and the task forbids adding one.

## What landed (private, unregistered)

| File | Role |
| --- | --- |
| `open-sse/services/providerParity/native-fal-realtime/config.js` | Provider id and alias, origin, documented endpoints, limits, and metadata. |
| `.../schema.js` | Endpoint and path checks, realtime input-schema selection, and the local validator. |
| `.../realtimeSchema.json` | The source's bundled fast-lcm-diffusion realtime schema, copied verbatim with its provenance fields. |
| `.../msgpack.js` | A small, bounded MessagePack encoder and decoder. |
| `.../socket.js` | One bounded WebSocket session: handshake, abort, frame, send-buffer, output-queue and idle limits, and cleanup that runs once. |
| `.../realtime.js` | `connectFalRealtime`, key selection, frame-to-event mapping, and binary artifacts. |
| `.../index.js` | Re-exports everything above. |
| `.../registration.json` | Exports, transport contract, and integration points for the serial registration change. |
| `tests/unit/native-fal-realtime.test.js` | 43 tests that use only synthetic sockets. |

No production code imports these modules. The unregistered state is asserted only in the `staging state (pre-registration only)` block. The protocol, schema, auth, security, lifecycle, and two-connection tests do not depend on it.

## Contract

- **URL:** `wss://fal.run/{endpoint_id}{path}`. `path` is `x-fal-realtime.path` when set. Otherwise it is `/realtime` for `fal-ai/fast-lcm-diffusion`. Otherwise there is no realtime transport. Malformed endpoint ids and paths get a 400 before any key use.
- **Input schema:** `x-fal-realtime.input_schema` if present. Otherwise, the bundled schema applies, but only for fast-lcm-diffusion when there is no override at all. A path-only override gets a 400. Unknown top-level keys are refused unless `additionalProperties` is true.
- **Auth:** `Authorization: Key <apiKey | accessToken>`, sent only on the upgrade request. A missing key gets a 401 before any socket opens. The key never appears in the URL, in events, or in errors.
- **Wire:** each input and each output is one binary MessagePack frame. The fixtures are byte strings assembled by hand from the MessagePack spec. They cover fixmap, fixstr, str8, true, float64, uint32, a nested uint16 map, bin8, a negative fixint, and an array.
- **Events:** each output arrives as `data: {"artifacts":[…],"output":…}`. Errors arrive as `event: error` with `{ error, status }`, where `status` is `FAILED`, `IDLE_TIMEOUT`, or `SUBMISSION_UNKNOWN`, and the stream then ends.
- **Retries:** none. The session never reconnects and never replays input. When the session ends after an input was sent but before its output arrived, it reports `SUBMISSION_UNKNOWN`.

## Fork deviations

- The codec is local (`msgpack.js`). It matches `@msgpack/msgpack`'s default encoding choices and is stricter when decoding:
  - Trailing bytes, over-deep nesting, and lengths larger than the remaining bytes are refused.
  - Unsafe 64-bit integers, non-string or non-number map keys, duplicate keys, and invalid UTF-8 are refused.
  - All ext types except timestamp are refused.
- Validation is local and covers a subset of JSON Schema (listed in the `schema.js` header). The source uses Ajv and ajv-formats, which are not dependencies here.
- The legacy alias table from `canonicalFalEndpoint` is not ported. Realtime endpoints are always given in full.
- An abort during the handshake returns 499, where the source returns 504.
- The session has a local handshake deadline and an idle timer (120 s). It also caps queued output at 64 MiB and encoded input at 8 MiB (413).
- An error with no input in flight is reported as `FAILED`. The source reports every failure as `SUBMISSION_UNKNOWN`.
- Validation happens in `send`, not in the session registry.
- The process-local session registry, the artifact store, and the job and accounting rows from `dispatch.ts` are left to the registration change. `artifact` is a hook.

## Not covered

- OpenAI Realtime bridging and chat-backed text bridges.
- fal's `http-websocket` transport (`wss://ws.fal.run`). It is staged separately; see [native-fal-http-websocket.md](native-fal-http-websocket.md).
- Live fal sockets. Every test uses a synthetic socket.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-fal-realtime.test.js --maxWorkers=2
```

Result: 43 passed.
