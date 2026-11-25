# #1073: preserve non-SSE bodies on the GitHub streaming routes

Source reviewed (upstream OmniRoute, merged, read-only):

- [OmniRoute #937](https://github.com/cheaper-inference/OmniRoute/pull/937) — "fix claude oauth and cc-compatible regressions", head `bcc374eb312200c2c37f35b74ef4b2a281872a90`, merged as `954c40067e7cb31857dfba1e9fbc1c8b6bb43977` (first-parent patch, two parents `6a36606bd5` + head).

The merged source diff was read from the private Git mirror at `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` with `git show --first-parent 954c40067e7cb31857dfba1e9fbc1c8b6bb43977`. The source touches 11 paths; only `open-sse/executors/github.ts` and its regression test are in scope for this port.

**Local disposition: ported (adapted) at `open-sse/executors/github.js`. Offline coverage in `tests/unit/omni-github-stream-content-type.test.js`.**

## Discovery and the superseded HOLD

The discovery report for this unit is `internal/docs/port-reports/1073-april-stream-and-translation.md` (section "#937 — GitHub executor stream guard, Claude Code-compatible bridge, catalog and OAuth"). It recorded exactly one open port candidate: a content-type precondition before the SSE transform on the GitHub Claude `/v1/messages` and `/responses` routes.

That report closed with the sentence that the candidate "is stated as a candidate with its expected behavior and scope, not as an approved change; the product remains on HOLD until explicit approval". **The owner decision to port this candidate supersedes that sentence.** The rest of the report's dispositions are unchanged: the Claude Code-compatible bridge, the catalog/model-selector hunks and the OAuth `redirectUri` hunk stay structural exclusions or out of scope (no bridge exists in this fork; the OAuth hunk is authentication work).

## What upstream changed

Upstream's `open-sse/executors/github.ts` applies its SSE response transform only when the upstream response is `ok` **and** its content type contains `text/event-stream`:

```ts
const contentType = (result.response.headers.get("content-type") || "").toLowerCase();
if (isStreaming && result.response.ok && contentType.includes("text/event-stream")) {
  const sourceResponse = result.response.clone();
  ...
}
```

Upstream's transform is a single generic `[DONE]`-stripping filter over one `execute()` method. Its regression test asserts that a streaming `401` keeps its status and a readable body.

## Fork state that made the port necessary

The fork's GitHub executor has **two** executor-side SSE transforms, not one:

- `executeWithMessagesEndpoint` — the Claude-native `/v1/messages` route. It translates Anthropic event frames into OpenAI chunks (`open-sse/executors/github.js`).
- `executeWithResponsesEndpoint` — the `/responses` route. It translates Responses event frames into OpenAI chunks.

The `/chat/completions` route has **no** executor-side transform: the generic executor returns the upstream response as-is (`open-sse/executors/base.js`), so the gateway parses it.

The `ok` half of the upstream guard was already satisfied locally: both routes return a non-`ok` upstream response untouched, with its status and a readable body. The residual difference was the content-type precondition. Before the port, a **successful** response whose media type was not `text/event-stream` was still piped through the route's SSE translator, so the upstream body was consumed and rewritten:

- a `200 application/json` body `{"error":{"message":"boom"}}` on `/v1/messages` became `data: {"error":{"message":"GitHub Messages stream failed","type":"stream_error"}}`;
- the same on `/responses` became `data: {"error":{"message":"GitHub Responses stream failed","type":"stream_error"}}`.

The upstream status, headers and body were lost, and the client saw a synthesized stream failure instead of the upstream answer. That is the only applicable difference, and it matches the discovery report's probe result.

## What was ported

`open-sse/executors/github.js` only.

- New helper `isEventStreamResponse(response)`: the media type of the upstream response, lower-cased, tested for `text/event-stream`.
- `executeWithMessagesEndpoint`: after the existing `!response.ok` early return, a response that is not an event stream is returned unchanged — the same `Response` object, so status, status text, headers and the readable body are intact. The SSE transform (strict frame routing, the held finish frame, the raw `[DONE]` guard, the terminal tracker) runs only for a genuine event stream.
- `executeWithResponsesEndpoint`: the same precondition before the Responses SSE transform.

### Adaptations, and why

- **Where the precondition lives.** Upstream has one `execute()` and one transform; the fork has two route-specific transforms. The precondition is applied at both fork transform sites instead of being lifted into a shared helper that would have to know about both dialects.
- **No clone.** Upstream clones the response and pipes the clone, because its transform consumes the body. The fork's non-SSE path consumes nothing, so the original response object is returned as-is: the upstream body stays readable for the gateway and for downstream error handling, and the physical upstream response — which owns the provider-attempt dispatch ticket — is not replaced by a rebuilt `Response`.
- **Terminal provenance.** The fork's generic executor returns `terminalProvenance: "upstream"` for the raw upstream response (`open-sse/executors/base.js`), and `"validated"` is reserved for a stream the executor itself validated. The passed-through response uses `"upstream"`: it is a complete upstream answer, not a validated stream. Without it the gateway would settle the quota reservation of a successful request as a malformed terminal.

## Gateway dispatch (the caller contract)

The gateway already dispatches on the media type of the provider response, so a passed-through body keeps a coherent contract for the caller:

- **Non-streaming client** — `handleNonStreamingResponse` reads the body by media type: an event-stream body goes to the SSE parser, any other body to `JSON.parse` and the existing coherence gate. A passed-through JSON body is therefore read as the provider's answer, classified by the existing rules, and recorded in the request detail, instead of being destroyed upstream of the gateway.
- **Streaming client** — the streaming handler frames a JSON provider body as SSE for OpenAI-shaped providers, and GitHub's registry format is `openai` (`open-sse/providers/schema.js` default; the GitHub registry does not override it). A body that is not an OpenAI completion is rejected with the existing `Invalid JSON completion for streaming request` 502, not with a synthesized `stream_error` frame.

Both paths are covered by the four gateway tests in the new test file.

## Preserved unchanged

- **Non-success handling.** A non-`ok` upstream response is still returned with its original status and a readable body, and without a terminal provenance — the existing GitHub error contract.
- **Genuine SSE validation.** The Claude route keeps its strict frame routing (a non-`data:`, non-`event:` line is a protocol violation), the finish frame held until EOF, the single trailing raw `[DONE]` guard and the terminal tracker. The Responses route keeps its contradictory-terminal rejection. A truncated or contradicted stream still emits a failure frame instead of a success terminal.
- **Negotiated stream / one-shot behavior.** `/v1/messages` and `/responses` still force `stream: true` upstream — request headers and body — regardless of the client's stream flag, and the one-shot client is still served by the gateway's buffered path. The passthrough does not change which route is chosen or how the upstream request is framed.
- **AbortSignal lifetime.** The per-attempt connect timer, the merged caller signal, the transient-retry loop and the body-cancellation on retry are untouched; a caller abort still propagates as an abort and never becomes a response.
- **Headers.** No request header changed: `Accept`, `anthropic-version`, the `copilot-*` and `x-github-*` headers are as before.
- **`/chat/completions` route.** Untouched — it has no executor-side SSE transform.
- **No bridge, dashboard, catalog, auth, OAuth, credential or new-integration change.**

## Regression coverage

`tests/unit/omni-github-stream-content-type.test.js` (new; offline, mocked upstream fetch, no provider traffic, no credentials):

- Claude `/v1/messages`: a successful JSON body keeps its status, content type and exact bytes; a successful plain-text body keeps its exact bytes; the status and headers of a successful non-SSE response are kept; a genuine event stream is still translated into OpenAI chunks with a `[DONE]` terminal and no `stream_error`; an event stream that carries a charset is still translated; a `401` keeps its status, its readable body and the absence of a terminal provenance; the upstream request still carries `Accept: text/event-stream`, a body with `stream: true` and a signal.
- `/responses`: the same successful JSON and plain-text passthrough, the genuine event-stream translation, and the unchanged `401` handling.
- A caller abort is propagated instead of being turned into a response.
- Gateway dispatch, non-streaming client: a passed-through successful JSON completion is served to the client as that completion; a passed-through error envelope is rejected instead of being served as a `stream_error` frame.
- Gateway dispatch, streaming client: a passed-through JSON completion is framed as SSE for the client (`data: [DONE]`, no `stream_error`); a passed-through body that is not an OpenAI completion is rejected with the existing `Invalid JSON completion for streaming request` 502.

Focused offline runs from `tests/` (no provider traffic, no full suite):

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-github-stream-content-type.test.js
```
1 file, 16 tests passed.

The same file fails 6 of its 16 assertions with the product change reverted (`git stash push -- open-sse/executors/github.js`), which is the regression guard for this port.

```
node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/github-claude-messages.test.js unit/github-responses-streaming.test.js \
  unit/github-responses-routing.test.js unit/omni-json-under-sse-media-type.test.js \
  unit/github-prefill-sanitize.test.js unit/github-prompt-limit-preflight.test.js
```
6 files, 88 tests passed. The existing GitHub and buffered-event-stream assertions are unchanged and still pass.

## Residual notes

- A successful non-SSE body from `/v1/messages` is a Claude-native document and one from `/responses` is a Responses document. The gateway's non-streaming path classifies such a body against the provider's registry format (`openai`), so a document in another dialect is reported as incoherent rather than projected. That is the same outcome the caller saw before the port (a `stream_error` frame), with the upstream body now preserved for the request record instead of discarded.
- The precondition is a media-type test, not a body sniff: a provider that labels a JSON body `text/event-stream` still takes the SSE transform, exactly as upstream.
- The full suite remains reserved for the integration gate.
