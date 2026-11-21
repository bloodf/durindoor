# #1073 May existing reasoning request shapes

Review compares the exact public PR heads below with this checkout's translator and offline fixtures. Enclosing merge commits are cited for provenance; each reviewed patch is the named PR head diff.

## #2639 — already covered; no port

- PR head [`bbe4a611536de454202b96abcb3288e953485314`](https://github.com/cheaper-inference/OmniRoute/commit/bbe4a611536de454202b96abcb3288e953485314); enclosing merge [`81a35b8141776cf16e30008a0e86188694869754`](https://github.com/cheaper-inference/OmniRoute/commit/81a35b8141776cf16e30008a0e86188694869754).
- The patch broadens injection of an empty `reasoning_content` on assistant tool-call history from DeepSeek-only detection to `requiresReasoningReplay`, including Kimi K2 and other replay models.
- Current behavior: [`reasoningContentInjector.js`](../../../open-sse/utils/reasoningContentInjector.js) applies a `toolCalls` model rule to `kimi-*` IDs, and provider registry `reasoningInject` rules cover provider-scoped cases. The fixture [`reasoningContentInjector.test.js`](../../../tests/unit/reasoningContentInjector.test.js) verifies Kimi tool-call injection, existing reasoning preservation, non-reasoning exclusion, and provider-level DeepSeek/MiniMax behavior. This establishes the relevant request-shape behavior locally; the upstream helper is not present under the same name or TypeScript path.
- Disposition: no independent current gap demonstrated. Do not port upstream provider/model enumeration or add support based on those rows.

## #2699 — cleanup only; no port

- PR head [`c7dd1c848e90ecacc9179ac7177530237f1d027d`](https://github.com/cheaper-inference/OmniRoute/commit/c7dd1c848e90ecacc9179ac7177530237f1d027d); enclosing merge [`8d0f751b85a638b2246d1c68a54026baf0aeced9`](https://github.com/cheaper-inference/OmniRoute/commit/8d0f751b85a638b2246d1c68a54026baf0aeced9).
- The patch removes the `tool_use_id` fallback when selecting a Claude `tool_use` ID and removes a redundant negative index guard. It does not change the intended replay behavior.
- Current behavior: [`translator/index.js`](../../../open-sse/translator/index.js) retains the fallback and guard in its Claude reasoning replay branch. The existing fixture [`port-2401-reasoning-history-bridge.test.js`](../../../tests/translator/port-2401-reasoning-history-bridge.test.js) exercises readable and opaque Claude history, but no fixture isolates this dead-code cleanup.
- Disposition: no behavioral gap demonstrated; retain compatibility cleanup only if a local change independently needs it. No port or added test is warranted for the equivalent behavior.

## #2843 — lookup guard not applicable; no port

- PR head [`b209387d9f0531b08370ffdd50f32870328034bd`](https://github.com/cheaper-inference/OmniRoute/commit/b209387d9f0531b08370ffdd50f32870328034bd); enclosing merge [`dd5098bf6753a8573ad3c7862925cbe4dc404b69`](https://github.com/cheaper-inference/OmniRoute/commit/dd5098bf6753a8573ad3c7862925cbe4dc404b69).
- The patch makes an `interleavedField` capability read null-safe in a reasoning replay call. Current provider metadata includes `interleavedField` in [`sensenova.js`](../../../open-sse/providers/registry/sensenova.js) and [`opencode-zen.js`](../../../open-sse/providers/registry/opencode-zen.js), but [`translator/index.js`](../../../open-sse/translator/index.js) has no corresponding `resolvedCapabilities.interleavedField` lookup or replay call. The existing [reasoning history fixture](../../../tests/translator/port-2401-reasoning-history-bridge.test.js) covers format-based Claude history conversion, not that upstream capability path.
- Disposition: no matching unsafe lookup or distinct request behavior exists in the current translator path, so this hunk does not demonstrate a local gap. Do not add capability plumbing or provider traffic to reproduce it.

## Acceptance

No narrow behavior change is demonstrated by these patches against current source and fixtures. No product change or new test is proposed; ordinary offline acceptance is therefore the requested report-presence and pin-content checks.
