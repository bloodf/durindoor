# #1073 — Kiro adjacent turns and transient quota handling

## Scope and pins

Compared OmniRoute PR #2105 (head `e84a2286eee6c2f23b2d7f57aba8d6ecbc21ad61`, first-parent merge `149d13cb9c846d2e67030d3b8dc15d7d734559d9`) and PR #2153 (head `7d366ebc0a9b67b1547ca619d8e91af22e2eb4da`, first-parent merge `fdb4c632449d2fef2c36546a526143b53a6bdad8`) against the current checkout at `213f009d8ad9d640dfa0c79e26905d3eefab77a4`. Source objects were read from `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`; source references below are pinned to the specified commits.

## #2105 — merge adjacent normalized user turns

The patch adds a post-pass in `open-sse/translator/request/openai-to-kiro.ts` that merges consecutive `history` entries containing `userInputMessage`. It concatenates nonempty contents with a blank line and combines context arrays (including `toolResults`); subsequent scalar context values replace prior values. Its regression transcript is `system, user, assistant, orphan tool, user`, which normalizes into adjacent user history entries after the assistant/tool-use boundary. [Pinned patch](https://github.com/cheaper-inference/OmniRoute/commit/149d13cb9c846d2e67030d3b8dc15d7d734559d9) · [Pinned test](https://github.com/cheaper-inference/OmniRoute/blob/e84a2286eee6c2f23b2d7f57aba8d6ecbc21ad61/tests/unit/translator-openai-to-kiro.test.ts)

**Disposition: covered behavior.** Current `openai-to-kiro.js` has the equivalent `mergedHistory` post-pass (around lines 408–445), including content concatenation and array-context merging. The focused local tests are `tests/unit/openai-to-kiro.test.js` (existing role/tool conversion and tool-result shapes) and `tests/unit/omni-kiro-final-turn-history.test.js`. The latter records that consecutive user history turns are merged and asserts ordered history/current turn behavior; #2104/#2149 scope is separately described in `internal/docs/port-reports/1073-kiro-final-turn-history.md`. Thus #2105's adjacent-turn invariant is already implemented and covered locally; no additional port is indicated by this comparison. This does not claim every possible context-key collision policy is tested.

## #2153 — ordinary runtime 429 versus quota exhaustion

The source patch adds a `failureKind` input to `shouldMarkAccountExhaustedFrom429` and explicitly returns false for `rate_limit` or `transient`. The chat handler classifies 429 errors before deciding whether to mark the account quota-exhausted. The accompanying test distinguishes rate-limit/transient from `quota_exhausted`. [Pinned patch](https://github.com/cheaper-inference/OmniRoute/commit/fdb4c632449d2fef2c36546a526143b53a6bdad8) · [Pinned classifier test](https://github.com/cheaper-inference/OmniRoute/blob/7d366ebc0a9b67b1547ca619d8e91af22e2eb4da/tests/unit/classify429.test.ts)

**Disposition: ordinary transient contract covered; classifier override is a distinct implementation detail.** In current DurinDoor, `checkFallbackError` uses `parseRateLimitEvidence` and only attaches `rateLimitEvidence.state === "exhausted"` when the 429 body provides explicit exhaustion evidence (`open-sse/services/accountFallback.js:159-190`). An ordinary rate-limit/high-traffic 429 therefore follows generic bounded backoff without exhausted evidence. The request path persists that evidence for fallback state (`src/sse/handlers/chat.js:1520-1590`); tests pin transient versus explicit exhaustion and persisted cooldown/exhausted states in `tests/unit/apikey-429-quota-exhausted.test.js` and `tests/unit/chat-quota-fallback.test.js`.

The source's additional `failureKind` veto can override exhausted wording when another classifier labels the response transient/rate-limit. The inspected current path instead derives the exhausted state from the parsed response evidence and has no equivalent separate `failureKind` veto at that decision point. The compared source test demonstrates ordinary “high traffic” classification as `rate_limit`, while the current parser and tests demonstrate that ordinary transient 429s do not become exhausted. No evidence in these pinned changes establishes a conflicting-body case that causes current Kiro fallback to poison quota state. Record this as a focused implementation difference, not a demonstrated ordinary-runtime behavior gap; no code change is supported by the comparison.

## Evidence boundary

Static comparison only. No sign-in, credential inspection, provider request, paid API, or live reproduction was performed. No product-code or test changes are proposed.
