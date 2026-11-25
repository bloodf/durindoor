# #1073 late-June Command Code request-shape review

Review compares the pinned OmniRoute patches with the current local Command Code translator and its offline fixtures. The local route is already applicable: `openaiToCommandCodeRequest` is registered for OpenAI-to-CommandCode and builds the `/alpha/generate` params envelope. No provider or endpoint addition is involved.

## Pins and dispositions

| PR | Exact patch pin | Disposition |
| --- | --- | --- |
| [OmniRoute #4473](https://github.com/cheaper-inference/OmniRoute/commit/f00ec2c51e42b48060f019eee66322457a2001f1) | head `f00ec2c51e42b48060f019eee66322457a2001f1`; enclosing merge `3e980a0b2b281eb8833d9f940f9fdd5b1c9d2cdb` | **Port narrowly:** use a non-empty rewritten `body.model` for the outgoing model while retaining the current model argument as fallback and applying the current suffix/capability rules. |
| [OmniRoute #5174](https://github.com/cheaper-inference/OmniRoute/commit/d5b42b5b012e58a7576d21ffc25df8c675e1c02c) | head `d5b42b5b012e58a7576d21ffc25df8c675e1c02c`; enclosing merge `b2aed90711a5ee9c8354681a601b3ff0d68ef15a` | **Do not port:** its user-array-to-string normalization discards non-text parts; local conversion preserves supported text and image blocks in Command Code's native structured content. |
| [OmniRoute #5221](https://github.com/cheaper-inference/OmniRoute/commit/509806dd614c09a877d85b8df050e3065b34b6ea) | head `509806dd614c09a877d85b8df050e3065b34b6ea`; enclosing merge `d8a392a47766ee3deb17dfdff75ec285cfab0e92` | **Do not port omission behavior:** local translation intentionally supplies its established default and clamps to the selected model's capability; omitting the field would change that contract. Preserve explicit positive client limits. |
| [OmniRoute #5304](https://github.com/cheaper-inference/OmniRoute/commit/1a096c4b3a0ddae5cc196a8ed0aa6956e242174b) | PR patch `1a096c4b3a0ddae5cc196a8ed0aa6956e242174b` (the supplied `02eaf90a6c671c75ae06f1ac93bfe5471d83e1e1` is the enclosing merge); enclosing merge `02eaf90a6c671c75ae06f1ac93bfe5471d83e1e1` | **Port narrowly:** treat a supplied non-positive token limit as no limit, rather than converting it to one. Keep local defaults and model caps for omitted/positive limits. |

## Current behavior and fixture evidence

- `open-sse/translator/request/openai-to-commandcode.js` derives the outgoing model from the `model` argument, strips only recognized Command Code thinking suffixes, and does not consult `body.model`. Therefore a payload-rule rewrite represented only in `body.model` is lost. The existing Muse suffix and capability fixture verifies the current model cleanup and 32,768 cap in `tests/unit/openai-to-commandcode.test.js` (`strips a recognized thinking suffix...`, `clamps Muse output tokens...`). A narrow addition should choose non-blank `body.model` before suffix cleanup and calculate the cap against that selected model.
- Reasoning already has native request handling: assistant `reasoning_content`, `thought`, or `reasoning` becomes a native `reasoning` block, and effort is read from `reasoning_effort`, `output_config.effort`, `reasoning.effort`, or adaptive `thinking`. Fixtures cover real reasoning text, no fabricated empty reasoning, forwarded effort, Claude output-config effort, and supported/unsupported Muse levels (`tests/unit/openai-to-commandcode.test.js`). These shapes should remain unchanged by either narrow port.
- User content already passes through `toContentBlocks`: strings become text blocks, arrays preserve recognized text and image content, and empty/unrecognized arrays become an empty text block. This differs from OmniRoute #5174's `normalizeContentText` flattening; flattening would drop the image represented in the patch's mixed text/image fixture. Existing translator fixtures in `tests/unit/openai-to-commandcode.test.js` exercise request conversion; the implementation itself provides the block behavior.
- The local token expression uses `body.max_tokens ?? body.max_output_tokens ?? DEFAULT_MAX_TOKENS`, then `Math.max(Number(requestedMaxTokens) || DEFAULT_MAX_TOKENS, 1)`, followed by the selected model's `maxOutput` cap. Thus omitted limits use the local default (fixture: 64,000), explicit positive budgets are retained unless the model cap is lower (fixtures: 16,384 retained and Muse 64,000 capped to 32,768), but `0` becomes the default and a negative value becomes `1`. The latter is a demonstrated narrow gap from #5304. Preserve explicit positive user budgets and the capability cap while treating zero/negative numeric limits as omitted.

## Ordinary offline acceptance for the narrow gaps

Extend the existing `tests/unit/openai-to-commandcode.test.js` fixtures and run that file offline:

1. A non-empty rewritten `body.model` is emitted in `params.model`, while absent, empty, or whitespace-only `body.model` falls back to the model argument. A recognized suffix on the selected model is cleaned and the selected model's capability cap is applied.
2. Existing reasoning assertions remain valid alongside a model rewrite; no new reasoning field or provider wire shape is introduced.
3. `max_tokens: 0`, negative `max_tokens`, and negative `max_output_tokens` do not produce `params.max_tokens: 1`; they follow the established omitted/default path. Positive explicit limits remain intact subject to the existing selected-model cap, including the existing 32,768 Muse fixture.
4. Existing user text and image block behavior remains unchanged; no flatten-to-string regression is introduced.
