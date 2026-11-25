# 1073: response masking preserves reasoning field shape

Source: [OmniRoute #18363](https://github.com/cheaper-inference/OmniRoute/pull/18363), "fix(sse): preserve reasoning fields through streaming redaction", merged (merge commit `e0012a82754708a6c0b3e9b75691c6f738747f2d`), pinned head `a49276e91e65f6c5d1a32ef8f35cbc9fcb82f649`. Compared against the existing DurinDoor pipeline only: `open-sse/services/contentMasking.js` (rules, `maskText`) and `open-sse/services/responseMasking.js` (`applyResponseMasking`, invoked last in `open-sse/handlers/chatCore.js`).

## Disposition: already covered. No application code changed.

Upstream's problem is a TypeScript stream transform in which `content`, `reasoning`, `reasoning_content` and tool arguments shared buffers, so rewriting one could corrupt or replay another. DurinDoor has no such shared buffer. `responseMasking.js` is a field-targeted walker:

- Only visible answer text is read and written: Chat `message.content` / `delta.content`, Responses `output_text` parts and top-level `output_text`, Claude `text` blocks and `text_delta`, Gemini non-`thought` text parts. Each is rewritten in place with `setField`, which assigns only when the value changed, so key order, sibling fields and unchanged bytes survive.
- Carry state is keyed per output index (`chat/<choice>/`, `resp/<output>/<content>/`, `claude/<block>/`, `gem/<candidate>/`) and holds visible text only. Reasoning fields never enter it, so they cannot mix with it.
- `reasoning_content`, `reasoning`, `reasoning_details`, Claude `thinking`/`signature`/`redacted_thinking`, Responses `reasoning` items (`summary`, `encrypted_content`), Gemini `thought` parts and `thoughtSignature`, tool calls and usage objects are never read or written. Synthesized flush frames contain only the held text (Chat `finish_reason: null`, `usage` unset; Gemini `finishReason` and `usageMetadata` unset, a single text part), so they neither replay reasoning or signed fields nor carry terminal metadata early.
- Mask mode that has nothing to rewrite returns the original bytes; warn returns the original bytes always; off returns the same result object.

## Intentional differences (existing output policy wins)

- **Reasoning text is not masked.** Upstream tracks reasoning buffers so it can redact them. DurinDoor's documented contract (header of `responseMasking.js`, `docs/features/content-masking.mdx`) rewrites visible answer text only and never touches reasoning or signed thinking. That is unchanged: no hidden reasoning is exposed and the masking policy is neither widened nor weakened.
- **No stream failure on carry limits.** Upstream now fails the stream with a fixed `[PII] ...limit exceeded` error. DurinDoor bounds carry (`CARRY_CHARS`, `MAX_CARRY_CHARS`, `MAX_TOTAL_CARRY_CHARS`) by masking and sending held text whole, as already documented in the file header. Not adopted.
- **Metadata suppression** already in the pipeline (flush frames drop `usage`, `finishReason`, `usageMetadata`, thought parts) is retained and asserted.

## Observed behavior recorded, not changed

- When Gemini visible text is held in the carry, the part that arrived carrying a `thoughtSignature` keeps that signature (exactly once, same value) with its text emptied; the masked text is delivered later in a synthesized part with no signature. Nothing is lost or duplicated, but the signature and text are no longer on the same part. Moving it would alter existing stream carry semantics, so it is pinned by a characterization test rather than modified.
- Synthesized Gemini frames spread the candidate, so candidate-level fields such as `safetyRatings` are repeated on the flush frame. This predates this port, is not reasoning or signed metadata, and was left alone.

## Evidence

`tests/unit/omni-response-mask-reasoning-shape.test.js` (20 tests, offline, no provider calls). It replaces only the rule set with a deterministic rewrite of the synthetic marker `ORCHID-<digits>`, so no credential or PII shaped values appear, and keeps the real `applyResponseMasking` walker, carry, flush and sequence-number logic. It covers:

- JSON bodies for Chat (string and array content), Claude, Responses and Gemini: deep-equal to the input except the rewritten visible text, including serialized key order.
- Chat, Claude, Responses and Gemini streams delivered in 23-byte pieces, with the marker split across frames: reasoning and signature values arrive once, unchanged and in order; synthesized frames carry no reasoning, usage or finish metadata; Responses `sequence_number` stays strictly increasing; the `{response: ...}` Gemini envelope is kept.
- Absent fields stay absent; warn and off leave bytes and result object unchanged.

Mutation check: dropping `reasoning_content` or `reasoning_details` in the walker (JSON and streaming paths) made the Chat tests fail; the walker was restored afterwards. Command: `test -s internal/docs/port-reports/1073-response-mask-reasoning-shape.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-response-mask-reasoning-shape.test.js)`. Not run: whole suite, e2e, browser, Docker, live providers. The existing `tests/unit/response-masking.test.js` and `tests/unit/content-masking.test.js` cover the real rule set and were not modified.
