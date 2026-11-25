# OmniRoute #21092: throughput sample bounds

## Source and local gap

On 2026-11-24, fetched the final upstream [#21092 diff](https://github.com/cheaper-inference/OmniRoute/pull/21092), head `72556c31cd9eb9180ce594a0a7d61748495e262e`, merge commit `eb037d64dffa6d8af1848ed7bcd8cceeb64b2276`. Its `tokensPerSecond` rejects generation windows below 250 ms and rates above 5,000 tok/s. Before this change, `open-sse/utils/generationThroughput.js` accepted every positive finite generation window and computed any resulting finite rate, so a short burst could be reported as extreme throughput.

Upstream also changes `src/lib/usage/usageHistory/helpers.ts` to aggregate speed as total tokens divided by total generation time. DurinDoor has no usage-history latency sample buckets or `avgTokensPerSecond` implementation (`rg` over `src/` and `tests/unit/` found none), so that aggregation change has no corresponding local behavior to port.

## Open PR overlap

Checked open DurinDoor PRs with `gh pr list --repo bloodf/durindoor --state open --limit 300` on 2026-11-24 and inspected their changed paths. PRs #2481, #2430, #2112, #1809 and #1784 do not touch `open-sse/utils/generationThroughput.js` or `tests/unit/generation-throughput.test.js`.

## Change and evidence

The local helper now omits samples with generation windows below 250 ms or computed rates above 5,000 tok/s. The exact boundaries remain valid: 250 ms and 5,000 tok/s are accepted. Existing stream and usage attachment paths already call this helper, so both inherit the bounds without changes to gateway routing or stream handling.

`tests/unit/generation-throughput.test.js` keeps the existing throughput calculation tests and adds literal expected results for plausible rates, the exact window and rate boundaries, too-short windows, over-ceiling rates, burst-like rates, and omission from attached usage. The file keeps its original name so existing intake evidence still resolves.

Focused verification passed: `cd tests && timeout 300 node node_modules/vitest/vitest.mjs run unit/generation-throughput.test.js --maxWorkers=2` — 1 file, 8 tests. `git diff --check` passed.

PR status: no DurinDoor PR link is established by this report; this is not a claim that the port is complete or merged.
