# #1073 — Late-June route-format and Claude effort extraction ownership

## Scope and exact pins

This review compares three late-June OmniRoute pull requests from the `#3501` `chatCore` decomposition series against current DurinDoor route-format, transport, and thinking/effort ownership and checked-in offline fixtures.

| Source PR | Exact PR head | Immediate parent / PR base | Enclosing merge | Landed patch scope |
| --- | --- | --- | --- | --- |
| [OmniRoute #4507](https://github.com/cheaper-inference/OmniRoute/pull/4507) | [`ac7779e760c4228f35f175054f51e64f5ddd293d`](https://github.com/cheaper-inference/OmniRoute/commit/ac7779e760c4228f35f175054f51e64f5ddd293d) | `b28f6e93464f8a626c29ead13203984e7f073be2` (head parent); `b12c80fa0c8cbed7b70e659ea11195d4e11a252c` (merge parent) | [`0f67eee11ea24d2e908f1b8581ff742bb0666fc6`](https://github.com/cheaper-inference/OmniRoute/commit/0f67eee11ea24d2e908f1b8581ff742bb0666fc6) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/requestFormat.ts`, `tests/unit/chatcore-request-format.test.ts` (`+197 / -38`) |
| [OmniRoute #4511](https://github.com/cheaper-inference/OmniRoute/pull/4511) | [`36b2f7ffab0a916aa5b7bf1fb5c2d112017410c6`](https://github.com/cheaper-inference/OmniRoute/commit/36b2f7ffab0a916aa5b7bf1fb5c2d112017410c6) | `b28f6e93464f8a626c29ead13203984e7f073be2` (head parent); `ac7779e760c4228f35f175054f51e64f5ddd293d` (merge parent) | [`aef00dded563c1da5b0403ba46e38c4b48db0251`](https://github.com/cheaper-inference/OmniRoute/commit/aef00dded563c1da5b0403ba46e38c4b48db0251) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/claudeEffortVariant.ts`, `tests/unit/chatcore-claude-effort-variant.test.ts` (`+183 / -29`) |
| [OmniRoute #4547](https://github.com/cheaper-inference/OmniRoute/pull/4547) | [`6ebbb48aa023837ab0172df84660d56c95ebf83f`](https://github.com/cheaper-inference/OmniRoute/commit/6ebbb48aa023837ab0172df84660d56c95ebf83f) | `3f48f24276d43227b0521444a03071f5d3c3f3a2` (head parent, cherry-picking `#4507`); `8273dfd3708861d3ed6afe27d058f7d16e3a0f83` (PR base and merge parent) | [`0b402e9bf350a030785790d08ec6eed551527010`](https://github.com/cheaper-inference/OmniRoute/commit/0b402e9bf350a030785790d08ec6eed551527010) | `open-sse/handlers/chatCore.ts`, `open-sse/handlers/chatCore/requestFormat.ts`, `open-sse/handlers/chatCore/claudeEffortVariant.ts`, `tests/unit/chatcore-request-format.test.ts`, `tests/unit/chatcore-claude-effort-variant.test.ts` (`+380 / -67` across `8273dfd370..6ebbb48aa0` and `8273dfd370..0b402e9bf3`) |

### Patch provenance notes

- For [#4507](https://github.com/cheaper-inference/OmniRoute/pull/4507), the PR branch stacked on `#4492`'s rebuilt commit (`b28f6e93464f8a626c29ead13203984e7f073be2`, `open-sse/handlers/chatCore/codexQuota.ts`). Comparing `b28f6e93464f8a626c29ead13203984e7f073be2..ac7779e760c4228f35f175054f51e64f5ddd293d` isolates the exact three-file `#4507` patch without pulling in `#4492`'s `codexQuota.ts` changes, and matches the enclosing squash merge `0f67eee11ea24d2e908f1b8581ff742bb0666fc6`.
- For [#4511](https://github.com/cheaper-inference/OmniRoute/pull/4511), the PR head `36b2f7ffab0a916aa5b7bf1fb5c2d112017410c6` (parent `b28f6e93464f8a626c29ead13203984e7f073be2`) and the enclosing merge `aef00dded563c1da5b0403ba46e38c4b48db0251` (rebuilt onto `ac7779e760c4228f35f175054f51e64f5ddd293d`) carry the identical three-file `claudeEffortVariant.ts` extraction.
- For [#4547](https://github.com/cheaper-inference/OmniRoute/pull/4547), the branch consists of two commits on top of PR base `8273dfd3708861d3ed6afe27d058f7d16e3a0f83`: `3f48f24276d43227b0521444a03071f5d3c3f3a2` (re-applying `#4507`) followed by head `6ebbb48aa023837ab0172df84660d56c95ebf83f` (re-applying `#4511`). The enclosing squash merge `0b402e9bf350a030785790d08ec6eed551527010` equals the full two-commit PR range `8273dfd3708861d3ed6afe27d058f7d16e3a0f83..6ebbb48aa023837ab0172df84660d56c95ebf83f` and restores both leaves after release-branch churn.

---

## Summary of dispositions

| Source PR | Subject | Disposition |
| --- | --- | --- |
| [OmniRoute #4507](https://github.com/cheaper-inference/OmniRoute/pull/4507) | `refactor(chatCore): extract pure endpoint/format resolution leaf (#4507, #3501)` | **Behavior-unchanged upstream refactor; no port.** Existing local endpoint/body format detection, client-tool detection, and transport selection remain owned by their current modules. |
| [OmniRoute #4511](https://github.com/cheaper-inference/OmniRoute/pull/4511) | `refactor(chatCore): extract pure Claude effort-variant normalization (#4511, #3501)` | **Behavior-unchanged upstream refactor of a non-local hyphenated suffix convention; no port.** Existing local parenthesized suffix parsing, explicit body-effort precedence, and unified thinking normalization remain authoritative. |
| [OmniRoute #4547](https://github.com/cheaper-inference/OmniRoute/pull/4547) | `refactor(chatCore): restore #4507 + #4511 leaves orphaned from release by churn (#3501) (#4547)` | **Behavior-unchanged release-branch restoration of #4507 and #4511; no port.** Re-applies the identical `requestFormat.ts` and `claudeEffortVariant.ts` leaves without altering runtime behavior. |

---

## 1. OmniRoute #4507 — `resolveChatCoreRequestFormat` extraction

### Exact pins

- PR: [OmniRoute #4507](https://github.com/cheaper-inference/OmniRoute/pull/4507)
- Exact head: [`ac7779e760c4228f35f175054f51e64f5ddd293d`](https://github.com/cheaper-inference/OmniRoute/commit/ac7779e760c4228f35f175054f51e64f5ddd293d)
- Enclosing merge: [`0f67eee11ea24d2e908f1b8581ff742bb0666fc6`](https://github.com/cheaper-inference/OmniRoute/commit/0f67eee11ea24d2e908f1b8581ff742bb0666fc6)

### Source patch contract

The patch moves the inline request-format setup block at the top of `handleChatCore` in `open-sse/handlers/chatCore.ts` and the private `isCopilotClient` helper into `open-sse/handlers/chatCore/requestFormat.ts` (`resolveChatCoreRequestFormat({ clientRawRequest, body, provider, userAgent })`), destructuring the same seven fields in `handleChatCore`:

1. `endpointPath = String(clientRawRequest?.endpoint || "")`
2. `sourceFormat = detectFormatFromEndpoint(body, endpointPath)`
3. `isResponsesEndpoint = /\/responses(?=\/|$)/i.test(endpointPath) || /^responses(?=\/|$)/i.test(endpointPath)`
4. `nativeCodexPassthrough = shouldUseNativeCodexPassthrough({ provider, sourceFormat, endpointPath })`
5. `isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli")`
6. `copilotCompatibleReasoning = isCopilotClient(clientRawRequest?.headers, userAgent)`
7. `clientResponseFormat = sourceFormat === FORMATS.OPENAI_RESPONSES && !isResponsesEndpoint && !isDroidCLI ? FORMATS.OPENAI : sourceFormat`

The upstream commit is a pure extraction with seven characterization tests in `tests/unit/chatcore-request-format.test.ts`; it introduces no runtime behavior change.

### Current local ownership and fixture evidence

DurinDoor splits inbound format detection, outbound transport selection, client-tool passthrough, and response projection across dedicated modules rather than a combined `requestFormat.ts` leaf:

- **Endpoint-first format detection (`detectFormatByEndpoint`)**: [`open-sse/translator/formats.js`](../../../open-sse/translator/formats.js) maps `/v1/responses` to `FORMATS.OPENAI_RESPONSES`, `/v1/messages` to `FORMATS.CLAUDE`, and `/v1/chat/completions` with `Array.isArray(body?.input)` to `FORMATS.OPENAI` (keeping Cursor CLI `input[]` payloads on `/v1/chat/completions` in the OpenAI client dialect at the route boundary, rather than classifying them as `openai-responses` and downgrading a separate `clientResponseFormat` variable).
- **Gateway and handler wiring (`sourceFormatOverride` and `detectFormat`)**: [`src/sse/handlers/chat.js`](../../../src/sse/handlers/chat.js) resolves `sourceFormat = detectFormatByEndpoint(...) || detectFormat(body)` and passes `sourceFormatOverride` into `handleChatCore` ([`src/sse/handlers/chat.js`](../../../src/sse/handlers/chat.js), [`src/sse/handlers/chat.js`](../../../src/sse/handlers/chat.js)); `open-sse/handlers/responsesHandler.js` (removed as dead code, issue #2255) passes `sourceFormatOverride: FORMATS.OPENAI_RESPONSES`. Inside [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js), `sourceFormat` resolves via `sourceFormatOverride || detectFormat(body)`, backed by [`open-sse/services/provider.js`](../../../open-sse/services/provider.js). Compact `/v1/responses/compact` detection is owned by `isCompactResponsesEndpoint` in [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js).
- **Request-scoped transport and target format (`resolveRequestTransport`)**: [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js) and [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js) combine `getModelSupportedFormats`, `getModelTargetFormat`, `getTargetFormat(provider, credentials)`, and `resolveTransport(provider, preferredFormat)` from [`open-sse/services/provider.js`](../../../open-sse/services/provider.js) without altering configured provider endpoints.
- **Client tool, native passthrough, Droid CLI, and Copilot detection**: [`open-sse/utils/clientDetector.js`](../../../open-sse/utils/clientDetector.js) owns `detectClientTool(headers, body)` (recognizing `"antigravity"`, `"github-copilot"`, `"claude"`, `"gemini-cli"`, `"codex"`, and `"deepseek-tui"`) and `isNativePassthrough(clientTool, provider)` (called at [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js)). [`open-sse/handlers/chatCore/streamingHandler.js`](../../../open-sse/handlers/chatCore/streamingHandler.js) owns `isDroidCLI` (`userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli")`) and `needsCodexTranslation` inside `buildTransformStream`. Non-streaming and forced-SSE response projections in [`open-sse/handlers/chatCore/nonStreamingHandler.js`](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) and [`open-sse/handlers/chatCore/sseToJsonHandler.js`](../../../open-sse/handlers/chatCore/sseToJsonHandler.js) project back to `sourceFormat`.
- **Checked-in offline fixture evidence**:
  - [`tests/unit/public-route-tool-conformance-1089.test.js`](../../../tests/unit/public-route-tool-conformance-1089.test.js) exercises `/v1/chat/completions`, `/v1/responses`, and `/v1/messages` through `detectFormatByEndpoint` into `handleChatCore`.
  - [`tests/unit/port-3245-rtk-system-part-type.test.js`](../../../tests/unit/port-3245-rtk-system-part-type.test.js) covers Cursor CLI `input[]` payloads labelled `FORMATS.OPENAI` on `/v1/chat/completions`.
  - [`tests/unit/format-detection-anthropic-version.test.js`](../../../tests/unit/format-detection-anthropic-version.test.js) and [`tests/unit/ollama-claude-regression.test.js`](../../../tests/unit/ollama-claude-regression.test.js) cover `detectFormat`, `getTargetFormat`, and `resolveTransport`.
  - [`tests/unit/codex-compact-chatcore.test.js`](../../../tests/unit/codex-compact-chatcore.test.js) and `tests/unit/ponytail-responses-handler.test.js` (removed as dead code, issue #2255) cover `sourceFormatOverride: "openai-responses"` and `/v1/responses/compact`.

### Disposition

**Behavior-unchanged upstream refactor; no port.** `#4507` is a structural extraction in OmniRoute with zero behavior delta. DurinDoor's existing route-boundary `detectFormatByEndpoint` + `sourceFormatOverride` contract, `resolveRequestTransport`, `detectClientTool` / `isNativePassthrough`, and `buildTransformStream` already own these responsibilities and preserve current provider endpoints and client response formats.

---

## 2. OmniRoute #4511 — `applyClaudeEffortVariant` extraction

### Exact pins

- PR: [OmniRoute #4511](https://github.com/cheaper-inference/OmniRoute/pull/4511)
- Exact head: [`36b2f7ffab0a916aa5b7bf1fb5c2d112017410c6`](https://github.com/cheaper-inference/OmniRoute/commit/36b2f7ffab0a916aa5b7bf1fb5c2d112017410c6)
- Enclosing merge: [`aef00dded563c1da5b0403ba46e38c4b48db0251`](https://github.com/cheaper-inference/OmniRoute/commit/aef00dded563c1da5b0403ba46e38c4b48db0251)

### Source patch contract

The patch extracts OmniRoute's inline Claude effort-variant block (originally added in OmniRoute `#3807`, commit [`cccb087011df661b8d342493eeaf66516cb7ec67`](https://github.com/cheaper-inference/OmniRoute/commit/cccb087011df661b8d342493eeaf66516cb7ec67)) from `open-sse/handlers/chatCore.ts` into `open-sse/handlers/chatCore/claudeEffortVariant.ts` (`applyClaudeEffortVariant({ provider, effectiveModel, body, sourceFormat })`) and adds `tests/unit/chatcore-claude-effort-variant.test.ts`.

In OmniRoute, when `provider === "claude"` or `isClaudeCodeCompatibleProvider(provider)` (`anthropic-compatible-cc-*`), `splitClaudeEffortSuffix(effectiveModel)` checks for a trailing `-{xhigh,max,high,medium,low}` suffix on the model ID, strips `effectiveModel` and `body.model` back to `baseModel`, and—when `sourceFormat !== FORMATS.CLAUDE` and `body` has no explicit `reasoning_effort`, `reasoning.effort`, or `output_config.effort`—assigns `body.reasoning_effort = effort`. The extraction in `#4511` is byte-identical to OmniRoute's prior inline block.

### Current local ownership and fixture evidence

DurinDoor intentionally uses a different model-modifier and effort-resolution architecture:

- **Parenthesized request-only model modifiers (`parseModelModifiers` / `parseSuffix`)**: [`open-sse/translator/concerns/thinkingSuffix.js`](../../../open-sse/translator/concerns/thinkingSuffix.js) parses `model(low|medium|high|xhigh|max|minimal|none|off|auto|thinking|<budget>)` and provider-scoped `fast|standard` service tiers, leaving unknown or hyphenated model IDs intact. [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js) strips the parenthesized modifier once at ingress (`cleanModel`, `modelThinkingIntent`) so routing, capability lookup, compression, accounting, and upstream dispatch all see the clean catalog model ID.
- **Why hyphenated `-<level>` suffixes are not globally stripped on Claude or compatible providers**: In [`open-sse/config/providerModels.js`](../../../open-sse/config/providerModels.js), `<model>-<tier>` lookup is scoped strictly to catalogs that declare thinking presets on `upstreamModelId` (Antigravity tier rows); in other catalogs and custom/compatible nodes, hyphenated `<model>-<level>` strings are distinct catalog or upstream model IDs that must not be rewritten by a heuristic suffix strip. Separately, Claude Code model projection and decoding on `/v1/messages` are owned by [`src/app/api/v1/models/_claudeCompat.js`](../../../src/app/api/v1/models/_claudeCompat.js) (`projectClaudeCodeModel` and `decodeClaudeCodeModelId`, invoked at [`src/sse/handlers/chat.js`](../../../src/sse/handlers/chat.js)), which only strips `claude-` prefixes and `[1m]`/`[200k]` context annotations when the target ID is verified routable.
- **Explicit effort precedence and unified thinking normalization**:
  - [`open-sse/config/providerModels.js`](../../../open-sse/config/providerModels.js) owns `applyProviderThinkingOverride(body, providerThinking)` (which never overwrites a client-supplied `thinking` or `reasoning_effort`) and `resolveRequestedModelTier(thinkingIntent, body, provider)` (which resolves request suffix intent first, then explicit body `reasoning_effort` / `output_config.effort` / `reasoning.effort`, then `thinking.budget_tokens`).
  - [`open-sse/handlers/chatCore.js`](../../../open-sse/handlers/chatCore.js) applies `thinkingIntent = modelThinkingIntent || (thinkingControlled ? null : getModelUpstreamThinkingIntent(alias, cleanModel))` so catalog presets apply only when neither the request suffix, the request body, nor `providerThinking` (`none`/`off`) controls thinking.
  - [`open-sse/translator/concerns/thinkingUnified.js`](../../../open-sse/translator/concerns/thinkingUnified.js) and [`open-sse/translator/concerns/thinkingUnified.js`](../../../open-sse/translator/concerns/thinkingUnified.js) own `extractThinking` (prioritizing `output_config.effort`, explicit `thinking` disable/budget blocks, and `reasoning_effort` / `reasoning.effort`) and `applyThinking` (converting unified intent into `claude-adaptive`, `claude-budget`, `openai`, `openai-responses`, and provider-specific wire shapes on both translated and passthrough paths).
- **Checked-in offline fixture evidence**:
  - [`tests/translator/thinking-unified.test.js`](../../../tests/translator/thinking-unified.test.js) pins `parseSuffix` and unified thinking extraction/conversion across Claude and OpenAI formats.
  - [`tests/unit/thinking-suffix-routing.test.js`](../../../tests/unit/thinking-suffix-routing.test.js) and [`tests/unit/thinking-suffix-chatcore.test.js`](../../../tests/unit/thinking-suffix-chatcore.test.js) verify that parenthesized thinking suffixes are stripped before upstream dispatch and accounting while opaque IDs survive unchanged.
  - [`tests/unit/antigravity-endpoint-tier.test.js`](../../../tests/unit/antigravity-endpoint-tier.test.js) verifies `resolveRequestedModelTier`, `applyProviderThinkingOverride`, non-Antigravity `<model>-<level>` preservation (`does not re-route non-Antigravity <model>-<level> ids by effort`), and suffix/body/preset precedence.
  - [`tests/unit/provider-service-tier-suffix-scope.test.js`](../../../tests/unit/provider-service-tier-suffix-scope.test.js) verifies provider-scoped `parseModelModifiers`.

### Disposition

**Behavior-unchanged upstream refactor of a non-local hyphenated suffix convention; no port.** `#4511` only moves OmniRoute's `#3807` helper into `claudeEffortVariant.ts` without changing behavior. DurinDoor does not synthesize or strip hyphenated `claude-...-{low,medium,high,xhigh,max}` model IDs or define `anthropic-compatible-cc-*` providers; porting `applyClaudeEffortVariant` would conflict with local parenthesized suffix ownership (`parseModelModifiers` / `parseSuffix`) and could corrupt legitimate hyphenated model IDs on compatible providers.

---

## 3. OmniRoute #4547 — Restoration of `#4507` and `#4511` leaves

### Exact pins

- PR: [OmniRoute #4547](https://github.com/cheaper-inference/OmniRoute/pull/4547)
- Exact head: [`6ebbb48aa023837ab0172df84660d56c95ebf83f`](https://github.com/cheaper-inference/OmniRoute/commit/6ebbb48aa023837ab0172df84660d56c95ebf83f)
- Intermediate branch commit: [`3f48f24276d43227b0521444a03071f5d3c3f3a2`](https://github.com/cheaper-inference/OmniRoute/commit/3f48f24276d43227b0521444a03071f5d3c3f3a2)
- PR base / merge parent: [`8273dfd3708861d3ed6afe27d058f7d16e3a0f83`](https://github.com/cheaper-inference/OmniRoute/commit/8273dfd3708861d3ed6afe27d058f7d16e3a0f83)
- Enclosing merge: [`0b402e9bf350a030785790d08ec6eed551527010`](https://github.com/cheaper-inference/OmniRoute/commit/0b402e9bf350a030785790d08ec6eed551527010)

### Source patch contract

After a force-push on OmniRoute's `release/v3.8.33` branch orphaned `#4507` and `#4511`, PR [#4547](https://github.com/cheaper-inference/OmniRoute/pull/4547) re-applied both commits in sequence on top of `8273dfd3708861d3ed6afe27d058f7d16e3a0f83`:

1. `3f48f24276d43227b0521444a03071f5d3c3f3a2` re-applies `#4507` (`open-sse/handlers/chatCore/requestFormat.ts` and `tests/unit/chatcore-request-format.test.ts`, blob hashes `63ad12589b` and `064a2384f2`).
2. `6ebbb48aa023837ab0172df84660d56c95ebf83f` re-applies `#4511` (`open-sse/handlers/chatCore/claudeEffortVariant.ts` and `tests/unit/chatcore-claude-effort-variant.test.ts`, blob hashes `e2a2a8e188` and `03bf40a4c1`).

The squash merge `0b402e9bf350a030785790d08ec6eed551527010` lands the combined five-file diff with the exact same blob hashes as `#4507` and `#4511`.

### Current local ownership and fixture evidence

All local route-format, transport, and thinking/effort ownership and fixtures documented under sections 1 and 2 above apply identically to `#4547`.

### Disposition

**Behavior-unchanged release-branch restoration of #4507 and #4511; no port.** Because `#4547` restores the exact `#4507` and `#4511` extraction leaves byte-for-byte without introducing any new logic, its disposition is identical to the two constituent refactors.

---

## Ordinary offline acceptance

None of the three pinned PR patches (`#4507`, `#4511`, `#4547`) changes upstream runtime behavior or demonstrates a narrow behavior gap in DurinDoor. Current provider endpoints, configured explicit thinking/effort intent, and known defaults are preserved unchanged, and no product code or test modification is warranted.

Existing offline unit and translator fixtures already provide acceptance coverage for the local equivalents:

- `tests/unit/public-route-tool-conformance-1089.test.js` and `tests/unit/port-3245-rtk-system-part-type.test.js` for endpoint-driven format detection (`detectFormatByEndpoint`) across `/v1/chat/completions`, `/v1/responses`, and `/v1/messages`.
- `tests/unit/format-detection-anthropic-version.test.js` and `tests/unit/ollama-claude-regression.test.js` for body-based `detectFormat`, `getTargetFormat`, and `resolveTransport`.
- `tests/translator/thinking-unified.test.js`, `tests/unit/thinking-suffix-routing.test.js`, `tests/unit/thinking-suffix-chatcore.test.js`, `tests/unit/antigravity-endpoint-tier.test.js`, and `tests/unit/provider-service-tier-suffix-scope.test.js` for parenthesized thinking/effort suffix parsing (`parseModelModifiers` / `parseSuffix`), explicit effort precedence (`resolveRequestedModelTier`, `applyProviderThinkingOverride`), and unified thinking application (`extractThinking`, `applyThinking`).
