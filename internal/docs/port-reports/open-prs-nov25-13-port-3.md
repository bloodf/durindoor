# Port report — open PR batch 13, port candidates 17–22

Scope: port candidates 17–24 of [the batch 13 dispositions](open-prs-nov25-13.md), counted over port-candidate rows in table order. That report has only 22 port-candidate rows, so this change covers candidates 17–22: rows 513–517 and 519. All six are `decolua/9router` PRs. On 2026-11-25 each current head SHA matched the one in that report.

Five had already landed, which the source rows did not record. Each was checked against the current diff and current code. For #3506, #3504, #3495 and the #3481 stream usage cases, upstream test cases were also run from temporary files, adapted to DurinDoor helper signatures and contracts. Those files are not committed.

| Row | PR | Final disposition | Evidence |
|---:|---|---|---|
| 513 | [#3506](https://github.com/decolua/9router/pull/3506) | already present | Commit `1f1a3ec0548`. [The prefill policy](../../../open-sse/translator/concerns/assistantPrefillPolicy.js) runs from both [Claude paths](../../../open-sse/translator/formats/claude.js), and [chat core](../../../open-sse/handlers/chatCore.js) passes it the request headers. It also keeps opaque redacted-thinking turns. See [the policy tests](../../../tests/translator/assistant-prefill-policy.test.js). The upstream cases passed once the passthrough call used DurinDoor's options argument for headers. |
| 514 | [#3504](https://github.com/decolua/9router/pull/3504) | already present | [The OpenCode registry entry](../../../open-sse/providers/registry/opencode.js) sets the `opencode` thinking format, [capabilities](../../../open-sse/providers/capabilities.js) has the stealth model rows, and [the thinking concern](../../../open-sse/translator/concerns/thinkingUnified.js) maps the gateway enum. See [the effort tests](../../../tests/unit/opencode-thinking-effort.test.js). |
| 515 | [#3495](https://github.com/decolua/9router/pull/3495) | already present | `responsesApiToOpenAICompletion` in [the completion projector](../../../open-sse/translator/response/completionProjector.js) joins reasoning summaries into `reasoning_content`, and [the forced-stream JSON handler](../../../open-sse/handlers/chatCore/sseToJsonHandler.js) uses it. Temporary checks showed a Claude client gets a thinking block before text or `tool_use`, and a Chat client keeps reasoning-only output. |
| 516 | [#3487](https://github.com/decolua/9router/pull/3487) | already present | Both [the combo-only list](../../../src/shared/models/modelListCombos.js) and [the full model list](../../../src/shared/models/modelListCore.js) publish `context_length` and `max_completion_tokens` for LLM combos. See [the combo limit tests](../../../tests/unit/port9r-combo-limits-4e54858.test.js) and [the routable limit tests](../../../tests/unit/port-4627-combo-routable-limits.test.js). |
| 517 | [#3481](https://github.com/decolua/9router/pull/3481) | ported in this change | Commit `3962854dd4e` had ported usage detail preservation, single billing of reasoning tokens and most prices. Two gaps remained. [The default executor](../../../open-sse/executors/default.js) did not ask OpenAI for usage when the client sent `stream_options` without `include_usage`. Three Codex rows in [pricing](../../../open-sse/providers/pricing.js) still charged reasoning at 1.5 times the output rate. See [the stream usage test](../../../tests/unit/port-3481-openai-include-usage.test.js) and [the reasoning rate test](../../../tests/unit/port-3481-codex-reasoning-rate.test.js). |
| 519 | [#3471](https://github.com/decolua/9router/pull/3471) | already present | [The quota view](<../../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js>) saves filters to `localStorage` under `quotaTrackerFilterState`, to settings and to the URL. It restores them before the first connections request and normalizes invalid values. URL filters win over stored ones. A temporary component test confirmed the restore order and three kinds of bad stored value. |

## Differences from the upstream diffs

DurinDoor behaviour was kept in these places:

- #3481, usage opt-out: upstream forces `include_usage: true` even when the client sent `false`. DurinDoor keeps an explicit client value, which [an existing test](../../../tests/unit/openai-max-completion-tokens.test.js) pins. An OpenAI chat stream with that opt-out therefore still sends no upstream usage request.
- #3481, prices: the three Codex rows change only their reasoning rate. `gpt-5-codex` and `gpt-5.1-codex` keep the cached rate that [the Codex pricing test](../../../tests/unit/pricing-claude-codex-u10.test.js) pins. [The pricing refresh test](../../../tests/unit/openai-pricing-refresh.test.js) pins the fork GPT-5.6 rates, the cached rates for `gpt-4` and `gpt-4-turbo`, and the absence of three upstream rows. `gpt-5.1-codex-mini-high` is kept, although upstream removes it.
- #3504: `x-preview-f-free` keeps its narrower `low`, `high` and `max` contract, so it has no `none` level. The upstream assertions about OpenAI GPT-5 picker levels were dropped from the temporary run because DurinDoor's list differs.
- #3495: a Chat client also receives `reasoning_content` next to text. Upstream omits it there.
- #3487: the combo output limit is the lowest member limit, not the highest, so any member can serve the advertised value. The source row suggested testing for the maximum. Members with unknown limits are left out of the calculation.

## Not verified

No live provider call was made and no credentials were used. The full suite was not run.

Totals: 1 ported in this change, 5 already present, 0 not applicable. None remaining.
