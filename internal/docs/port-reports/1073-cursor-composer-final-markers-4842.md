# #1073 Cursor Composer final markers — candidate withdrawn; replaced by boundary-preserving port

**Status: superseded by complete adaptation.** The global-stripping proposal below from unpublished candidate `be88c41bb06a05a503b762a3cef3d978f6bb1d91` was withdrawn in [the withdrawal report](1073-cursor-composer-marker-withdrawal.md) and has now been replaced by a boundary-preserving port recorded in [the complete #4842 report](1073-cursor-composer-markers-complete-4842.md).

Reviewed OmniRoute [#4842](https://github.com/cheaper-inference/OmniRoute/pull/4842) head [`66aa394b53a6b4b34ac57f7ba453f968aff310f4`](https://github.com/cheaper-inference/OmniRoute/commit/66aa394b53a6b4b34ac57f7ba453f968aff310f4) and enclosing merge [`7d2501b2862cf58cce5a2fad9e1f692f5c35edcd`](https://github.com/cheaper-inference/OmniRoute/commit/7d2501b2862cf58cce5a2fad9e1f692f5c35edcd). The installed Composer executor already extracts the visible suffix after `</think>` (#4554), and the completed #4842 port now strips only paired boundary framing while keeping interior marker literals, normal markup, native output, hidden reasoning, tools, and cancellation contracts intact.

## Withdrawn candidate behavior

The withdrawn candidate changed `visibleComposerContentFromThinking` in [`open-sse/executors/cursor.js`](../../../open-sse/executors/cursor.js) and added a four-entry literal marker table (`<|final|>`, `<｜final｜>`, `<|/final|>`, `<｜/final｜>`). It removed every occurrence of those literals from the visible suffix, held back a bounded suffix that is a proper prefix of one of the markers during streaming, and flushed a terminal incomplete prefix as ordinary text. It also relaxed the AgentService thinking fallback so a Composer fallback can still be emitted after visible text was already emitted.

That candidate was withdrawn for two reasons. It deletes a quoted marker that sits inside valid answer text, which is answer content rather than framing. It also changed the terminal-flush and fallback behavior of the shipped Cursor route, which is broader than the framing question the candidate set out to answer.

## Pre-replacement restored baseline (prior to complete port)

Before the boundary-preserving replacement, `visibleComposerContentFromThinking` in [`open-sse/executors/cursor.js`](../../../open-sse/executors/cursor.js) returned the visible suffix after the last `</think>` with only leading whitespace trimmed.

## Resolution

The #4842 framing gap has been resolved with a boundary-preserving extractor and offline unit fixtures covering buffered and fragmented framing, interior quoted markers, normal markup, native output, hidden reasoning, tool calls, and cancellation. See [the complete #4842 report](1073-cursor-composer-markers-complete-4842.md) for the exact scope and verification commands. No claim here establishes live provider behavior.

The #4554 visible-suffix extraction remains covered and its rationale is recorded in [the source audit](1073-late-june-existing-cursor-visible-output.md).
