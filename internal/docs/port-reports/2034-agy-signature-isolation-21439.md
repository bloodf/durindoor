# Antigravity signature isolation and generated tool-call IDs (#2034)

Follow-up to `2034-agy-signature-scope-21439-3366.md` (commit `a269ea1066`). That
unit's account- and model-scoped capture for the nonstream body and forced
SSE-to-JSON is kept as it was, and its 20-case suite is unchanged. The two Gemini
replay suites (`cpa-gemini-replay-parity`, `cpa-gemini-replay-retained`) are
also unchanged.

## Source

| Project | Pull request | Head used | Files read |
| --- | --- | --- | --- |
| diegosouzapw/OmniRoute (MIT) | 21439 | `35e01594ad13a7ffc0cd44d6598f6d862dfcff9f` | `open-sse/executors/antigravity/sseCollect.ts`, `open-sse/translator/request/openai-to-gemini.ts`, `tests/unit/translator-tool-result-json-passthrough.test.ts` |

The head was read through the GitHub API and matched the pinned SHA. The upstream
correction `cd8be126278` (`1072-1073-nov27-omni-21439-antigravity-signature-scope.md`)
is not in any local clone. Its findings were checked against current source.

## Reconciling the earlier report

- **Already present before `a269ea1066` (#2518).** The OpenAI-facing nonstream
  body already carried a provider signature to the client. It used the signature
  transport ID, including a pending signature from a preceding thinking-only part
  (`1073-gemini-nonstream-pending-thought-signature-2518.md`). Item 1 of the
  earlier report reads as if nonstream had no persistence. That is too broad.
  Only the store write was missing, which matters for clients that drop the
  transport ID.
- **Added by `a269ea1066`.** The selected-account, model-family store write for
  the nonstream body, forced SSE-to-JSON and the native Gemini collector, with
  no bare-ID row.
- **Newly proved here (gaps that remained after `a269ea1066`).** These are
  isolation and ID problems, not persistence problems. Each is listed below.

## Fixed

1. **Bare-alias fallback in the executor.** `AntigravityExecutor` read
   `getAccountThoughtSignature(Sync) || getGeminiThoughtSignature(Sync)`. The
   session API checks `<session>:<id>`, then the bare `<id>` alias. A streamed
   capture writes that alias for any reader. So account B, or a new session,
   could replay account A's signature, or a legacy bare row, by reusing a tool ID.
   Both executor paths now call `getProvenThoughtSignature(Sync)`: the async
   cold-cache restore in `execute()` and the sync backfill in `transformRequest()`.
   That reader accepts only:
   - the account and family row;
   - the exact client-session row, unless another account captured it;
   - a bare alias that records this same account.

   It never reads a row of unknown provenance. The sync path used to look up the
   hashed wire session ID, which never matched a write key. It now uses the same
   client session as the writer and the async path.
2. **Streamed Antigravity captures had no owner.** For `antigravity` and `agy`,
   `gemini-to-openai.js` now records the selected account (`signatureNamespace`)
   on the session row and the alias. The capture stays session-scoped, as the
   earlier suite requires, and writes no account-scoped row. The session API
   (`getGeminiThoughtSignature(Sync)`) and the keyed API bare fallback skip
   account-bound rows. Rows written without an account keep the global
   session-API contract for direct Gemini routes, so those suites are unchanged.
3. **Same-millisecond ID collisions.** The generated fallbacks were
   `${name}_${Date.now()}_${index}` (streaming and forced SSE-to-JSON) and
   `call_${name}_${Date.now()}_${index}` (nonstream body). They collided across
   simultaneous responses, so one account's second response overwrote the first
   one's signature row. Both paths now use `generatedGeminiToolCallId`, whose middle field is 20
   random digits from `crypto.randomUUID`. 21439 uses `${name}-${randomUUID()}`.
   DurinDoor keeps the `<name>_<digits>_<index>` shape so the request translator
   can still recover names for orphaned results
   (`openai-to-gemini.js`, `/^(.+?)[-_]\d{10,}[-_]\d+$/`). Valid upstream IDs are
   unchanged. Encoded IDs stay inside the Anthropic `tool_use` alphabet.

## Equivalent, not changed

- **Media function-response ordering.** At this head, 21439 splits a tool-response
  turn into the media parts followed by every `functionResponse`. Locally,
  `normalizeGeminiContents` already moves the `functionResponse` parts to the end
  of a mixed user turn, in order. Inline media already becomes Gemini media parts,
  and #5529 (`wrapFunctionResult`) already keeps a single `result` envelope.
  Contracts pin the OpenAI case: three calls, interleaved image and text, a JSON
  envelope, nothing dropped. They also pin the Anthropic `tool_result` case. Both
  pass on the base. No product change was needed.
- **Embedded transport round trip.** A client-held `agsig1_` ID still replays its
  own signature after the store is cleared.

## Not ported (fork policy, unchanged)

The signed-sibling inheritance, the `skip_thought_signature_validator`
sentinel, `ANTIGRAVITY_ALLOW_SIGNATURE_BYPASS` and the `context` mode stay
unported, as recorded in the earlier report. This change adds no bypass, context
flag or source-equivalence claim.

## Remaining gap outside these paths (reported, not changed)

The request translators read the session API before the executor runs:

- `open-sse/translator/request/openai-to-gemini.js:282`, in `openaiToGeminiBase`.
  `openaiToAntigravityRequest` calls `openaiToGeminiCLIRequest(model, body, stream)`
  without credentials, so `sessionId` is null and this is a bare-only read.
- `open-sse/translator/request/openai-to-gemini.js:574`, in
  `wrapInCloudCodeEnvelopeForClaude`.

Account-bound rows are now invisible to both reads, so account A's captures cannot
reach account B through them. A **legacy or provenance-less** bare row is still
global under the session-API contract. Those translators place it on the part,
and the executor keeps explicit signatures. A local probe through the real
gateway (`handleChatCore`, account B, a new session, a legacy bare row) replayed
the legacy signature on the OpenAI and Anthropic endpoints. Native passthrough
and the executor do not. Closing this means passing the selected account and
session into those two reads, or using `getProvenThoughtSignatureSync` for
Antigravity. That is a translator change outside this unit.

## Contracts

`tests/unit/antigravity-signature-isolation-completion.test.js` has 15 cases. It uses the
real `handleChatCore`, translators and `AntigravityExecutor`, with only the
outbound transport mocked. The scenarios use two synthetic accounts, client
sessions, the same tool ID, the same model family, warm and cold caches, and a
frozen `Date.now` across simultaneous requests. Nine cases fail with the four
product files reverted to the base:

- cross-account replay on the OpenAI and Anthropic endpoints, in the same or a new
  session, warm and cold;
- shared-session combo leakage;
- legacy and foreign rows on the native path;
- an unknown reader;
- ID collisions on the nonstream, streaming and forced SSE-to-JSON paths, and
  within one account.

The other six are equivalence contracts.
