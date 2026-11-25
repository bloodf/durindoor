# #1073 — Codex free-plan optional hosted image declaration

OmniRoute [#2999](https://github.com/cheaper-inference/OmniRoute/pull/2999) records that Codex CLI adds `image_generation` to Responses requests even when a free-plan account cannot execute the hosted tool. Candidate `59b4f8f77b3` applied the free-plan filter but also removed a declaration selected explicitly by the caller, leaving `tool_choice` without its matching tool.

The executor now filters that declaration only when stored plan metadata resolves to the exact string `free` after trimming and case normalization. `chatgptPlanType` retains precedence over `workspacePlanType`; unknown, malformed, paid, and absent values do not activate filtering. The declaration remains when the caller explicitly chooses `image_generation`, and when `tool_choice: "required"` would otherwise have no executable option. Optional declarations are removed while other executable tools remain. The separate image endpoint policy is unchanged.

The ordinary mocked unit suite covers normalized plan values, precedence and controls, optional image filtering alongside other tools, explicit image choice, required choice with image as the sole executable option, and required choice with another executable option.

Refs #1073
