# Realtime WebSocket Bridge

DurinDoor exposes an OpenAI-Realtime-shaped WebSocket endpoint at \"GET /v1/realtime\" (upgrade). It bridges text chat into the existing chat-completions core. The socket is owned by \"custom-server.js\" so it works alongside the Next.js HTTP server.

## Scope

- **Text modality: full.** Each \"response.create\" turns the session conversation into an ordinary OpenAI chat-completions request and reframes the SSE stream into Realtime events.
- **Audio modality: not supported.** Declaring \"audio\" in \"session.modalities\" and issuing \"response.create\" yields an \"error\" event with code \"modality_not_supported\". The socket stays open. Audio is never faked.

## Authentication

Send a DurinDoor API key via one of:

```http
Authorization: Bearer <key>
```

or the OpenAI subprotocol convention:

```text
openai-insecure-api-key.<key>
```

The protocol handler selects a safe subprotocol and never echoes the key-bearing subprotocol back to the client. The key is validated against the same policy as the HTTP routes through a loopback probe to \"/api/v1/realtime/auth\". A rejected key closes the socket with code \"4001\". A failed auth probe (not a bad credential) closes with code \"1011\".

The CLI token \"x-9r-cli-token\" can also be forwarded for local dashboard access.

## Client → server events

| Event | Purpose |
| --- | --- |
| session.update | Update \"model\", \"instructions\", \"modalities\", \"temperature\", \"max_output_tokens\". Validated atomically: every supplied known field is checked before any is applied. On failure an \"error\" is emitted, nothing mutates, and no \"session.updated\" is sent. Unknown fields are accepted and ignored. |
| conversation.item.create | Append a message item. When \"item.role\" is supplied it must be \"user\", \"assistant\", or \"system\"; when omitted it defaults to \"user\". Unknown item fields are accepted and ignored. |
| response.create | Generate a response from the current conversation. Refused with \"response_in_progress\" while a response is streaming. |
| response.cancel | Abort the in-flight response. |

## Server → client events

- session.created
- session.updated
- conversation.item.created
- response.created
- response.output_text.delta
- response.output_text.done
- response.done
- error

## Session field validation

| Field | Rule |
| --- | --- |
| modalities | array of strings, each in \"{text, audio}\" |
| temperature | finite number in [0.6, 1.2] |
| max_output_tokens | finite integer in [1, 4096] |
| model | string |
| instructions | string |

Out-of-range or wrong-type values reject the whole update. The literal string \"inf\" for \"max_output_tokens\" is not accepted by this bridge.

## Resource limits

| Limit | Default | Env override | Behavior when exceeded |
| --- | --- | --- | --- |
| MAX_SESSION_ITEMS | 100 | REALTIME_MAX_SESSION_ITEMS | On growth, oldest non-system items are dropped first. System items are never evicted. If the history is at the cap and consists entirely of system items, \"conversation.item.create\" is rejected with \"error.code = \"session_item_limit\"\" and no \"conversation.item.created\" is emitted. |
| MAX_REALTIME_FRAME_BYTES | 1048576 (1 MiB) | REALTIME_MAX_FRAME_BYTES | Enforced via the \"ws\" \"maxPayload\" option. An oversize frame trips a socket error and the stack closes with code \"1009\" (Message Too Big). |

The default model is \"openai/gpt-4o-mini\" if the URL does not specify one.

## Disconnect and error cleanup

On \"close\" and on \"error\", the session's \"dispose()\" aborts any in-flight upstream chat, so provider connections and tokens are not stranded. Frames already queued across the auth window are dropped and cannot start a response after cleanup. The abort is abort-only: the owning response clears its own controller in its \"finally\" block, so an abort racing a newer \"response.create\" can never clobber the newer request's handle.

## Usage dashboard live activity

The Usage provider graph shows active models and their API-key names on pointer hover and keyboard focus. The `/api/usage/stream` active-request payload contains only safe key names and concurrent counts; it never includes raw keys, masked secrets, or database key IDs. Concurrent calls use request-owned completion tokens so finishing one call cannot remove another call from the graph.

## Test coverage

"tests/unit/realtime-ws.test.js" covers bad-key close (4001), ordered event sequences ending in "response.done", audio-modality refusal, frame/session validation, oversize-frame rejection, history cap, disconnect cleanup, and upstream-error propagation.