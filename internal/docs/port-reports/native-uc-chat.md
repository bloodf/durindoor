# Native UC persona WebSocket chat (staged)

Issue #1241, related to #2034. The executor is staged and unregistered. Nothing in production imports `open-sse/services/providerParity/native-uc-chat/`. `registration.json` in that directory describes the serial registration step.

## Source

OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The commit is present in this checkout's object store, and every file below was read from it:

- `open-sse/executors/uc.ts`: `UcExecutor`. It checks the credential, gets a scoped JWT, applies the prompted tool shim, streams or buffers the OpenAI answer, and classifies turn errors.
- `open-sse/executors/uc/constants.ts`: the socket host `wss://internal-6.pubyar.com/ws`, the origin `https://uncensored.com`, the app version `1.0.0-web`, the 120 s turn timeout and the 8 s token refresh skew.
- `open-sse/executors/uc/catalog.ts`: the 19 persona models.
- `open-sse/executors/uc/protocol.ts`: `assembleUcTurn`, `buildPersonaFrame` and the identity steer.
- `open-sse/executors/uc/stream.ts`: the frame parser, soft-error detection and the token estimate.
- `open-sse/executors/uc/toolDialect.ts`: the code-style preamble, the code-style and `<tool_code>` parsers, and refusal detection.
- `open-sse/executors/uc/ws.ts`: one socket per turn. The upgrade carries only `Origin`, and auth is the `?token=` query parameter.

Source-file disposition:

- `uc/media.ts` is now ported by `attachments.js` for one inline image/document (see attachment contract below).
- `uc/clerkAuth.ts` and `uc/credentials.ts`. The staged `native-uc-signin` session controller and the staged `native-uc-tts` credential resolver replace them.

## Local equivalence check

There is no equivalent. This module is the whole delta.

- No `uc` or `ucn` entry exists in `open-sse/providers/registry`, and no executor is mapped in `open-sse/executors/index.js`.
- `uc-direct` is the metered REST API at `api.uncensored.com` with a `uai_` API key. It is a different backend. This module never reads an API key, never sends a uc-direct API key, and never falls back to uc-direct.
- `native-uc-video-image` uses the same host only for `/generate-signed-url`. A checkout search for the persona socket path finds nothing outside this module.

## Reused staged modules (read-only)

- `native-uc-signin` `createUcSessionController`:
  - mints the JWT with only the selected connection's cookie jar;
  - caches it per uid, session id and cookie digest;
  - refuses a JWT whose `uid` claim names another account;
  - returns `rotated` when Clerk set a new `__client`.

  The executor creates one controller per instance with the source 8 s skew. It hands `rotated` to `onCredentialsRefreshed` for the same connection only.
- `native-uc-signin` `UC_AUTH_SOURCES` and `isUcConsumerSignInEnabled` provide the opt-in guards.
- `native-uc-tts` provides `resolveUcCredential`, `ucSecrets` (redaction) and `UC_PROVIDER_DEFINITION` (id `uc`, alias `ucn`, display and credential fields).

None of those files changed.

## Wire contract (ported)

- The socket URL is `wss://internal-6.pubyar.com/ws/{uid}?token={jwt}&_t={epoch ms}`. The `_t` cache-buster comes from the source `buildUcWsUrl`.
- The upgrade sends only the header `Origin: https://uncensored.com`. It sends no Cookie and no Authorization.
- Each turn sends one frame. It carries fresh `message_id`, `client_request_id` and `thread_id` UUIDs and `app_version: "1.0.0-web"`. `model` is the catalog shortname. `text` is the current turn. `chat_history` holds `{ role: "human" | "assistant", content: [{ type: "text", text }] }` entries. `user_identifier` is the uid. The fixed flags are `chat_mode: "chat"`, `use_memory: false`, the search flags `false`, `no_media_in_chat: true` and empty media fields. The frame never carries `max_tokens`, temperature, reasoning, `direct_params` or `tools[]`.
- The split point is the last assistant message. Systems, the identity steer and the prompted tool contract are folded into `text` ahead of a `---` divider. A tool result in history becomes a `human` entry prefixed `[tool result] `. A trailing tool result becomes "The {name} tool already ran and returned: …".
- Frames are newline-delimited JSON. The parser handles each kind as follows:
  - `{ type: "error", code, message, next_reset }` and the top-level codes `message_limit_exceeded`, `paywall_exceeded`, `rate_limit_exceeded`, `unauthorized` and `forbidden` are terminal.
  - `generation_failed` is terminal.
  - `status` is ignored.
  - `intermediary_message` becomes reasoning.
  - A `text` delta becomes content.
  - `text` with `end_of_stream` and `raw_text` is the terminal frame, and its `raw_text` is the authoritative answer.
- The OpenAI answer takes one of two shapes:
  - With `stream`, the SSE sequence is the role chunk, then `reasoning_content` deltas, then `content` deltas. When `raw_text` extends the streamed text, the rest follows as one more content delta. The stream ends with a `finish_reason: "stop"` chunk that carries estimated usage, then `[DONE]`.
  - Without `stream`, the answer is one `chat.completion` with `reasoning_content`, `finish_reason` and usage.
- Usage is estimated at about 4 characters per token (source), because UC sends no usage frame.
- In tool mode the turn is buffered:
  - Calls are parsed from `<tool>` and `<tool_call>` blocks. When none are found, code-style `fn("x")` lines and Gemini `<tool_code>` blocks naming a declared tool are tried.
  - Calls get the source `uc_<n>` ids, and `finish_reason` becomes `tool_calls`.
  - For `gpt-5.5`, the code-style header leads the prompt.
- Error mapping (source `classifyTurnError`):
  - message, paywall or rate limit: 429;
  - unauthorized or forbidden: 401;
  - `generation_failed`: 502;
  - anything else: 502.
- A short capacity apology returned as the answer is a 502 `uc_soft_error`.

Tests cover real request and response translation for both gateway formats. Claude Messages and Responses requests go through `translateRequest` into this executor. Its SSE output then goes through `translateResponse` back to Claude events (thinking, text, `tool_use` with id `uc_0`, stop reasons, and an `error` event on a broken stream). Responses events are covered the same way (`response.completed`, `function_call`, and `response.failed` on a broken stream).

## Fork deviations (safety)

- **Opt-in.** Every request answers 403 `uc_disabled` unless `DURINDOOR_UC_CONSUMER_SIGNIN=1`. The connection's metadata must also come from the staged sign-in module: an accepted `ucAuthSource` and a valid ISO `ucSignedInAt`. Otherwise the answer is 401 `uc_unconfigured` and nothing goes on the network.
- **Fail closed on auth.**
  - A Clerk token mint answered with 401 or 403 returns 401 `uc_auth_error`, whatever the body says, including a captcha or second-factor code. The source treats a mint 401/403 as an invalid durable login that needs a re-login (`uc/clerkAuth.ts:85-87`, `uc.ts:198-203`). No socket opens.
  - A revoked session returns 401 `uc_auth_error`.
  - A JWT for another account returns 401 `uc_identity`.
  - A socket upgrade answered with 401 or 403, or an `unauthorized` or `forbidden` frame, returns 401 `uc_auth_error` and drops only that account's cached JWT. The source `ws.ts` keeps no handshake status, and its `classifyTurnError` maps both words to 401 (`uc.ts:163-164`). A refused upgrade carries no `acceptedTurn`, because no frame left.
  - A session-controller result of kind `needs_operator` (a sign-in challenge or MFA) returns 403 `uc_auth_challenge` before any socket opens. This is fork-only: the token mint never produces it.

  Nothing retries these.

  The first version of this module answered a mint 403 with 403 `uc_auth_challenge`. That predated the source alignment of the staged sign-in controller (`c8d758aa79`), which maps mint 401/403 to `reauth`. Two expectations in `tests/unit/native-uc-chat.test.js` changed to match the source: the mint 403 case now expects 401 `uc_auth_error`, and the mint URL carries only `_clerk_js_version` (`uc/clerkAuth.ts:95`).
- **No replay.**
  - The source's code-style retry after a refusal is not run, because it was a second quota-bearing turn. A refusal is returned as the answer.
  - The executor never retries a turn.
  - Every failure after the frame left carries `acceptedTurn: { state, outcome }`. The state is `accepted` once UC sent any frame back, and `uncertain` otherwise. The caller can use it to avoid failover replays.
- **Stream commit.** A stream returns its 200 only after the first reasoning or content frame. A quota, auth or soft error before any output is therefore a plain HTTP error. A failure after output ends the stream with a `finish_reason: "error"` chunk that carries a redacted `error` object, then `[DONE]`. It never ends with `stop`.
- **Truncation.** A socket that closes or errors before `end_of_stream` after the frame left is a 502 `uc_truncated`. The source returned the partial text as a success.
- **Remainder.** After the deltas, the `raw_text` remainder is emitted only when `raw_text` extends the streamed text. The source could repeat the whole answer.
- **Bounds.**
  - 15 s handshake;
  - 60 s idle between messages;
  - 120 s total (source);
  - 4 MiB per frame and per split-frame carry;
  - 16 MiB per turn.

  Redirects are refused (`followRedirects: false`). A non-101 upgrade answer is a handshake failure that keeps its status.
- **Split frames.** When a JSON frame is split across socket messages, it is reassembled in order. A carried fragment that never parses is dropped, the same way the source drops non-JSON keepalives.
- **Redaction.** Error text goes through `sanitizeErrorMessageWithSecrets` with the connection's cookies, the client cookie and the session JWT. The socket URL is never logged or returned. The result's `url` is the nominal base URL, and `headers` and `transformedBody` are the `Origin` header and the frame. Neither contains the token.
- **History.**
  - An assistant turn with tool calls keeps them in its history text as `<tool_call>{json}</tool_call>`.
  - A trailing tool result takes its name from the matching `tool_call_id`.
  - A request with no user text is a 400, where the source sent only the steer.
- **Media default.** The original `createUcChatExecutor()` remains text-only and refuses image/file/audio with 400 `uc_media_unsupported`. Registration now selects the separate `createUcAttachmentChatExecutor()` wrapper described below.
- **Tool-mode SSE.** The replay keeps `reasoning_content` and usage, and numbers tool-call deltas with `index`.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/uc-chat-reauth-contract.test.js unit/native-uc-chat.test.js unit/uc-signin-source-contract.test.js --maxWorkers=2
```

`native-uc-chat.test.js` has 59 tests. `uc-chat-reauth-contract.test.js` adds 22 for the auth contract: mint 401/403 bodies, the `needs_operator` challenge and MFA cases, socket 401/403 denial, per-account JWT invalidation, redaction, and no early 200 on a stream. Both use synthetic Clerk transports and synthetic sockets only. No live account, browser, mailbox or socket is involved, so passing says nothing about the live service.

## Registration (not done here)

See `registration.json` `integrationPoints`. Register one `createUcAttachmentChatExecutor()` per process for `uc` and `ucn`, and add `llm` with `UC_CHAT_REGISTRY_MODELS` to the `uc` registry entry next to the staged TTS kind. Then replace the staging-only test block with positive registry checks.


## Attachment contract (#1241 follow-up)

Pinned source inspected in `/tmp/omni-2034` at
`c71f0065a7efe9230ec23b96a12253b050c4d7ad`:

- `uc.ts:49,212-229,275` imports and calls `extractCurrentTurnMedia` and
  `uploadUcTurnMedia`, then passes `media` into the socket turn.
- `uc/media.ts` (`extractCurrentTurnMedia`, `uploadUcBlob`, `uploadUcTurnMedia`) is the actual implementation. There are no tracked
  `uc/upload*` files at this pin. Extraction accepts inline image data URLs,
  OpenAI file data, Responses input_file data, and base64 Claude documents.
  Remote image URLs are collected separately but `uc.ts` only consumes `inline`.
  There is no input_audio extraction branch: audio is unsupported locally.
- `uc/protocol.ts:160-195` attaches the primary blob through
  `media_blob_name` and `media_content_type`, keeping `no_media_in_chat: true`.
  It calls its multiple-file fields untested forward compatibility; this port
  rejects multiple attachments instead of claiming that capability.
- `uc/ws.ts:126` forwards the media descriptors to the persona frame.

The attachment-enabled wrapper validates the complete active turn before token
mint, upload or billable socket dispatch. It supports one inline PNG/JPEG/GIF/WebP
image or PDF/text/Markdown/CSV/JSON/Word document, with strict canonical base64,
nonempty bytes and a 10 MiB decoded ceiling. It rejects remote URLs, file ids,
audio, unknown MIME types, multiple attachments and media outside the last user
message in the active turn with local 400. Historical media is not uploaded again.
Source percent-encoded non-base64 data URLs and unknown octet-stream files are
also refused. A text prompt remains required.

The upload follows the source sequence and headers exactly: fixed-origin
`POST /generate-signed-url` with Bearer session JWT, JSON content type, Origin
and Referer; body `{ content_type, user_identifier }`; then raw-byte PUT to the
returned signed URL with only Content-Type. Optional source readiness polling is
omitted. Signed responses are bounded at 16 KiB, the whole operation at 30 s,
and caller aborts stop waiting even for a transport that ignores cancellation.
Every redirect or foreign response URL is refused. Only HTTPS
`d.moveinwater.com/up/...` destinations are allowed, without userinfo, custom
ports or fragments. The existing outbound URL connector enforces public-only DNS
at connection time and pins all checked results, including mixed-answer refusal.
The JWT and cookies never reach the CDN or socket headers. Bound proxy routes
are refused with 400 before mint/upload because this transport cannot honor them.

The wrapper reuses the existing account-scoped session cache and rotation
callback, then checks token freshness again after upload before opening the
socket. It shares no blob cache or socket across requests or accounts. Opt-in,
consented sign-in metadata, model and auth challenge guards run before upload.
Every upload failure fails closed rather than sending a text-only turn. There
are no retries. Results retain `acceptedUpload: { state, outcome }` from the first
signed request onward, including socket failures after successful upload; existing
`acceptedTurn` semantics remain. Callers must not replay these outcomes.
The default executor and all 59 existing tests are unchanged in contract.

### Follow-up evidence

The new synthetic attachment suite has 58 passing tests and covers actual POST/PUT/socket dispatch,
OpenAI identity and Anthropic image/document translation, streaming, concurrent
accounts, real session-controller rotation/freshness, admission limits, destination
and DNS checks, redirects, auth failures, cancellation, deadlines and no replay.
No live account, provider call, browser or credentials were used.

Root `pnpm run lint` passes (349 existing warnings, zero errors; anti-slop zero diagnostics). Scoped ESLint and `git diff --check` pass. The exact evidence command is:

```sh
cd tests && test -f unit/uc-chat-attachments.test.js && node node_modules/vitest/vitest.mjs run unit/uc-chat-attachments.test.js unit/native-uc-chat.test.js --maxWorkers=2
```

On top of the corrected chat base (`c1abe99f6e`, mint 401/403 -> 401
`uc_auth_error`, mint URL with only `_clerk_js_version`), the combined command
exits 0 with 117 passing tests: 58 attachment tests and the 59 chat tests,
unchanged from that base. No tests or failure baseline were altered. Full local CI
and independent merge review remain outstanding; this is staged work, not a
merge-ready or live-provider claim.

## Fragment and streamed failure integrity (#1241, #2034)

These are fork bug fixes to the staged port attributed above to OmniRoute
`c71f0065a7efe9230ec23b96a12253b050c4d7ad`; they do not register or publish UC.
The split-frame carry now retains original JSON fragment bytes, including spaces
inside an unfinished quoted string. JSON parsing still accepts protocol whitespace,
malformed keepalives still recover, and the byte cap counts the retained bytes.
The existing source final-answer trimming contract remains unchanged; deltas retain
leading/trailing spaces and newlines.

Every complete answer uses the same capacity-apology classifier, including after
content deltas committed a 200 response. Such a streamed failure preserves already
emitted content and ends with a redacted `uc_soft_error`, `finish_reason: "error"`
and `[DONE]`, without success usage or a `stop` ending. The existing gateway
translators produce Claude error events and Responses `response.failed` events.
Buffered and pre-output failures retain HTTP 502 and accepted-turn bookkeeping.
No retry, replay, account-cache invalidation or success callback is introduced;
UC still supplies no measured usage and failed streams carry no success estimate.
Cancellation and socket/turn limits retain their existing paths.

`tests/unit/uc-chat-stream-integrity.test.js` is an independent synthetic regression
suite: arbitrary fragment splits (including quoted whitespace, escapes and Unicode),
terminal frames with/without raw text, carry limits, malformed recovery, buffered
and live capacity/ordinary answers, gateway translations, redaction, cancellation,
account isolation and single dispatch. Running it against the pre-fix implementation
fails both fragment integrity and post-delta capacity classification. The existing
59 chat, 22 reauth and 58 attachment tests remain byte-for-byte unchanged.

```sh
cd tests && test -f unit/uc-chat-stream-integrity.test.js && node node_modules/vitest/vitest.mjs run unit/uc-chat-stream-integrity.test.js unit/native-uc-chat.test.js unit/uc-chat-reauth-contract.test.js unit/uc-chat-attachments.test.js --maxWorkers=2
```

The focused command passes 160 tests (21 new regressions plus all 139 protected
existing tests). Root lint passes with 349 existing warnings and zero errors;
scoped ESLint and `git diff --check` also pass. The old implementation fails 11 of the initial 18 regression
cases, including both reported defects.

Validation uses private HOME/DATA_DIR and a credential-free environment with closed
synthetic transports. No live-provider equivalence or full local-CI receipt is claimed.
