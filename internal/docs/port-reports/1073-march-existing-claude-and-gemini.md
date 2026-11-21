# #1073: March OmniRoute existing Claude and Gemini behavior

Reviewed 2026-11-20 against the supplied merged-source metadata and pinned patches, current DurinDoor code, and local fixtures. Scope is behavior for already supported Claude and Gemini/Antigravity paths. New providers/integrations, provider additions, authentication/sign-in flows, and CI are excluded. Dispositions below distinguish source behavior from current local coverage; no owner selection list is included.

## Dispositions

| Source | Disposition | Comparison |
| --- | --- | --- |
| [#183](https://github.com/cheaper-inference/OmniRoute/pull/183) | **Covered** for the in-scope project selection behavior; provider/catalog addition excluded. | The source patch adds request-body `project` precedence over stored credentials `projectId`, using a generated fallback only if neither is present. Local Antigravity request construction already uses the request body project when provided and otherwise uses credentials; existing project-ID fixtures exercise stored connection/project propagation. The added Blackbox registry/logo work is a provider addition and excluded. |
| [#275](https://github.com/cheaper-inference/OmniRoute/pull/275) | **Excluded** | This is Cursor-specific efficiency and tool-result escaping work, outside existing Claude/Gemini behavior. |
| [#285](https://github.com/cheaper-inference/OmniRoute/pull/285) | **Confirmed in-scope gap** | OmniRoute removes synthetic project-ID fallback and fails when Antigravity/Gemini CLI credentials have no project ID, including the Claude-on-Antigravity path. Local `open-sse/executors/antigravity.js` and `open-sse/translator/request/openai-to-gemini.js` still call `generateProjectId()` when credentials lack `projectId`. Focused port: require a real project ID and return the corresponding missing-project error on those existing paths. Existing Gemini CLI sign-in fixtures cover saved project values, but not the missing-project request case. |
| [#288](https://github.com/cheaper-inference/OmniRoute/pull/288) | **Covered** | The source filters empty tool names and tool-result blocks without `tool_use_id` in Claude request normalization, including nested message content and top-level tools. Current Claude translation path has sanitation for malformed tool history and tests covering tool-result handling; no additional port is indicated from this patch comparison. The Docker helper copy is deployment packaging and excluded. |
| [#354](https://github.com/cheaper-inference/OmniRoute/pull/354) | **Covered; unrelated UI portion excluded** | Source trims and filters invalid/empty Claude tool names while mapping Claude tools to OpenAI format, omitting `tools` if none remain. Current `claude-to-openai` conversion trims and filters names and existing translator fixtures cover malformed tool history. Clipboard and console viewer changes are unrelated UI behavior and excluded. |
| [#607](https://github.com/cheaper-inference/OmniRoute/pull/607) | **Covered; separate provider validation excluded** | Source passes `toolNameMap` through non-streaming response translation so Claude tool names cloaked for the upstream are restored. Current chat core carries the map into its non-streaming response handler, and Claude decloak boundary fixtures cover map-based restoration. LongCat provider validation is a separate provider integration and excluded. |
| [#720](https://github.com/cheaper-inference/OmniRoute/pull/720) | **Covered; separate changes excluded** | The Claude response change stops repeating a tool-call `id` in a translated OpenAI streaming delta. Existing Claude response translator behavior and Claude stream fixtures cover tool-call id emission. General Responses API routing, usage accounting, release metadata, and UI styling are separate scopes and excluded. |
| [#834](https://github.com/cheaper-inference/OmniRoute/pull/834) | **Excluded** | This patch changes debug sidebar visibility and prompt-cache settings/UI. It does not change existing Claude or Gemini provider request/response behavior. |

## Pin record

The supplied source rows are preserved exactly as head SHA / merge SHA:

| PR | Head SHA | Merge SHA |
| --- | --- | --- |
| #183 | `78094afd344ead2faaee5052ca9a9df69d1986d4` | `b25552e3613398e91234a5bf2a51eba352ea5999` |
| #275 | `25cd0b361249d5e2facf2f68028e080294b81f3c` | `9233edb6cd030866de4296fb2cb94601c42a4b77` |
| #285 | `2a1472e870ceec6c05a9d5ee6cce0c5aee06c3d5` | `54b1d8c8dedf532fef476baced3ceaced4a76a52` |
| #288 | `7cfbdbdaaf1b4a8bc7f98792c583235ab2cada97` | `c2b31f6b2050cdbc755fd1f3cb1a94cc64dbab54` |
| #354 | `61a9636a4398d0d60fce936c3ff2388358c2fadd` | `42bac2d3fd0dd122e12e433e6dfc1b9aa8372cb3` |
| #607 | `ed146fcf074c5972a82ceda35fe47e5784caf275` | `33fee5dcc5c0ec5bbdb753af380f2fe61fd981b9` |
| #720 | `cb55e790f987bd796fb2e270a62fd4d559a9a280` | `437cf9bab085d7e3a0e1408eeb8ffd737d8e64cd` |
| #834 | `a315ab29bc465858d3cf5dd162d920481003b919` | `aa7b754693abbd194a19ed57fc7c5537e700eebf` |

Focused port scope is limited to rejecting synthetic project IDs for existing Antigravity/Gemini CLI-backed requests, including Claude-on-Antigravity. No product code was changed and no tests were run.

Refs #1073
