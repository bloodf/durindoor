Verdict: CHANGES
PR: https://github.com/bloodf/durindoor/pull/2716 ("perf(stream): decode SSE frames once for observing stages"), base mac/arch-backhalf-part3, stacked on #2705
Head: 47876e55f5fa049e27ce7b036825e691d1fdeb08
Merge-base with origin/main: c0ab5d52df1a4c9f8cf2bfa26c16cbe0ac845492 (origin/main == c0ab5d52df)
PR's own diff vs #2705 head ed59fcc834: 9 files, +427/-60 (open-sse/utils/{sseFrames,streamHandler,streamTerminal,emptyStreamTerminal}.js, open-sse/handlers/chatCore/{proxyTimeline,proxyTimelineFrame,timelineFrameObserver}.js, tests/unit/s2302.test.js, tests/unit/review-x-sse-final.test.js)

Merge and inventory
- git show --remerge-diff 47876e55f5 -> exit 0, header only, no conflict hunks: the merge of #2705 into the PR head is conflict-free.
- git show --remerge-diff 78569b45b -> exit 0, header only: the earlier merge of #2705 into the PR branch is conflict-free too, so main's behaviour and the PR's fix both survive.
- git diff --stat 78569b45b 47876e55f5 -> exit 0, 184 files, +46367/-5985; that is main advancing (78569b45b's merge-base with main was 795f37e414), not PR edits.
- git diff --stat c0ab5d52df 47876e55f5 -- tests/e2e/storybook-surfaces.json -> exit 0, 1 file, +207/-149. Every changed line is a sourceSha256/sourceHashes value and each matches `git show 47876e55f5:<file> | sha256sum` for the head's own source files; no approvedClassification or other approval field changed (null in both trees). The inventory is regenerated for the merged tree and no approval was dropped.
- tests/__baseline__/known-fails.txt: 0 bytes at head, not touched by the PR.
- tests/unit/review-x-sse-final.test.js: the only edit removes "utils/emptyStreamTerminal.js" from the ALLOWED hand-splitter list and adds it to the "reads fields through sseFrames" assertion. The exact hand-splitter set assertion is kept; no assertion was removed or weakened.

Commands (private HOME/DATA_DIR/TMPDIR/XDG_CACHE_HOME under /var/tmp, env -i PATH, timeout -k 5s 290s, detached worktrees at 47876e55f5 and ed59fcc834 with symlinked node_modules)
- vitest focused (s2302, review-x-sse-final, review-x-sse-consumers, review-x-sse-parsers, review-v-sse-frames[-2], empty-stream-guard, empty-stream-terminal-1073, client-terminal-tracker, proxy-timeline-frame, proxy-timeline-stream-tap, pending-sse-line-limit, review-empty-stream-tail, stream-terminal-outcome, review-b-stream-terminal, sse-consumer-compatibility): exit 0, 16 files, 635 passed.
- vitest broad batch 1 (113 stream/sse/timeline/terminal/empty/client/proxy files): exit 0, 113 files, 1233 passed.
- vitest broad batch 2 (97 files): exit 0, 766 passed on 2 of 3 runs. One run failed omni-grok-empty-payment-model-scope and omni-token-limit-empty-terminal; both sit in paths this PR does not touch (nonStreamingHandler/combo + DB), both pass in isolation at head, and the same batch passes at the parent ed59fcc834 (2/2). Pre-existing flake, not a PR regression.
- vitest broad batch 3 (115 files): exit 0, 115 files, 1372 passed.
- node /var/tmp/probe*-2716.mjs: old-vs-new comparison of head against the pre-PR parent worktree.

Findings
1) MEDIUM - The shared frame reader now backs the client-observation path and buffers the whole client stream for formats without a blank-line delimiter (Ollama NDJSON). open-sse/utils/sseFrames.js:186 builds the reader with preserveWire:true, but createSseFrameReader only resets its pending buffer on a blank-line delimiter (open-sse/utils/sseFrames.js:110-123); NDJSON has only a single "\n" (open-sse/utils/ollamaTransform.js:87 emits JSON + "\n"), so pendingChunks grows with the response and open-sse/utils/sseFrames.js:116-119 throws invalid_sse_payload past 64 MiB. open-sse/utils/streamHandler.js:158 creates that dispatcher whenever a terminal tracker or the timeline tap exists, and the tap is attached at open-sse/handlers/chatCore/streamingHandler.js:248 whenever a trace id exists (proxy timeline or OTel enabled). The pre-PR path was O(1): open-sse/handlers/chatCore/proxyTimelineFrame.js:78-81 keeps only the current partial line, and the old tracker decoded each chunk without accumulating.
   Reproduce: node /var/tmp/probe6-2716.mjs -> "OLD (pre-PR) tap: heapUsedMB=5.2" vs "NEW (PR 2716) tap: heapUsedMB=22.5" for the same 17.1 MiB NDJSON client stream, i.e. the delta is the whole stream; node /var/tmp/probe3-2716.mjs -> "legacy ndjson framer: retainedMB=0.0" vs "new shared dispatcher: retainedMB=7.0" for 6.9 MiB, and "NDJSON over 64 MiB: threw invalid_sse_payload ... after 145 chunks".
   Impact: every in-flight Ollama-format response now holds up to 64 MiB of extra heap where the old code held O(1); past 64 MiB the reader throws inside open-sse/utils/streamHandler.js:172, where it is swallowed, so the timeline/terminal observation for that chunk is lost. Client bytes are unchanged (81920 records and identical bytes in both runs).
   Suggested fix: use the shared reader only for blank-line-delimited formats, or give the observation reader a line-scoped pending buffer for ndjson.

2) LOW - Production drops the trailing batch, so the final decoder flush never reaches the proxy timeline. open-sse/handlers/chatCore/streamingHandler.js:252 calls clientTap?.onClientEnd() and :256 clientTap?.onClientAbort() without the batch that open-sse/utils/streamHandler.js:187-191 now produces, and open-sse/handlers/chatCore/timelineFrameObserver.js:22 then falls back to its own (never fed) dispatcher. A client stream ending in a truncated multi-byte character therefore loses the U+FFFD timeline record.
   Reproduce: node /var/tmp/probe7-2716.mjs with the production onClientEnd shape -> OLD records=["data: {...café}","�"], NEW records=["data: {...café}"].

3) LOW - The "sse" timeline format stores a trailing newline the legacy framer dropped. open-sse/handlers/chatCore/timelineFrameObserver.js:14-19 emits the raw tail frame, so a frame ending with "\n" is recorded as "data: x\n" instead of "data: x".
   Reproduce: node /var/tmp/probe-2716.mjs -> TL DIFF sse "data: x\n": old ["data: x"], new ["data: x\n"]. Production never uses that format (open-sse/handlers/chatCore/streamingHandler.js:248 only uses "sse-lines"/"ndjson"), so the impact is confined to the test-only "sse" path.
