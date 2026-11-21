# 1073: Antigravity trailing usage after the finish chunk

Compared at DurinDoor base `e2605ebb141071d0dd532f815d0f11ee65f624e4` on 2026-11-20.

## Source

- [OmniRoute #18643](https://github.com/cheaper-inference/OmniRoute/pull/18643) — merged. Exact
  source head `5058c9f50545f71c303a063c031860e1ebb6544c`, merge commit
  `20a7957590a10af180b5345d2e61405dfe8f666a`.
- Upstream changed four paths: `open-sse/translator/response/openai-to-antigravity.ts`,
  `changelog.d/fixes/18643-antigravity-usage-only-chunk.md`,
  `tests/unit/sse-stream-openai-to-antigravity-usage.test.ts` and
  `tests/unit/translator-resp-openai-to-antigravity.test.ts`. Only the translator and its tests
  carry behavior; the changelog fragment has no local counterpart.
- The upstream diff was read from the merged PR. No upstream file was copied verbatim; see
  "Deliberate adaptations".

## Gap found

`open-sse/translator/response/openai-to-antigravity.js` dropped the trailing usage-only chunk.

An OpenAI-compatible upstream called with `stream_options.include_usage` sends the usage in a
separate final chunk with `choices: []`, after the finish chunk. The local translator read that
chunk on the candidate-less branch and stashed it on `state._usage`, then returned `null`:

    const choice = chunk.choices?.[0];
    if (!choice) {
      if (chunk.usage) {
        state._usage = chunk.usage;
      }
      return null;
    }

The stash is only ever read by a later finish chunk (`chunk.usage || state._usage`). When the
usage arrives *after* the finish chunk — the normal `include_usage` order — the finish chunk has
already been emitted, so nothing reads the stash and the usage was lost. The Antigravity,
Gemini, Gemini-CLI and Vertex clients received no `usageMetadata` at all for such a stream.

Reproduced on the pre-change tree with a synthetic OpenAI stream of text → finish → usage-only:
the client received two frames (text, terminal candidate with `finishReason: "STOP"`) and the
usage frame was absent, so the client-visible totals were missing.

## Change

`open-sse/translator/response/openai-to-antigravity.js` now distinguishes the two orderings and
forwards the trailing frame as usage metadata of its own.

- A candidate-less chunk with usage before the finish chunk is still stashed on `state._usage`
  and still rides on the finish chunk. That pre-finish handling is unchanged.
- The finish chunk sets `state._finishSent`, and every frame that carries `usageMetadata` sets
  `state._usageSent`.
- A candidate-less chunk with usage after the finish chunk is emitted as its own frame: one
  candidate with an empty text part, no `finishReason`, the stream's `modelVersion` and
  `responseId`, and the projected `usageMetadata`. The terminal candidate is not reopened and not
  repeated.
- A candidate-less chunk with usage after the finish chunk is dropped when the usage already went
  out (`state._usageSent`), so usage is never reported twice.
- A candidate-less chunk without usage stays dropped, exactly as before.

The usage projection itself moved to a new local module,
`open-sse/translator/response/geminiUsageMetadata.js`, exporting `buildGeminiUsageMetadata(usage)`.
Both the finish chunk and the new trailing frame use it, so the two paths cannot drift apart.

## Deliberate adaptations

1. **The local reasoning math is kept; upstream's is not.** Upstream's `buildGeminiUsageMetadata`
   reports `completion_tokens` verbatim as `candidatesTokenCount`. This fork subtracts the
   reasoning share instead, because OpenAI completion tokens include reasoning while Gemini counts
   thoughts separately:

       metadata.candidatesTokenCount = Math.max(0,
         metadata.candidatesTokenCount - metadata.thoughtsTokenCount);

   This is a pre-existing local rule, documented in `internal/docs/v5-protocol-conformance.md` and
   asserted by `tests/translator/v5-conformance-gemini-stream-usage.test.js` (stream path) and
   `tests/translator/v5-conformance-gemini-usage.test.js` (JSON path). Importing upstream's helper
   verbatim would have broken `promptTokenCount + candidatesTokenCount + thoughtsTokenCount ===
   totalTokenCount` on the stream path. The upstream total is never recomputed, and a usage object
   without reasoning or cache detail still projects byte-identically to the pre-port output.

   Concretely, for `prompt_tokens: 11, completion_tokens: 5, total_tokens: 16` with
   `reasoning_tokens: 2` the local frame reports `candidatesTokenCount: 3`; upstream's helper
   would report `5`. The focused test asserts the local value.

2. **Module language and location.** Upstream ships `openai-to-antigravity.ts` and a `.ts`
   helper. This fork is JavaScript, so the helper is `geminiUsageMetadata.js` beside the
   translator that owns it, and the translator is otherwise unchanged in shape. The helper is a
   plain module, not a registration file, so `open-sse/translator/index.js` is unchanged and no
   generated index needed regeneration.

3. **The `[DONE]` sentinel difference is left alone.** Upstream's Gemini-client wire test expects
   a trailing `data: [DONE]` on the client. In this fork the translate path consumes the
   provider's `[DONE]` and does not forward it, so a Gemini-family client sees no sentinel. That
   is pre-existing local behavior and is unrelated to the usage frame, so it was not changed and
   the focused test does not assert on the sentinel; it asserts on the parsed data frames only.

4. **Gemini-family reach.** Locally, `open-sse/translator/response/openai-to-gemini.js` registers
   the same `openaiToAntigravityResponse` for `FORMATS.GEMINI`, `FORMATS.GEMINI_CLI` and
   `FORMATS.VERTEX`. The port therefore reaches all four Gemini-family client formats through the
   one translator, and the focused test covers the Antigravity and Gemini registrations.

## Preserved

- The pre-finish usage stash and the "usage already on the finish chunk" duplicate suppression.
- The local reasoning and cached-token math, including the absent-detail case.
- The candidate shape of the terminal frame, the finish-reason mapping, the tool-call
  accumulation and the empty-text-part fallback.
- Provider credentials, sign-in and request behavior: no executor, provider registry, OAuth
  service, request translator or request body was touched. The change is confined to the
  OpenAI→Gemini-family *response* projection.
- Gateway accounting. The provider's OpenAI-shaped usage chunk was already read by the stream
  accounting path before this change; the port only changes what the client sees.

## Focused evidence

`tests/unit/omni-antigravity-after-finish-usage.test.js` (11 tests) covers three layers, all
offline with synthetic fixtures:

- Translator: the trailing usage-only chunk after the finish chunk is forwarded as
  `usageMetadata` with an empty text part and no `finishReason`; the stream's `modelVersion` and
  `responseId` are preserved; usage already on the finish chunk is not repeated; the pre-finish
  stash still rides on the finish chunk exactly once; a trailing chunk without usage stays
  dropped; a usage object without detail fields projects byte-identically to the pre-port output.
- Registered response path (`translateResponse`): exactly one `usageMetadata` frame for the
  Antigravity and the Gemini registrations, emitted last, with the flush adding nothing; and
  exactly one frame when the finish chunk already carried the usage.
- Client-facing wire frames through the production stream factory
  (`createSSETransformStreamWithLogger`): for the Antigravity and the Gemini client formats the
  client receives one usage frame, the terminal candidate appears once and before it, the usage
  frame is the last frame, and the text frame is still first.

No provider call, credential, browser, e2e, Docker, paid API or live request is involved.

    cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-antigravity-after-finish-usage.test.js

Before and after were measured on the same tree with the translator change stashed and
restored. On the pre-change translator, 6 of the 11 tests fail and 5 pass: the failures are
exactly the new-behavior assertions (the trailing frame is forwarded, one `usageMetadata`
frame reaches the client, and the wire frame is the last one), while the 5 that pass are the
preserved-behavior assertions (pre-finish stash, duplicate suppression, trailing chunk without
usage, and the finish chunk that already carried its usage). The pre-change wire run emitted 2
client frames and 0 `usageMetadata` frames; after the change it emits 3 frames and exactly one
`usageMetadata` frame.

Related existing coverage was re-run and still passes: the whole `tests/translator/` suite
(99 files, 1862 passing, 34 skipped; 9 live files skipped because `RUN_REAL` is not set), plus the
238 `unit/` files selected by antigravity, gemini, stream or usage in their name (237 passed, 1
skipped; 1989 tests passing, 6 skipped). ESLint over the changed files reports no diagnostics.
