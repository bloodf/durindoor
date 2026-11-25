# #1073 late-June existing Responses conversion tail

Review scope: existing managed JSON-schema conversion, nameless hosted-tool filtering, and Responses image-part conversion. This review does not add providers, endpoints, provider-specific fallback behavior, or API features.

## Exact public patches

| PR | Exact head | Enclosing merge | Patch |
| --- | --- | --- | --- |
| [OmniRoute #4766](https://github.com/cheaper-inference/OmniRoute/pull/4766) | `76a82d1125c5b1e2955a76f707908a08835a99c6` | `4259b104ddb33b7ef6255802d6d813062013272f` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/76a82d1125c5b1e2955a76f707908a08835a99c6) |
| [OmniRoute #4789](https://github.com/cheaper-inference/OmniRoute/pull/4789) | `d3c7596142232b01bdf95a18af791e3ac3396aa8` | `e5d98ed3015894e241b4cefd197dc5a8e1f2344c` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/d3c7596142232b01bdf95a18af791e3ac3396aa8) |
| [OmniRoute #4859](https://github.com/cheaper-inference/OmniRoute/pull/4859) | `d43004b8910acdc74e655d4b369ead27b2a0c738` | `a46caac3d2647e106d527067b58e0059b84a76e5` | [head commit](https://github.com/cheaper-inference/OmniRoute/commit/d43004b8910acdc74e655d4b369ead27b2a0c738) |

The patch review used each PR head commit's own changed files, rather than treating the enclosing merge as a single-PR diff.

## Current behavior and fixture evidence

### Managed JSON schema

The #4766 patch adds an executor fallback for the `openai-compatible-*` provider family: it converts `response_format.type=json_schema` to `json_object` and places a serialized schema instruction in a system message. This is provider-family-specific behavior and does not have an equivalent route for the native Responses or other native structured-output paths; it is outside this review's permitted scope.

Current source already carries managed JSON schema through existing format conversions. `openai-responses.js` normalizes and sanitizes function-tool parameter schemas and carries strict flags. The OpenAI→Claude mapper converts `response_format.json_schema.schema` to Claude `output_config.format`; OpenAI→Gemini maps it to `generationConfig.responseSchema` under its existing conditions. Ordinary offline fixtures in `tests/translator/v5-conformance-matrix-responses.test.js` verify strict/schema preservation through Responses→Chat and Responses→Claude, and verify Gemini receives a cleaned parameter schema without leaking OpenAI's `strict` field. `tests/translator/openai-to-claude.test.js` exercises the managed response schema mapping. These fixtures support retaining the existing native representations and per-target media/schema policies.

**Disposition — #4766: do not port.** The patch is an executor fallback for a specific provider family, excluded from this conversion-tail scope. Existing managed schema translation is covered by offline fixtures; no narrow in-scope gap is demonstrated.

### Nameless hosted tools

The #4789 patch filters a missing or whitespace-only tool name before it is emitted as a Chat function declaration. Current `openai-responses.js` already rejects absent/blank names in the Responses→Chat tool conversion and filters nameless namespace subtools. The ordinary offline Responses conformance fixture exercises valid named tools and schema/flag preservation; the existing converter guard is direct evidence for the nameless case. Hosted tools without Chat function equivalents remain unrepresentable and are not synthesized as function declarations.

**Disposition — #4789: already covered; no port.** Current behavior contains the guard this patch introduces, so the upstream change is redundant here. If extending the regression fixture, acceptance should use ordinary offline translation: a named function remains present, while a nameless and a whitespace-only function/hosted tool produce no nameless Chat declaration; verify the downstream Gemini request contains no invalid declaration.

### Responses image parts

The #4859 patch accepts AI SDK user content shaped as `{type:"image", image:"data:image/...;base64,..."}` and lowers it to a Responses `input_image`. Current Chat→Responses `chatPartToResponses` in `openai-responses.js` preserves existing `image_url` parts and existing `input_image` parts, but an AI SDK `image` part falls through to generic text serialization. In contrast, Responses→Chat already maps Responses `input_image` into OpenAI `image_url`, and Chat tool-result images are retained as Responses `input_image` media.

Offline evidence for existing media policy is in `tests/translator/chat-responses-tool-output-media-1332.test.js`: data-URI and remote `image_url` tool-result images remain media, detail is preserved/defaulted, existing `input_image` remains native, and missing URLs fall back to text rather than emitting invalid media. `tests/translator/openai-responses-tool-output-images.test.js` covers the reverse Responses→Chat output-image path. These fixtures show that image media should remain native where the target supports it and preserve current fallback/policy behavior.

**Disposition — #4859: port the narrow conversion only.** The demonstrated gap is limited to the existing Chat→Responses content mapper. Ordinary offline acceptance should pass an AI SDK data-URL image alongside text and assert an `input_image` with the same data URL and the supplied detail; also assert the default detail for an omitted value. Include negative fixtures for a non-data URL/malformed data URL and a non-image part to ensure they do not become media, and retain the current `image_url`/`input_image` and tool-result fixtures. Do not add an endpoint, provider, remote-image policy, or a new public API shape. No product code or test changes are part of this report-only task.
