# #1073 — qualification of OmniRoute #2927

## Disposition

No product change. The earlier [late-May report](1073-late-may-gemini-request-projection.md) called this ready; that conclusion does not hold under the required conversation ownership and pairing constraints. A current local wire-contract failure is not demonstrated by the offline fixtures. Source divergence alone does not establish one.

## Exact source

Inspected the first-parent diff of [merge c2fc3e916f264e7301a6a721843c33cd546e62ee](https://github.com/cheaper-inference/OmniRoute/commit/c2fc3e916f264e7301a6a721843c33cd546e62ee) and the [head 5cb23b4e712ec2f1393df1c6266c238849a2a3b5](https://github.com/cheaper-inference/OmniRoute/commit/5cb23b4e712ec2f1393df1c6266c238849a2a3b5). The merge selects `context` for non-Claude models matching `thinking`, `gemini-3`, `gemini-2.5`, or `gemini-pro`. It omits each signatureless function call, escapes the result into `<previous_tool_result_context source="…">`, and appends that text to a Gemini `user` turn. The head adds escaping of ampersands and angle brackets in the result; the merge tests assert escaping and native treatment of a cached signed call. Escaping delimiters does not retain the tool-result role: the resulting ordinary user text represents tool-returned material as user-authored content. The call and its arguments are omitted, and results are appended after native responses, so mixed signed and signatureless calls also do not preserve their original call/result ordering. These are blockers to the requested projection, independent of whether the source endpoint accepts it.

## Current evidence and boundaries

The current [Antigravity catalog](../../../open-sse/providers/registry/antigravity.js) includes `gemini-3.5-flash-low`, the source fixture model, as well as 3.6, 3.7, and 3.8 Flash tiers and `gemini-pro-agent`; it also explicitly marks `gemini-3-flash` as `thinking: false`. The source name predicate alone therefore does not establish current thinking policy for every matching model. [Declared-thinking fixtures](../../../tests/unit/gemini-declared-thinking-efforts.test.js) exercise current centralized 3.8 and 3 Flash settings, not a provider rejection of historical native calls.

The [current converter](../../../open-sse/translator/request/openai-to-gemini.js) resolves a transported provider signature first, then a session/model-keyed cached signature, then a route-specific synthetic fallback. Antigravity Gemini delegates through the CLI converter; the standard Gemini converter uses its own fallback. Antigravity Claude takes a distinct conversion and envelope path. The Antigravity Gemini delegation currently does not pass credentials to the CLI converter, so a cached lookup there does not receive the client's session ID; that observation does not justify treating a bare ID as definitively unsigned or changing session ownership in this task.

Existing offline [signature-store fixtures](../../../tests/translator/gemini-thought-signature-store.test.js) establish cached replay and the synthetic fallback for normal Gemini. [Antigravity fixtures](../../../tests/translator/bugs-antigravity.test.js) establish transport-signature round-trip with matching native response, signatureless synthetic fallback with matching ID, and occurrence-based disambiguation of reused IDs. They establish current behavior, not an Antigravity endpoint failure for a catalogued thinking model. The source fixture's `gemini-3.5-flash-low` is an existing input, but its expected conversion alone is not evidence of an accepted wire contract or a local defect.

No tool-selection, signature, role, or provider behavior was changed. Ordinary Gemini, Gemini CLI, and Antigravity Claude retain their existing paths. No live provider traffic was used.
