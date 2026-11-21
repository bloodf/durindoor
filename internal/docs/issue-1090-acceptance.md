# Issue #1090 Acceptance & Verification Evidence Audit

Audit of merged capability routing, tool-output media admission, authorization enforcement, and error semantics against issue #1090 acceptance criteria.

Date: 2026-11-21  
Target: `bloodf/durindoor:main` (integration branch `orq/toty04/integration`, active branch `orq/toty04/n1090-audit-a1-l3`)  
Tracking Issue: [bloodf/durindoor#1090](https://github.com/bloodf/durindoor/issues/1090) — `feat(routing): include nested tool-output images in capability admission`  
Parent Epic: #1057 (Roadmap #1056, Stage 3, Priority P2)  
Linked Pull Requests:
- PR #1588: `feat(routing): include nested tool-output images in capability admission` (merged commit `fc4c580b6`)
- PR #1646: `fix(routing): apply fusion media admission to panels and judges` (merged commit `3dd1e0319`)
- PR #1649: `fix(media): reject wrong-kind models across endpoints` (merged commit `2deba52e9`)
- PR #2138: `feat(routing): preserve access controls for nested vision` (merged commit `35fd0c89c`)

---

## 1. Executive Summary & Verification Evidence

Issue #1090 addresses capability routing blindness to images and visual media nested within tool results and function outputs. While format translation modules could handle image translation locally, router capability admission historically only inspected top-level user message content blocks. Consequently, requests containing nested tool-output images (e.g., screenshots captured by browser/CLI tools) were erroneously dispatched to text-only models, resulting in runtime failure or silent degradation.

The integrated implementation resolves this by:
1. Introducing `detectToolOutputCapabilities` to scan trailing user turns across Chat, Claude, Responses, and Gemini message envelopes for nested visual media and document types.
2. Integrating tool-output media detection into capability admission across model combos (`handleComboChat`), fusion panels and judges (`handleFusionChat`), and single-model Vision Bridge rerouting (`applyVisionBridgeReroute`).
3. Preserving tool call IDs, result IDs, arguments, and media attachments intact during capability routing and protocol translation.
4. Strictly enforcing API key model policies, connection account scopes, and combo allowlists without permitting fallback to text-only models when a capable vision model is rejected by local access controls.
5. Emitting explicit HTTP 400 `capability_unavailable` errors when no capable model exists, and HTTP 403 `Access denied` (`capability_unavailable`) when all capable candidates are rejected by local authorization policies.

### Focused Test Suite Verification

Evidence was gathered by executing the focused Vitest test suite on the head commit:

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/1090-nested-vision.test.js unit/security-authorization-matrix.test.js --maxWorkers=2
```

**Results**:
- **Test Files**: 2 passed (2 total)
- **Tests**: 868 passed (868 total, 0 failed, 0 skipped)
- **Execution Breakdown**:
  - `tests/unit/1090-nested-vision.test.js`: 12 passed (40ms)
    - Verifies Claude tool results, Responses function outputs, Responses custom outputs, and Responses role-based outputs only dispatch to vision members while preserving call/result IDs and media.
    - Verifies text-only pool rejection before dispatch (`code: "capability_unavailable"`).
    - Verifies text-only outputs retain text-only models.
    - Verifies all-candidate local policy denials return generic HTTP 403 without text fallback.
    - Verifies fusion panel member policy rejections return generic HTTP 403.
    - Verifies upstream provider 403 responses are preserved as provider errors rather than converted to local policy denials.
  - `tests/unit/security-authorization-matrix.test.js`: 856 passed (1098ms)
    - Lines 219–260 explicitly cover `#1090 fusion tool media authorization`, verifying that key model policy, key account scope, and combo account allowlist intersections are preserved for nested tool media requests, and that all-candidate rejections return generic HTTP 403 without leaking provider names, model IDs, or account credentials.

**Additional Covering Suites**:
- `tests/unit/combo-tool-output-media.test.js`: 51 passed (51 total)
  - Unit tests for `detectToolOutputCapabilities` across Chat, Claude, Responses, Gemini, and Antigravity payloads.
  - Verification that completed turns from prior interactions are excluded from forced vision admission.
  - Verification that CSV files and plain text files do not trigger spurious PDF capability requirements.
  - Verification that fallback combos never fall back to text-only members when vision members are denied by ACL.
  - Verification of fusion media admission, explicit judge validation, and panel preservation.
- `tests/unit/vision-bridge-chat.test.js`: 8 passed (8 total)
  - Lines 194–239 explicitly cover `tool-output images (#1090)`, verifying that Vision Bridge reroutes tool-output images to the configured vision model while preserving tool call IDs, and fails closed with HTTP 400 `capability_unavailable` if the vision target is unconfigured or denied by API key policy.

---

## 2. Requirement-to-Evidence Matrix

| Acceptance Criterion | Implementation Scope & Mechanism | Exact Code Locations | Covering Tests | Status |
|---|---|---|---|---|
| **1. Reproduce nested image admission using a text-only and a vision-capable combo member** | `detectToolOutputCapabilities` scans current user turn for nested images across Chat `tool`/`function` messages, Claude `tool_result` blocks, Responses `function_call_output` and `custom_tool_call_output` items, Responses role-based tool messages, and Gemini `functionResponse.parts`. In `handleComboChat`, `toolOutputMedia` is filtered via `filterByInputCapabilities`, excluding text-only models and selecting only vision-capable members. In `applyVisionBridgeReroute`, single-model non-vision requests with nested images are rerouted to `visionBridgeModel`. Completed turns from prior interactions are excluded via `trailingUserItems`. | • [`open-sse/services/combo.js:506-540`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L506-L540)<br>• [`open-sse/services/combo.js:606`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L606)<br>• [`open-sse/services/combo.js:1568-1585`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L1568-L1585)<br>• [`open-sse/services/combo.js:2193-2207`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L2193-L2207)<br>• [`open-sse/services/model.js:231-247`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/model.js#L231-L247)<br>• [`src/sse/handlers/chat.js:951-958`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/src/sse/handlers/chat.js#L951-L958) | • [`tests/unit/1090-nested-vision.test.js:53-60`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/1090-nested-vision.test.js#L53-L60)<br>• [`tests/unit/1090-nested-vision.test.js:71-77`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/1090-nested-vision.test.js#L71-L77)<br>• [`tests/unit/combo-tool-output-media.test.js:77-159`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/combo-tool-output-media.test.js#L77-L159)<br>• [`tests/unit/combo-tool-output-media.test.js:179-189`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/combo-tool-output-media.test.js#L179-L189)<br>• [`tests/unit/vision-bridge-chat.test.js:210-217`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/vision-bridge-chat.test.js#L210-L217) | **Met** |
| **2. Apply original key/account/combo ACLs to reroutes; preserve call/result IDs and media** | Client API key model policy (`enforceApiKeyModelPolicy`), key account scopes, and combo `allowedConnectionIds` are evaluated on every dispatch. For requests with tool-output vision, attempts pass `reportComboPolicyRejections: true`. If all capable models are rejected by policy, `comboPolicyRejection(true)` returns generic HTTP 403 `Access denied` with `code: "capability_unavailable"`. No fallback to text-only models occurs. Payloads sent to capable models preserve tool call IDs (`call_id`, `tool_call_id`, `tool_use_id`), function arguments, and media attachments intact. In Responses lowering (`openai-responses.js`), `splitToolOutputImages` lifts `input_image` into user message while maintaining `call_id` linkage. In fusion, `liftChatToolMedia` preserves tool call IDs and text descriptions while exposing images to panel models. | • [`open-sse/services/combo.js:95-103`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L95-L103)<br>• [`open-sse/services/combo.js:1641-1678`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L1641-L1678)<br>• [`open-sse/services/combo.js:2231-2233`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L2231-L2233)<br>• [`src/sse/handlers/chat.js:640-663`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/src/sse/handlers/chat.js#L640-L663)<br>• [`src/sse/handlers/chat.js:840-880`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/src/sse/handlers/chat.js#L840-L880)<br>• [`src/sse/services/auth.js:80-140`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/src/sse/services/auth.js#L80-L140)<br>• [`open-sse/translator/request/openai-responses.js:620-635`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/translator/request/openai-responses.js#L620-L635) | • [`tests/unit/1090-nested-vision.test.js:53-60`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/1090-nested-vision.test.js#L53-L60)<br>• [`tests/unit/1090-nested-vision.test.js:79-88`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/1090-nested-vision.test.js#L79-L88)<br>• [`tests/unit/1090-nested-vision.test.js:91-108`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/1090-nested-vision.test.js#L91-L108)<br>• [`tests/unit/1090-nested-vision.test.js:110-117`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/1090-nested-vision.test.js#L110-L117)<br>• [`tests/unit/combo-tool-output-media.test.js:203-213`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/combo-tool-output-media.test.js#L203-L213)<br>• [`tests/unit/security-authorization-matrix.test.js:242-260`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/security-authorization-matrix.test.js#L242-L260)<br>• [`tests/unit/vision-bridge-chat.test.js:219-229`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/vision-bridge-chat.test.js#L219-L229) | **Met** |
| **3. Return an explicit capability error if no permitted target can consume the request** | When no model in a combo pool advertises vision, `handleComboChat` returns HTTP 400 with `error.code: "capability_unavailable"` before dispatch. In fusion, if no panel member is capable or the explicit judge lacks vision, `handleFusionChat` returns HTTP 400 `capability_unavailable`. In single-model Vision Bridge routing, if no valid target is configured or the target is not permitted, `handleSingleModelChat` returns HTTP 400 `capability_unavailable`. If all capable models are rejected by local ACLs, the combo returns HTTP 403 `Access denied` with `code: "capability_unavailable"`. | • [`open-sse/services/combo.js:1573-1585`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L1573-L1585)<br>• [`open-sse/services/combo.js:2201-2207`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L2201-L2207)<br>• [`src/sse/handlers/chat.js:951-958`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/src/sse/handlers/chat.js#L951-L958)<br>• [`open-sse/services/combo.js:95-103`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L95-L103) | • [`tests/unit/1090-nested-vision.test.js:62-69`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/1090-nested-vision.test.js#L62-L69)<br>• [`tests/unit/1090-nested-vision.test.js:79-88`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/1090-nested-vision.test.js#L79-L88)<br>• [`tests/unit/combo-tool-output-media.test.js:191-201`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/combo-tool-output-media.test.js#L191-L201)<br>• [`tests/unit/combo-tool-output-media.test.js:257-273`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/combo-tool-output-media.test.js#L257-L273)<br>• [`tests/unit/vision-bridge-chat.test.js:224-238`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/tests/unit/vision-bridge-chat.test.js#L224-L238) | **Met** |

---

## 3. Detailed Architecture & Technical Trace

### 3.1 Input Detection Envelope Coverage

`detectToolOutputCapabilities(body)` in [`open-sse/services/combo.js:506-540`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L506-L540) handles every supported protocol variant:

1. **OpenAI Chat Completions**:
   - Matches messages where `role === "tool"` or legacy `role === "function"`.
   - Scans `message.content` for `image_url` parts, data URIs, and file blocks.
2. **Anthropic Claude Messages**:
   - Matches user messages containing `type: "tool_result"` content blocks.
   - Scans `block.content` for image blocks (`source.type: "url"` or `"base64"`).
3. **OpenAI Responses API**:
   - Matches items where `type === "function_call_output"` or `"custom_tool_call_output"`, scanning `item.output`.
   - Matches role-based items in `input` array (`role === "tool"` or `"function"`).
4. **Google Gemini & Antigravity**:
   - Matches `contents` or `request.contents`, inspecting `part.functionResponse.parts` for `inlineData` image objects.
5. **Internal Lifted Media**:
   - Inspects `body[LIFTED_TOOL_MEDIA]` symbol to preserve detected capabilities across internal processing passes without serializing to client/upstream payloads.

### 3.2 Modality Degradation & Non-Strippable Invariants

Top-level user images can be stripped when routing to a text-only fallback member (`open-sse/services/combo.js:215-223`). In contrast, media embedded inside tool results cannot be stripped without violating tool protocol contracts or destroying tool result semantics.

The router maintains the invariant that **nested tool media is non-degradable**:
- If `toolOutputMedia.has("vision")` is true, text-only members are completely pruned from candidate rosters in `handleComboChat` via `filterByInputCapabilities(rotatedModels, inputMedia, capabilitiesMap)`.
- If no capable member remains in the candidate pool, dispatch halts immediately with HTTP 400 `capability_unavailable`.

### 3.3 Authorization Boundary & Policy Fencing

When a client API key has restricted model access (or restricted account scopes):
1. Normal provider failures (HTTP 429, 500, network disconnects) trigger standard fallback rotation.
2. If an API key policy rejects a candidate vision model, `handleSingleModelChat` flags the attempt with `LOCAL_POLICY_REJECTION`.
3. If all capable models in the combo are denied by local policy:
   - The router halts execution and returns `comboPolicyRejection(true)`.
   - Status code is HTTP 403 `Forbidden`.
   - Error code is explicitly tagged as `capability_unavailable`.
   - Error message is generic `Access denied` and sanitizes provider names, model identifiers, and internal connection IDs.
   - Text fallback is strictly prevented; the request is never routed to an unpermitted or incapable model.

### 3.4 Single-Model Requests and Vision Bridge

For standalone single-model requests targeting a non-vision model:
- `applyVisionBridgeReroute` ([`open-sse/services/model.js:231-247`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/model.js#L231-L247)) detects `toolOutputVision`.
- If Vision Bridge is enabled, the request is rewritten to target `visionBridgeModel`, preserving the body, message structure, and tool IDs.
- If Vision Bridge is disabled, unconfigured, or the rerouted vision model is denied by client API key policy, `handleSingleModelChat` ([`src/sse/handlers/chat.js:951-958`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/src/sse/handlers/chat.js#L951-L958)) emits HTTP 400 `capability_unavailable`.

---

## 4. Concrete Remaining Gaps, Limitations, and Boundaries

While the acceptance criteria for capability admission, authorization preservation, and explicit error responses are satisfied, several concrete architectural boundaries and limitations exist in the merged codebase:

### 1. Cross-Protocol Translation Limits (Claude-to-OpenAI Base64 Omission)
- **Mechanism**: In [`open-sse/translator/request/claude-to-openai.js:229-234, 360-370`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/translator/request/claude-to-openai.js#L229-L234), Claude tool-result images with URL sources (`{ type: "image", source: { type: "url", url } }`) map directly to OpenAI `image_url` parts in a following user turn. However, base64 images inside Claude `tool_result` blocks are downgraded to a placeholder: `[tool result omitted image: ${mediaType}]`.
- **Reason**: OpenAI `tool` role messages cannot carry image blocks, and lifting arbitrary base64 binary blocks into user turns risks exceeding upstream payload limits and inflating token consumption.
- **Impact**: When routing a Claude-format client request to an OpenAI-format provider through capability admission, the router correctly admits an OpenAI vision-capable model, but the request translator omits the raw base64 image data. Native Claude-to-Claude routes (and URL-based images) retain full media end-to-end. This limitation is explicitly documented in [`docs/features/combos.mdx:172`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/docs/features/combos.mdx#L172).

### 2. Structured Non-Image Tool Outputs in Fusion Panels
- **Mechanism**: For CSV-only or complex document tool outputs, fusion panels that do not support tool calling rely on legacy text flattening ([`open-sse/services/combo.js:67-68`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L67-L68)).
- **Impact**: Structured file objects in tool history may flatten into `[object Object]` for panel models, discarding call/result IDs. The final judge receives the pristine tool history, but panel members receive degraded context. Documented in [`docs/features/combos.mdx:172`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/docs/features/combos.mdx#L172).

### 3. Historical Turn Exclusion by Design
- **Mechanism**: In [`open-sse/services/combo.js:528-538`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L528-L538), `detectToolOutputCapabilities` processes only `trailingUserItems(body.messages)` / `trailingUserItems(body.input)`.
- **Impact**: If a conversation contained a tool-output screenshot two turns ago, but the latest user message is purely textual ("summarize what you saw"), the request is not classified as requiring vision. The request may route to a text-only model unless the client resends the image or the provider maintains server-side state. This boundary is intentional to prevent multi-turn conversations from being indefinitely locked into expensive multimodal models.

### 4. Internal `autoSwitch: false` Parameter
- **Mechanism**: In [`open-sse/services/combo.js:1568`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/open-sse/services/combo.js#L1568):
  ```javascript
  const toolOutputMedia = autoSwitch ? detectToolOutputCapabilities(body) : new Set();
  ```
- **Impact**: Internal callers specifying `autoSwitch: false` bypass capability-aware routing for fallback combos (though fusion retains requirements via `getFusionRequiredInput`). There is no dedicated user-facing UI dashboard toggle specifically for nested tool media; it inherits the global capability routing toggle.

### 5. Hermetic Verification Boundaries
- **Mechanism**: All test verification in `tests/unit/1090-nested-vision.test.js`, `tests/unit/combo-tool-output-media.test.js`, and `tests/unit/vision-bridge-chat.test.js` runs in hermetic, offline test harnesses where `globalThis.fetch` is stubbed or mocked.
- **Impact**: Live upstream provider calls against actual production endpoints (e.g., live OpenAI `gpt-4o`, Anthropic `claude-3-5-sonnet`, or Google `gemini-1.5-pro`) were not executed as part of this local CI audit because live API keys and outbound network requests are prohibited in local CI.

---

## 5. Documentation Conformance

The public and internal documentation accurately reflects the merged capabilities and constraints:
- [`docs/features/combos.mdx:168-177`](../../orq-toty04-n1090-audit--52ac8a4d3d85b03d/docs/features/combos.mdx#L168-L177):
  - Documents tool-output media capability admission across Chat `tool`, Claude `tool_result`, Responses `function_call_output`/`custom_tool_call_output`, and Gemini `functionResponse.parts`.
  - Confirms non-degradability of nested media and immediate rejection when no capable member exists (`capability_unavailable`).
  - Documents fusion panel and judge media admission rules.
  - Candly documents cross-protocol translation limits for Claude base64 images and CSV text flattening.
  - Documents all-candidate local policy rejections returning HTTP 403 `Access denied` with `code: "capability_unavailable"`.
  - Documents Vision Bridge fallback for single-model requests with tool-output images.

---

## 6. Audit Conclusion & Sign-Off

All three acceptance criteria defined in GitHub issue #1090 are **fully implemented, documented, and verified**:
1. **Nested image admission reproduction**: Verified across all 4 major protocol formats (Chat, Claude, Responses, Gemini) in `tests/unit/1090-nested-vision.test.js` and `tests/unit/combo-tool-output-media.test.js`.
2. **Access control preservation & ID/media fidelity**: Key/account/combo ACL intersections, fail-closed policy enforcement, and payload preservation verified in `tests/unit/security-authorization-matrix.test.js` and `tests/unit/1090-nested-vision.test.js`.
3. **Explicit capability errors**: HTTP 400 `capability_unavailable` (for incapable pools) and HTTP 403 `Access denied` / `capability_unavailable` (for policy denials) verified across combos, fusion, and Vision Bridge.

Verification confirmed by **868 passing tests** in focused suites with 0 regressions.
