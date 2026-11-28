# Review: OmniRoute #21329 Claude cache-read counter selection

**Verdict: concrete missing behavior, severity low.** Streamed Chat → Claude replies select the reported cache-read counter in a different order from the JSON path. For a response that reports conflicting cache counters, the SSE `message_delta` usage can differ from the non-streaming usage for the same upstream usage. The upstream PR aligns the SSE order with JSON. Nothing was ported or changed; this report is the only file committed.

## Upstream candidate

- PR: https://github.com/cheaper-inference/OmniRoute/pull/21329, `fix(usage): align Claude cache-read counter selection`
- State at read time (2026-11-27): **open**, not draft, `updated_at` 2026-11-26T16:09:26Z
- Base: `release/v3.8.55` at `16e2c146fb5b8e4ee6364fb679ffe412880757fb`
- Head: `KiaroSama/OmniRoute:fix/claude-cache-read-alignment` at `90c55e91bfccc672e20c9914da561ce8c91af9a2`
- Files (5, +118/−22): `changelog.d/fixes/0000-claude-cache-read-alias-precedence.md` (added), `open-sse/handlers/responseTranslator.ts`, `open-sse/translator/helpers/chatCacheRead.ts` (added), `open-sse/translator/response/openai-to-claude.ts`, `tests/unit/openai-to-claude-trailing-usage-deferred-finish.test.ts`
- Change: a shared `readChatCacheReadCounter` selector with the order prompt details → flat `cached_tokens` (positive numeric strings accepted) → `input_tokens_details.cached_tokens` → `cache_read_input_tokens`. JSON and SSE both call it. SSE keeps its raw, unclamped count; JSON keeps its clamp to `prompt_tokens`. The PR closes #21328.

## Local state

- `origin/main`: `29490b783e83176d4d6a4162f76ee3dc79db66ea`. Frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c`. The four runtime files below are byte-identical between the frozen tree and `origin/main`.
- The upstream TypeScript paths map to DurinDoor's JavaScript files: `open-sse/translator/response/openai-to-claude.js` (SSE), `open-sse/translator/concerns/usage.js` (JSON), `open-sse/handlers/chatCore/nonStreamingHandler.js` (JSON normalizer). DurinDoor has no `chatCacheRead` helper.
- Frozen-tree row `O0075` in `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1743` reads "Unrecorded at this head; review required". This report resolves that row.
- Claims: none. #21329 is not in the auth lane (#2034, #1241, #1234, shared credential lifecycle, provider OAuth, #2266, #2289) or the sync lane (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433, 9router #5884, #5904). No open issue in the list I read (#1074, #1056, #2331, #1065, #2034, #1061, #1067) references #21329.

## Already present (JSON side)

- `toClaudePromptUsage` (`open-sse/translator/concerns/usage.js:129-146`) reads `prompt_tokens_details.cached_tokens`, `cached_tokens`, `input_tokens_details.cached_tokens`, `cache_read_input_tokens`, in that order. It keeps an explicit zero and clamps to `prompt_tokens`. This matches the upstream selector order.
- `normalizeClaudeCacheUsage` (`open-sse/handlers/chatCore/nonStreamingHandler.js:192-205`) applies the same order and runs after translation, so the final JSON value follows the same rule.
- Explicit zero on both JSON and SSE: present, ported in the #20949 work (`1073-nov22-verify-oc01.md:11`, `1073-nov26-pm4.md:30` and `:61`). Covered by `tests/unit/portor-claude-explicit-zero-cache-read-20949.test.js`.

## Intentional or inapplicable

- **Numeric-string counters are rejected, on purpose.** Upstream's `legacyPositiveCacheRead` accepts `"20"` in flat fields. DurinDoor's converters require finite numbers. `internal/docs/port-reports/1073-nov26-pm4.md:71` records this as a deliberate DurinDoor disposition. The port should not add string acceptance.
- **Raw SSE count and JSON clamp are both present.** `toClaudeUsage` keeps the raw count (`openai-to-claude.js:315-322`), and the JSON path clamps. The upstream "wire-specific clamping" test expects this split, so it needs no change.
- **`prompt_cache_hit_tokens` is SSE-only.** `toClaudeUsage` reads it (`openai-to-claude.js:320`). The JSON helper does not. Pinned by `tests/unit/portor-claude-cache-hit-alias-20279.test.js:13-24` (`prompt_cache_hit_tokens` alone gives 400; prompt details 100 beats it; a negative alias falls through to `cached_tokens` 30). The DeepSeek record (`1073-deepseek-nonstream-cache-read.md`) keeps JSON passthrough unchanged. This is not part of #21329, and any SSE reorder must keep it.

## Gap

`toClaudeUsage` in `open-sse/translator/response/openai-to-claude.js:315-322` uses this order:

1. `prompt_tokens_details.cached_tokens`
2. `input_tokens_details.cached_tokens`
3. `cache_read_input_tokens`
4. `prompt_cache_hit_tokens`
5. `cached_tokens`

JSON uses the order `prompt_tokens_details` → flat `cached_tokens` → `input_tokens_details` → `cache_read_input_tokens`. The flat `cached_tokens` sits last on SSE and second on JSON. The streaming port record (`1073-nov22-verify-oc01.md:11`) describes the SSE selector as "prompt details, input details, cache_read" and never mentions the flat counter. The Nov 26 correction then aligned JSON to the flat-counter order, and SSE was not updated.

The SSE usage is stored in `state.usage` (`openai-to-claude.js:393-400`) and emitted in `finalizeOnFlush` (`:374-384`). `stream.js` does not appear to rewrite `cache_read` on `message_delta`. I searched it by grep and did not read the whole file.

### Reproduction

Runs on `origin/main`, not the working tree. Node 24.22.3, `env -i`, fresh directories under `/var/tmp`, no npm packages, no provider calls.

```bash
X=$(mktemp -d /var/tmp/omni21329-XXXXXX)
git archive origin/main open-sse src package.json | tar -x -C "$X"
mkdir -p "$X/home" "$X/data" "$X/tmp"
cat > "$X/repro.mjs" <<'EOF'
const root = process.argv[2];
const { toClaudePromptUsage } = await import(`${root}/open-sse/translator/concerns/usage.js`);
const { openaiToClaudeResponse } = await import(`${root}/open-sse/translator/response/openai-to-claude.js`);
const cases = {
  "flat-zero-before-claude-positive": { cached_tokens: 0, cache_read_input_tokens: 20 },
  "flat-positive-before-responses-detail": { cached_tokens: 20, input_tokens_details: { cached_tokens: 7 } },
  "flat-positive-before-claude-named": { cached_tokens: 20, cache_read_input_tokens: 7 },
  "chat-detail-zero-before-flat-positive": { prompt_tokens_details: { cached_tokens: 0 }, cached_tokens: 20 },
};
for (const [name, details] of Object.entries(cases)) {
  const usage = { prompt_tokens: 50000, completion_tokens: 7, ...details };
  const json = toClaudePromptUsage(usage).cache_read_input_tokens ?? "omitted";
  const state = { messageStartSent: false, toolCalls: new Map(), contentBlocks: [] };
  openaiToClaudeResponse({ id: "chatcmpl-x", choices: [], usage }, state);
  const sse = state.usage?.cache_read_input_tokens ?? "omitted";
  console.log(`${name}: JSON=${json} SSE=${sse} ${json === sse ? "match" : "MISMATCH"}`);
}
EOF
cd /var/tmp && env -i PATH=/usr/bin:/bin HOME="$X/home" DATA_DIR="$X/data" TMPDIR="$X/tmp" "$(command -v node)" "$X/repro.mjs" "$X"
```

Observed output:

```
flat-zero-before-claude-positive: JSON=0 SSE=20 MISMATCH
flat-positive-before-responses-detail: JSON=20 SSE=7 MISMATCH
flat-positive-before-claude-named: JSON=20 SSE=7 MISMATCH
chat-detail-zero-before-flat-positive: JSON=0 SSE=0 match
```

The first two mismatches match two of the pre-change failures the upstream PR reports ("flat zero lost to a named positive", "flat positive lost to Responses detail"). The third is the same mechanism with the Claude-named counter. The fourth case is the one the current SSE order already gets right. The upstream PR's "numeric string omitted" failure does not reproduce as a mismatch here, because DurinDoor rejects that string on both paths (see Intentional or inapplicable).

### Test coverage

`tests/unit/portor-claude-explicit-zero-cache-read-20949.test.js` covers single-counter zero cases and an invalid-then-valid fallback (lines 14–20). None of its rows checks a conflict between flat `cached_tokens` and another counter. No existing test pins the current SSE precedence on a conflict, so changing it breaks no assertion.

## Recommended port

Small and scoped to SSE. Make `toClaudeUsage` (`open-sse/translator/response/openai-to-claude.js:315-322`) read the JSON order: prompt details → flat `cached_tokens` → input details → `cache_read_input_tokens`. Keep `prompt_cache_hit_tokens` where it is relative to the DeepSeek test. Keep SSE raw and unclamped. Do not add numeric-string acceptance. Add rows for the three conflict cases above, plus a JSON-and-SSE parity assertion on the same usage object. The upstream changelog fragment and the TypeScript helper are not needed.

## Severity

Low. The mismatch needs an upstream response that reports two different cache-read counters at once. The client-visible streamed usage and the non-streamed usage then disagree, but the single-counter cases agree on both paths.
