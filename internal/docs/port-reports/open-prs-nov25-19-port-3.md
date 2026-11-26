# Open upstream PR ports: batch 19, port candidates 17–24

Source: [batch 19 dispositions](open-prs-nov25-19.md). That report has 23 port-candidate rows, so this slice holds seven (candidates 17–23, source rows 754–760). There is no candidate 24.

Current heads and changed-file diffs were fetched on 2026-11-25. Each of the seven PRs was open, and each head matched the source report. Before this change, `git log --grep` found no earlier port of these PR numbers.

| Row | PR | Head SHA | Final disposition | Evidence |
|---:|---|---|---|---|
| 754 | OmniRoute [#21113](https://github.com/cheaper-inference/OmniRoute/pull/21113) | `d011d9ec2a8082db3966f82a3102188d11a84f6a` | **already present** | Upstream's partial-usage module dropped the Gemini cache-read alias. DurinDoor reads Gemini usage in `extractUsage` in [usageTracking.js](../../../open-sse/utils/usageTracking.js), which keeps `cachedContentTokenCount` as `cached_tokens`, including zero. An offline probe of interrupted-stream snapshots kept a read of 30 for Chat, Responses, Claude and passthrough clients. A read of zero canonicalizes to zero. DurinDoor storage does not separate unknown from zero. See the separate Claude-client finding below. |
| 755 | OmniRoute [#21112](https://github.com/cheaper-inference/OmniRoute/pull/21112) | `84a2f3462399f313f6cb472d7aaa49296085a6af` | **not applicable** | The fix is in upstream's compression worker pool. [Local compression services](../../../open-sse/services/compression/index.js) run without one: `open-sse/services/compression/compressionWorkerPool.js` is absent, and no compression source starts a worker thread. The source report's `open-sse/rtk/` path has no worker either. |
| 756 | OmniRoute [#21111](https://github.com/cheaper-inference/OmniRoute/pull/21111) | `72c5c32f0ebe6704be2233d683b931bb5e5ab253` | **not applicable** | The fix changes result truncation for the `omniroute_ccr_retrieve` MCP tool. `open-sse/mcp-server/` is absent and no local source defines that tool. The [local CCR slice](../../../open-sse/services/compression/engines/ccr/index.js) only stores blocks for session deduplication. |
| 757 | OmniRoute [#21110](https://github.com/cheaper-inference/OmniRoute/pull/21110) | `88fc660ada7c01c803f58f60d7e01211d5789e6e` | **ported in this change** | A Responses stream with nested `cache_write_tokens` lost the count in both Chat and Claude client output and in the usage passed to accounting. `toResponsesUsage` in [usage.js](../../../open-sse/translator/concerns/usage.js) now reads the top-level and nested alias. The Chat-to-Claude half already read these aliases. [Test](../../../tests/unit/port-omniroute-21110-nested-cache-write.test.js). |
| 758 | OmniRoute [#21108](https://github.com/cheaper-inference/OmniRoute/pull/21108) | `7fa2a13336bab04bfc9b6235ed44b9ce610027d0` | **not applicable** | The fix changes cache-read completeness in upstream's ten-minute buckets. DurinDoor's `last10Minutes` buckets in [usageRepo.js](../../../src/lib/db/repos/usageRepo.js) carry requests, prompt, completion and cost only. They expose no cache-read value, and the `cachedTokens` column is `NOT NULL DEFAULT 0`. `src/lib/usage/usageStats.js` is absent. |
| 759 | OmniRoute [#21107](https://github.com/cheaper-inference/OmniRoute/pull/21107) | `f6235ae61b44e8633e1e785384f28eb185844c61` | **ported in this change** | Adapted. Upstream's log component read one of two cache-write key names. DurinDoor's request log list has no cache columns. Its request-detail table and drawer read only the flat `cache_creation_input_tokens`, while translated streams can persist the count only under token details. `tokenDisplay.js` in the dashboard usage components now falls back to the nested counts, and a flat zero still wins. No column was added. [Test](../../../tests/unit/port-omniroute-21107-cache-write-display.test.js). |
| 760 | OmniRoute [#21106](https://github.com/cheaper-inference/OmniRoute/pull/21106) | `bd7ced4d0c8514a63ccd4c61f10c779607335f1f` | **already present** | The OpenAI Chat branch of `extractUsage` in [usageTracking.js](../../../open-sse/utils/usageTracking.js) already passes `total_tokens` through. An offline call kept a reported 113 for 100 prompt and 7 completion tokens, and added no total when none was reported. Unlike upstream, DurinDoor also keeps the total on usage marked estimated; this change leaves that as it is. |

## Compatibility choices

- When flat cache fields select cache-exclusive input accounting, nested creation counts are still discarded. `toResponsesUsage` now removes a nested `cache_write_tokens` there too, so applying it twice gives the same result.
- A malformed alias (negative, fractional or non-numeric) is ignored. It does not create a creation counter.
- Upstream emits a reported zero cache write to Claude clients. DurinDoor already omits zero creation counts, and this change keeps that.
- Upstream treats an unmarked top-level `cache_write_tokens` as unknown. DurinDoor already treats it as part of inclusive input, and `toResponsesUsage` now agrees with that.

## Open finding outside this slice

[gemini-to-claude.js](../../../open-sse/translator/response/gemini-to-claude.js) copies Gemini's cache-inclusive `promptTokenCount` into Claude `input_tokens` and also reports `cache_read_input_tokens`. Claude input excludes cache reads. For 80 prompt tokens with 30 cached, canonical accounting gives a prompt of 110. The probe reproduced this on an interrupted direct Gemini-to-Claude stream, and the translator uses the same mapping for completed streams.

This change does not fix it. #21113 does not touch that translator, and [an existing block-order test](../../../tests/unit/omni-gemini-claude-text-block-order.test.js) asserts the current value. It needs its own change with an intentional update to that expectation.

## Verification limits

All checks are offline assertions. No browser, live provider or PostgreSQL check ran, and the full suite was not run. The standalone `node:test` file beside the non-stream Responses translator reported 14 passes and 3 failures both before and after the `usage.js` edit.
