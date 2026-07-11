# Realtime WebSocket Bridge

OpenAI-Realtime-shaped WebSocket endpoint that bridges text chat to the
existing chat-completions core. Mounted at `GET /v1/realtime` (upgrade) on the
same `custom-server.js` that serves the dashboard and `/api/*`.

## Scope

- **Text modality: full.** Each `response.create` turns the session
  conversation into an ordinary OpenAI chat-completions request and re-frames
  the SSE stream into Realtime events.
- **Audio modality: not supported.** Declaring `audio` in `session.modalities`
  and issuing `response.create` yields an `error` event
  `{"type":"invalid_request_error","code":"modality_not_supported","message":"audio modality not supported"}`
  and the socket stays open. Audio is never faked.

## Auth

`Authorization: Bearer <key>` header, or the OpenAI subprotocol convention
(`openai-insecure-api-key.<key>`). The key is validated against the same policy
as the HTTP routes; a rejected key closes the socket with code `4001`.

## Client → server events

| Event | Purpose |
|---|---|
| `session.update` | Update `model`, `instructions`, `modalities`, `temperature`, `max_output_tokens`. Validated atomically: every supplied known field is checked before any is applied; on failure an `error` is emitted, nothing mutates, and no `session.updated` is sent. Unknown fields are accepted and ignored (not stored). |
| `conversation.item.create` | Append a message item. When `item.role` is supplied it must be `user`, `assistant`, or `system`; when omitted it defaults to `user`. Unknown item fields are accepted and ignored (not preserved on the stored/emitted item). |
| `response.create` | Generate a response from the current conversation. Refused with `response_in_progress` while a response is streaming. |
| `response.cancel` | Abort the in-flight response. |

### `session.update` validation ranges

| Field | Rule |
|---|---|
| `modalities` | array of strings, each ∈ {`text`, `audio`} |
| `temperature` | finite number in `[0.6, 1.2]` |
| `max_output_tokens` | finite integer in `[1, 4096]` |
| `model`, `instructions` | string |

Out-of-range / wrong-type values reject the whole update (no partial apply).

## Server → client events

`session.created`, `session.updated`, `conversation.item.created`,
`response.created`, `response.output_text.delta`, `response.output_text.done`,
`response.done`, `error`.

## Resource limits

Sourced from `open-sse/config/runtimeConfig.js` (backed by
`src/shared/utils/realtimeConfig.js` for bare-Node CJS consumers):

| Limit | Default | Env override | Behavior when exceeded |
|---|---|---|---|
| `MAX_SESSION_ITEMS` | `100` | `REALTIME_MAX_SESSION_ITEMS` | On growth, oldest **non-system** items are dropped first. System items are never evicted; if the history is at the cap and consists entirely of system items, `conversation.item.create` is rejected with `error.code = "session_item_limit"` and no `conversation.item.created` is emitted. The cap is checked after every growth — client items and the assistant turn — so memory per session is O(cap). |
| `MAX_REALTIME_FRAME_BYTES` | `1048576` (1 MiB) | `REALTIME_MAX_FRAME_BYTES` | Enforced via the `ws` `maxPayload` option. An oversize frame trips a socket `error` and the stack closes with code `1009` (Message Too Big). |

## Disconnect / error cleanup

- On `close` **and** on `error`, the session's `dispose()` aborts any in-flight
  upstream chat (the `response.create` `AbortController`), so provider
  connections and tokens are not stranded. Frames already queued across the
  auth window are dropped and cannot start a response after cleanup.
- The abort is abort-only: the owning response clears its own controller in its
  `finally` (guarded by controller identity), so an abort racing a newer
  `response.create` can never clobber the newer request's handle.

## Test entry

`tests/unit/realtime-ws.test.js` — covers bad-key close (4001), ordered event
sequences ending in `response.done`, audio-modality refusal, frame/session
validation, oversize-frame rejection, history cap, disconnect cleanup, and
upstream-error propagation.
