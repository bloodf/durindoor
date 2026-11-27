# Native UC text-to-speech (staged)

Issue #2034. The adapter is staged and unregistered. Nothing in production imports it.

## Source

OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout had this HEAD when the adapter was ported.

- `open-sse/config/audioRegistry.ts`: `AUDIO_SPEECH_PROVIDERS.uc` with the fields `id: "uc"`, `baseUrl: "wss://tts-stream.chatuncensored.ai"`, `authType: "web-cookie"`, `authHeader: "none"`, `format: "uc-tts"` and the model `jade`.
- `open-sse/handlers/audioSpeech.ts`: the `uc-tts` branch. It reads text from `input` and the voice from `voice`. The parsed model ID goes into the start frame. The answer is `audio/mpeg`.
- `open-sse/handlers/uc/ucTts.ts`: the socket URL, the `start` frame, frame parsing and `handleUcTextToSpeech`.
- `open-sse/executors/uc/constants.ts`, `credentials.ts` and `clerkAuth.ts`: the Clerk `__session` mint from the durable `__client` cookie, and the credential field aliases.
- `src/shared/constants/providers/web-cookie.ts`: the `uc` provider row, with alias `ucn`.

## Local equivalence check

There is no equivalent. This module is the whole delta.

- `open-sse/providers/registry` has no `uc` or `ucn` entry. `PROVIDERS.uc` and `PROVIDER_MEDIA.uc` are undefined.
- `uc-direct` is a different backend: `https://api.uncensored.com/api/v1/chat/completions` with an API key, a metered REST endpoint for chat only. The source keeps it separate from the `uc` web-cookie socket. It is not an alias of `uc` and it was not changed.
- `TTS_ADAPTERS` returns `null` for both `uc` and `ucn`. No generic format is named `uc-tts`.
- A checkout search for `chatuncensored`, `uc-tts` and `clerk.uncensored.com` finds nothing outside this module.

## STT inventory row

The inventory lists `uc` under STT. The pinned source has no `uc` key in `AUDIO_TRANSCRIPTION_PROVIDERS`, and `audioTranscription.ts` has no `uc-tts` branch. The `uc` entry exists only in `AUDIO_SPEECH_PROVIDERS`. Because there is no source transcription contract, no STT adapter was written and none is claimed.

## Wire contract (ported)

1. Mint request: `POST https://clerk.uncensored.com/v1/client/sessions/{sid}/tokens?_clerk_js_version=5.127.1`
   - Headers: `Origin: https://uncensored.com`, `Referer: https://uncensored.com/`, `Cookie: <jar incl. __client>` and `Content-Type: application/x-www-form-urlencoded`.
   - The body is empty.
   - The JWT is read from `jwt`, or from `token` when `jwt` is absent.
2. Socket: `wss://tts-stream.chatuncensored.ai/{uid}?token={jwt}`
   - The upgrade sends only `Origin: https://uncensored.com`: no Cookie and no Authorization.
3. The client sends one frame: `{ message_type: "start", text, raw_text, turn_anchor_message_id, message_id, thread_id, threadId, model, voice, token }`.
   - The three IDs are UUIDs, and `thread_id === threadId`.
   - `model` is the requested model ID, which is `jade`.
   - `voice` defaults to `jade`.
4. The server sends frames, one per message or newline-delimited:
   - `{ type: "usage_update", usage_percent, threshold_crossed }`
   - `{ data: <base64 MP3 chunk> }`
   - The server closes the socket when synthesis is done. The chunks are concatenated into one MP3.

The credential comes only from `providerSpecificData`, using the source aliases: `ucClientCookie`/`clientCookie`/`__client`, `ucSid`/`sid`, `ucUid`/`uid` and `ucCookies`/`cookies`. The cookie jar can be flat or a CDP dump. `apiKey` and OAuth tokens are never read. The connection modes of other providers are unchanged.

## Supported subset

- Model: `jade`, or `uc/jade`.
- Output: MP3 only. `response_format` may be omitted or set to `mp3`.
- Voice: any string of 1 to 64 characters from `[A-Za-z0-9_-]`, or the default `jade`. No voice list is published, so the voice is passed through as in the source.
- Input: 1 to 4096 characters.

The following are refused with a 400 before the mint, so no network call is made:

- any other model;
- any other container;
- `stream: true` or a `stream_format` other than `audio`;
- `speed` other than 1;
- non-empty `instructions`;
- a voice that is not a string or contains unsafe characters;
- empty or oversize text.

A missing or unsafe credential is refused with a 401 and no network call. Unsafe means a cookie value with CR/LF, `;` or a control character, a `sid` outside `[A-Za-z0-9_]`, or a `uid` outside `[A-Za-z0-9-]`.

Dynamic discovery: none. The source lists one model statically and exposes no voice or model listing.

## Fork deviations (safety)

- Deadlines: 120 s total (the source socket timeout), 15 s for the mint, 15 s for the handshake, and 30 s idle between frames. The caller's signal aborts the mint fetch and terminates the socket.
- Fixed origins: the mint goes only to `clerk.uncensored.com` with `redirect: "manual"`. A redirect, or an answer from another origin, is refused. The socket uses `followRedirects: false`, and a non-101 upgrade answer is mapped without being followed. Connection base URLs are ignored.
- The mint body is read with a 16 KiB cap and is never quoted. The JWT must have JWT shape. If its `uid` claim names a different account than the selected connection, the call is refused.
- No token cache: each call mints with its own connection. The source TTS path also mints per call. The source rotates cookies on `Set-Cookie` during the mint, but its TTS path discards them, and so does this port.
- Byte caps: 4 MiB per frame (`maxPayload` plus a check in the handler) and 50 MiB of total audio.
- A chunk that is not strict base64 fails the call. It is not half-decoded.
- The result must start with MP3 magic bytes (ID3 or a layer III frame sync). Anything else is refused rather than labeled `audio/mpeg`.
- Truncated output: the source returns partial audio after a timeout or error. Here, a close other than 1000/1005, a timeout, an idle stall or an abort is an error, never a success.
- Error messages are fixed. They redact the connection's cookies and the JWT, and never include upstream bodies.
- The WebSocket uses the selected connection's proxy policy (`resolveWebSocketProxyRoute`). When a strict proxy is required but unavailable, the call is refused before the socket opens.

## Accepted work and accounting

The adapter treats failures differently depending on whether the start frame was sent.

- No `acceptedJob` (the start frame never left): mint failures, and socket failures before the start frame (handshake refusal, connect error, handshake timeout, abort before open).
- With `acceptedJob` (UC may have counted the request against the subscription): any failure after the start frame was handed to the socket. The job state is:
  - `submit-unknown` when no audio arrived;
  - `accepted` once audio arrived.
  The adapter makes exactly one attempt and never replays.
- A socket that closes cleanly with no audio, after `usage_percent >= 100`, answers 429 with `quotaExhausted: true` for this connection only.
- On success, accounting comes from `mediaAccounting(null, "uc", "tts")`:
  - Cost is unknown. The service is a subscription with no price receipt.
  - `meta.nativeUnitsSource` is `input-characters`. `withTtsUsage` adds the character count.
  - When usage frames arrived, `meta.providerQuota` records `{ usagePercent, thresholdCrossed }`.

## Registration (serial step)

See `open-sse/services/providerParity/native-uc-tts/registration.json`. In summary:

- Add `uc: ucTtsAdapter` to `TTS_ADAPTERS`.
- Add a `uc` registry entry (alias `ucn`, category `webCookie`, `serviceKinds: ["tts"]`) from `UC_PROVIDER_DEFINITION`. The source `uc` llm persona executor is not part of this delta.
- Pass `requestedResponseFormat` for `uc` in `src/sse/handlers/tts.js`.
- Accept the `providerSpecificData` fields in the connection form.
- List the provider in the catalog.

The isolated `staging state (isolated)` block in the test is the only part that asserts the unregistered state. Registration replaces it with positive identity checks.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-uc-tts.test.js --maxWorkers=2` passes 64 tests, all closed mocks. The tests use a mocked fetch for the mint and a synthetic WebSocket class. The credentials are synthetic. Neither a browser nor live accounts are involved.

The tests cover:

- the exact mint URL, headers, body and redirect mode;
- the socket URL and the Origin-only upgrade;
- the exact start-frame keys;
- chunk concatenation across mixed framing;
- quota metadata;
- every pre-network refusal;
- mint failures (401/403/429/5xx, redirect, foreign origin, malformed answer, identity mismatch, transport failure, deadline);
- two credentials isolated from each other;
- handshake refusals;
- abort before the call, during the mint and after the start frame;
- idle and total deadlines;
- uncertain submit with no replay;
- malformed base64, non-MP3 audio, byte caps;
- no leakage of credentials or upstream bodies.

A separate loopback run against the real `ws` library confirmed the Origin header, text-frame decoding and the mapping of a 401 upgrade answer. That run was not committed.

## Remaining restrictions

- The live service is unverified. The wire shapes come from the pinned source only.
- The source sends the model ID (`jade`) as the start-frame `model`. Its constants describe a `default` tier, which the source uses only when no model is given. This port keeps the source behavior on its public path.
- No streaming output, no other containers, and no STT.
