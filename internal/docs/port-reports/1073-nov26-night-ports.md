# November 26 night port candidates

Scope: every row marked "Port candidate" in [the night dispositions](1073-nov26-night.md). That report has four such rows. On 2026-11-26 each PR was open, its head matched the SHA in the source row, and its diff was fetched with `gh api`. No live provider was called.

| PR | Head | Final disposition | Evidence |
|---|---|---|---|
| 9router [#5864](https://github.com/decolua/9router/pull/5864) | `6b82c6b3248f` | Ported (remaining gaps only) | Most chat cases were already handled. Gaps fixed in [the JSON handler](../../../open-sse/handlers/chatCore/nonStreamingHandler.js), [buffered SSE](../../../open-sse/handlers/chatCore/sseToJsonHandler.js), [streaming](../../../open-sse/handlers/chatCore/streamingHandler.js) and the media cores. Tests: [chat](../../../tests/unit/port9r-http200-chat-outcome-5864.test.js), [media](../../../tests/unit/port9r-http200-media-outcome-5864.test.js). Details below. |
| OmniRoute [#21244](https://github.com/cheaper-inference/OmniRoute/pull/21244) | `855ec3fd7e61` | Already present (ported earlier) | The PR changes exactly the files of #20232 and #20233 together. Both were ported in [batch 24](open-prs-nov25-24-port-1.md), which lists each member as ported, present, not adopted or not applicable. At this HEAD the six `tests/unit/port-omni-2023*` files pass. A temporary probe of a Responses tool call with no `output_item.done`, cut by `max_output_tokens`, kept the arguments and ended with `length`. |
| OmniRoute [#21247](https://github.com/cheaper-inference/OmniRoute/pull/21247) | `3bc14869ca48` | Ported (UncloseAI retirement); readiness gate not applicable | [UncloseAI](../../../open-sse/providers/registry/uncloseai.js) is now an API-key provider and its rows in [the free catalog](../../../open-sse/config/freeModelCatalog.data.js) are `discontinued`. Test: [retirement](../../../tests/unit/port-omniroute-uncloseai-retired.test.js). The browser readiness gate belongs to upstream keyless auto routing; `open-sse/services/autoCombo` is absent. |
| OmniRoute [#21119](https://github.com/cheaper-inference/OmniRoute/pull/21119) | `149516b12d4d` | Ported (error code); Gemini 4 mode menu not applicable | DOM answer reading was [ported earlier](open-prs-nov25-19-port-2.md). Account exhaustion in [credentials](../../../src/sse/handlers/chat/singleModel/credentials.js) now keeps the last upstream error code. Test: [exhaustion code](../../../tests/unit/port-omniroute-exhaustion-error-code.test.js). The Gemini 4 modes are new models with a new menu path; `open-sse/executors/gemini-web/modeSelection.js` is absent. The high-demand check applies only to those modes. `open-sse/utils/publicErrorIdentifiers.js` is absent, so no code allowlist is needed. |

## #5864 per surface

Already present:

- Non-streaming and forced-SSE chat reject error envelopes, empty output, missing terminals, malformed SSE and failed Responses streams with `502` before success is recorded. A translation exception also ends as `502`.
- Streaming chat records success only on a coherent terminal, reports a cut stream in band, and retries a sibling account when the stream ends or errors without content inside `STREAM_EARLY_EOF_PEEK_MS`. The client abort signal reaches the handler.
- OpenRouter TTS requires `[DONE]` and rejects in-stream errors. NVIDIA STT requires a transcript.

Ported:

- A content filter or safety block with no output is returned as an answer, not a `502` with an account cooldown.
- A buffered SSE reply with a plain `stop`, no output and no billed tokens is a `502`.
- A `200` HTML or text page on a streaming request is a `502`, not a failure carrying status `200`.
- Embeddings, images, STT and TTS fail on an error envelope sent with `200`. Embeddings also fail on an empty or non-numeric vector, images on blank image items, and TTS on JSON, HTML or empty audio.
- An AssemblyAI upload or submission without an id fails at once instead of polling for 120 seconds.
- Video: a caller abort is `499` (a deadline stays `408`, also on the retry after refresh), a non-JSON `200` is a `502`, and a creation without a job id or with a failed job is a `502`. Polls pass through.

Not adopted, because local tests or code pin the current behaviour on purpose:

- A buffering barrier that holds the stream until first output. The early-EOF peek and the combo check cover failover.
- Rejecting an empty `data` list from embeddings or images, or a non-OpenAI embeddings body.
- Rejecting an STT reply that only lacks a transcript. The audio is already billed, so a combo would pay again.
- Rejecting `text/plain` TTS bodies. Only JSON and HTML are treated as errors.
- The `errorKind` result field. Nothing here reads it.

Not applicable: `open-sse/handlers/ttsProviders/selfhostedTts.js` is absent.
