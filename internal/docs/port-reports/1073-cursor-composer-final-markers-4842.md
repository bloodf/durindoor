# #1073 Cursor Composer final markers — candidate withdrawn, port pending product and gate work

**Status: pending product and gate work.** The adaptation described below was proposed in unpublished candidate `be88c41bb06a05a503b762a3cef3d978f6bb1d91` and has been withdrawn from the product tree. It is not shipped, no test in the tree asserts it, and the shipped Cursor executor keeps its pre-candidate behavior byte-for-byte. The exact withdrawal record, including the restored file identities and the verification commands, is [the withdrawal report](1073-cursor-composer-marker-withdrawal.md).

Reviewed OmniRoute [#4842](https://github.com/cheaper-inference/OmniRoute/pull/4842) head [`66aa394b53a6b4b34ac57f7ba453f968aff310f4`](https://github.com/cheaper-inference/OmniRoute/commit/66aa394b53a6b4b34ac57f7ba453f968aff310f4) and enclosing merge [`7d2501b2862cf58cce5a2fad9e1f692f5c35edcd`](https://github.com/cheaper-inference/OmniRoute/commit/7d2501b2862cf58cce5a2fad9e1f692f5c35edcd). The installed Composer executor already extracts the visible suffix after `</think>` (#4554) and returns that suffix unchanged, including any literal ASCII or full-width final marker the answer text happens to carry.

## Withdrawn candidate behavior

The withdrawn candidate changed `visibleComposerContentFromThinking` in [`open-sse/executors/cursor.js`](../../../open-sse/executors/cursor.js) and added a four-entry literal marker table (`<|final|>`, `<｜final｜>`, `<|/final|>`, `<｜/final｜>`). It removed every occurrence of those literals from the visible suffix, held back a bounded suffix that is a proper prefix of one of the markers during streaming, and flushed a terminal incomplete prefix as ordinary text. It also relaxed the AgentService thinking fallback so a Composer fallback can still be emitted after visible text was already emitted.

That candidate was withdrawn for two reasons. It deletes a quoted marker that sits inside valid answer text, which is answer content rather than framing. It also changed the terminal-flush and fallback behavior of the shipped Cursor route, which is broader than the framing question the candidate set out to answer.

## Shipped behavior

`visibleComposerContentFromThinking` in [`open-sse/executors/cursor.js`](../../../open-sse/executors/cursor.js) returns the visible suffix after the last `</think>` with only leading whitespace trimmed. No marker literal is removed, no suffix is held back, and no terminal flush is added, so a quoted marker inside an answer survives unchanged. The pre-existing offline coverage in [`tests/unit/cursor-composer-thinking.test.js`](../../../tests/unit/cursor-composer-thinking.test.js) and [`tests/unit/cursor-agent-exec-request.test.js`](../../../tests/unit/cursor-agent-exec-request.test.js) passes against this restored behavior.

## Pending work

The #4842 framing question is unresolved rather than closed. A complete replacement needs a product decision on how a framing marker is distinguished from a quoted marker inside answer text, and it needs gate work before it can be landed: the replacement must carry its own offline fixtures, must not restate the withdrawn candidate's marker-stripping assertions, and must land under the scoped or full local CI mode that its changed paths require. No claim here establishes live provider behavior.

The #4554 visible-suffix extraction is already covered in the shipped executor and is unaffected by this withdrawal. Its rationale is recorded in [the source audit](1073-late-june-existing-cursor-visible-output.md).
