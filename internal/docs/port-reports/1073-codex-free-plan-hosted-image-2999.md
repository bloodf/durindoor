# #1073: Preserve Codex text chat on known free plans

## Source comparison

OmniRoute [PR #2999](https://github.com/cheaper-inference/OmniRoute/pull/2999) is pinned at patch head [`d0a87970c69281012975b6f1b881317e26d77997`](https://github.com/cheaper-inference/OmniRoute/commit/d0a87970c69281012975b6f1b881317e26d77997), enclosed by merge [`b2e1e6c1e950d54c89b138aff4b382c8cbd4300e`](https://github.com/cheaper-inference/OmniRoute/commit/b2e1e6c1e950d54c89b138aff4b382c8cbd4300e). Its executor drops the Responses `image_generation` hosted tool for free-plan Codex accounts. The dedicated local Codex image path already rejects known free plans before dispatch.

## Local compatibility behavior

`CodexExecutor.transformRequest` now removes only the `image_generation` declaration when the normalized plan is explicitly `free`. Plan resolution reuses the image adapter's field precedence: `chatgptPlanType || workspacePlanType`, followed by lowercase normalization. Paid, unknown, and absent plans retain existing behavior. Other hosted and function declarations retain their content and order.

An explicit `tool_choice: { type: "image_generation" }` is preserved when the declaration is filtered. That request remains incompatible and is not silently converted to text chat. Other existing tool-choice validation remains in place, including removal of function choices that refer to missing function declarations.

## Offline evidence

`tests/unit/omni-codex-free-plan-hosted-image.test.js` invokes the executor's actual request normalization entry point and covers both plan fields, precedence, paid/unknown/absent controls, preservation of other tool types and order, and an explicit hosted image choice. Existing Codex tool normalization and client-version/reasoning fixtures are included in the focused verification command.

Refs #1073
