# 1073: GLM Anthropic thinking budget

Source: https://github.com/cheaper-inference/OmniRoute/pull/18378 (merged), pinned final head `9fa343943acb3f5c25356bc01c303031b8fcd2a8`. The patch adds `ensureGlmAnthropicThinkingBudget` to OmniRoute's GLM executor. Z.ai's Anthropic endpoint answers an enabled `thinking` block without `budget_tokens` with HTTP 400 `missing field budget_tokens`. The patch keeps a client budget, otherwise takes one from the effort tier (high 24576, max 131072, medium 10240 for other models), clamps it to `max_tokens - 1024`, and drops thinking when the result is under 1024.

Local evidence: DurinDoor has no GLM executor. The `glm` and `zai` providers use the Anthropic endpoint (`https://api.z.ai/api/anthropic/v1/messages`) as their Claude-format transport; `glm` also lists an OpenAI-format transport. Both call paths reach `translateRequest`, because native passthrough covers only the `claude` and `anthropic` providers. The sequence there is `applyThinking`, then `prepareClaudeRequest`, which calls `reconcileClaudeThinkingBudget`.

Probing the translated and native shapes offline before the change showed:

- `thinkingFormat: "zai"` models that can disable thinking (`glm-4.6`, `glm-4.5`, `glm-4.5-air`, `glm-4.7-flashx`) were sent `thinking: { type: "enabled" }` with no budget. This covered translated `reasoning_effort` and native `enabled`/`adaptive` blocks, and it is the rejected shape.
- An explicit native `budget_tokens` was discarded by the `zai` branch of `applyThinking`, on every GLM model.
- Always-on models (`glm-5.x`, `glm-4.7`) already omit the marker without a budget; an existing test pins that.

Disposition: adapted to the local layers rather than adding an executor.

- `open-sse/translator/concerns/thinkingUnified.js`: for the Claude wire and the `glm`/`zai` providers only, an explicit budget now survives the `zai` branch, bounded by the model's `thinkingRange`. Always-on models carry it too (it caps reasoning); without a budget they still omit the marker.
- `open-sse/translator/formats/claude.js`: `reconcileClaudeThinkingBudget` calls a new `ensureGlmAnthropicThinkingBudget` for those providers, after the max-output ceiling clamp and before the existing raise-then-fit step. A missing budget comes from the local level map (`effortToBudget`, using the `reasoning_effort` already on the wire, else medium) and is clamped to `thinkingRange.max` and `max_tokens - 1024`. When `max_tokens` cannot hold the floor, thinking is dropped, as upstream does. An explicit budget below the floor is lifted to it. The floor is the local `low` level budget (1024) or `thinkingRange.min`, whichever is larger.
- `open-sse/translator/concerns/thinking.js`: `GLM_ANTHROPIC_PROVIDERS`, the provider set shared by both edits.

Differences from upstream: budgets come from the local `LEVEL_TO_BUDGET` map (high 24576, max 128000, medium 8192) instead of copied constants. The effort used is the one the `zai` branch normalizes onto the wire (`high` or `max`), so a `low` or `medium` request is budgeted as `high`. That is the existing wire normalization and is unchanged. Explicit budgets above `max_tokens` keep the existing local behavior: `max_tokens` is raised within the model ceiling, then the budget is fitted.

Unchanged by design: adaptive, `between_tools` and disabled handling on routes that support them (the disable flag for GLM remains `enable_thinking: false`), other providers (including `glm-cn` and other hosts of `glm-*` ids), and the OpenAI-format GLM transport. The existing `glm-always-on-thinking` assertion that a toggle-capable model receives a bare `{ type: "enabled" }` from `applyThinking` alone still holds; the budget is added at the Claude-wire stage where `max_tokens` is known.

Verification (offline only): `tests/unit/omni-glm-anthropic-thinking-budget.test.js` has 29 cases over translated OpenAI and native Claude shapes for `glm` and `zai`, plus scope controls. 23 fail against the pre-change source. The 67 existing test files that reference `applyThinking`, `prepareClaudeRequest`, `normalizeClaudePassthrough` or the reconcile helper pass. `unit/omni-hydrogen-interactions-effort.test.js` was failing on the integration branch independent of this change: its Antigravity Hydrogen levels assertion predated the `xhigh` row added by `a1bc463d2`. The integration branch fixed that expectation as well; the merge keeps its version. No provider traffic, credentials, browser, e2e or full-suite run was used. A real Z.ai account was not exercised, so the 400 itself is taken from the pinned upstream report.
