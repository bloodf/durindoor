# Independent verification: OmniRoute #21336 Claude provisional usage

**Disposition: confirmed, conditional defect; severity low.** On both requested trees, a positive Claude `message_start` output count remains in usage when the stream has produced no content and no final usage receipt. The interruption snapshot then treats that provisional count as valid output. The impact is one or more possibly unproduced output tokens in interrupted requests; an empty completion may also avoid the existing empty-stream cooldown classification. The code path is verified; the frequency of positive start counts in real streams and provider acceptance are unknown.

## Revisions and scope

- Report under review: `87db55c5df00851ef98a1351be848bd2dac65d03`, read with `git show 87db55c5df`.
- Exact current main: `29490b783e83176d4d6a4162f76ee3dc79db66ea` (`origin/main`).
- Exact frozen train: `32a783d76d45d90bf0517015442f43fadd96106c` (`train/2`). This was verified by SHA, not inferred from a branch label.
- The provisional marker, `extractUsage`, `refreshProvisionalOutput`, and `mergeUsage` logic are the same in both trees. Relevant files include `open-sse/utils/usageTracking.js`, `open-sse/utils/stream.js`, `open-sse/handlers/chatCore/streamingHandler.js`, and `tests/unit/portor-stream-tail-20279.test.js`.
- The upstream `nativeClaudeUsage.ts` tracker is absent locally. That implementation detail is not itself a defect: local Claude accounting already has equivalent provisional tracking. The confirmed issue is the no-content behavior of that existing local implementation.

## Reproduction and trace

I archived only `open-sse`, `src`, and `package.json` from the exact `origin/main` SHA into a fresh `/var/tmp` directory, then ran a helper probe with isolated `HOME`, `DATA_DIR`, and `TMPDIR`, an empty inherited environment except `PATH`, and a 300-second timeout. No dependency install, credentials, services, gateway, live provider, or `~/.9router` access was used.

Exact probe command shape:

```sh
RUN_DIR=$(mktemp -d /var/tmp/dd-21336-verify-XXXXXX)
mkdir -p "$RUN_DIR/home" "$RUN_DIR/data" "$RUN_DIR/tmp" "$RUN_DIR/src"
git archive 29490b783e83176d4d6a4162f76ee3dc79db66ea open-sse src package.json | tar -x -C "$RUN_DIR/src"
cat > "$RUN_DIR/src/probe.mjs" <<'EOF'
import { extractUsage, refreshProvisionalOutput, isProvisionalOutput, mergeUsage } from './open-sse/utils/usageTracking.js';
const start = extractUsage({ type: 'message_start', message: { usage: { input_tokens: 80, output_tokens: 1 } } });
const empty = refreshProvisionalOutput(start, 0);
const content = refreshProvisionalOutput(start, 350);
const finalZero = mergeUsage(start, extractUsage({ type: 'message_delta', usage: { output_tokens: 0 } }));
console.log(JSON.stringify({ empty: { usage: empty, provisional: isProvisionalOutput(empty) }, content, finalZero }));
EOF
(cd "$RUN_DIR/src" && env -i PATH="$PATH" HOME="$RUN_DIR/home" DATA_DIR="$RUN_DIR/data" TMPDIR="$RUN_DIR/tmp" timeout 300 node probe.mjs)
rm -rf "$RUN_DIR"
```

The probe passed through these cases: start receipt `{input_tokens:80, output_tokens:1}`, refresh with zero observed chars, refresh with 350 chars, and final `message_delta` output of zero. Output (apart from Node's module-type warning):

```json
{"empty":{"usage":{"prompt_tokens":80,"completion_tokens":1},"provisional":true},"content":{"prompt_tokens":80,"completion_tokens":87},"finalZero":{"prompt_tokens":80,"completion_tokens":0}}
```

The no-content result confirms the candidate. The content result and final-zero result show that observed text is estimated and a final receipt, including zero, replaces the placeholder; those behaviors are not the finding.

Caller and effect trace:

1. `extractUsage(message_start)` marks positive output usage in a `WeakSet` as provisional.
2. In `createSSEStream`, Claude output characters increment only for text, thinking, or partial JSON deltas. With no such chunks the count remains zero.
3. Both interruption snapshot (`getStreamSnapshot`) and normal transform finalization call `refreshProvisionalOutput`. It estimates zero and returns the original placeholder because `0 <= completion_tokens`.
4. `hasValidUsage` accepts the positive count. `onStreamAbandoned` persists that snapshot via both request details and `saveUsageStats` as cancelled stream usage. In the completion path, `hasOutputTokens` sees the same positive value and the empty-stream callback condition is false.

Thus the observed count can enter recorded usage and alter empty-stream classification. The test file already covers refreshing from observed content and replacement by a lower final receipt, but not a start-only provisional snapshot. The helper probe directly reproduces the accounting result; the cooldown consequence is a static trace through the caller, not a full pipeline execution.

## Train comparison and ownership

`git diff 29490b783e83176d4d6a4162f76ee3dc79db66ea 32a783d76d45d90bf0517015442f43fadd96106c -- open-sse/utils/usageTracking.js open-sse/handlers/chatCore/streamingHandler.js tests/unit/portor-stream-tail-20279.test.js` is empty. The stream file has unrelated train changes, but the relevant counter, snapshot and finalization logic remains the same. Therefore this is present on the frozen train as well as current main.

Repo-local report/census searches found no existing disposition or ownership claim for #21336. The prior candidate report's sync-lane inventory likewise names no active sync owner touching `usageTracking.js` or the stream finalizer. Auth-owned #2266 and #2289 are unrelated (auth/provider-auth paths); this finding belongs with the sync-owned shared usage/refresh path. This check is limited to repository records and the supplied report; no external issue or PR listing was performed.

## Limits and conclusion

The no-content behavior is a defect conditional on `message_start` carrying a positive placeholder: it may account a tiny amount of output that was never observed. Severity is low because the demonstrated overcount is one token for the candidate fixture and only affects streams interrupted before content/final usage. The possible cooldown effect has greater operational consequence but remains a trace, not a reproduced integration outcome. No evidence was gathered about how often real Anthropic streams carry a positive provisional value, nor about live-provider acceptance. No product change or issue was created.
