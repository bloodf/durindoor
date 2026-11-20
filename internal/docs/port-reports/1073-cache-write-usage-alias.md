# 1073: cache-write and Responses usage aliases

- [OmniRoute #11814](https://github.com/cheaper-inference/OmniRoute/pull/11814), source `4d20d379740160ecebf46e67b2e57b5bb683f173`: adapted at `open-sse/utils/usageTracking.js`. The existing normalizer and canonicalizer accept top-level and token-detail `cache_write_tokens` as inclusive cache creation, retaining canonical-field precedence and stream aggregation. No accounting field or settlement path was added.
- [OmniRoute #14205](https://github.com/cheaper-inference/OmniRoute/pull/14205), source `844a34254abb38685bb2e89d2646dcda268a19fc`: adapted at `open-sse/translator/response/openai-to-claude.js`. Responses totals and details are read alongside numeric Chat Completions fields, including usage-only chunks; existing terminal emission timing is retained.

Synthetic regression coverage is in `tests/unit/omni-cache-write-usage-alias.test.js`. Existing stream-tail accounting coverage in `tests/unit/stream-completion-usage.test.js` exercises the local scope associated with #20279. No live provider calls are needed.
