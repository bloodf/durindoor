# Review: OmniRoute #21336 native Claude provisional usage

**Verdict: concrete missing behavior, severity low.** An interrupted Claude stream that has no observed content still reports the `message_start` output placeholder as `completion_tokens`. The upstream PR corrects this. Nothing was ported or changed; this report is the only file committed.

## Upstream candidate

- PR: https://github.com/cheaper-inference/OmniRoute/pull/21336, `fix(usage): treat native Claude start output as provisional`
- State at read time (2026-11-27): **open**, not draft, `updated_at` 2026-11-26T16:16:14Z
- Base: `release/v3.8.55` at `16e2c146fb5b8e4ee6364fb679ffe412880757fb`
- Head: `KiaroSama/OmniRoute:fix/claude-provisional-output` at `1fe315b5ed7befb8ec835b8a283098526cba48ce`
- Files: `open-sse/utils/nativeClaudeUsage.ts` (+3/−3), `tests/unit/native-claude-accounting.test.ts` (+11), `tests/unit/native-claude-usage-tracker.test.ts` (+30/−3), `changelog.d/fixes/pending-claude-provisional-output.md` (+1)
- Change: for a non-final native Claude receipt, output is marked `unknown` whenever the receipt is not final, not only when the start count is 0. Completion is 0 unless the receipt is final. The PR body says it closes #21332 and follows #20279.

## Local state

- `origin/main`: `29490b783e`. Frozen train head: `train/2` at `32a783d76d`. `train/1` is `26ce5cc60e`. Worktree HEAD: `d27f288cb5`.
- `open-sse/utils/usageTracking.js` has blob `06408cb668` on `origin/main`, HEAD and `train/2`. `train/1` has a different blob (`0b9f306eb9`), but the same provisional logic is at its lines 488 and 503.
- DurinDoor has no `nativeClaudeUsage.ts` and no native tracker. Its equivalent is the #20279 port: `extractUsage`, the `provisionalOutputUsage` marker and `refreshProvisionalOutput` in `open-sse/utils/usageTracking.js` (lines 465–507, 484–489). Its test is `tests/unit/portor-stream-tail-20279.test.js`.

## Already present

- Output refresh from content: `refreshProvisionalOutput` raises a placeholder to `estimateOutputTokens(chars)` (`usageTracking.js:484–489`, `788–791`). It is called from `open-sse/utils/stream.js:837` and `:1928`. Probe: 80 input and a start count of 1, with 350 characters observed, gives completion 87 (chars/4). Upstream's test expects 100 under its own estimator. That is an estimator difference, not a defect.
- A final delta replaces the placeholder, including a lower or zero value: `mergeUsage` has the `prevProvisional && finalOutputReceipts.has(next)` branch. The existing test at `tests/unit/portor-stream-tail-20279.test.js` covers it.

## Gap

When a native Claude stream is interrupted after `message_start` (with `output_tokens: 1`), before any `content_block_delta` and before any `message_delta`:

1. `claudeOutputChars` stays 0.
2. `refreshProvisionalOutput(usage, 0)` sees `estimate (0) <= completion (1)` and returns the placeholder unchanged (`usageTracking.js:485–486`).
3. The final path at `stream.js:1928` keeps `completion_tokens = 1`. The record is saved as `STREAM USAGE` with `tokens: usage` (`open-sse/handlers/chatCore/streamingHandler.js:457`).

The existing test does not pin this case. Its only provisional refresh test uses observed content.

Upstream's rule is that no observed content means output is `unknown` and completion is 0.

### Reproduction

Run in a private directory with a credential-stripped environment:

```bash
W=$(mktemp -d /var/tmp/dd-21336-XXXXXX); mkdir -p $W/home $W/data $W/tmp $W/src
git archive origin/main open-sse src package.json | tar -x -C $W/src
# probe.mjs imports extractUsage/mergeUsage/refreshProvisionalOutput/isProvisionalOutput from ./open-sse/utils/usageTracking.js
cd $W/src && env -i PATH="$PATH" HOME=$W/home DATA_DIR=$W/data TMPDIR=$W/tmp timeout 300 node probe.mjs
```

Observed output:

```
start-only, no content  : {"prompt":80,"completion":1,"provisional":true}
start-only, 350 chars   : {"prompt":80,"completion":87,"provisional":true}
```

Expected under upstream's rule: the no-content line should show `completion: 0` with output unknown. The mismatch is 1 output token per affected stream, only for streams interrupted before any content.

### Possible secondary effect (trace only, not run)

`streamingHandler.js` `hasOutputTokens` (line 37) would count the placeholder as output. That would suppress the empty-stream cooldown for such a stream (the `!hasOutputTokens(usage)` check around line 415). This is a reading of the code, not a verified run.

## Overlap

- No active sync-lane owner covers this path. #21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433 and 9router #5884 and #5904 do not touch `usageTracking.js` or the stream finalizer. The #21432 match in the docs is a commit-hash prefix.
- The parity refresh row `O0070` (`2026-11-27-full-parity-refresh.md`, line 1738) reads "Unrecorded at this head; review required". This report supplies that disposition.
- No existing claim on #21336 was found.

## Suggested narrow port (not implemented)

When a provisional output count has no observed content and no final receipt, report completion 0 and output unknown, instead of the placeholder. Apply this where `refreshProvisionalOutput` is called. Add a regression for the no-content case in the style of `tests/unit/portor-stream-tail-20279.test.js`.

## Uncertainty

- The test suite was not run. The probe covers only the helper functions, not the full stream pipeline.
- I did not check how often real Anthropic `message_start` events carry `output_tokens: 1`. The upstream PR assumes a positive placeholder.
- I did not trace the usage database write beyond the `saveUsageStats` call.
- The upstream PR was read from GitHub metadata and diff. Its code was not fetched or run.
- The secondary cooldown effect is from reading the code only.
