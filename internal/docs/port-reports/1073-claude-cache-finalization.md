# 1073: Claude passthrough usage finalization

Checked 2026-11-20 against DurinDoor `e41c7b55f70a667bf639e9fd2b2128bf36baaae4`.

- [OmniRoute #20571](https://github.com/cheaper-inference/OmniRoute/pull/20571), head `d2d750fd17e015e876ddeffac1c5ec73e7f8b946`: open, non-draft, mergeable and clean; CI and quality gates passed. **Disposition: not applicable.** Its final diff guards the eager `getAccountingUsage()` call before Claude `message_delta` repair.
- [OmniRoute #20640](https://github.com/cheaper-inference/OmniRoute/pull/20640), head `6f0bc662df5aa831dce0ab4e5370a0e133139a7a`: open, non-draft, mergeable and clean; CI and quality gates passed. **Disposition: not applicable.** Its final diff fixes the same eager lookup by passing a lazy callback into the repair helper.

DurinDoor has neither upstream's final-wire repair helper nor its per-frame accounting receipt lookup. `open-sse/utils/stream.js` extracts and merges passthrough usage once per parsed frame (around lines 919–926); fallback estimation occurs at stream finalization or interruption (around lines 689–704 and 1458–1461). `open-sse/utils/usageTracking.js` extracts Claude start and delta usage separately (around lines 404–426), then merges cumulative snapshots without summing them (around lines 575–620). The existing wire path preserves raw event data unless another normalization requires rewriting; importing upstream's repair would introduce new wire behavior and speculative accounting. Existing stream terminal and interruption handling remains in place.

Focused evidence: `node node_modules/vitest/vitest.mjs run unit/claude-openai-cache-usage.test.js unit/claude-usage-cache.test.js unit/native-streaming-quota.test.js unit/native-usage.test.js unit/stream-usage-replaces-estimate.test.js --maxWorkers=2` from `tests/`: 5 files, 35 tests passed. These cover cache accounting, native usage, quota and replacement of estimates. Full suite is reserved for the integration gate.
