# Tencent AI Studio Web cookie flow (#2034)

**Public-route positive flow and the no-replay repair proved offline; one strict Anthropic framing case stays red pending a shared-formatter repair outside this unit.** All responses below are synthetic network fixtures. This is not evidence of live sign-in or the vendor protocol.

The original three cases are preserved inside a describe block. They cover extension capture, the parser contract, and import refusal/update behavior, but their direct `runSession` call is not gateway evidence. The added vertical slice unloads their legacy DB/localDb mocks and uses `tests/unit/helpers/cookiePublicFlow2034.js`: real file-backed SQLite initialization/migrations, repositories, management pairing/import handlers, registry-selected executor, account selection and public route handlers. The helper contains no vendor response fixtures or provider protocol mapping. Only operator permission checks and the final external fetch boundary are replaced. Operator checks require a synthetic operator header; imports use the issued single-use pairing capability without an operator session. No global configuration or gate changed. The helper is unchanged from checkpoint `3b97d39f164`; this run carries that checkpoint's 32 cases and adds one MaxAI case (33).

## Positive evidence

- Two accounts are created through pairing/import, persisted, and bound to distinct strict proxy pools. All eight combinations of account A/B, OpenAI/Anthropic public route, and buffered/streamed mode reach the actual executor and return the fixture answer.
- The network boundary asserts exact URL, cookie, origin, request body/model mapping, stream flag, redirect refusal and dispatcher identity. No request-builder or direct executor call is counted toward these public-route claims. The transport upgrades redirects to `error`, preventing credential forwarding.
- Cookie header, cURL and HAR each go through the actual dashboard parser, candidate builder, pairing, import endpoint, persistence and public dispatch. Only the supported `sessionid` survives. This is separate from HAR expiry/chunk fixes and the public cookie batch.
- An update changes only its paired account, preserves the strict proxy, and sends the replacement credential next. Cross-target update, foreign operator, foreign origin, expired cookie metadata, unsupported chunks and unsupported localStorage are refused without changing either stored row.
- Public response, connection listing and captured logs do not expose either synthetic account credential. Import responses do not echo the pairing token.
- Explicit 401 refusal permits unpinned fallback to the other imported account/proxy. Pinned 401 and 429 do not rotate. Caller abort and a broken stream after a text frame do not replay or produce the asserted success terminators.
- No billable POST is replayed once the vendor may have accepted it. A vendor 502, a post-send connection reset, a 200 with malformed JSON, a 200 HTML sign-in-looking page, and a 200 whose body stalls past the body deadline each produce exactly one POST, on the selected account and its own strict proxy, and an error answer without a success terminal. No source-backed protocol says a 200 HTML page means the vendor did no billable work, so it is treated as an unusable accepted answer, not a refusal.
- A vendor SSE error envelope is not turned into success on either route, with one POST. OpenAI emits no `[DONE]` and no `finish_reason: "stop"`. Anthropic emits `event: error` carrying the vendor message, with no `message_delta`, `end_turn` or `message_stop`, but it is still followed by an OpenAI `data: [DONE]` line. That line has no place in the Anthropic protocol, so the strict case asserts its absence and is the one remaining failure (below).
- MaxAI regression on the same real public route: two MaxAI accounts imported through pairing/import (saved signing constants keep setup page loads off the network), each on its own strict proxy. A connection reset after the chat POST yields one POST on one account/proxy and an error; the sibling account is never dispatched. Before the repair the same case sent two POSTs, one per account.

The descriptor supports Cookie header/cURL/HAR inputs with `sessionid`, not `sessionid.0`, optional cookies or localStorage. Unsupported fields receive actionable refusal rather than being accepted. Its origin is `https://aistudio.tencent.ai`. The registry's provenance note says the pinned source forwards the Cookie header without naming the cookie or validation path: neither `sessionid` sufficiency nor `/api/user/info` validity is established here. No upstream source was acquired or read after the freeze.

## Product repair in this unit

The previous checkpoint left four strict no-replay cases red. All are one defect class: the gateway replayed a billable POST when nothing proved the vendor had not accepted it (pinned 502 and malformed 200: three POSTs via `runWithTransientBackendRetry`; post-send reset and stalled 200 body: a second POST on the sibling account). The repair reuses the existing `upstream_outcome_unknown` no-replay marker that `minimax-code` already authors and `postProcess.js` already honors. It changes no retry configuration and no other provider.

- `open-sse/executors/tencent-aistudio-web.js`: a post-send transport exception (unless its error code proves the connection never left), a vendor 502/504, and an unreadable 2xx body on the shape-conversion path answer with code `upstream_outcome_unknown` and a fixed message. `parseError` carries only that code into `errorBody`; every other answer parses as before. Explicit 401/403, 429 and the refused sign-in redirect are unchanged, so explicit-401 fallback still works.
- `open-sse/executors/maxai.js`: the chat-send `catch` tags the same code unless the error proves the request never left, with the same narrow `parseError`. Nothing else changed.
- `src/sse/handlers/chat/singleModel/postProcess.js`: for `tencent-aistudio-web` and `maxai`, that code is terminal before pin/quota/fallback handling and sets the internal `response.upstreamPartialOutput`. The outer `runWithTransientBackendRetry` already stops on that flag. No cooldown is written, because nothing proves the account failed.
- `open-sse/handlers/chatCore/nonStreamingHandler.js`: for `tencent-aistudio-web` only, a 2xx body that times out, fails to read, or fails to parse (malformed JSON, HTML page, invalid SSE, non-record JSON) marks the error result and response `upstreamPartialOutput`. Status codes, messages and logs are unchanged.

The local codes are string-equal to `MINIMAX_CODE_OUTCOME_UNKNOWN`. Both executors keep their own copy of the unsent-code check, following the existing per-module `PRE_CONNECT_ERROR_CODES` pattern. Importing `minimax-code.js` into them broke a module-mocked suite (`arch-c2311`), so they do not import it.

Dispatch and unknown-cost evidence: the repair adds no usage or dispatch event. Each attempt still records the selected account's dispatch once, and stopping the replays removes the extra dispatches. `chatCore.js` writes an explicit unknown-cost receipt only for `minimax-code` (`recordMinimaxUnknown`). An equivalent Tencent/MaxAI receipt would need `open-sse/handlers/chatCore.js`, which is outside this unit's allowed paths, and is not claimed here.

## Strengthened cases restored

- **200 HTML sign-in page:** now requires exactly one POST (previously "at most three") and the HTML error page error, on account A's cookie over proxy A. It passes after the repair.
- **Anthropic SSE error framing:** the conditional "`[DONE]` may trail the error" allowance was removed. Both routes now forbid `[DONE]`; Anthropic still requires `event: error` and forbids `message_delta`, `end_turn` and `message_stop`.
- **New MaxAI two-account mid-send reset** on the real public route (see positive evidence). Red before the repair (two POSTs), green after.

No assertion was weakened, skipped or marked as an expected failure. Case count: 33 (32 checkpoint cases + 1).

## Remaining failure and repair handoff

`does not turn a vendor SSE error into success anthropic=true` fails: the Anthropic stream is `event: error` + `data: {"type":"error",...}` + `data: [DONE]`. The trailing line comes from the shared translated-stream formatter, `formatTranslatedStreamError` in `open-sse/utils/stream.js` line 197 (`return formatClaudeSseError(claudeError) + "data: [DONE]\n\n";`). The repository's format-aware helper `buildStreamErrorBytes` in `open-sse/utils/streamHelpers.js` already emits Claude errors without `[DONE]`.

Minimal repair (not applied, because the file is outside this unit's allowed paths and is shared by every provider): make that Claude branch return `formatClaudeSseError(claudeError)` without the `[DONE]` suffix. Bounded probe: the one-line change was applied temporarily, then this suite and the 14 other unit files containing both `event: error` and `[DONE]` were run (15 files, 595 tests, all passing), and the change was reverted (`git diff open-sse/utils/stream.js` is empty). The probe does not cover the whole inventory. It needs owner approval for the shared path and full CI before it counts.

## Validation

Dependencies were not installed in this checkout. As before, the run borrowed the root and `tests/` `node_modules` of the earlier attempt's worktree (`orq-tp47m5-complete-coo-f61cc802e4ad1579`) read-only, through two untracked symlinks. Both lockfiles are byte-identical. Nothing was written through them, and both are removed after the run so the native gate installs its own dependencies. CodeGraph was not used; only bounded checkout reads. No browser, live provider, real token, protected data directory, upstream checkout, push or merge was used. No upstream source was read.

Focused command (from `tests/`; each run used a private `/var/tmp` root that was removed afterwards):

```sh
runroot=/var/tmp/tencent-2034-l3-$$
timeout 300 env -i PATH=/home/stormtrooper/.local/bin:/usr/bin:/bin LANG=C.UTF-8 CI=1 \
  HOME="$runroot/home" DATA_DIR="$runroot/data" TMPDIR="$runroot/tmp" XDG_CACHE_HOME="$runroot/cache" \
  node node_modules/vitest/vitest.mjs run unit/cookie-flow-tencent-aistudio-web-2034.test.js --maxWorkers=2
```

- Before the repair (checkpoint, 32 cases): 28 passed, 4 failed (the four replay cases).
- After the repair and test strengthening: **33 collected, 32 passed, 1 failed** (the Anthropic `[DONE]` case above), exit 1.
- Related unit files: every file in `tests/unit` that references `tencent-aistudio`, `executors/maxai`, `singleModel/postProcess`, `nonStreamingHandler`, `minimax-code` or `"maxai"` (99 files), in four batches with the same command: 98 files pass. The only failure is the Anthropic case in this suite (27+26+23+23 files; 408+459+209+819 passed).
- Root lint (`eslint src` plus the anti-slop gate) exit 0: 0 errors, and 12 warnings in unrelated dashboard files. The anti-slop step regenerates `tools/oxlint/anti-slop/index.bundle.js`; that regenerated file was restored, not committed. `git diff --check` passes.

Full CI was not run. The evidence gate stays red until the shared formatter repair above is approved and lands. This must not be reported as a passing gate or as merge eligibility.
