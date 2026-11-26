# Port report — open PR batch 24, port candidates 1–8

Scope: port candidates 1–8 of [the batch 24 dispositions](open-prs-nov25-24.md), counted over port-candidate rows in table order. On 2026-11-26 each PR was open and its current diff was fetched with `gh api`. Each head matched the SHA in its source row. `git log --grep` found no earlier commit on this branch that names any of the eight PR numbers.

Most of these PRs are bundles. A row is "ported in this change" when at least one gap was ported. The member notes below give the result for every code fix in each bundle.

| Row | PR | Final disposition | Evidence |
|---:|---|---|---|
| 923 | OmniRoute [#20233](https://github.com/cheaper-inference/OmniRoute/pull/20233) | ported in this change | [The stream layer](../../../open-sse/utils/stream.js) forwarded the usage-only chunk that the executor had asked for. It now drops it for a Chat client that did not ask, and still records usage. Tests: [usage chunk](../../../tests/unit/port-omni-20233-unrequested-usage-chunk.test.js), [translator edges](../../../tests/unit/port-omni-20233-responses-translator-edges.test.js), [refused reply](../../../tests/unit/port-omni-20233-refused-reply-usage.test.js). |
| 924 | OmniRoute [#20232](https://github.com/cheaper-inference/OmniRoute/pull/20232) | ported in this change | Usage rows already stored no non-streaming TTFT. Request details stored total latency as TTFT in [the JSON handler](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) and [the buffered SSE handler](../../../open-sse/handlers/chatCore/sseToJsonHandler.js). Both now store 0, which means not measured. Tests: [TTFT](../../../tests/unit/port-omni-20232-nonstream-no-ttft.test.js), [reused tool index](../../../tests/unit/port-omni-20232-reused-tool-index.test.js), [ClinePass status](../../../tests/unit/port-omni-20232-clinepass-envelope-status.test.js). |
| 925 | OmniRoute [#20230](https://github.com/cheaper-inference/OmniRoute/pull/20230) | ported in this change | After a rotation the second account received the first account's reasoning ciphertext. [Dispatch](../../../src/sse/handlers/chat/singleModel/dispatch.js) now flags a send on another account, and [the Codex executor](../../../open-sse/executors/codex.js) strips the ciphertext before that send. Test: [rotation](../../../tests/unit/port-omni-20230-codex-account-switch-reasoning.test.js), run through the real chat handler with a mocked transport. |
| 926 | OmniRoute [#20228](https://github.com/cheaper-inference/OmniRoute/pull/20228) | ported in this change | The headers were already sent, but `X-Conversation-ID` was random on every request. [The header hook](../../../open-sse/executors/default.js) now derives it from an explicit client session and the account, for both CodeBuddy providers. Tests: [conversation id](../../../tests/unit/port-omni-20228-codebuddy-conversation-headers.test.js), [Argon location](../../../tests/unit/port-omni-20228-vertex-argon-location.test.js). |
| 927 | OmniRoute [#20222](https://github.com/cheaper-inference/OmniRoute/pull/20222) | ported in this change | A turn made only of an unsupported image or document vanished. [Claude to OpenAI](../../../open-sse/translator/request/claude-to-openai.js) now leaves a short notice. Tests: [notice](../../../tests/unit/port-omni-20222-omitted-attachment-notice.test.js), [Responses-only fields](../../../tests/unit/port-omni-20222-responses-only-fields.test.js). |
| 928 | OmniRoute [#20210](https://github.com/cheaper-inference/OmniRoute/pull/20210) | ported in this change | [The Cursor executor](../../../open-sse/executors/cursor.js) now sends a standard Grok 4.7 effort alias with `reasoning_effort`, `fast=false` and no legacy model envelope. Test: [standard speed](../../../tests/unit/port-omni-20210-cursor-grok-standard-speed.test.js). |
| 930 | OmniRoute [#20205](https://github.com/cheaper-inference/OmniRoute/pull/20205) | ported in this change | `generationConfig.stopSequences` was dropped by [Gemini](../../../open-sse/translator/request/gemini-to-openai.js) and [Antigravity](../../../open-sse/translator/request/antigravity-to-openai.js) translation. Both now send it as `stop`. Tests: [request fields](../../../tests/unit/port-omni-20205-gemini-request-fields.test.js), [roles](../../../tests/unit/port-omni-20205-antigravity-roles.test.js), [schema keys](../../../tests/unit/port-omni-20205-gemini-schema-keys.test.js). |
| 931 | OmniRoute [#20203](https://github.com/cheaper-inference/OmniRoute/pull/20203) | ported in this change | [The Responses transformer](../../../open-sse/transformer/responsesTransformer.js) wrote resumed reasoning to the closed item. It now opens a new item. No production module imports this transformer today; only tests do. Tests: [reopen](../../../tests/unit/port-omni-20203-transformer-reasoning-reopen.test.js), [stream end](../../../tests/unit/port-omni-20203-transformer-stream-end.test.js), [backpressure](../../../tests/unit/port-omni-20203-keepalive-backpressure.test.js). |

## Bundle members

### #20233

- Ported: the unrequested usage-only chunk. The Gemini v1beta bridge (`geminiBridge.js` under `src/app/api/v1beta/`) and the [Kiro MITM handler](../../../src/mitm/handlers/kiro.js) read usage from the Chat stream, so both now ask for it. A chunk is dropped only when the gateway added `include_usage` itself. An upstream chunk that nothing asked for still passes.
- Ported: chunks after `response.completed` are dropped, and object-valued tool arguments stay JSON text.
- Ported: an empty-content or fake-success non-streaming reply was logged as `200 OK` before it was refused. It is now one `error` usage row with the billed tokens. The account was already not marked successful.
- Already present: Responses to Chat streams send argument deltas as they arrive, and `response.incomplete` reports `length` or `content_filter`. `Retry-After` HTTP dates are read and values over the cap are ignored. Both reply modes read upstream errors with `parseUpstreamError`.
- Not adopted: `Retry-After: 0` as no wait. It still gets the standard backoff.
- Not applicable: there is no in-flight request deduplication, post-call guardrail or model-family fallback here.

### #20232

- Ported: no non-streaming TTFT. The request details tab (`RequestDetailsTab.js` in the usage dashboard) shows `-` for an unmeasured TTFT and no per-request speed, as before for these rows. Aggregate speed still uses the full duration of non-streaming calls, which [the usage guide](../../../docs/guides/monitoring-usage.mdx) documents; upstream excludes them.
- Ported: an upstream that reuses a tool-call index no longer merges two calls in the Chat to Responses translator.
- Ported: a ClinePass failure envelope keeps its `statusCode` on the non-streaming path.
- Already present: a missing call id gets a fallback, billed usage is kept on refused replies, a Responses stream without a terminal event ends in an `incomplete_upstream_stream` error, and the translator reopens reasoning at a new output index.
- Not applicable: the non-streaming handler does not re-send requests or sync Claude extra usage. There is no model-family or larger-context fallback, so served-model billing has nothing to change.

### #20230

- Ported: the Codex rotation fix. The one-time retry on `invalid_encrypted_content` stays. The flag covers rotations inside one request; a later request that starts on another account still relies on that retry.
- Not applicable: the four other members edit OmniRoute's agent skill documents and generator. `src/lib/agentSkills` does not exist here.

### #20228

- Ported: the stable conversation id. Request, message and `X-Request-ID` values stay equal within one request and change on each request, as before. Without an explicit session, each request gets a new conversation id.
- Ported: Gemini 4 Argon on Vertex ignores a stored location that does not serve it.
- Already present: the generated session id does not hash the system prompt, so Claude Code's billing line cannot rotate it.
- Not applicable: there is no Traffic Inspector proxy (`src/mitm/inspector`) or upstream readiness report.

### #20222

- Ported: the omitted-attachment notice, only when the turn has nothing else. `context_management` and `prompt` no longer reach Chat requests.
- Already present: all thinking blocks are kept, `max_output_tokens` becomes `max_tokens`, a custom tool in `allowed_tools` is not rejected, and Claude streams keep cache reads, refusal text and `{}` arguments.
- Not applicable: a file in a tool output is rejected with HTTP 400 here and is never inlined. The same-format Responses route has no promotion safety net: a probe showed `reasoning_effort` and `response_format` passing through the translator unchanged. CLOVA uses its OpenAI-compatible endpoint, so there is no CLOVA translator.

### #20210

- Ported: standard speed for Grok 4.7 effort aliases that are split into a base model and parameters.
- Unchanged: `-fast` and `-256k` ids and ids listed in the account catalog are still sent verbatim. Not checked against live Cursor.

### #20205

- Ported: Antigravity follow-ups beside tool results and role-less turns get the right role. Stop sequences (at most four) are kept by both translators; Antigravity also keeps `toolConfig` and `fileData`.
- Ported: `discriminator`, `xml`, `externalDocs`, `errorMessages`, `doNotSuggest` and `suggestSortText` are removed from Gemini tool schemas.
- Already present: tuple element types, nullable enums, a parameter named `required`, empty text parts, the Gemini 4 trailing-turn gate and Gemini's own role and `toolConfig` handling.

### #20203

- Ported: new reasoning item after text, zero-usage placeholders ignored, completion on `[DONE]` while waiting for usage, and [early keepalive](../../../open-sse/utils/earlyStreamKeepalive.js) backpressure.
- Already present in the transformer: whitespace-only first text, empty tool arguments, separate output indexes, CRLF frames and failed upstream error chunks.

## Changed test expectations

Three streaming provider tests ([NoTrack](../../../tests/unit/notrack-provider.test.js), [DemonRoute](../../../tests/unit/demonroute-provider.test.js), [Token Harbor](../../../tests/unit/tokenharbor-provider.test.js)) read the usage chunk without asking for it. #20233 changes that behaviour on purpose. Their requests now set `include_usage`; their assertions are unchanged.

The storybook inventory hashes for the request details tab were updated by replacing the old source hash. The sync tool was not run because it needs a built Storybook.

## Checks

Related test files were run after each behaviour. Closed mocks were used and no live provider was called. The red run before the fix was checked only for the translator edges and the Codex rotation; the other new tests were not run against the old code.

- Source-tree guard files: 50 files, 1028 tests passed.
- Files that use the chat core or the non-streaming handler: 171 files, 5119 tests passed.
- Translator files that use the Responses formats: 179 files, 2902 tests passed.
- The anti-slop lint gate reported no diagnostics. ESLint, the production build and the full suite were not run.

Totals: 8 ported in this change, 0 already present, 0 not applicable. No rows remain.
