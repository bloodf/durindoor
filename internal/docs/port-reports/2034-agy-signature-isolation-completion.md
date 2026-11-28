# Antigravity signature isolation and generated tool-call IDs (#2034)

Follow-up to `2034-agy-signature-scope-21439-3366.md` (commit `a269ea1066`).
Its item 1 is too broad, as the reconciliation below explains; that report is left
as written and this one supersedes its "fallback-ID change does not apply" note. That
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
  #2518 already persisted OpenAI nonstream signatures; this work makes no
  claim of a general OpenAI nonstream persistence gap.
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

## Retry correction and expanded paths

Gate 2 at `77aeb39c7e2884b73437a4af1640be47508111a5` preserved 80 passing
assertions and exposed a failed Claude streaming cold replay (line 184). The direct
`gemini-to-claude.js` translator wrote a connection-keyed row, while the executor
looked for account/session provenance. Antigravity captures there now use the
same account-bound session writer as the OpenAI stream; direct Gemini keyed
writes retain their existing contract. Its missing-ID fallback now uses the
shared UUID generator too.

The earlier candidate also documented a real remaining gateway leak:
`openai-to-gemini.js` attached a legacy bare alias at the request translation
stage before executor validation. Both Antigravity paths now use the proven
reader: the Gemini CLI conversion receives explicit account/session scope and
the Claude envelope uses that scope directly. Embedded signatures still win.
These two translator files are essential scope expansion: executor-only checks
cannot distinguish an already attached legacy alias from a client signature.
Two additional mocked gateway cases preserve the legacy scenario on OpenAI and
Claude endpoints with warm and cold caches, while retaining direct Gemini reads.

## Gate 3 retry: cold-persistence race and the family fixture

Gate 3 at `22c352f6acdf2b21435a4eba8ebe76973d0b1ef6` first failed the same cold
replay (line 184), then passed 83 on retry. Its full check also failed
`antigravity-thought-signature-family.test.js:102` on both runs.

**Race, diagnosed.** The first capture in a worker runs before that process has
opened the SQLite adapter, so `writeSignature` persisted it through the async
`signatureKv.set`. The evidence runs five suites in parallel workers on one fresh
`DATA_DIR`. While another worker migrated the file, this worker's adapter open
threw `SqliteError: database is locked` from `migrate.js` (stack captured locally).
The `.catch(() => {})` dropped the row. `getAdapter()` clears its failed init, so
the next open succeeded, and the cold read found nothing. Whichever streaming case
ran first lost its row (OpenAI or Claude), so the failure moved between runs.
With a fresh private `DATA_DIR` per run, it reproduced in 6 of 8 local runs. It
never reproduced when the suite ran alone.

**Fix (`thoughtSignatureStore.js`).** Async writes are now write-behind entries,
tracked per key until SQLite confirms them. A sync write that throws keeps its
rows in the same way. Every persisted (cold) read goes through `readPersisted`.
It awaits the key's in-flight write and retries a failed write once, at the moment
of the read. If SQLite still cannot take the row, the read returns the written
row, which goes through the same provenance, family and expiry checks as a
persisted row. Nothing sleeps. The buffer is capped like the RAM cache, and
`clearThoughtSignatures()` clears it too. A new case per endpoint holds the
adapter "not open, open fails with database is locked" during the capture. It
checks that the other account still gets nothing cold, that the capturing account
replays cold, and that SQLite then holds the account-bound row. Both cases fail
without the store change, at the gate's assertion.

**Family fixture, migrated.** The old positive case wrote an ownerless global row
(`session = null`, no account) and expected `openaiToAntigravityRequest` to
replay it with no credentials. #2034 forbids exactly that: an Antigravity replay
must not borrow a row of unknown provenance. The positive same-family scenario
now stores the row under an explicit account and client session. It replays with
matching credentials and still expects `GEMINI_SIG`. A new case covers the
negatives: the ownerless row, with or without credentials, and another account's
row in the same session all get the default signature. The direct Gemini session
API still reads the ownerless row. Cross-family cases are byte-identical.

Local runs used private `/var/tmp` installs, `env -i` with
`HOME`/`DATA_DIR`/`TMPDIR`/caches/pnpm store all private, and no borrowed
dependency graph. The 20-case and two Gemini replay suites are unchanged.

## Contracts

`tests/unit/antigravity-signature-isolation-completion.test.js` has 19 cases.
There are 17 from the earlier attempts plus the two locked-open cold-persistence cases. It uses the
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
