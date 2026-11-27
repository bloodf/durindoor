# Antigravity signature scope and empty-turn parity — #2034

Base: `6affc064d889273ebded78cb307f463ecbe05567`, which already contains the
Gemini replay unit (`69fdd78e537a0a666bc30ca2af98a7a4c58b1412`,
`4b1737339975876d3b9c01cf5b41d13da14a4749`). Its fixes and suites are unchanged.

> **Correction.** Item 1 below is too broad. Before this unit, the OpenAI nonstream
> body already gave the client the signature through the transport ID (#2518, see
> `1073-gemini-nonstream-pending-thought-signature-2518.md`). Only the store write
> was missing. The "fallback-ID change does not apply" note is superseded: the
> same-millisecond collision was real, and the executor's bare-alias fallback still
> crossed accounts. See `2034-agy-signature-isolation-21439.md`.

## Sources (MIT, read-only, both pull requests open)

| Project | Pull request | Head used | Files read |
| --- | --- | --- | --- |
| diegosouzapw/OmniRoute | 21439 | `35e01594ad13a7ffc0cd44d6598f6d862dfcff9f` | `open-sse/executors/antigravity.ts`, `open-sse/executors/antigravity/sseCollect.ts`, `open-sse/translator/helpers/geminiTrailingModelTurn.ts`, `open-sse/translator/request/openai-to-gemini.ts`, `tests/unit/antigravity-thought-signature-and-gemini4-21395.test.ts` |
| decolua/9router | 3366 | `829f2a88ea2069d2455ef0004bf29e70e793b3c8` | `open-sse/executors/antigravity.js` |

Both heads were fetched by pull-request ref and matched the pinned SHAs. The
upstream corroboration report (`4c03663223c416fa513846b4a4c0da1169cbc683`) was
not present in any local clone and was not fetched; its two findings were checked
against current source instead. Nothing here verifies live provider behavior.

## Path comparison

DurinDoor does not share OmniRoute's executor structure. OmniRoute collects
non-streaming Antigravity output inside its executor (`sseCollect.ts`). Here the
executor returns the upstream response and `chatCore` consumes it through:

- the JSON body in `translateNonStreamingResponse` (`nonStreamingHandler.js`);
- forced SSE-to-JSON (`handleForcedSSEToJson` → `parseGeminiSSEToOpenAIResponse`);
- the streaming translator (`gemini-to-openai.js`, session-scoped store);
- native Antigravity passthrough (client format `antigravity`), which reaches
  `AntigravityExecutor.transformRequest` without the OpenAI translator.

## Fixed (source-backed gaps)

1. **Nonstream JSON did not persist signatures.** The upstream finding holds:
   the body already put the signature in the transport tool-call ID but did not
   write the store. The Gemini-family branch now writes for Antigravity targets
   when a signed `functionCall` with a string name is emitted. It uses the raw ID
   that the client receives. This adapts the `sseCollect.ts` hunk in 21439.
2. **The forced SSE-to-JSON path wrote unscoped rows.** The streaming translator
   ran with no session or model there. Each signed call got a bare-ID row with no
   model family, readable from any account. For Antigravity targets, that path now
   uses the account scope.
3. **Scope.** 21439 namespaces by account and model (`scopeGeminiThoughtSignatureNamespace`)
   and skips the `"unknown"` account. The local store gains `accountSignatureScope`,
   `storeAccountThoughtSignature` and `getAccountThoughtSignature(Sync)`. The key is
   `account.<connectionId>.<family>:<toolCallId>`, and no bare alias is written.
   Unknown accounts or families write nothing. The executor reads this scope first,
   then the existing session store. This covers both the async cold-cache restore in
   `execute()` and the sync backfill in `transformRequest()`, for translated and
   native contents.
4. **Pending signature.** The JSON body already cleared the held signature after
   each call. That is equivalent. A signature on a terminal or text part with no
   following call writes nothing. Error bodies are rejected before translation.
5. **Trailing model turns.** 21439 adds Gemini 4 and strips a `provider/` prefix in
   its helper. The local Vertex executor already did both inline. Native
   Antigravity passthrough had no exclusion, so `stripTrailingModelTurns` now drops
   trailing `model` turns for Gemini 3/4 and `gemini-pro-agent`, keeping at least
   one turn. It does not add a user turn, matching the existing native rule that
   passthrough must not fabricate turns. The translated path already ends with a
   user turn (`normalizeGeminiContents`), so stripping does nothing there and
   nothing is appended twice. The regular expression now lives in
   `translator/concerns/geminiTrailingModelTurn.js` and is shared with Vertex, with
   the same behavior. Image models are unchanged.

## Equivalent, not changed

- **9router 3366** was already ported in `747a1eef3c` (`normalizeFilteredContents`).
  It drops only turns that thought filtering emptied and merges the resulting
  adjacent same-role turns. Wholly empty histories get a local 400 in `execute()`
  before any network call. The new contracts pin thought-only turns, retained user
  text and tool turns, and refusal before dispatch.
- **Streaming capture** stays session-scoped, with existing replay unchanged and asserted.
- **Cancellation, usage and partial output.** An aborted request writes nothing.
  Usage still reaches the client. The existing no-replay-after-partial-output
  suites pass unchanged.

## Not ported (fork policy)

The OmniRoute `openai-to-gemini.ts` hunks belong to its signature-bypass design.
That includes the `skip_thought_signature_validator` sentinel,
`ANTIGRAVITY_ALLOW_SIGNATURE_BYPASS`, and the `context` mode for thinking Gemini
models, now extended to `gemini-4`. DurinDoor has none of these. It never emits
the sentinel and keeps native calls with route-specific synthetic signatures.
`1073-antigravity-signatureless-history-2927.md` already declined the `context`
projection on ownership and ordering grounds. So:

- No sentinel default is added. No explicit opt-in exists to preserve.
- Unsigned parallel siblings of a signed call stay native, with matching native
  `functionResponse`s in the original ID/name order. They keep the fork's
  existing default and never inherit the sibling's signature.
- The fallback-ID change from `Date.now()` to `randomUUID()` in `sseCollect.ts`
  does not apply. The local JSON body ID includes the call index.

No registry, catalog, model ID or capability changes were made.

## Contracts

`tests/unit/antigravity-signature-scope-21439-3366.test.js` has 20 cases. It uses
the real `handleChatCore`, translators and `AntigravityExecutor`, and mocks only the
outbound transport, with synthetic credentials. Nine cases fail with the four
product files reverted to the base: nonstream capture and replay, split
signatures, account and family isolation, cold-cache restore, the Anthropic
endpoint, forced SSE-to-JSON on both endpoints, forced unknown account, and native
Gemini 4 trailing-turn stripping. The other cases are equivalence contracts.
