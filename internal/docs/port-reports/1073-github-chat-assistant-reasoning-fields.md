# #1073: GitHub Copilot chat route must omit the assistant reasoning fields

Source: [OmniRoute #923](https://github.com/cheaper-inference/OmniRoute/pull/923) "fix: GitHub Copilot token refresh failure and reasoning field stripping", head `51c734e4388a4b6b3000348290d7ff81386dbfbc`, merge commit `2ab41a359eceec4dc0b0bd60bf59a058e0ba8d5c` (first parent `c87167cac414c908a01c56f4663572b84ef594c8`; merge base `e121fec5996b9f3e720b041e1f6382f8074c7f85`; upstream files `open-sse/executors/github.ts`, `src/sse/services/tokenRefresh.ts`, `+23/−0`). The upstream PR content (`merge-base..head`) is byte-identical to the merge commit's first-parent patch (`c87167cac4..2ab41a359eceec4dc0b0bd60bf59a058e0ba8d5c`) — a clean merge, 2 files, 23 insertions — verified in the public-source scratch mirror `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`. Local comparison base: this worktree's integration head. No provider request, live account, credential access, browser, Docker, paid API or whole-suite run was used; every statement below comes from the upstream diff, this repository's code, and offline fixtures.

This resolves the row recorded as UNRESOLVED in [the April recovered dispositions](1073-april-recovered-1-dispositions.md) (`#923`, same head and merge pins) and the residual described in [the April provider-runtime dispositions](1073-april-provider-runtime.md).

## Disposition: confirmed residual — ported, message-field half only

**The local shape was not already compatible.** The upstream executor deletes `reasoning_text` and `reasoning_content` from assistant messages before dispatch, because Copilot converts those fields into Anthropic thinking blocks it cannot sign, and the upstream then answers 400 (`Invalid signature in thinking block`).

The local GitHub Copilot chat route forwarded both fields untouched:

- `open-sse/executors/github.js:117` (`sanitizeMessagesForChatCompletions`) rewrites only `content` parts and drops a trailing assistant prefill; it never touches a message-level field.
- `open-sse/executors/github.js:172` (`transformRequest`) runs `stripUnsupportedParams("github", model, transformed)`, and the `github` rules in `open-sse/translator/concerns/paramSupport.js:24` and `:29` are top-level `drop` rules only. The existing message-level mechanism (`dropMessageFields`, `paramSupport.js:44-46`, `:164-179`) is used by `groq`, `mistral` and `cerebras`, and it had no `github` rule.
- The field is reachable on this route: `open-sse/translator/request/claude-to-openai.js:437` and `:455` attach `reasoning_content` to assistant messages, and the GitHub provider targets the `openai` format, so a Claude-format client routed to Copilot produces exactly the shape upstream removes. A client that replays Copilot's own `reasoning_text` on the assistant turn produces the second field.

**Existing equivalents checked, and why they do not already cover this.** Three local mechanisms were examined:

- `src/sse/handlers/chat.js:361` (`stripReasoningFromMessages`) strips `reasoning_content` for every provider except DeepSeek, but it runs on the **client-format** body before translation, so it never sees a `reasoning_content` that the Claude → OpenAI pivot creates afterwards. It also does not know `reasoning_text` at all.
- `open-sse/translator/concerns/paramSupport.js` has the right mechanism (`dropMessageFields`, assistant turns only) but no `github` rule.
- `open-sse/executors/github.js:373` (`normalizeClaudePassthrough` on the Anthropic-native route) already strips unsigned thinking for the `/v1/messages` route. The chat route had no counterpart — that is the residual.

### Change

`open-sse/executors/github.js` — the GitHub Copilot **chat completions** request shaping.

- `stripAssistantReasoningFields(message)` (`:85-111`) drops `reasoning_text` and `reasoning_content` from an assistant turn and returns everything else unchanged. The copy is built from the original property descriptors, so the non-enumerable Claude native blocks a message may carry survive the rewrite (`open-sse/translator/schema/blocks.js`).
- `sanitizeMessagesForChatCompletions()` (`:147-150`) applies it to the messages it is about to send.

**Why this location.** It is the executor's existing per-route request shaping for Copilot's `/chat/completions` endpoint — the one route that forwards assistant reasoning to an OpenAI-shaped Copilot endpoint. It is the narrowest scope available in this fork:

- The Anthropic-native `/v1/messages` route returns before `sanitizeMessagesForChatCompletions` is reached (`open-sse/executors/github.js:252-254`), so its signed thinking blocks are untouched.
- The `/responses` route bypasses `transformRequest` and this shaper entirely (`open-sse/executors/github.js:737`).
- `GheCopilotExecutor` (`open-sse/executors/ghe-copilot.js:28`) inherits the executor, so the enterprise host gets the same fix for the same upstream API; that is the executor's documented "identical request handling" contract, not a second provider.

The strip is applied to a copy, so the caller's body object is never mutated: another provider in the same request (a combo member, a fallback) still sees the original body.

### Actual behavior

Before: the outbound `/chat/completions` body carried the assistant turn's `reasoning_text` and `reasoning_content` verbatim, and Copilot turned them into unsigned Anthropic thinking blocks and answered 400.

After: the assistant turn that reaches Copilot carries neither field. Everything else about the request is byte-identical — same roles in the same order, same message content, same `tool_calls`, same `tools` definitions, same `model`.

### What is preserved

- **Other roles.** Only `role: "assistant"` messages are touched. A user turn that carries a `reasoning_content` keeps it, matching the scope of the upstream change and the local `dropMessageFields` contract (`paramSupport.js:160-163`, `#4220`).
- **Tools and message content.** The assistant's `content`, its `tool_calls`, the `tool` turns and the request-level `tools` definitions are unchanged; only the two reasoning fields are removed.
- **Anthropic-native signed thinking.** The `/v1/messages` route is not reached by this change. A signed thinking block (`signature` present and valid) still survives the OpenAI → Claude pivot and the `normalizeClaudePassthrough` validation (`open-sse/translator/formats/claude.js:737-798`).
- **Responses path.** The `/responses` route is not reached by this change, and it never carried the fields anyway: the Chat → Responses assembler deliberately does not replay chat `reasoning_content` as a Responses reasoning item (`open-sse/translator/request/openai-responses.js:895`).
- **Selected model.** The strip does not touch `model`; the outbound body still names the selected model.
- **Both transport modes.** The chat route behaves the same for a streaming and a non-streaming request, and for a `copilotToken` connection and an access-token-only connection.
- **Other providers.** No shared mechanism was changed. `paramSupport.js` is untouched, so `groq` / `mistral` / `cerebras` keep their own `dropMessageFields` rules, DeepSeek keeps its required `reasoning_content`, and another provider's executor still forwards assistant reasoning.

### Not ported from this source

The upstream PR also carries two credential-side changes, and the port's boundary excludes token mirroring and sign-in/credential work:

- `open-sse/executors/github.ts` mirrors the refreshed Copilot token into `providerSpecificData` on both refresh paths.
- `src/sse/services/tokenRefresh.ts` copies the refreshed Copilot token to the top level of the credential object so `buildHeaders()` picks it up.

Both are already present locally, in different and more central places: the executor's own refresh paths return the token at the top level (`open-sse/executors/github.js:931`, `:938`), `src/sse/services/tokenRefresh.js:329` sets `creds.copilotToken` at the top level after a refresh, `src/shared/services/providerCredentials.js:321-322` lifts `providerSpecificData.copilotToken` for every executor, and `src/sse/handlers/typeHelpers.js:97` preserves it. `open-sse/executors/github.js:66` reads the top-level token. There is no local counterpart to add, and no credential, sign-in, persisted-key, provider-catalog or route change was made by this port.

## Verification

`tests/unit/omni-github-chat-assistant-reasoning-fields.test.js` (new) asserts against the **actual outbound executor request**, captured from a mocked offline transport (`open-sse/utils/proxyFetch.js` mocked; no network, no account, no credential):

- the assistant turn the executor sends to `/chat/completions` has neither `reasoning_text` nor `reasoning_content`, and the serialized keys are absent;
- the roles, the assistant content, its `tool_calls`, the `tool` turn, the request-level `tools` and the selected `model` survive unchanged, and a non-assistant turn keeps its own field;
- the same holds for a non-streaming request and for an access-token-only connection;
- the caller's body object is not mutated;
- an assistant turn without reasoning fields is untouched;
- the Claude → OpenAI pivot that a Claude-format client goes through really does put `reasoning_content` on the assistant turn, and the chat route does not forward it;
- the Anthropic-native `/v1/messages` route still sends the signed thinking block with its signature;
- the `/responses` route still sends a `messages`-free body with no reasoning field anywhere in it;
- another provider's executor (`DefaultExecutor("openai")`) still forwards the assistant `reasoning_content`.

The three chat-route assertions fail when the fix is reverted (verified by temporarily removing the strip call: `3 failed | 6 passed`), and the six preservation assertions pass in both states — they do not depend on the change.

Focused run:

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-github-chat-assistant-reasoning-fields.test.js
```

Result: `Test Files 1 passed (1)`, `Tests 9 passed (9)`.

Related existing coverage was run unchanged and still passes: the ten `unit/github-*.test.js` files plus `unit/param-support.test.js`, `unit/omniroute-provider-field-strips-exec.test.js` and `unit/omni-responses-text-native-1073.test.js` (13 files, 204 tests passed), and the reasoning-history set `translator/thinking-unified.test.js`, `translator/omniroute-7912-7919-reasoning.test.js`, `translator/port-2401-reasoning-history-bridge.test.js`, `unit/reasoning-history-bridge.test.js`, `unit/omni-chat-responses-reasoning-history.test.js`, `unit/reasoningContentInjector.test.js`, `unit/openai-responses-assistant-merge.test.js`, `unit/grok-cli-foreign-reasoning.test.js`, `unit/claude-reasoning-response.test.js`, `unit/omni-response-mask-reasoning-shape.test.js` (10 files, 185 tests passed). No existing assertion was edited or removed. The whole-suite gate (`cd tests && npm run test:ci`) was not run, per the port's scope.

**Uncertainty that cannot be resolved offline.** No request was sent to Copilot, so the exact upstream 400 body was not reproduced here, and the assertion that Copilot rejects these two fields on assistant history rests on upstream's own report. Whether a specific Copilot account or model tolerates the fields was not measured, and the fix is a no-op for an account that accepted them.

## Follow-up: immutable assistant turns followed the same scope

**The defect.** `stripAssistantReasoningFields()` built its copy from **all** of the original own property descriptors and then removed the two reasoning fields with `delete` on the copy. An own descriptor that is not configurable cannot be deleted after the object has been constructed, so an assistant turn the caller made immutable — a frozen message, or one whose `reasoning_content` / `reasoning_text` is defined as a non-configurable descriptor — made `delete` throw `TypeError: Cannot delete property 'reasoning_text' of #<Object>` in the module's strict mode. The exception escaped `sanitizeMessagesForChatCompletions()` and the whole chat request failed before it reached Copilot, instead of being stripped.

**The change.** `open-sse/executors/github.js` — `stripAssistantReasoningFields()` now keeps only the **other** descriptors on the new object: the descriptor map is read once, the two reasoning entries are dropped from the map, and the copy is created from what remains. A non-configurable descriptor is never deleted, so a mutable and an immutable assistant turn end up with the same scope: the two reasoning fields gone, everything else carried over.

**What is preserved.**

- **The source object.** The caller's message is never mutated; the frozen turn still carries its own reasoning fields afterwards.
- **The native non-enumerable blocks.** The copy is still built from the original descriptors, so the non-enumerable Claude native blocks a pivoted message carries survive the rewrite with their own `enumerable` / `writable` / `configurable` flags.
- **The original prototype.** The copy keeps the source's prototype, so a message with a custom prototype is not silently flattened to a plain object.
- **The unaffected settings.** Every other descriptor keeps its own flags — a frozen turn's `content` stays non-writable and non-configurable on the copy.

**Scope.** Chat route only, exactly as the original port: the Anthropic-native `/v1/messages` route returns before the shaper is reached and keeps its signed thinking blocks, the `/responses` route bypasses it and keeps its own body, and no provider, auth, credential or `/responses` behaviour changed. `paramSupport.js` is untouched, so `groq` / `mistral` / `cerebras` keep their own `dropMessageFields` rules.

**Verification.** The focused fixture `tests/unit/omni-github-chat-assistant-reasoning-fields.test.js` keeps its nine existing assertions unchanged and adds two: one that drives a frozen and a read-only assistant turn through the actual outbound executor request, and one that checks the copy directly — the source is untouched, only the two reasoning fields are gone, and the prototype, the native blocks and the other descriptors' settings survive.

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-github-chat-assistant-reasoning-fields.test.js
```

Result: `Test Files 1 passed (1)`, `Tests 11 passed (11)`. Against the pre-follow-up implementation the two new assertions fail with `TypeError: Cannot delete property 'reasoning_text' of #<Object>` and the nine existing ones still pass (`2 failed | 9 passed`), so they pin the defect rather than the fix.

Related existing coverage was run unchanged and still passes: the ten `unit/github-*.test.js` files plus `unit/param-support.test.js`, `unit/omniroute-provider-field-strips-exec.test.js`, `unit/omni-responses-text-native-1073.test.js` and this fixture (14 files, 215 tests passed). The anti-slop/oxlint gate passes with 0 diagnostics across 2736 files. The whole-suite gate (`cd tests && npm run test:ci`) was not run, per the port's scope.

Refs #1073
