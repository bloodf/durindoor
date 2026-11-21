# #1073 Late-June Existing Request-Schema Ledger Residuals

This review compares each PR's pinned patch commit (rather than treating its enclosing merge as a single patch) with the current local translator and offline fixtures. The seven PRs concern existing request fields, property names, or translations; only two leave narrow behavior gaps in current source.

## Exact pins

| PR | Exact patch head | Enclosing merge | Patch subject |
|---|---|---|---|
| [OmniRoute #4434](https://github.com/cheaper-inference/OmniRoute/pull/4434) | [`73b6426f8f6d3396ae7c94b92a3ac7d8103225f3`](https://github.com/cheaper-inference/OmniRoute/commit/73b6426f8f6d3396ae7c94b92a3ac7d8103225f3) | `482433e44fe9da4d5433a64fb3632977bc6c3eaa` | Gemini accepts OpenAI audio input parts |
| [OmniRoute #4624](https://github.com/cheaper-inference/OmniRoute/pull/4624) | [`88acbd4d3173ab49054fe78e5cde564656b3cd1c`](https://github.com/cheaper-inference/OmniRoute/commit/88acbd4d3173ab49054fe78e5cde564656b3cd1c) | `fc2fdc7e3c7b1bd6bee646b22d30ee113740ec88` | Strip top-level `client_metadata` on OpenAI passthrough |
| [OmniRoute #4625](https://github.com/cheaper-inference/OmniRoute/pull/4625) | [`5f0c1382abcecdfbf72311f12dc6e7bcf1b5d320`](https://github.com/cheaper-inference/OmniRoute/commit/5f0c1382abcecdfbf72311f12dc6e7bcf1b5d320) | `ea406b21975371f493e78a6c2e7ae1f825067285` | Normalize `developer` to `system` for OpenAI-format providers |
| [OmniRoute #4651](https://github.com/cheaper-inference/OmniRoute/pull/4651) | [`d87c1f9075bf9ad4ff0b0e823b9ac9d6ff3589d1`](https://github.com/cheaper-inference/OmniRoute/commit/d87c1f9075bf9ad4ff0b0e823b9ac9d6ff3589d1) | `35a3962cf0ac2586c51d510b82fd39679d96135d` | Preserve Gemini `pattern` in Antigravity tool schemas |
| [OmniRoute #4675](https://github.com/cheaper-inference/OmniRoute/pull/4675) | [`1c75d127e894df4e34dfde58538b4b76a16d2a01`](https://github.com/cheaper-inference/OmniRoute/commit/1c75d127e894df4e34dfde58538b4b76a16d2a01) | `33ac3f6b7df8e669cd57b434b6f9a2e80eba15fd` | Coerce tool descriptions in OpenAI normalization |
| [OmniRoute #4688](https://github.com/cheaper-inference/OmniRoute/pull/4688) | [`320ee893287b84e5115b7ab00fe6285622957a9d`](https://github.com/cheaper-inference/OmniRoute/commit/320ee893287b84e5115b7ab00fe6285622957a9d) | `fd8a52ed64fff05cd747151ee734117815bbac8c` | Preserve `reasoning_effort` for non-Copilot Responses clients |
| [OmniRoute #4728](https://github.com/cheaper-inference/OmniRoute/pull/4728) | [`25ec9e2195c01d08958015ca013c824569d76ca1`](https://github.com/cheaper-inference/OmniRoute/commit/25ec9e2195c01d08958015ca013c824569d76ca1) | `2c8921fe34d466487cad28e5f85f4284e254055e` | Strip `x-anthropic-billing-header` in Claude-to-OpenAI |

The enclosing merges for #4434, #4624, #4625, #4651, #4675, #4688 and #4728 each have the corresponding listed head as their first parent and the PR head as their second parent. The patch comparisons above use those PR heads directly.

## Per-PR disposition

### #4434 — audio input parts: already implemented

The patch adds `input_audio` and `audio_url` to the OpenAI content allowlist and maps them to Gemini `inlineData`. Local `VALID_OPENAI_CONTENT_TYPES` includes both literal block names in [blocks.js](../../../open-sse/translator/schema/blocks.js), and [gemini.js](../../../open-sse/translator/formats/gemini.js) maps `input_audio` (`mp3` to `audio/mpeg`, default format to WAV) and data-URI `audio_url`. [multimodal-drop-lock.test.js](../../../tests/unit/multimodal-drop-lock.test.js) covers input-audio mapping and confirms Claude rejects unsupported input audio before dispatch. No new audio type or feature is needed for this patch.

**Disposition:** covered. Existing source and offline fixture evidence match the patch's request shapes and preserve the Claude target boundary.

### #4624 — `client_metadata`: keep the Responses boundary

The patch deletes the top-level field in generic OpenAI normalization. Local [openai-responses.js](../../../open-sse/translator/request/openai-responses.js) already removes `client_metadata` when lowering a Responses request to Chat, and [openai-responses-strip-fields.test.js](../../../tests/unit/openai-responses-strip-fields.test.js) covers that conversion. [port-2318-strip-responses-fields.test.js](../../../tests/translator/port-2318-strip-responses-fields.test.js) also has a negative control requiring OpenAI Chat-to-Chat passthrough to retain the field. Applying the patch's deletion indiscriminately in `filterToOpenAIFormat` would reverse that explicit source/client boundary.

**Disposition:** no generic change. Existing Responses-to-Chat normalization covers the compatibility case; preserve the Chat passthrough behavior pinned by the negative-control fixture. The PR alone does not establish a separate provider-specific rejection requiring broader deletion.

### #4625 — `developer` role: already normalized

The patch maps OpenAI `developer` messages to `system` in OpenAI-format normalization. Local [openai.js](../../../open-sse/translator/formats/openai.js) does this using the schema role constants, before content filtering. The role is an existing OpenAI request role and this normalization adds no new role type.

**Disposition:** covered by current normalization. Keep literal role names sourced from schema constants.

### #4651 — Gemini `pattern`: already preserved as a constraint and a property name

The patch removes `pattern` from Antigravity's unsupported-schema-key set. Local `UNSUPPORTED_SCHEMA_CONSTRAINTS` in [gemini.js](../../../open-sse/translator/formats/gemini.js) does not include it, so both a string constraint named `pattern` and a user property literally named `pattern` survive sanitization. [gemini-schema-stray-key.test.js](../../../tests/translator/gemini-schema-stray-key.test.js) protects literal property names while checking unsupported schema-node keys; the local Gemini sanitizer likewise leaves the constraint key untouched.

**Disposition:** covered. Preserve `pattern` in both JSON Schema roles; it is not a new schema keyword or feature.

### #4675 — tool descriptions: narrow falsey-value coercion gap

The patch uses `String(description ?? "")` in the two OpenAI normalization paths. Local [openai.js](../../../open-sse/translator/formats/openai.js) uses `String(tool.description || "")` and `String(fn.description || "")`. Truthy non-string values are coerced, and null/undefined become empty strings, but valid non-null falsey values such as `0` and `false` are silently replaced by `""`, unlike the pinned patch's `"0"` and `"false"`. This affects Claude-style and Gemini-style tool declarations; it does not require changing OpenAI-format declarations already in canonical shape.

**Disposition:** narrow residual behavior gap in the two normalizers.

**Ordinary offline acceptance:** add local unit cases for Claude-style and Gemini `functionDeclarations` descriptions set to `0` and `false`; expect `"0"` and `"false"`. Keep null/undefined expectations at `""` and assert canonical OpenAI function tool objects are unchanged.

### #4688 — Responses `reasoning.effort`: final request wiring gap

The patch promotes Responses `reasoning.effort` to Chat `reasoning_effort` for non-Copilot clients, leaving the Copilot-only summary marker gated. Local Chat-to-Responses wiring already nests `reasoning_effort` as `reasoning.effort` at [openai-responses.js](../../../open-sse/translator/request/openai-responses.js). In the reverse direction, however, `openaiResponsesToOpenAIRequest` deletes `result.reasoning` without first promoting its `effort`; it also does not promote a nested effort in the request body. [responses-api-reasoning-port.test.js](../../../tests/unit/responses-api-reasoning-port.test.js) only proves that the lower-level `convertResponsesApiFormat` helper retains nested `reasoning`; it does not cover this final Responses-to-Chat request translator. Thus an OpenAI Responses client routed to a Chat-format provider loses an existing request hint. Named tool choices and other Responses request wiring are separate, already covered paths and do not address this loss.

**Disposition:** narrow residual behavior gap in Responses-to-Chat request conversion.

**Ordinary offline acceptance:** add translator unit cases asserting `reasoning: { effort: "high" }` yields `reasoning_effort: "high"`, explicit Chat `reasoning_effort` takes precedence, and `reasoning` is removed from the resulting Chat body. Verify non-Copilot clients do not gain the Copilot-only summary marker. Use fixture inputs only; no provider call is needed.

### #4728 — Claude billing header: behavior exists; boundary is directional

The patch removes a leading `x-anthropic-billing-header` line when translating Claude system content to OpenAI. Local [claude-to-openai.js](../../../open-sse/translator/request/claude-to-openai.js) already strips that leading line for both scalar and array `system` values, retaining remaining system text. The nearby [port9r-claude-system-metadata-5774.test.js](../../../tests/unit/port9r-claude-system-metadata-5774.test.js) tests the opposite OpenAI-to-Claude direction and intentionally preserves this text on unrelated/developer content, so it is not evidence for removing metadata across all routes.

**Disposition:** implementation covered in the requested direction. Do not broaden stripping beyond Claude-to-OpenAI system content. No source behavior change is demonstrated by this patch; a dedicated offline fixture for this direction would be optional coverage rather than a remaining behavior gap.

## Summary

Five PRs are covered by current behavior or by an existing source/client boundary: #4434, #4624, #4625, #4651 and #4728. The remaining two PRs identify narrow residuals that merit ordinary offline acceptance: falsey non-null tool descriptions in #4675 and final Responses-to-Chat `reasoning.effort` wiring in #4688. No new type, provider feature, live traffic, or paid API is required to accept either gap.
