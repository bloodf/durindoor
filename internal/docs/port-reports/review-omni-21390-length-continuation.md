# Review: OmniRoute #21390 — bounded continuation after a genuine length finish

Review only. No implementation, no PR, issue or label changes. Verdict is from Git objects and `gh api` reads; nothing was executed.

## Upstream identity

Read with read-only `gh api` on 2026-11-27.

- PR: [cheaper-inference/OmniRoute#21390](https://github.com/cheaper-inference/OmniRoute/pull/21390), "feat(sse): bounded continuation after a genuine length finish (opt-in)".
- State: **open**, not draft, not merged. Last updated 2026-11-27T02:01:13Z.
- Base: `release/v3.8.55` @ `9671192011beb2d7f83979f40be488c5da8772b9`.
- Head: `feat/sse-length-continuation` @ `ca3be78da68cc03cf05c2ac48ec54217471f0284`. Three commits, 11 files, +1649/−68.
- The refresh report already records the same head at [`2026-11-27-full-parity-refresh.md:1692`](2026-11-27-full-parity-refresh.md) (row O0024).

## Local baselines

- `origin/main`: `29490b783e83176d4d6a4162f76ee3dc79db66ea`.
- Frozen train head `orq/tp3r51/integration`: `d27f288cb59be43a4c1068ac314076cde0297413`. It descends from `origin/main`. Its nine-file delta under `open-sse/` changes unrelated config, compression, and non-streaming code, plus finish-chunk handling in `open-sse/utils/stream.js`. It adds no length continuation.

## What the PR adds

- `open-sse/services/streamLengthContinuation.ts` (791 lines, new) plus wiring in `open-sse/handlers/chatCore/executeProviderRequest.ts` (+82/−62).
- Flag `STREAM_LENGTH_CONTINUATION_ENABLED`, default `false`.
- With the flag on, a single-choice Chat Completions SSE stream that already delivered text and ends with `finish_reason: "length"` has its terminal held. It makes one extra request through the same executor, prefilled with the delivered text. Limits: 2048 extra tokens, 30 s, 64 KiB held. The client limit is never extended. Any failure, or any splice that cannot be proven, releases the original frames unchanged.
- The PR's own code depends on upstream modules that DurinDoor does not have: `open-sse/services/streamRecovery.ts` (`makeContinuationBody`, `trimContinuationOverlap`), `open-sse/utils/registeredFeatureFlag.ts`, and `STREAM_RECOVERY` in `open-sse/config/constants.ts`. Upstream's `executeProviderRequest.ts` also uses a recoverable-stream wrapper (`createRecoverableStream`).

## DurinDoor current behavior

- A genuine length finish is forwarded to the client. `open-sse/utils/stream.js:557-564` only detects the frame (`isOpenAITokenLimitFrame`) to record summary and usage. `open-sse/utils/stream.js:1076` uses the same detection. I found no code that withholds that terminal or re-sends the request.
- The single `executor.execute` call site in `open-sse/handlers/chatCore.js:1496` has no reopen or continuation path.
- Absence checks, run at `origin/main` and at the train head:

  ```bash
  git grep -n -i -E "length.continu|createRecoverableStream|makeContinuationBody|trimContinuationOverlap|continueMidStream|STREAM_RECOVERY|streamRecoveryEnabled|registeredFeatureFlag|featureFlagDefinitions" origin/main HEAD -- open-sse src
  ```

  Result: no matches for this feature. The word "continuation" appears only for unrelated provider tokens (Gemini, ChatGPT, Antigravity, Kiro).
- Existing tests pin only zero-content `length` terminals: `tests/unit/omni-token-limit-empty-terminal.test.js:127,186` and `tests/unit/empty-stream-terminal-1073.test.js:88`. Upstream also declines to continue a length with no delivered text (its test "a length with no delivered text is not continued"), so the two do not conflict.

## Ownership overlap

- The sync lane owns #21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433, plus 9router #5884 and #5904. None of them is #21390, and no existing port report claims #21390. This review does not claim any of the owned PRs.
- Adjacent work: upstream #21388 (O0026 in the refresh report) also holds a stream back before committing a target. Its code overlap with this PR was not checked, only the title.

## Verdict

**Missing opt-in feature, not a defect.** Severity: low.

- DurinDoor's current contract forwards a genuine `length` finish with `finish_reason: "length"` and no second request. Upstream keeps that same behavior when the flag is off.
- I found no decision record that rejects this feature, and no evidence that the absence is a bug.
- Porting is not a small parity fix. It needs the mid-stream recovery layer first (the helpers, the recoverable stream wrapper, and the `STREAM_RECOVERY` config), plus a feature-flag resolver. DurinDoor has neither. A port would be a separate owner decision.
- Recommendation: do not port now. Keep it on the optional backlog. If it is pursued, first port the recovery prerequisites with their own tests.

## Uncertainty

- No tests were run, upstream or local. The PR's own claims (27 + 4 tests, 276/276 sibling tests) were not reproduced.
- I did not audit the 791-line upstream module for safety defects. The verdict does not depend on that, because the feature is absent.
- Only the `stream.js` lines listed above were read. Some other downstream handler could in principle hold length terminals. None turned up in the absence grep.
