# #1073 — June existing response contracts

## Scope

Five June records from the #1073 OmniRoute inventories are resolved here against their
actual merged trees, not against their titles, changed paths, or old port ancestry.

Source: the public-source scratch mirror `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`.
Each record was read as `git diff <merged-tree>^1 <merged-tree>`, so the source contract
below is the first-parent diff of that exact tree, including the source's own tests.

Local comparison base: DurinDoor `4d03d0dd64a90e291b9406b9cbe8c9dccd6b89b2`
(branch `orq/tornf6/audit-omni-june-existing-response-contracts-a1`).

The five records cover five already-existing response contracts:

| Record | Contract area |
| --- | --- |
| OmniRoute #3107 | Codex native assistant commentary history |
| OmniRoute #3108 | Non-SSE JSON upstream body on a streaming path, and SSE-wrapped cache hits |
| OmniRoute #3150 | Native Responses `image_url` normalization across input paths |
| OmniRoute #3596 | Legacy `/v1/completions` text-completion output |
| OmniRoute #3595 | Normal token-limit terminal status |

No code, provider, integration, credential, sign-in, workflow, baseline, or published-doc
change is made by this inventory. Every local behavior quoted below was produced by an
offline probe executed against the local tree (temporary probe files under `tests/unit/`,
removed after each run) or by reading the local source at the cited lines. No provider
traffic, no network, no paid API, no e2e, no browser, no Docker, and no full suite run.

Cache support is treated as out of scope wherever the applicable product path is absent
locally, as instructed.

## Summary

| Source PR | Exact merged tree | First parent | Disposition |
| --- | --- | --- | --- |
| [#3107](https://github.com/cheaper-inference/OmniRoute/pull/3107) | `98c59307c636e25cd07f8f0ec852bb6e1b79ff7a` | `be5a0ff2a8cc7f23cc942c0c9a945748bec2cd6d` | **Already in** - the local Codex path never drops internal assistant messages |
| [#3108](https://github.com/cheaper-inference/OmniRoute/pull/3108) | `0bd5c692317415c0c9521ed9d8e003287e65449c` | `f0f776c310909ee758c215f2ae367cf1f97c5004` | **Split** - the non-SSE JSON projection is already in (adapted); the cache half is **out of scope** (no local cache product path) |
| [#3150](https://github.com/cheaper-inference/OmniRoute/pull/3150) | `e4a9ec55821bc3baf3ae79499f1dd881cd22eaff` | `506a701a1accc286709afd1b71f3914a49c98f64` | **Residual** - role-aware `image_url` lowering is missing in two narrow places |
| [#3596](https://github.com/cheaper-inference/OmniRoute/pull/3596) | `cb08cf221da25daade62c2d2dadc1d8d762e8831` | `1bc858837af4b9fa29208117b21e19f67dd19671` | **Already in** - local `/v1/completions` already emits the legacy text-completion shape |
| [#3595](https://github.com/cheaper-inference/OmniRoute/pull/3595) | `1bc858837af4b9fa29208117b21e19f67dd19671` | `2947bfd5eb85605cb6139f7543975843fd860f0c` | **Residual** - a truncated turn is still rewritten into a synthetic empty-content failure |

---

## 1. OmniRoute #3107 - preserve native assistant commentary history

### Exact source pin

- Merged tree: `98c59307c636e25cd07f8f0ec852bb6e1b79ff7a`
- First parent: `be5a0ff2a8cc7f23cc942c0c9a945748bec2cd6d`
- Subject: `fix(codex): preserve native assistant commentary history`
- Author/date in the tree: yinaoxiong, Thu Jun 4 03:03:02 2026 +0800
- First-parent changed paths (3): `open-sse/executors/codex.ts`,
  `open-sse/services/responsesInputSanitizer.ts`, `tests/unit/executor-codex.test.ts`

### Source contract

The upstream Responses input sanitizer dropped every assistant item carrying
`phase: "commentary"` (`INTERNAL_ASSISTANT_PHASES`) before the request left the gateway.
The merged tree adds a `dropInternalAssistantMessages` option and passes
`!nativeCodexPassthrough`, so that in the native Codex passthrough the commentary item is
**kept**, while every other path still drops it. The upstream test asserts the commentary
text survives the Codex request transform under native passthrough, and a second test
asserts it is still dropped outside native passthrough.

### Local implementation and test evidence

The local tree has no equivalent drop site, so the post-fix behavior holds by absence of
the pre-fix behavior:

- No `phase` handling exists anywhere in `open-sse/` or `src/` for Responses items; a
  search for `commentary` in the gateway sources returns only unrelated compression and
  STT strings.
- The native Codex request path is `open-sse/handlers/chatCore.js:605` (passthrough
  selection via `isNativePassthrough`, `open-sse/utils/clientDetector.js:8` maps the
  `codex` client to the `codex` provider) followed by
  `open-sse/executors/codex.js:951` `transformRequest`. The only item-level filters there
  are `removeInvalidEncryptedReasoning` (`open-sse/executors/codex.js:564`),
  `dropForeignReasoningItems` (`open-sse/executors/codex.js:596`) and
  `normalizeStatelessResponseInput` (`open-sse/executors/codex.js:987`); all three are
  scoped to `reasoning` items or to call-item IDs, never to assistant message items.
- `normalizeCodexAssistantHistory` (`open-sse/executors/codex.js:350`) rewrites assistant
  `input_text`/`text` parts to `output_text` in place; it preserves the item and its
  `phase` field.
- Executed probe: `CodexExecutor.transformRequest` over
  `[{role:"user",…}, {role:"assistant",phase:"commentary",content:[{type:"output_text",text:"Internal progress note."}]}, {role:"assistant",phase:"final_answer",content:[{type:"output_text",text:"Visible final answer."}]}]`
  returned all three items, including `phase: "commentary"` and
  `phase: "final_answer"`, unchanged.
- Existing local test evidence: `tests/unit/codex-assistant-history-normalization.test.js`
  asserts that replayed assistant history is preserved and normalized
  (`input_text`/`text` to `output_text`) while user and function items are untouched, and
  that a non-text part (`scoped_content`) survives.

### Disposition

**Already in.** The local Codex path preserves native assistant commentary history
because no local component classifies or drops internal assistant messages; the source's
pre-fix drop behavior has no local counterpart, and the merged tree's post-fix contract is
therefore satisfied. No new capability is recommended: the local tree needs no
`dropInternalAssistantMessages` option, because there is no drop to make conditional.

Narrower note: the source keeps the "still drops commentary outside native passthrough"
branch because upstream drops commentary in every other path. The local tree has no
non-passthrough commentary drop either, so that branch has no local counterpart to assert
against. The matching local branch that does exist is
`normalizeCodexAssistantHistory`, which normalizes the part type without dropping the
item, and it is covered by the existing test named above.

---

## 2. OmniRoute #3108 - non-SSE JSON upstream body on a streaming path, and SSE-wrapped cache hits

### Exact source pin

- Merged tree: `0bd5c692317415c0c9521ed9d8e003287e65449c`
- First parent: `f0f776c310909ee758c215f2ae367cf1f97c5004`
- Subject: `fix(sse): handle non-SSE JSON upstream body on streaming path + SSE-wrap cache hits (#3089, #2952)`
- Author/date in the tree: diegosouzapw, Wed Jun 3 10:14:27 2026 -0300
- First-parent changed paths (4): `CHANGELOG.md`, `open-sse/handlers/chatCore.ts`,
  `open-sse/utils/jsonToSse.ts`, `tests/unit/json-to-sse-3089.test.ts`

### Source contract

The merged tree carries two separate contracts in one commit.

- **#3089 (streaming projection).** When an upstream answers a `stream: true` request with
  an `application/json` chat-completion body, the readiness scan only recognizes SSE
  `data:` frames, so the body produced a spurious `STREAM_EARLY_EOF` / HTTP 502. The fix
  detects the JSON content type (excluding `text/event-stream` and
  `application/x-ndjson`), reads the body, and synthesizes an equivalent OpenAI SSE
  stream with `synthesizeOpenAiSseFromJson`: one chunk per choice carrying `role`,
  `content`, `reasoning_content` and `tool_calls`, a terminal chunk carrying
  `finish_reason` and `usage`, and a final `data: [DONE]`. When the body is not a
  convertible chat-completion object, the consumed body is rebuilt so the existing
  readiness and error path still runs unchanged.
- **#2952 (cache contract).** A semantic-cache hit returned `application/json`
  regardless of the client's `stream` flag, so streaming clients lost
  `reasoning_content`. On a cache hit with `stream: true` the cached completion is
  SSE-wrapped with the same helper, `Content-Type` becomes `text/event-stream`, and the
  cache-hit metadata headers are still attached.

### Local implementation and test evidence

**#3089 half - already in (adapted).** The local gateway has the same projection, from an
earlier 9router port rather than from OmniRoute:

- `open-sse/handlers/chatCore/streamingHandler.js:135` detects
  `upstreamContentType.includes("application/json")` on the streaming path, reads the
  body with `readBoundedResponseText`, frames it with `completionToStream`
  (`open-sse/handlers/chatCore/streamingHandler.js:51`) and rebuilds the response with
  `content-type: text/event-stream` and `content-length` removed.
- `completionToStream` spreads the whole `message` into the chunk `delta`, so `content`,
  `reasoning_content`, `role` and `tool_calls` all survive, and it emits the chunk's
  original `finish_reason` plus `data: [DONE]`.
- Local adaptation differences, all narrower than the source contract and all benign for
  the source's own scenario:
  - the branch is gated on `targetFormat === FORMATS.OPENAI`, so it applies to
    OpenAI-format upstreams serving any client format; the source applies it to any
    provider whose body is a convertible chat completion;
  - the local projection emits a single chunk plus `[DONE]`, where the source emits a
    content chunk, a separate terminal chunk with `finish_reason` and `usage`, then
    `[DONE]`; both are valid `chat.completion.chunk` streams and the local chunk keeps
    the source `finish_reason`;
  - the local helper throws for a body without `choices` or without
    `choices[].message`, which yields a 502 `Invalid JSON completion for streaming
    request`; the source instead returns an empty string and rebuilds the original body so
    the readiness/error path runs. Both end in a failure for a non-convertible body, the
    source via the readiness path.
- Existing local test evidence: `tests/unit/chat-json-stream-5320.test.js` asserts the
  framing of `content`, `tool_calls`, `finish_reason` and `usage`, and that an error
  envelope or a malformed choice set is rejected. The commit that introduced the branch
  is `111b87782b port(upstream): #5320 - frame JSON completions for streams`, so this is
  a pre-existing local capability, not a new port.

**#2952 half - out of scope.** The local tree has no response-body cache to serve:

- A search across `open-sse/` and `src/` for `semanticCache`, `cacheHit`, `cachedResponse`,
  `responseCache`, `exactMatchCache` and `cacheStore` returns no response writer and no
  response lookup. The only `cacheHit` string in the tree is a dashboard percentage
  column (`src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js:333`).
- `open-sse/handlers/chatCore/comboContextCache.js` caches operator provider proxy
  settings, not completions, and is not on a response path.
- The prior inventory record `internal/docs/port-reports/1073-nov20-existing-routing-and-cache.md`
  reached the same conclusion for OmniRoute #19788: no semantic-cache response writer or
  lookup exists in this tree.

### Disposition

**Split.** The streaming projection half (#3089) is **already in**, adapted: the local
`completionToStream` path produces the same client-visible outcome, with the narrower
gating and single-chunk framing noted above. The cache half (#2952) is **out of scope**:
the local product path that would serve a cached completion does not exist, so there is
no local behavior to compare and no cache contract to introduce.

---

## 3. OmniRoute #3150 - normalize `image_url` parts across Responses input paths

### Exact source pin

- Merged tree: `e4a9ec55821bc3baf3ae79499f1dd881cd22eaff`
- First parent: `506a701a1accc286709afd1b71f3914a49c98f64`
- Subject: `fix(responses): normalize image_url parts across input paths`
- Author/date in the tree: Wilson, Thu Jun 4 11:26:28 2026 -0300
- First-parent changed paths (4): `open-sse/services/responsesInputSanitizer.ts`,
  `open-sse/translator/request/openai-responses.ts`,
  `tests/unit/responses-input-sanitizer-name.test.ts`,
  `tests/unit/translator-openai-responses-req.test.ts`

### Source contract

The merged tree adds role-aware normalization of legacy Chat-style `image_url` parts to
every Responses input path:

- In the Responses input sanitizer, a `message.content` part of type `image_url` becomes
  `{type:"input_image", image_url:<url>}` for a user message (keeping `detail`), and
  `{type:"output_text", text:"[Image: <url>]"}` for an assistant message. An assistant
  `input_image` part becomes the same `output_text` form.
- A replayed Responses item's `output[]` array is normalized the same way: assistant
  output items become `output_text`, and a `function_call_output` output becomes
  `input_image`. This is the replay path, where a client sends previous Responses output
  items back inside `input`.
- In the Chat to Responses request translator, an assistant message's `image_url` content
  part becomes `{type:"output_text", text:"[Image: <url>]"}` rather than an image part.

The source's own tests assert all four shapes, including that no `"image_url"` key
survives in the normalized result.

### Comparison with the published Responses image work

The local tree's published Responses image contract is in `docs/reference/api.mdx`:

- line 112 documents that Responses `input_image` accepts `image_url` (URL or `data:`
  base64), that a bare `file_id` is rejected with HTTP 400 by the registered Responses
  translator and by the worker converter, and that the file reference is preserved on
  native-compatible, same-format Responses transports.
- line 114 documents that a Chat tool message with `image_url` parts becomes a
  `function_call_output` whose `output` is an `input_text` / `input_image` array, keeping
  `detail` and the `[Tool error]` marker.

The matching implementation is `open-sse/translator/formats/responsesApi.js` (the
`responsesImageUrl` helper at line 9 and the Chat worker converter), the tool-output image
lifting and bounding in `open-sse/translator/request/openai-responses.js` (see
`internal/docs/port-reports/1073-responses-tool-image-bounds.md`), and the Codex remote
image prefetch at `open-sse/executors/codex.js:695`.

That published work covers the `input_image` / `file_id` policy and the Chat **tool
output** image path. It does not cover assistant-role image lowering, and it does not
cover the replayed `output[]` image parts. Those two are exactly the source contract's
subject, so the residual below is narrower than the published work rather than a
contradiction of it.

### Local implementation and test evidence

**Residual (a): Chat to Responses, assistant message with an `image_url` part.**

`open-sse/translator/request/openai-responses.js:775` `chatPartToResponses` lowers a
Chat `image_url` part to `{type:"input_image", image_url:<url>, detail:<detail>|"auto">}`
unconditionally. The role is not consulted at that point: the caller at line 903 chooses
`input_text` for a user message and `output_text` for an assistant message, but the
`image_url` branch never reaches that `contentType`.

Executed probe (`openaiToOpenAIResponsesRequest`, Chat body with one assistant message
carrying a text part and an `image_url` part) produced:

```
{ type: "message", role: "assistant", content: [
  { type: "output_text", text: "I inspected the screenshot." },
  { type: "input_image", image_url: "https://example.com/scope.png", detail: "auto" } ] }
```

The source contract produces `{type:"output_text", text:"[Image:
https://example.com/scope.png]"}` for that second part. The local shape places an
`input_image` part inside an assistant message, where the Responses contract admits only
`output_text` or `refusal`, and it also injects `detail: "auto"` that the source does not
add on this path.

**Residual (b): native Responses replay path.**

The native Responses transport has no input sanitizer. `open-sse/executors/codex.js:951`
`transformRequest` applies the filters listed in section 1, none of which touches image
parts; the only image handling is `prefetchImages` (`open-sse/executors/codex.js:695`),
which maps a `content[]` part of type `image_url` to `{type:"input_image", image_url,
detail}` for **every** role.

Executed probes:

- an assistant message whose `content` holds an `image_url` part came out of
  `prefetchImages` as `{type:"input_image", image_url:"data:image/png;base64,…",
  detail:"auto"}` inside the assistant message, that is, an assistant item carrying an
  image part rather than `output_text`;
- a replayed item `{type:"message", role:"assistant", output:[{type:"image_url",
  image_url:{url:…}}]}` came out of `transformRequest` unchanged, with the raw
  `image_url` part still inside `output[]`;
- a replayed `{type:"function_call_output", call_id:"call_1", output:[{type:"image_url",
  image_url:{url:…}}]}` likewise came out unchanged.

The source contract normalizes all three of those shapes.

Existing local test evidence for the surrounding image behavior:
`tests/unit/codex-image-fetch.test.js` (remote URL prefetch into a base64 `input_image`),
`tests/unit/openai-responses-tool-output-images.test.js` and
`tests/unit/omni-responses-tool-image-bounds.test.js` (the published tool-output image
contract), and `tests/unit/openai-responses-nonstream.test.js` for the Responses
projection. None of them asserts an assistant-role image lowering or a replayed
`output[]` image normalization.

### Disposition

**Residual, narrowed to two places.** The published Responses image work already covers
the `input_image` / `file_id` policy and the Chat tool-output image path, and that work
stands unchanged. The source's own subject, role-aware `image_url` normalization across
Responses input paths, is **not** implemented locally in either of the two narrow places
above: the Chat to Responses translator lowers an assistant `image_url` part to
`input_image`, and the native Responses replay path leaves assistant image parts and
replayed `output[]` image parts unnormalized. No new provider, integration, or capability
is implied; this is a normalization gap inside existing paths.

**Bounded ordinary offline acceptance fixture.** A single offline unit file,
`tests/unit/omni-june-existing-response-contracts.test.js`, must pin the exact local
behavior so a future port cannot land silently. It must assert, without network access and
without provider traffic:

1. `openaiToOpenAIResponsesRequest` on a Chat body with one assistant message carrying
   `{type:"text"}` and `{type:"image_url", image_url:{url:"https://example.com/scope.png"}}`
   returns `input[0].content` exactly equal to
   `[{type:"output_text",text:"I inspected the screenshot."},
   {type:"input_image",image_url:"https://example.com/scope.png",detail:"auto"}]`
   (current local behavior; the assertion is the residual, not the target).
2. `CodexExecutor.transformRequest` on a user item, a `phase:"commentary"` assistant item
   and a `phase:"final_answer"` assistant item returns all three items, with the
   commentary item's `phase` and `output_text` content intact (section 1 contract).
3. `CodexExecutor.prefetchImages` on an assistant message whose `content` holds one
   `image_url` part returns that part as `{type:"input_image", image_url:<same url>,
   detail:"auto"}`.
4. `CodexExecutor.transformRequest` on a replayed assistant item with
   `output:[{type:"image_url", image_url:{url:…}}]` and on a replayed
   `function_call_output` with `output:[{type:"image_url", …}]` returns both items
   unchanged, with the `image_url` part still present in `output[]`.

Run it offline from `tests/`:

```
node node_modules/vitest/vitest.mjs run unit/omni-june-existing-response-contracts.test.js --maxWorkers=2
```

The fixture needs only the translator and the Codex executor; item 3 must use a `data:`
URI so no image fetch and no network are involved.

---

## 4. OmniRoute #3596 - `/v1/completions` returns the legacy text-completion format

### Exact source pin

- Merged tree: `cb08cf221da25daade62c2d2dadc1d8d762e8831`
- First parent: `1bc858837af4b9fa29208117b21e19f67dd19671` (the merged tree of #3595, so
  the two records are consecutive in the upstream history)
- Subject: `fix: /v1/completions returns legacy text-completion format, not chat (#3571) (#3596)`
- Author/date in the tree: Diego Rodrigues de Sa e Souza, Wed Jun 10 18:06:17 2026 -0300
- First-parent changed paths (4): `CHANGELOG.md`,
  `src/app/api/v1/completions/route.ts`,
  `src/app/api/v1/completions/textCompletionTransform.ts`,
  `tests/unit/completions-text-format-3571.test.ts`

### Source contract

The upstream endpoint routes internally through the chat pipeline, so `/v1/completions`
answered with chat payloads (`choices[].message` or `choices[].delta.content`) and legacy
Completion clients crashed on the missing `text` field. The merged tree wraps the chat
response in `asTextCompletionResponse`, which rewrites the response into the legacy
shape:

- a chat object becomes `{object:"text_completion", choices:[{text, index, logprobs,
  finish_reason}]}` with `id`, `created`, `model`, `usage` and `system_fingerprint`
  preserved;
- each SSE `data:` frame is rewritten the same way, with `[DONE]` and error bodies passed
  through unchanged;
- the source mapper reads `message.content`, then `delta.content`, then an existing
  `text`, so an empty delta still yields `text: ""` rather than an absent field.

### Local implementation and test evidence

The local endpoint already implements this contract:

- `src/app/api/v1/completions/route.js:253` `POSTHandler` adapts the legacy `prompt`
  body with `adaptLegacyBody` (line 187), runs the chat core, and returns
  `mapCompletionResponse` (line 218).
- `toTextCompletion` (line 69) produces `{id, object:"text_completion", created, model,
  choices:[{text, index, logprobs:null, finish_reason}], usage}` from a
  `chat.completion` body; `toTextCompletionChunk` (line 93) does the same for a
  `chat.completion.chunk` frame; `createCompletionStreamTransform` (line 122) rewrites
  each `data:` frame line by line and passes `[DONE]` through untouched.
- `mapCompletionResponse` returns a non-2xx response untouched and maps both the SSE and
  the JSON case, dropping `content-length` and `content-encoding` after re-serialization.
- The published contract matches: `docs/reference/api.mdx:72` states that `POST
  /v1/completions` is a router shim where "Streaming SSE `chat.completion.chunk` frames
  are rewritten to `text_completion`", and the endpoint table at line 99 records the same.
- Existing local test evidence: `tests/unit/v1-completions.test.js` asserts the exact
  non-stream body (`object:"text_completion"`, `choices[].text`, `index`, `logprobs`,
  `finish_reason`, `usage`), the SSE rewrite of two chunks split across a network chunk
  boundary with `[DONE]` preserved, the multi-choice mapping, the untouched non-2xx
  error body, and the `content-length` cleanup.

### Disposition

**Already in.** The local `/v1/completions` endpoint already returns the legacy
text-completion shape for both the non-streaming JSON body and the SSE stream, and
`[DONE]` and error bodies pass through unchanged, which is the source contract of the
merged tree. Nothing needs to change.

Narrower differences that are not part of the source's response contract, recorded so
they are not mistaken for a port gap:

- the local mapper reads `message.content` (non-stream) and `delta.content` (stream) only;
  the source additionally falls back to an already-present `text` field;
- the local mapper drops `system_fingerprint`; the source preserves it;
- the local stream transform rewrites only frames whose `object` is
  `chat.completion.chunk`, and forwards any other frame verbatim; the source rewrites any
  JSON payload that carries a `choices` array;
- the local endpoint requires a `prompt` (a string or a one-element array) and returns
  400 otherwise, while the source also accepts a chat-shaped body on the same endpoint
  and still answers in the legacy shape. That is a request-side difference owned by the
  local legacy shim, not part of the #3596 response contract, and it is already the
  documented local behavior at `docs/reference/api.mdx:72`.

---

## 5. OmniRoute #3595 - a token-limit truncated response is a normal terminal status

### Exact source pin

- Merged tree: `1bc858837af4b9fa29208117b21e19f67dd19671`
- First parent: `2947bfd5eb85605cb6139f7543975843fd860f0c`
- Subject: `fix: pass through valid max_tokens-truncated responses instead of fake 502 (#3572) (#3595)`
- Author/date in the tree: Diego Rodrigues de Sa e Souza, Wed Jun 10 18:01:52 2026 -0300
- First-parent changed paths (3): `CHANGELOG.md`, `open-sse/services/errorClassifier.ts`,
  `tests/unit/empty-content-stopreason-3572.test.ts`

### Source contract

`isEmptyContentResponse` flagged any Claude `content: []` payload and any OpenAI
empty-choice payload, regardless of the terminal reason. A Claude Code `max_tokens: 1`
connectivity ping (HTTP 200, `stop_reason: "max_tokens"`, empty content) therefore became
a synthetic `502 "Provider returned empty content"` and triggered a needless family
fallback. The merged tree adds a terminal-signal allowlist:

- Claude: `stop_reason` in `{max_tokens, tool_use}` is a legitimate completion;
- OpenAI: `finish_reason` in `{length, tool_calls}` is a legitimate completion;
- a genuinely empty response (no terminal reason, or `stop` / `end_turn` with empty
  content) is still caught.

The source's own tests pin all six boundary cases, including that `end_turn` and `stop`
stay flagged.

### Local implementation and test evidence

The local guard is `hasUsefulContent` (`open-sse/handlers/chatCore/nonStreamingHandler.js:70`),
applied at line 680. It never consults a terminal reason:

- an OpenAI body is useful only when `choices[0].message` carries non-empty `content`,
  `reasoning_content`, `reasoning`, `audio.data`, `tool_calls` or `function_call`;
- a Claude body (`type === "message"`) is useful only when its `content` array holds a
  `tool_use`, `thinking` or non-blank `text` block;
- the only terminal-reason exception is `hasNormalTerminalStop` (line 119), which matches
  `finish_reason === "stop"` / `stop_reason === "end_turn"` **and** is restricted to the
  `antigravity` and `agy` providers by `TRUSTED_EMPTY_STOP_PROVIDERS` (line 117).
- `isNativeClaudeRefusal` (line 679) exempts a Claude `stop_reason: "refusal"`.

Executed probes through `handleNonStreamingResponse` (the same harness used by
`tests/unit/openai-responses-nonstream.test.js`):

- OpenAI `{choices:[{message:{role:"assistant",content:""},finish_reason:"length"}]}` with
  `usage.completion_tokens: 1` returned
  `{success:false, status:502, error:"Empty response content from openai/gpt-test"}`;
- Claude `{type:"message",role:"assistant",content:[],stop_reason:"max_tokens"}` returned
  `{success:false, status:502, error:"Empty response content from anthropic/gpt-test"}`.

The streaming path behaves differently, and the difference is part of the residual
boundary:

- an OpenAI stream whose only chunk carries `finish_reason: "length"` and then
  `data: [DONE]` is forwarded unchanged, with no synthetic error;
- a Claude stream whose `message_delta` carries `stop_reason: "max_tokens"` with
  `usage.output_tokens: 1` is forwarded unchanged;
- the same Claude stream with `usage.output_tokens: 0` is replaced by
  `event: error` with `{"message":"Provider returned empty content"}`.

That follows `open-sse/utils/emptyStreamTerminal.js:28`, whose success terminal for the
OpenAI shape is `[DONE]` or `finish_reason: "stop"` and for the Claude shape is
`message_stop`, combined with `isEmptyCompletion`
(`open-sse/handlers/chatCore/streamingHandler.js:44`), which treats a completion as
non-empty when output tokens are reported. The terminal reason itself is never
consulted.

Existing local test evidence for the surrounding policy:
`tests/unit/openai-responses-nonstream.test.js:35` asserts the 502 for an empty OpenAI
completion, and the same file asserts that reasoning-only and tool-call-only completions
stay usable; `tests/unit/14243-antigravity-empty-stop-completion.test.js` covers the
antigravity empty-stop exception.

Relationship to the earlier empty-lifecycle decision: the prior record
`internal/docs/port-reports/1073-first-party-complete-empty-turn.md` declined to port
OmniRoute #15598, which accepted an empty Claude lifecycle in a combo quality gate only
with trusted served-connection and host provenance. That decision is unaffected: #3595 is
a narrower contract about a **terminal truncation or tool signal**, which the model
itself reports, and it does not rely on any provider provenance. The two records can
coexist.

### Disposition

**Residual, narrowed to the non-streaming path plus the zero-output-token streaming
case.** The local gateway still rewrites a valid token-limit truncated completion into a
synthetic empty-content failure:

- non-streaming: an OpenAI `finish_reason: "length"` and a Claude `stop_reason:
  "max_tokens"` body with empty content both become `502 "Empty response content"`,
  independently of the reported usage;
- streaming: the outcome depends on the reported output tokens rather than on the
  terminal reason, so a truncated Claude turn that reports `output_tokens: 0` is replaced
  by a synthetic `Provider returned empty content` error event.

The source contract's other half, that a genuinely empty response (no terminal reason,
or `stop` / `end_turn` with empty content) is still caught, already holds locally: those
bodies are flagged today, and the antigravity exception and the Claude refusal exception
stay as they are.

**Bounded ordinary offline acceptance fixture.** The same proposed offline unit file,
`tests/unit/omni-june-existing-response-contracts.test.js`, must pin the exact local
behavior for this record as well. It must assert, without network access and without
provider traffic:

1. `handleNonStreamingResponse` on
   `{choices:[{index:0,message:{role:"assistant",content:""},finish_reason:"length"}]}`,
   with `usage: {prompt_tokens:7, completion_tokens:1, total_tokens:8}`, returns
   `{success:false, status:502}` and an error string of
   `Empty response content from openai/gpt-test`;
2. `handleNonStreamingResponse` on
   `{type:"message",role:"assistant",content:[],stop_reason:"max_tokens"}` for a Claude
   source and target format returns `{success:false, status:502}`;
3. `handleNonStreamingResponse` on
   `{choices:[{index:0,message:{role:"assistant",content:""},finish_reason:"stop"}]}` also
   returns `{success:false, status:502}`, so the guard against a genuine fake success
   stays pinned;
4. `handleStreamingResponse` on an OpenAI SSE body whose only chunk carries
   `finish_reason: "length"` followed by `data: [DONE]` forwards both frames unchanged and
   injects no error;
5. `handleStreamingResponse` on a Claude SSE body with `message_start`,
   `message_delta` carrying `stop_reason: "max_tokens"` and `usage.output_tokens: 1`, and
   `message_stop` forwards all three events unchanged;
6. `handleStreamingResponse` on the same Claude body with `usage.output_tokens: 0` ends
   with an `event: error` frame whose payload carries
   `{"message":"Provider returned empty content"}`.

The fixture must reuse the existing harness shape from
`tests/unit/openai-responses-nonstream.test.js` (the `options()` helper and the
`handleNonStreamingResponse` / `handleStreamingResponse` imports), and it must mock
`@/lib/usageDb.js` exactly as that file does, so no usage rows are written. No provider
call, credential, or account is involved.

Run it offline from `tests/`:

```
node node_modules/vitest/vitest.mjs run unit/omni-june-existing-response-contracts.test.js --maxWorkers=2
```

When a future port adopts the source contract, items 1, 2 and 6 flip to the non-error
outcome and the fixture moves with them; items 3, 4 and 5 must not change.

---

## What remains needed

- **#3150** is a confirmed residual with an executable offline reproduction and a bounded
  acceptance fixture. Porting it needs no new provider, integration, or credential: it is
  a role-aware normalization inside the existing Chat to Responses translator and the
  existing native Responses input path.
- **#3595** is a confirmed residual with an executable offline reproduction and a bounded
  acceptance fixture. Porting it needs a terminal-reason allowlist in the existing
  non-streaming empty-content guard and in the existing streaming terminal guard, with
  the genuine fake-success cases left flagged.
- **#3108** has one half that is out of scope by instruction and one half that is already
  in. No cache contract, cache setting, or cache response shape is proposed, because the
  local product path that would serve a cached completion does not exist.
- **#3107** and **#3596** need no work: the local tree already holds the source's
  post-fix behavior. No new capability is recommended for either.
- The whole suite was not run, and no live provider path was exercised. The findings above
  are bounded to the offline probes and the cited local sources.
