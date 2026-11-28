# Review: OmniRoute #21335 — preserve Responses stream receipt totals

Disposition: **CONCRETE GAP (low severity), narrow.** Positive receipt totals are already preserved; the one missing behavior is the non-positive-total rule on the translated Chat wire. No port or change is made here.

## Revisions and ownership

- Upstream PR: [cheaper-inference/OmniRoute#21335](https://github.com/cheaper-inference/OmniRoute/pull/21335) "fix(usage): preserve Responses stream receipt totals". State read 2026-11-27: **open**, not draft, `updated_at` 2026-11-26T16:21:46Z.
- Upstream base `16e2c146fb5b8e4ee6364fb679ffe412880757fb` (`release/v3.8.55`); head `a3ccdf764a10e214e8d8d0e44367fc32b78c17f8` (2 commits: `4801a9ef6d` fix, `a3ccdf764a` refactor). 8 files, +146/−20. Closes upstream #21334.
- DurinDoor `origin/main` `29490b783e83176d4d6a4162f76ee3dc79db66ea`; frozen train head `d27f288cb59be43a4c1068ac314076cde0297413` (`origin/main` is its ancestor). The four relevant files (`open-sse/translator/response/openai-responses.js`, `open-sse/translator/concerns/usage.js`, `open-sse/utils/usageTracking.js`, `open-sse/utils/stream.js` aside from terminal-margin edits) are identical between main and head except `stream.js`, which only adds terminal-margin projection.
- Overlap: none with the sync-lane claims (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433, 9router #5884/#5904). #5904 touches the same stream-usage area; this review does not port or claim it. Existing `2026-11-27-full-parity-refresh.md` row O0071 lists #21335 as "Unrecorded at this head; review required"; this report fills that row.
- Layout note: upstream paths are `.ts`; DurinDoor equivalents are `.js` at the same relative paths (no `reportedCounter.ts` or `streamAccountingUsage.ts` exists).

## What upstream changes

1. Translator (`openai-responses.ts` Responses→Chat): `total_tokens` uses a positive receipt total, falling back to input+output only when the receipt is missing, zero, negative or non-numeric (`positiveReportedTotal`, which uses `firstReportedCounter` requiring `value >= 0`).
2. Stream completion summary: uses the receipt total rather than `prompt + completion`.
3. Test: `tests/unit/stream-responses-receipt-total.test.ts` expects, for translate and passthrough, wire and summary total 109 for complete frame, EOF with `\n`, and bare EOF; and 89 for missing, zero, negative and string totals.

## Local behavior (DurinDoor, `origin/main` and head give identical results)

| Case (translate: Responses provider → Chat client, buffered) | Local wire `total_tokens` | Evidence |
|---|---|---|
| receipt 109, complete frame | 2109 (= 109 + client buffer 2000; prompt 2080) | already preserved |
| receipt 109, EOF with `\n` | 2109 | already preserved |
| receipt 109, bare data at EOF | 109 (prompt 80; **no buffer, no cost**) | total preserved; buffer/cost skipped — see adjacent note |
| receipt missing / 0 / `"109"` | 2089 (= component 89 + buffer) | matches upstream rule |
| receipt **−1** | **1999** (= −1 + buffer) | **wrong** — should be component 89 + buffer = 2089 |
| passthrough (Responses→Responses) 109 / 0 / −1 / missing | 109 / 0 / −1 / null (raw upstream receipt) | forwarded as received; by design |

Mechanism of the gap:
- `open-sse/translator/concerns/usage.js:20` `const n = (v) => isNumber(v) ? v : 0;` and `:192` `total_tokens: hasExclusiveCache ? … : n(raw.total_tokens) || inputTokens + outputTokens` accept any finite number, including −1 (truthy), so the translator emits −1.
- `open-sse/translator/response/openai-responses.js:1100` `totalTokens: normalized.total_tokens` carries −1 into `buildUsage`.
- `open-sse/utils/usageTracking.js:85-88` `addBufferToUsage` then adds the buffer to −1, giving 1999 on the wire.
- DurinDoor's own canonicalizer already treats non-positive explicit totals as absent (`open-sse/utils/usageTracking.js:344`, `explicitTotal > 0 ? … : componentTotal`), so the wire and canonical rule disagree for negatives. Upstream's rule (`value >= 0`, then zero → undefined) and its test expectation of 89 match the canonical rule, not the wire.

## Reproduction (private, no product run beyond source modules)

- Source snapshots: `git archive origin/main` and `git archive HEAD` of `open-sse src package.json` into `/var/tmp/dd-review-21335/{main,head}`; `node_modules` read-only symlink to the main checkout's dependencies.
- Alias hook maps `@/lib/usageDb.js` to a stub; `env -i` with private `HOME`, `DATA_DIR`, `TMPDIR` under `/var/tmp/dd-review-21335`; Node v24.22.3; single run under 120 s.
- Probe: `createSSEStream({mode:"translate", sourceFormat: OPENAI, targetFormat: OPENAI_RESPONSES, provider:"codex", …})` fed `response.created`, a text delta, and `response.completed` with `usage {input 80, output 9, total T}`; collected wire `usage` objects. Command shape: `env -i PATH=/usr/bin:/bin HOME=… DATA_DIR=… TMPDIR=… FX_ROOT=<tree> FX_STUB=<stub> node --no-warnings --import reg.mjs probe.mjs`.

## Adjacent observations (not claimed as defects of #21335)

- Bare EOF on the translated path bypasses `addBufferToUsage` and `enrichUsageCost` (prompt 80, no cost) while framed completions do not. Same behavior on main and head. This is buffer/cost accounting, outside the receipt-total rule; needs its own review.
- `open-sse/translator/response/openai-responses-nonstream.js:32` builds `total_tokens: inputTotal + outputTokens` and ignores the receipt total. Upstream #21335 does not touch the non-stream path, so this is out of scope here.
- Request-log/usage-DB totals were **not verified**: the stream path did not write request logs to the stub in this probe, so the logged total for the −1 case is unconfirmed.

## Verdict and severity

- Already present: positive receipt totals (109) on the translated wire for complete, `\n`-terminated and bare EOF frames, and on passthrough, through `toResponsesUsage`, `mergeUsage` (`Math.max`), and `canonicalizeUsage` (`usageTracking.js:344`).
- Concrete missing behavior: **low**. A negative upstream `total_tokens` on a translated Responses→Chat stream yields a client-visible total of 1999 instead of 2089 (buffered component sum). Missing, zero and string totals already match upstream's expectation.
- Not implemented here. A minimal fix would mirror upstream's non-negative/positive guard at `usage.js:192` (or at `openai-responses.js:1100`); it touches the stream-usage area that the #5904 sync-lane review covers, so it should be coordinated with that lane before porting.
