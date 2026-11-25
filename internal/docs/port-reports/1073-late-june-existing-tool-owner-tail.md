# #1073: late June existing tool owner tail

Review date: 2026-11-21. Scope is the three named public PR heads, inspected as their exact head commits rather than treating their enclosing merges as single-purpose patches:

| PR | Exact head | Enclosing merge | Disposition |
|---|---|---|---|
| [OmniRoute #5250](https://github.com/cheaper-inference/OmniRoute/pull/5250) | `7c535baa0cc1d5988c97dcb04da44b62c63ac463` | `503b1205c61584bd6e2a4821883e7a576d807588` | Do not port as submitted; preserve caller-owned shell functions and close the narrowly demonstrated hosted `local_shell` gap separately. |
| [OmniRoute #5256](https://github.com/cheaper-inference/OmniRoute/pull/5256) | `141b1a86e65f4e433e767d58ea7e28a7eb2ef65e` | `25139348775a592705ed8ed75ed12ca334c964d1` | No port: comment-only deletions; behavior and assertions remain. |
| [OmniRoute #5273](https://github.com/cheaper-inference/OmniRoute/pull/5273) | `db360c4002e9830c811ec86d4feed2b675b935fc` | `57f81f60d5eae0524ad3857f11b16ae1bc075eb6` | No port: current implementation and offline tests already cover the parameter stripping. |

## #5250: distinguish shell ownership

The exact PR head removes comments asserting that Responses `local_shell` is no longer supported and adjusts a test to include that hosted tool in the preserved set. It does not establish that caller-side shell functions should be removed. Current Codex normalization recognizes `local_shell` in `CODEX_HOSTED_TOOL_TYPES` in [open-sse/executors/codex.js](../../../open-sse/executors/codex.js), alongside service-executed tools such as `web_search`, `image_generation`, and `code_interpreter`. Its current fixture asserts that these hosted tool types, including `local_shell`, survive normalization in [tests/unit/codex-tool-normalization.test.js](../../../tests/unit/codex-tool-normalization.test.js).

The shell function identity is a different shape and owner: a caller sends a function tool (for example `exec_command`) and receives a function call to execute itself. It is not a hosted Responses `local_shell` tool. Preserve that function declaration, matching `tool_choice`, and returned function call unchanged. Do not convert it into a hosted capability or execute it in the gateway.

The public #5250 patch’s evidence identifies the unsupported hosted variant as the `local_shell` type; current local fixtures do not encode that rejection and instead affirm pass-through. Narrow gap: remove only hosted `local_shell` from the hosted allowlist and discard only `tool_choice: {type: "local_shell"}`. Retain general Responses-shaped tools, explicit function tool choice, and all service-owned capabilities already recognized. Ordinary offline acceptance should prove that a hosted `local_shell` declaration and matching hosted choice are omitted, while a sibling `web_search`/`image_generation` declaration survives and an `exec_command` function declaration plus explicit function choice survives byte-for-structure through request normalization. A response fixture should keep the function call caller-side. No hosted tool execution is part of this acceptance.

## #5256: no behavior delta

The exact head removes explanatory comments from the Responses translator request test. The test still exercises the same empty-call-id case and asserts both that the orphan tool result is absent and that the assistant call with an empty id is absent. Current behavior and assertions remain in the corresponding Responses request translator coverage. This is test-comment cleanup, not an ownership or request-shape change; no port or additional acceptance test is warranted.

## #5273: Grok parameters already handled

The public patch adds a Grok CLI fixture for unsupported `presencePenalty`, `frequencyPenalty`, `logprobs`, and `topLogprobs`, while retaining `temperature`, `top_p`, and message content. Current `GrokCliExecutor.transformRequest` deletes those camelCase fields and also `top_logprobs`; its Responses allowlist retains supported `temperature` and `top_p`. Existing offline evidence is in [tests/unit/grok-cli-strip-params.test.js](../../../tests/unit/grok-cli-strip-params.test.js), which verifies all four requested fields disappear, the supported sampling values remain, messages become Responses `input`, and streaming is enabled. [tests/unit/omniroute-oauth-provider-slice.test.js](../../../tests/unit/omniroute-oauth-provider-slice.test.js) independently checks rejected parameter stripping. The #5273 behavior is already present, so the upstream test addition is redundant; no code or test port is needed.

## Evidence boundary

The review used the exact public commit diffs above and local source/tests. No live provider traffic, account access, new tools, or external requests were used. The only acceptance proposal is the offline, shape-preserving hosted-versus-caller ownership regression described for #5250.
