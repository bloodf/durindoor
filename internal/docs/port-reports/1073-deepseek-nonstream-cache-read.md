# 1073: DeepSeek nonstream cache reads

Compared OmniRoute #1930 head `bfcb068a5502c57dbaf3b4d31fdf08c0d7ef43c3` and merge `37058ad3d278ba1e22cd4a82370ab10bd5e261c3` using the merge's first-parent patch against integration `1e43a102811d18bbf792ac881eef11f4648b7ae4`. The upstream patch also changes streaming extraction, response translation, and pricing; those changes are outside this port.

Nonstream usage extraction now recognizes a finite nonnegative numeric `prompt_cache_hit_tokens` on OpenAI-shaped usage as an inclusive cache-read subset when existing cache fields do not provide one. Existing nested values, including zero, take precedence. Exclusive cache accounting and input/total counts remain unchanged. JSON passthrough and Responses projection retain their existing behavior; the flat fallback is for usage extraction, not a new wire projection.

Offline checks: `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-deepseek-nonstream-cache-read.test.js unit/cached-token-usage.test.js`. Fixtures cover fallback, precedence, invalid counts, exclusive accounting, JSON passthrough and Responses projection.
