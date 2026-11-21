# #1073 May Claude wire and reasoning follow-ups

## Source pins

- OmniRoute [#2063](https://github.com/cheaper-inference/OmniRoute/pull/2063): head `51deee3853e30e9ad96020273491e4f266e10aa1`, first-parent merge `afdebbc793cce519afc676fee73f2bff4da71fad`.
- OmniRoute [#2140](https://github.com/cheaper-inference/OmniRoute/pull/2140): head `82a5bb377863bf98c2b3dac944eed4b8a35a4b6f`, first-parent merge `4e53fba8b9f39fc902e213c58ddd383db5dbc694`.
- The separate OmniRoute [#2090](https://github.com/cheaper-inference/OmniRoute/pull/2090) executor hardening is pinned at head `611f995cf71bb3d10d20d85a2bb088a9009a2491`, merge `4f202f3fa5d0db738306917e0ccb65a9212b791b`.

## #2063 — Antigravity Claude request conversion

The #2063 merge replaces an Anthropic-shaped Cloud Code request for Claude models with the same Gemini-compatible `contents`, `systemInstruction`, `generationConfig`, tools and tool configuration used for Gemini. Its executor applies Gemini content cleanup to Claude too and removes legacy Anthropic fields (`messages`, `system`, `max_tokens`, `stream`, and top-level `temperature`). The source tests assert this wire shape, output cap, tool conversion, and removal of legacy fields.

The current route has the same two-stage outcome, with local behavior retained around it. [`openaiToAntigravityRequest`](../../../open-sse/translator/request/openai-to-gemini.js) selects the Claude request converter when the Antigravity model uses Claude request format; that converter wraps Claude history, while executor [`transformRequest`](../../../open-sse/executors/antigravity.js) normalizes content and limits Claude requests to supported Gemini-compatible fields. Its request-shape fixture checks normalized `contents`, system instruction, generation configuration and tools, omission of unrelated inner fields, and retention of local metadata/tool configuration ([`omni-antigravity-claude-wire-shape.test.js`](../../../tests/unit/omni-antigravity-claude-wire-shape.test.js)). This is the relevant parity boundary; the source patch's forced `VALIDATED` tool mode and field deletion list are not copied over local tool semantics.

The follow-on #2090 patch is a separate executor change: it adds a Claude-only supported-field allowlist and routes tools through the Gemini tool sanitizer. In this repository, the executor's Claude allowlist and tool normalization are already exercised independently. No additional independently tested #2063 residual is identified in the compared request-conversion behavior.

## #2140 — reasoning with tool history

The #2140 first-parent patch changes an OpenAI response sanitizer's rule: visible assistant text normally causes `reasoning_content` removal, but the field remains when the same message carries `tool_calls` or legacy `function_call`. Its added tests cover both preservation cases and the no-tool stripping control; the companion Claude request test checks that preserved reasoning becomes a leading Claude `thinking` block alongside text and `tool_use`.

DurinDoor has no equivalent `sanitizeOpenAIResponse` function or blanket final-message rule to amend. The current OpenAI-to-Claude request translator converts `reasoning_content` to a leading thinking block before appending tool-use blocks ([`openai-to-claude.js`](../../../open-sse/translator/request/openai-to-claude.js)); [`reasoning-history-bridge.test.js`](../../../tests/unit/reasoning-history-bridge.test.js) explicitly covers `reasoning_content` with an actual `tool_calls` entry. The native reasoning fixtures in [`non-streaming-forced-client-sse.test.js`](../../../tests/unit/non-streaming-forced-client-sse.test.js) check that native `reasoning_content` survives the client projection by default and that the explicit opt-out strips it. These paths keep the source patch's tool-history condition distinct from client projection policy; they do not establish raw-content storage or sign-in behavior, which are outside this comparison.

The repository's recorded OmniRoute #5488 is a batch-response formatter refactor, with batch route files and no reasoning sanitizer or translator coverage ([`1073-late-june-recovered-4-dispositions.md`](1073-late-june-recovered-4-dispositions.md)). It provides no contrary reasoning-path fixture for this comparison.

## Evidence scope

Compared the first-parent source patches at the exact merge pins above against the current Antigravity converter/executor, OpenAI-to-Claude translator, and named offline fixtures. This is a source and test-fixture comparison; no runtime provider requests or external service calls were used.

Refs #1073
