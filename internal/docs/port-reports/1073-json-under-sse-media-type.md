# #1073: a complete JSON reply under the event-stream media type

Sources reviewed (upstream OmniRoute, merged, read-only metadata):

- [OmniRoute #18377](https://github.com/cheaper-inference/OmniRoute/pull/18377) — "fix(sse): read a JSON response document served as text/event-stream", head `75606f926bbedbf4345f23fbc23107cdca1c634b` (the pinned source), merged 2026-11-04 as `2948d4b94997c241c146b0b709511c08ddd42a59` into `release/v3.8.53`: **ported (adapted)**.

**Local disposition: ported (adapted) at `open-sse/handlers/chatCore/nonStreamingJsonDocument.js` (new), `open-sse/handlers/chatCore/nonStreamingHandler.js` and `open-sse/handlers/chatCore/sseToJsonHandler.js`. Public contract updated in `docs/reference/api.mdx`. Offline coverage in `tests/unit/omni-json-under-sse-media-type.test.js`.**

## What upstream changed

Upstream adds `open-sse/handlers/chatCore/nonStreamingJsonDocument.ts` and calls it from the buffered event-stream branch of its single non-streaming parse (`parseNonStreamingResponseBody`). A forced-streaming upstream that answers a non-streaming client with one complete JSON response document — an OpenAI `chat.completion`, a Responses `response`, a Claude `message`, or a structured error envelope — labelled `text/event-stream` (sometimes with `data: [DONE]` glued after the closing brace) is now returned as the non-stream response instead of failing with `invalid_sse`. The document is used as the response, so a combo no longer skips a target that had answered. Corrupt event streams keep the 502: truncated JSON, trailing garbage, unknown objects, bare stream chunks and unparseable `data:` frames.

The pinned commit also splits upstream's parse function into helpers. That refactor is upstream-internal (upstream keeps one parse site); the fork splits the same responsibility across three buffered parse sites, so the recognition had to be applied at each of them.

## Fork state that made the port necessary

The fork has no single non-streaming parse. Three sites buffer an event-stream body into a non-stream response, and each of them missed a complete JSON document:

1. `open-sse/handlers/chatCore/nonStreamingHandler.js` — `handleNonStreamingResponse`, the route a client reaches when it asked for JSON and the provider answered with the event-stream media type. The body went to `parseSSEToOpenAIResponse`, which finds no `data:` frame in a JSON document and returns `null`; the request then failed with 502 `Invalid SSE response for non-streaming request`.
2. `open-sse/handlers/chatCore/sseToJsonHandler.js` — `handleForcedSSEToJson`, standard Chat Completions branch (`parseSSEToOpenAIResponse` / `parseClaudeSSE` / `parseGeminiSSEToOpenAIResponse`): the same `null` produced the same 502.
3. `open-sse/handlers/chatCore/sseToJsonHandler.js` — `handleForcedSSEToJson`, Codex/Responses branch: the body was streamed into `convertResponsesStreamToJson`, which found no event frames and synthesized `status: "failed"`, so the request failed with 502 `Provider stream ended before a coherent terminal`.

This matters because providers declared `forceStream: true` (codex, grok-cli, opencode, commandcode, kimi-coding, codebuddy, openai) always receive `stream: true` upstream. When such a provider answers with one complete JSON document under the event-stream media type, the client's non-streaming request failed with a 502 instead of returning the provider's answer, and the failed leg was skipped by the combo/fallback path.

## What was ported

New module `open-sse/handlers/chatCore/nonStreamingJsonDocument.js`:

- `parseJsonDocumentBehindEventStream(rawBody, targetFormat)` — trims the body, strips one trailing `data: [DONE]` sentinel, requires a single JSON object, and recognizes the supported shapes: a chat completion (`choices[].message`), a Responses object (`object: "response"` with an `output` array), a Claude message (`type: "message"` with a `content` array), and a structured error envelope (a non-empty `error` string or object). Anything else — truncated JSON, trailing garbage, an unknown object, a bare chunk, a JSON array, an empty body — returns `null`, so the caller keeps its 502.
- `claudeMessageDocumentToEventStream(message)` — replays a complete Claude message document as the Claude events it stands for, so the existing Claude event parser serves both shapes instead of a second Claude conversion being written.

Wiring:

- `handleNonStreamingResponse`: when the event-stream parse yields nothing, a recognized document is read as the response. The document keeps its own dialect as `responseFormat`, and the existing coherence gate, provider normalization, translation, usage extraction, projection and synthetic-client-SSE paths continue to run unchanged.
- `handleForcedSSEToJson`, standard Chat Completions branch: a recognized document is converted into the OpenAI completion shape that branch already consumes — a chat completion as-is, a Responses document through `responsesApiToOpenAICompletion`, a Claude message through the Claude event parser.
- `handleForcedSSEToJson`, Codex/Responses branch: the provider body is now read once through the existing bounded reader; a Responses document is used as the response, and every other body keeps going through `convertResponsesStreamToJson`.

## Adaptations, and why

- **Format label.** Upstream keeps the transport label when it names the same dialect as the document (`parserFamily(targetFormat) === detected ? targetFormat : detected`). The fork's translation layer has no branch for the transport-only labels (`kiro`, `cursor`, `commandcode`, `ollama`, `codex`, `openai-response`), so the fork labels the document with its own dialect and never lets a transport label hide it. For the supported dialects the outcome is the same; for a transport-only label the fork's outcome is the correct one.
- **Error envelopes.** Upstream returns the error envelope as a body and lets its downstream classify it. The fork's event-stream branches already own error-envelope propagation through `createSSEErrorResult` (upstream status, message redaction, no success marking, no recorded usage), so a recognized error document is routed through it. The outcome stays an error in both.
- **Parse sites.** Upstream has one buffered parse; the fork has three, and the recognition is applied at each of them.
- **Module conventions.** Upstream's helper is TypeScript; the fork's chat-core modules are JavaScript. The port follows the fork's conventions (`isRecord` / `isString` from `src/shared/utils/typeChecks.js`, no runtime `typeof`, `FORMATS` from `open-sse/translator/formats.js`).

## Preserved unchanged

- **Bounded reads.** The document is parsed from the text that was already read through `readBodyWithTimeout` (`MAX_PROVIDER_BODY_BYTES`, `RESPONSE_BODY_TIMEOUT_MS`). The Codex branch reads the same body once through the same bounded reader (`PROVIDER_BODY_TIMEOUT_MS`) and hands the buffered text to the SSE converter. No unbounded read was added and the provider body is still consumed exactly once.
- **Real SSE.** The event-stream parsers still run first. A body with real frames keeps the existing aggregation, tool-call, thinking, DSML, usage and terminal behavior; the document path only runs when the event-stream parse found nothing.
- **Error propagation.** Error envelopes and `finish_reason: "error"` keep their existing status, redaction and no-usage behavior, and corrupt event streams keep their 502 and their message.
- **Cancellation.** An aborted request still returns 499 through the bounded reader's existing abort handling.
- **Usage.** The document's usage is extracted, recorded and projected exactly like the same body served as `application/json`, including the provider's cache and reasoning fields.
- **Streaming.** The streaming route is untouched. A client that asked for SSE while the provider answered with a document still receives synthesized SSE frames from that document: the synthetic path normalizes from the parsed response dialect (`responseFormat`) instead of the transport label, so a document of any dialect can be synthesized. For the event-stream branch, where the accumulator always produces an OpenAI completion, the parsed dialect is that OpenAI completion, so the synthesized frames are unchanged.

## Regression coverage

`tests/unit/omni-json-under-sse-media-type.test.js` (new; offline, mocked bodies, no provider traffic, no credentials):

- the helper recognizes the three success documents and an error envelope, strips a glued `data: [DONE]`, and rejects truncated JSON, an unknown object, a bare chunk, trailing garbage, a JSON array and an empty body;
- the non-streaming route serves a bare document, a document with a glued `data: [DONE]`, a document followed by a `data: [DONE]` frame and a pretty-printed document, with the content-type mismatch verified (the media type is `text/event-stream` while the body opens with the JSON document);
- the provider body is read exactly once (a single-read body stream would throw on a second read);
- a Responses document reaches a Responses client and a Claude document reaches a Claude client and a chat client;
- an error envelope stays an error (429 with the upstream message, no success callback, no recorded usage);
- real event streams keep their existing path; corrupt bodies keep 502 `Invalid SSE response for non-streaming request`;
- a client that asked for a stream still receives synthesized SSE from the document (chat completion, Claude message and Responses object), and an aborted request still returns 499;
- the forced-streaming route serves a chat completion document, a Responses document (Responses client and chat client) and a Claude document, keeps an error envelope an error, keeps corrupt bodies at 502, and keeps real event streams on the event-stream path.

Focused runs from `tests/` (offline, no provider traffic):

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-json-under-sse-media-type.test.js
```
37 tests passed.

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/nonstream-sse-error-1355.test.js unit/non-streaming-forced-client-sse.test.js \
  unit/nonstream-trailing-done-5384.test.js unit/openai-responses-nonstream.test.js \
  unit/forced-sse-responses-custom-tool-1469.test.js unit/openai-responses-custom-tools-3373.test.js \
  unit/codex-search-classifier-projection.test.js unit/openai-responses-tool-name-map-4200.test.js \
  unit/forced-sse-claude-json.test.js unit/forced-sse-cache-tokens.test.js
```
10 files, 184 tests passed.

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/chat-billing-epoch.test.js unit/done-line-telemetry.test.js \
  unit/openai-passthrough-normalization-3611.test.js unit/claude-refusal-nonstream-passthrough.test.js \
  unit/thinking-responses-nonstream.test.js unit/port-3220-nonstreaming-read-timeout.test.js \
  unit/clinepass-2332.test.js unit/14243-antigravity-empty-stop-completion.test.js \
  unit/claude-decloak-response-boundary.test.js unit/port-review-followups-1433.test.js \
  unit/openai-finish-reason-claude-literals.test.js unit/sse-to-json-claude-compat.test.js \
  unit/mistral-nonstream-5510.test.js translator/v5-conformance-claude-name-restore.test.js \
  translator/v5-conformance-matrix-chat.test.js translator/v5-conformance-gemini-name-restore.test.js
```
16 files, 195 tests passed.

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/chat-kimi-forced-claude-sse.test.js unit/chat-sse-error-envelope-fallback-1405.test.js \
  unit/forced-sse-responses-json.test.js unit/forced-sse-chat-tool-name-aliases-1406.test.js \
  unit/forced-sse-gemini-name-restore.test.js unit/nonstream-client-projection-5380.test.js \
  unit/nonstream-json-contracts-10258.test.js unit/nonstream-binary-transport-client-format-3247.test.js \
  unit/v5-1330-sse-json-error-finish.test.js unit/v5-1331-stream-error-responses-failed.test.js \
  unit/responses-stream-to-json-usage.test.js unit/responses-explicit-stream-route.test.js \
  unit/codex-compact-chatcore.test.js unit/codex-app-server.test.js \
  unit/opencode-go-muse-spark-responses.test.js unit/commandcode-outbound-validation-chatcore.test.js \
  unit/combo-native-responses-output-port.test.js
```
17 files, 118 tests passed.

The three batches above were also re-run together after the last change to the synthetic-client-SSE normalization: 43 files, 497 tests passed.

`node scripts/check-docs.mjs` passed. `eslint src` reports 0 errors. The anti-slop/oxlint gate is green repo-wide (0 diagnostics across 2713 files). The full suite remains reserved for the integration gate.

## Residual notes

- Gemini-family documents (`candidates`) are not recognized — upstream does not recognize them either — so such a body keeps its 502.
- On the forced-streaming Codex branch only a Responses document is accepted; a chat-completion document there keeps the existing behavior, because that branch answers in the Responses dialect.
- The recognition needs one complete JSON object. NDJSON bodies, bare stream chunks and truncated JSON keep the 502.
- The upstream changelog entry has no counterpart here: this fork has no `changelog.d/` directory.
