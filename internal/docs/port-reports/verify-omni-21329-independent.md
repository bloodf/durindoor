# Independent verification: OmniRoute #21329 Claude cache-read counter selection

**Verdict: confirmed real JSON/SSE inconsistency in this repo, not yet fixed or ported. Severity low.** The prior integrated report's mechanism and its three conflict rows reproduce. It understates one effect: on the streamed path the same wrong counter also changes `input_tokens`. Nothing was changed in the product; this report is the only file committed.

## Scope and identity

- Current `main`: `29490b783e83176d4d6a4162f76ee3dc79db66ea`, verified as a commit.
- Frozen train: `32a783d76d45d90bf0517015442f43fadd96106c`, tree `fd449b3cefa538d912c3b51dee0ed774ede580e6`, verified. Frozen train was not modified.
- The four runtime files named below have identical blob IDs at `main` and the train (`openai-to-claude.js` `c76e05ca…`, `concerns/usage.js` `2c572b17…`, `nonStreamingHandler.js` `5436b5c1…`). Across `open-sse` and `src` the two commits differ in 89 files, so the aggregate is not identical. That difference does not touch these files.
- The prior report was read from the integration object `HEAD:internal/docs/port-reports/review-omni-21329-claude-cache-read.md`. Its claims were checked against `main` source, not taken from it.
- Dependencies were not installed and no vitest run was done (see Not verified). Repro used a `git archive` of `main` extracted into `/var/tmp/omni21329-verify-5omw7Q`, with a stripped environment (`env -i`, private `HOME`, `DATA_DIR`, `TMPDIR`) and Node 24.22.3. No provider calls, no secrets, no `~/.9router`, no memory writes.

## Upstream state (read-only, checked now)

- `cheaper-inference/OmniRoute#21329` `fix(usage): align Claude cache-read counter selection`: **OPEN**, not draft, base `release/v3.8.55`, head `90c55e91bfccc672e20c9914da561ce8c91af9a2`, `updatedAt` 2026-11-26T16:09:26Z. Closes #21328.
- Its diff adds a shared `chatCacheRead` selector in the order prompt details → flat `cached_tokens` → `input_tokens_details.cached_tokens` → `cache_read_input_tokens`, used by both the JSON and SSE paths. The added tests cover the conflict rows listed below. The upstream diff does not mention `prompt_cache_hit_tokens`. That is expected, since the alias came from DurinDoor's own #20279 history, not upstream.

## Source trace (`main`)

**SSE path**, `open-sse/translator/response/openai-to-claude.js:315-322`, `toClaudeUsage`:

1. `usage.prompt_tokens_details.cached_tokens`
2. `usage.input_tokens_details.cached_tokens`
3. `usage.cache_read_input_tokens`
4. `usage.prompt_cache_hit_tokens`
5. `usage.cached_tokens` (flat, last)

The selected value sets `cache_read_input_tokens` (`:343`) and is subtracted from `input_tokens` (`:340`: `Math.max(0, promptTokens - cacheReadTokens - cacheCreateTokens)`). So the selection affects both fields. The value is stored in `state.usage` (`:393-400`) and emitted in `finalizeOnFlush`.

**JSON path**, `open-sse/translator/concerns/usage.js:128-146`, `toClaudePromptUsage`, called from `openai-to-claude-json.js:69` and `completionProjector.js:93`:

1. `prompt_tokens_details.cached_tokens`
2. `cached_tokens` (flat, second)
3. `input_tokens_details.cached_tokens`
4. `cache_read_input_tokens`

It clamps to `prompt_tokens` and subtracts from `input_tokens`. It does not read `prompt_cache_hit_tokens`.

**JSON normalizer**, `open-sse/handlers/chatCore/nonStreamingHandler.js:192-205`, `normalizeClaudeCacheUsage`, called at `:377` and `:780`: same order as `toClaudePromptUsage`, writes `min(prompt_tokens, cached)` to `cache_read_input_tokens`. It does not change `input_tokens`. It is not exported, so the repro transcribes its order and labels that as a transcription.

Both JSON functions use the `isNumber && Number.isFinite && >= 0` filter. Numeric strings are rejected on both paths, so the upstream string-acceptance change is not a live gap here. This matches the prior report's disposition, which is recorded at `internal/docs/port-reports/1073-nov26-pm4.md:71`.

## History of the divergence (`git blame`)

- SSE order with `cache_read_input_tokens` ahead of the flat counter: `bd8ff2ba758`, 2026-11-22. Its comment reads "DeepSeek-style and flat aliases (OmniRoute #20279); Claude-shaped counter keeps priority." This was a deliberate precedence choice at the time.
- JSON flat-second order: `462c5528bd4`, 2026-11-26. Its commit message ("sync: finish 9router provider and connection parity") does not discuss precedence, so the reason for moving JSON is not recorded in the commit.

So the two paths were each chosen at different times, and nobody reconciled them. The SSE comment's rationale ("Claude-shaped counter keeps priority") would be changed by a port.

## Reproduction

Script at `/var/tmp/omni21329-verify-5omw7Q/repro-verify.mjs`, run from `/var/tmp/omni21329-verify-5omw7Q` with `env -i PATH=/usr/bin:/bin HOME=… DATA_DIR=… TMPDIR=…`. `prompt_tokens` is 50000 in every row. The only warning is Node's typeless-package notice, which is harmless.

```
A flat-zero vs claude-named-positive
  JSON cache_read=0 (normalizer=0) input_tokens=50000
  SSE  cache_read=20 input_tokens=49980  cache MISMATCH / input MISMATCH
B flat-positive vs responses-detail
  JSON cache_read=20 (normalizer=20) input_tokens=49980
  SSE  cache_read=7 input_tokens=49993  cache MISMATCH / input MISMATCH
C flat-positive vs claude-named
  JSON cache_read=20 (normalizer=20) input_tokens=49980
  SSE  cache_read=7 input_tokens=49993  cache MISMATCH / input MISMATCH
D chat-detail-zero vs flat-positive
  JSON cache_read=0 (normalizer=0) input_tokens=50000
  SSE  cache_read=0 input_tokens=50000  cache MATCH
E prompt_cache_hit only (DeepSeek, known SSE-only)
  JSON cache_read=omitted (normalizer=omitted) input_tokens=50000
  SSE  cache_read=400 input_tokens=49600  cache MISMATCH / input MISMATCH
F flat-only control
  JSON cache_read=20 (normalizer=20) input_tokens=49980
  SSE  cache_read=20 input_tokens=49980  cache MATCH
```

Reading the output:

- **A, B, C** are the conflict rows from the prior report. Each reproduces. In A the SSE value is the Claude-named 20 where JSON gives the flat 0. In B and C the SSE value is the lower-priority 7 where JSON gives the flat 20.
- **D** is the one case where SSE and JSON already agree.
- **E** is the known SSE-only DeepSeek alias (pinned by `tests/unit/portor-claude-cache-hit-alias-20279.test.js`). It is a deliberate difference, not part of #21329, but any port must keep it.
- **F** is the single-counter control.

**Effect the prior report missed:** the `input_tokens` disagreement. Because SSE subtracts its selected counter, the streamed `input_tokens` differs from the non-streamed value for the same upstream usage (49980 vs 50000 in A, 49993 vs 49980 in B and C). The size of the gap equals the cache-read difference.

## Existing test coverage

- `tests/unit/portor-claude-cache-hit-alias-20279.test.js` checks `prompt_cache_hit_tokens` alone (400), nested 100 beats the alias, and a negative alias falls through to flat `cached_tokens` (30). It does not test flat against Claude-named or against `input_tokens_details`.
- `tests/unit/portor-claude-explicit-zero-cache-read-20949.test.js` checks single-counter zeros, positives, omissions, and an invalid-then-valid fallback. It does not test a conflict between counters.
- So no existing assertion pins the current SSE conflict order. Changing it breaks nothing today.

## Classification

- **Defect or parity:** a real inconsistency within this repo. The same upstream usage yields different `cache_read_input_tokens` and `input_tokens` depending on wire format, which the repo's own JSON/SSE parity work aims to prevent. Which counter should win is not fixed by any Anthropic spec in this repo, so the precedence is a judgment call. The JSON choice (flat second) matches upstream.
- **Already fixed:** no. `main` and the train both have the old SSE order.
- **Already claimed:** yes, upstream #21329 is open. No DurinDoor branch or PR was checked for a local claim.
- **Severity:** low. It needs an upstream response that reports two different cache-read counters at once. Single-counter responses agree on both paths.
- **Security or privacy:** none. This candidate touches usage arithmetic only, with no credential, redaction, or auth handling.

## Auth and sync overlap

The prior report says #21329 is outside the auth lane (#2034, #1241, #1234, #2266, #2289 and related) and the sync lane (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433, 9router #5884 and #5904). I did not re-audit that. I checked only that the four runtime files are usage-translation files, not credential or OAuth files. Overlap with the lanes is therefore **not independently verified**.

## Recommended port (if taken)

Keep it SSE-only and small:

1. In `openai-to-claude.js:315-322`, reorder to prompt details → flat `cached_tokens` → input details → `cache_read_input_tokens`, keeping `prompt_cache_hit_tokens` after `cache_read_input_tokens` so the DeepSeek test (#20279) still holds. Update the comment at `:318`, since "Claude-shaped counter keeps priority" would no longer be true.
2. Keep SSE raw and unclamped. Do not add numeric-string acceptance.
3. Add rows for A, B and C above, asserting the same usage object gives the same `cache_read_input_tokens` and `input_tokens` on both the JSON and SSE paths.
4. Do not copy the upstream TypeScript helper or changelog fragment.

## Not verified

- No vitest run. Dependencies are not installed in this worktree, and the instruction is to avoid installs. The repro uses only the runtime source.
- The full `stream.js` pipeline was not read. Downstream consumers of the streamed usage (usage tracking, billing) were not traced, so the user-visible impact beyond the wire payload is unknown.
- The upstream #21328 issue body and the other PRs in the lanes were not re-read.
- The repro transcribes `normalizeClaudeCacheUsage` rather than importing it. The transcription matches lines 192-205 but is not executed from the real file.
