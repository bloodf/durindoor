# #1073 September existing chat core residuals

Scope: six pinned OmniRoute patches were compared with the current DurinDoor source and installed offline fixtures. Public commit links below pin the patch itself; enclosing merge pins identify the integration context. A merge is not treated as the PR diff when it contains unrelated changes. Privacy and boundary behavior is assessed statically; no raw logs, credentials, live providers, or unsafe reproduction were used.

## Findings

### OmniRoute #14252 — internal marker stripping

- Patch: [48da1b47b6d97d894120c857db7fa3b3e0fc94eb](https://github.com/cheaper-inference/OmniRoute/commit/48da1b47b6d97d894120c857db7fa3b3e0fc94eb), integrated by [1fb7c9d7fcc73035ed6c241574b81a8c00663ea0](https://github.com/cheaper-inference/OmniRoute/commit/1fb7c9d7fcc73035ed6c241574b81a8c00663ea0).
- The patch strips `_omniroute*` markers at shared pre-executor normalization and adds a dispatch regression fixture. Current `open-sse/handlers/chatCore.js` calls `stripInternalKeys(translatedBody)` at the outbound boundary; `open-sse/translator/validate.js` owns that sanitizer. `tests/unit/openai-responses-custom-tools-3373.test.js` verifies internal keys are stripped from a translated provider body. This fixture is adjacent evidence, not a universal-handoff dispatch assertion.
- **Disposition: covered by the current outbound sanitizer; exact universal-handoff dispatch coverage remains a narrow fixture gap.** If expanding coverage, add an ordinary offline chat-core fixture that sends a body carrying representative internal markers through dispatch and asserts the executor receives none.

### OmniRoute #14314 — Claude safeguards and empty stream

- Patch: [d8b9885e183dd59105f4ab4878abadbf08b51bea](https://github.com/cheaper-inference/OmniRoute/commit/d8b9885e183dd59105f4ab4878abadbf08b51bea), integrated by [b3867e4e93d19a3e6903defb84bdb4c8f4242251](https://github.com/cheaper-inference/OmniRoute/commit/b3867e4e93d19a3e6903defb84bdb4c8f4242251).
- The patch conditions native Claude `safeguards` retention on forwarding its paired beta and also relocates empty-stream handling. Current tree has Claude passthrough normalization and empty-stream recovery in `open-sse/handlers/chatCore.js` and `open-sse/handlers/chatCore/emptyStreamGuard.js`; `tests/unit/agy-empty-stream-chatcore.test.js` exercises chat-core empty-stream recovery. This is not evidence that the exact paired-beta/safeguards predicate is covered.
- **Disposition: empty-stream attempt settlement has installed fixture coverage; safeguards pairing is not established by that evidence.** Ordinary offline acceptance for a demonstrated gap: fixture the passthrough body and outbound beta together, asserting safeguards is retained only when the matching beta is sent and stripped otherwise. No live Claude call is needed.

### OmniRoute #14324 — late usage during artifact enrichment

- Patch: [2052a5e78020d4077957bc837821d8bdd6b7609b](https://github.com/cheaper-inference/OmniRoute/commit/2052a5e78020d4077957bc837821d8bdd6b7609b), integrated by [95651e6e49cd15ed492cb6ee69835b1673df428c](https://github.com/cheaper-inference/OmniRoute/commit/95651e6e49cd15ed492cb6ee69835b1673df428c).
- This is dashboard request-detail enrichment, not chat-core routing. Current installed inventory has usage preservation and stream terminal-usage fixtures, including `tests/unit/v5-usage-preservation.test.js` and `tests/unit/stream-usage-replaces-estimate.test.js`; neither is the exact in-memory artifact-enrichment race fixture.
- **Disposition: adjacent usage accounting coverage only; no chat-core residual is demonstrated.** Do not infer retry, trace, or observability features from this dashboard patch.

### OmniRoute #14447 — collaboration function-call marker

- Patch: [2e2c76eca93b2d8cf67bfd5af5033bbfd16bafcb](https://github.com/cheaper-inference/OmniRoute/commit/2e2c76eca93b2d8cf67bfd5af5033bbfd16bafcb), integrated by [38cbb7ef801a461f41958edffb1c08cdb571094e](https://github.com/cheaper-inference/OmniRoute/commit/38cbb7ef801a461f41958edffb1c08cdb571094e).
- The patch adds the plaintext marker to collaboration function-call emitters and threads identity through the Responses transformer. Current response translation has `isCodexMultiAgentPlaintextTool` in `open-sse/translator/concerns/codexMultiAgent.js`; `open-sse/translator/response/openai-responses.js` stamps `encrypted_function_args: []` in both relevant emission paths, while `completionProjector.js` stamps projected output. `tests/unit/codex-client-version-and-reasoning.test.js` covers marker presence for collaboration calls and absence for unrelated tools.
- **Disposition: existing response adapter behavior and fixture coverage; no gap demonstrated.** This marker is adapter response handling, not an added collaboration runtime or retry feature.

### OmniRoute #14465 — foreign account quota headers

- Patch: [ec6c4b4cc3a6af5e767dc222cfc73ec62e8340ae](https://github.com/cheaper-inference/OmniRoute/commit/ec6c4b4cc3a6af5e767dc222cfc73ec62e8340ae), integrated by [ee372a4b4b63ca48206ab38b916651c58eba53b4](https://github.com/cheaper-inference/OmniRoute/commit/ee372a4b4b63ca48206ab38b916651c58eba53b4). The head is a release merge; the enclosing PR title identifies the named #14116 patch carried by that merge. Assessment is limited to that patch, not the merge's unrelated release content.
- The upstream change filters Codex quota headers for a foreign combo/pool account across normal and streaming response paths. Current source has request-local Codex identity helpers in `open-sse/config/codexIdentity.js`, outbound identity resolution in `open-sse/executors/codex.js`, and chat response header handling in chat-core. Installed `tests/unit/codex-identity.test.js` checks outbound identity, but does not establish the upstream foreign-account response-header filter.
- **Disposition: privacy-sensitive response-header boundary; static review only, evidence does not establish equivalent filtering.** Ordinary offline acceptance if treated as a gap: feed synthetic headers and fixture identities through the response-header helper, asserting foreign-account quota headers are omitted and same-account headers are retained, for both stream and non-stream paths. No credential or live quota access is required.

### OmniRoute #14527 — echoed cues in retained provider failures

- Patch: [5e090ebb20863a2a2ab0229dca1452e83c445e74](https://github.com/cheaper-inference/OmniRoute/commit/5e090ebb20863a2a2ab0229dca1452e83c445e74), integrated by [2afbd8723afffe99bf554b4330f2495e19895916](https://github.com/cheaper-inference/OmniRoute/commit/2afbd8723afffe99bf554b4330f2495e19895916).
- The patch removes echoed video cues from retained provider failure diagnostics. Current chat-core error handling uses sanitization and request-detail boundaries, but the installed evidence inspected here does not establish cue-specific redaction in retained failures. This is a privacy boundary; review remained static and did not inspect raw logs or reproduce provider failures.
- **Disposition: static review cannot claim cue-specific equivalence; narrow offline redaction coverage is warranted if this retained-failure path is in scope.** Acceptance can use a synthetic error object with harmless sentinel cue text and assert the retained diagnostic omits it, while preserving non-sensitive status classification. No provider traffic or exploit reproduction is needed.

## Scope distinction

These patches concern existing request-body formatting, adapter response handling, response headers, attempt settlement, dashboard usage enrichment, and diagnostic redaction. They do not establish absent trace, collaboration-agent runtime, retry policy, or generalized observability features. Only the three explicitly identified narrow fixture gaps above merit ordinary offline acceptance; no product implementation or tests were changed in this report task.
