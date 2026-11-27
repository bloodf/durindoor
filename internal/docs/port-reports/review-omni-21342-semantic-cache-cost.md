# OmniRoute #21342 semantic-cache cost review

## Verdict

**Inapplicable to DurinDoor at this train.** The PR fixes the cost-saved header on semantic-cache hits by persisting the miss's original USD cost beside semantic-cache entries, then using that value on hits. Neither the frozen train nor current `origin/main` contains a semantic-cache implementation, entry store, or hit path. There is therefore no local observable behavior to patch for this candidate. This is a scope verdict, not a claim that the upstream fix is incorrect or that all cost accounting is equivalent.

## Upstream candidate

Read-only GitHub REST metadata (`gh api repos/cheaper-inference/OmniRoute/pulls/21342`) observed PR [#21342](https://github.com/cheaper-inference/OmniRoute/pull/21342), open, titled “fix(sse): report the original cost on semantic cache hits for Messages and Responses (KEA-9624)”. Head: `2c5ad0985c72272fb9c7309d14c46fcf7d1a184f`; base `release/v3.8.55`: `16e2c146fb5b8e4ee6364fb679ffe412880757fb`. The PR body reports incorrect `X-OmniRoute-Cost-Saved` on `/v1/messages` and `/v1/responses` after semantic cache hits because the cached translated response loses gateway-reported cost and reasoning/cache token detail; chat completions is its control case.

Changed files from the paginated PR files endpoint:

- `changelog.d/fixes/kea-9624-cache-cost-saved.md`
- `open-sse/handlers/chatCore/nonStreamingResponse.ts`
- `open-sse/handlers/chatCore/semanticCache.ts`
- `open-sse/handlers/chatCore/semanticCacheStore.ts`
- `open-sse/services/cache/semanticCacheManager.ts`
- `open-sse/services/cache/vectorStore.ts`
- `src/lib/db/migrations/20261126161248_semantic_cache_original_cost_usd.sql`
- `src/lib/db/semanticCache.ts`
- `src/lib/semanticCache.ts`
- `tests/unit/guardrail-pipeline-characterization.test.ts`
- `tests/unit/kea-9624-cache-cost-saved.test.ts`

PR test evidence: the added KEA-9624 test sends two identical requests through `handleChatCore` for Messages, Responses and chat completions, checks that only one upstream call occurs, and expects the hit to report the original `$0.00042` saved cost. This review did not execute candidate code or tests.

## DurinDoor evidence

Compared Git objects for frozen train commit `32a783d76d45d90bf0517015442f43fadd96106c` (tree `fd449b3cefa538d912c3b51dee0ed774ede580e6`) and `origin/main` (tree `ba241eb7e1ff2a3840359ad583320c5645090c69`). In both trees:

- `git ls-tree -r --name-only <rev> | rg 'semanticCache|semantic-cache'` returns no paths.
- `git grep -n -i -E 'semantic.?cache|X-OmniRoute-Cost-Saved|Cost-Saved' <rev> -- open-sse src tests` returns no matches.
- The local `open-sse/handlers/chatCore/nonStreamingHandler.js` handles non-streaming upstream responses and usage, but has no semantic-cache read/write or cost-saved header branch.

These checks cover both the frozen train requested for parity and the live comparison base; a path-name absence alone is not the basis of the verdict. The executable behavior in both trees has no semantic-cache hit that could trigger KEA-9624. No severity or local reproduction is applicable without that feature. The exact static reproduction is the three Git commands above for each revision.

## Prior dispositions and ownership

The November 27 parity census records this exact PR head as “Unrecorded at this head; review required” (`internal/docs/port-reports/2026-11-27-full-parity-refresh.md`, O0067); no earlier row-level disposition for #21342 was found, so this is a new behavior review rather than a repeated disposition. The listed active auth and sync claims do not cover semantic-cache cost persistence or cache-hit headers. No duplicate implementation claim applies.
