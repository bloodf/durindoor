# #1073: late-June Gemini, MiMo, and DeepSeek message shapes

## Scope and evidence

Compared the exact PR heads with their first-parent bases, using the PR-specific patches where the supplied enclosing merge may contain unrelated changes. The four pins are:

| PR | Exact head | Enclosing merge | Patch summary |
| --- | --- | --- | --- |
| [OmniRoute #4631](https://github.com/cheaper-inference/OmniRoute/pull/4631) | `57e436b1fa9f331188adb4fdc809b023fcc708d0` | `b92f045f704daae648985ba9b7089321fae6537b` | OpenCode executor injects a whitespace `reasoning_content` into assistant history for model IDs matching DeepSeek, Kimi, K2, and MiniMax. |
| [OmniRoute #4639](https://github.com/cheaper-inference/OmniRoute/pull/4639) | `3ad331661f247fd768a92f769088d51991d308c3` | `7a6f43209c5d32d406f1c596226b9e2884f7ca84` | Expands the direct translator's reasoning-only replay target from DeepSeek to Xiaomi MiMo. |
| [OmniRoute #4946](https://github.com/cheaper-inference/OmniRoute/pull/4946) | `e9f225f5ea234d1858c6e74314bf5dabddb6ab6f` | `6137d4ef5786643a8eb10ab8a7ac5235f1c15923` | Maps Gemini `reasoning_effort` `auto`, `max`, and `xhigh` to high effort; also asserts existing DeepSeek thought-block behavior. |
| [OmniRoute #5661](https://github.com/cheaper-inference/OmniRoute/pull/5661) | `41fa3df7d1c6e43e837874dfe8ef38aa7e9d099d` | `9e227194db21c4222741af5df83fdb5de6f14387` | Merges adjacent same-role Gemini `contents` entries by appending their parts in order. |

The comparison uses the pinned commit diffs and current local translator/executor source plus ordinary offline fixtures. No provider traffic or account credentials were used.

## Current behavior and evidence

### Reasoning replay and optional account/provider behavior

Current request translation maps assistant `reasoning_content` to Gemini thought parts (`thought: true`, followed by the existing synthetic signature part) in [openai-to-gemini.js](../../../open-sse/translator/request/openai-to-gemini.js). The current non-Anthropic reasoning placeholder is owned by executor/provider normalization in [reasoningContentInjector.js](../../../open-sse/utils/reasoningContentInjector.js) and is applied from [default.js](../../../open-sse/executors/default.js). OpenCode also applies it in its executor. This is provider/executor behavior, not a general translator replay rule. The MiniMax M3.1 exception deliberately preserves exact native history and does not fabricate a placeholder.

MiMo is present as an OpenAI-compatible provider and has account-session versus API-key transport behavior in [xiaomi-mimo.js](../../../open-sse/providers/registry/xiaomi-mimo.js). That account layer is separate from message translation. Current provider registry and injector rules do not establish MiMo as a placeholder-injection target. Existing MiMo fixtures cover executor/capability behavior, but no offline translator fixture establishes plain-turn `reasoning_content` replay.

## PR dispositions

### #4631 — already covered at the OpenCode provider layer; do not port the broad model regex

The patch adds an OpenCode-only `transformRequest` helper and injects a placeholder on every assistant message for model IDs matching broad family regexes. Current OpenCode registry configuration already owns `reasoningInject: { scope: "all" }`, and the current executor invokes the shared injector. The generic rule therefore exists in the current provider layer; the PR’s regex expansion is not evidence for broadening global translator behavior. Existing `tests/unit/reasoningContentInjector.test.js` covers preserving supplied reasoning, injecting OpenCode DeepSeek history, and executing the provider hook. Keep the M3.1 exact-history exception.

### #4639 — narrow gap: plain Xiaomi MiMo reasoning replay

The patch makes direct request translation replay missing reasoning on plain assistant turns for provider `xiaomi-mimo` and model IDs matching `mimo`. Current direct translator source has no corresponding replay-target predicate, and MiMo is not covered by the current shared injector rules. Existing `tests/unit/xiaomi-mimo-executor.test.js` and `tests/unit/port-4245-mimo-v2.6.test.js` exercise the provider, but not this message shape. This is a demonstrated narrow gap.

Ordinary offline acceptance if implemented: exercise the direct translator with a prior plain assistant turn lacking `reasoning_content` and a later user turn, for both provider `xiaomi-mimo` and a compatible `mimo` model identifier. Assert the established reasoning placeholder is added only to the eligible assistant history, existing non-empty reasoning is preserved byte-for-byte, message order/content and unrelated fields remain unchanged, and a control provider/model is unchanged. Cover both API-key and account-session routing only at the body/format boundary; do not access an account.

### #4946 — already covered; no port

Current `thinkingUnified.js` maps Gemini auto intent to high, and `effortToThinkingLevel` clamps unsupported levels such as `max` and `xhigh` to Gemini’s accepted level. `tests/translator/thinking-unified.test.js` has offline cases for auto, max, and xhigh on Gemini 3. The PR’s DeepSeek discussion confirms existing thought handling rather than introducing a missing conversion. Current Gemini thought replay remains subject to the Gemma 4 omission rule in `openai-to-gemini.js`.

### #5661 — partial overlap; do not apply unconditional merge

The patch’s ordered append preserves part order and per-part metadata for ordinary adjacent same-role content. Current `openai-to-gemini.js` still emits each converted message as an individual `contents` entry and has no general same-role merge. However, unconditional merging also combines tool `functionResponse` parts with a following plain user turn. Current offline `tests/translator/port-3055-gemini-turn-normalization.test.js` explicitly expects an empty function response to remain a separate entry before following user text; that boundary carries tool-result semantics and should not be flattened as a generic role normalization.

Ordinary offline acceptance for any narrow implementation: merge adjacent plain user entries while preserving exact part order and metadata; retain the current separate function-response/user boundary fixture; include a control conversation with alternating roles unchanged. A tool-result-then-user case should only merge if the Gemini request contract and existing replay ownership allow the function response to remain distinguishable. The cited PR alone does not justify that broader behavior.

## Summary

| PR | Disposition |
| --- | --- |
| #4631 | Covered by current OpenCode provider-level injection; no broad translator port. |
| #4639 | Narrow direct-translator gap for MiMo plain assistant reasoning replay; add focused offline fixture if implemented. |
| #4946 | Covered by current Gemini thinking normalization and offline fixtures. |
| #5661 | No unconditional port; consider only a narrow plain-user merge with tool-result boundaries preserved. |
