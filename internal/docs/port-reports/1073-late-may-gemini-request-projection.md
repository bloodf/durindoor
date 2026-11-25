# #1073 — late May Gemini request and result projection

## Scope and method

Compared each pinned OmniRoute merge's first-parent diff with the current DurinDoor runtime. Source is the local bare repository at `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`; links below pin source files to the merge commit. This report covers Gemini request projection, tool history and thought handling only. Provider additions, Google Search grounding, authentication, executor retries/headers, and unrelated response features in the same PRs are out of scope.

| PR | Head pin | First-parent merge pin | Relevant patch disposition |
|---|---|---|---|
| [OmniRoute #2676](https://github.com/cheaper-inference/OmniRoute/pull/2676) | `460a4d3392d95b1ab600b761ad0751edf3e44558` | `4df424498b644074720d5d5654f4380fbb336746` | Reasoning request projection already covered in current DurinDoor's centralized thinking pass; no request-projection port identified. |
| [OmniRoute #2801](https://github.com/cheaper-inference/OmniRoute/pull/2801) | `acc11739d091b5c82df1fbacac235c9275e38119` | `0e9aed4d039870b8db229a6fe11f4dcdb6285a63` | Divergent executor-mode behavior; not a blanket native Gemini API fix. No change recommended absent evidence that the hosted Gemini dialect needs Antigravity's signatureless-history workaround. |
| [OmniRoute #2878](https://github.com/cheaper-inference/OmniRoute/pull/2878) | `e8e17bb264359c9ef9cd38c843018a7c3501e1b0` | `a9b5a7cc8c9648b149ee2a94d57bfa1ed4962f2b` | Antigravity-only hardening is represented locally only in part: local emits native call history with a synthetic signature, rather than preserving signatureless history as inert text. Superseded by #2927's safer context projection. |
| [OmniRoute #2927](https://github.com/cheaper-inference/OmniRoute/pull/2927) | `5cb23b4e712ec2f1393df1c6266c238849a2a3b5` | `c2fc3e916f264e7301a6a721843c33cd546e62ee` | **Ready scoped remaining fix:** add the source's signatureless historical tool projection to the Antigravity Gemini-thinking request path only, retaining signed calls in native Gemini form. Do not apply it to ordinary Gemini API or Gemini CLI routes. |

## Runtime comparison

### #2676: common thinking fields

The source moved `reasoning_effort` and Claude `thinking` → `thinkingConfig` projection into `openaiToGeminiBase`, making those fields available to all three converter variants. See the pinned [request diff](https://github.com/cheaper-inference/OmniRoute/commit/4df424498b644074720d5d5654f4380fbb336746#diff-4adf1cb9b3cc3ccd634e0c08d77638fd5e89e5f7f0f2f2935fdd6fcfe6c53974).

DurinDoor's [OpenAI-to-Gemini converter](../../../open-sse/translator/request/openai-to-gemini.js) constructs the Gemini request, while `applyThinking` centralizes request thinking policy after translation. The [declared-level tests](../../../tests/unit/gemini-declared-thinking-efforts.test.js) demonstrate current behavior: Gemini 3.8 requests use vendor `thinkingLevel` values (`low`/`medium`/`high`) and `includeThoughts`, and the 3 Flash preview path keeps its existing minimal/no-thought contract. The source's older numeric `thinkingBudget` mapping is therefore not an equivalent drop-in for the current vendor dialect. This request projection is already covered by the current centralized behavior.

The same merge adds `groundingMetadata` → `citations` in Gemini-to-OpenAI streaming response projection. That is a separate result feature and excluded by the requested scope; it is not used to infer request parity.

### #2801: hosted Gemini versus CLI/Antigravity modes

The exact patch adds `signaturelessToolCallMode` to the standard Gemini request adapter and registers that adapter with mode `text`. In that mode the source serializes signatureless historical calls and their results into text rather than native `functionCall` / `functionResponse` parts. This changes the hosted Gemini-format registration, while the CLI/Antigravity request paths already have their own options. See the pinned [request diff](https://github.com/cheaper-inference/OmniRoute/commit/0e9aed4d039870b8db229a6fe11f4dcdb6285a63#diff-4adf1cb9b3cc3ccd634e0c08d77638fd5e89e5f7f0f2f2935fdd6fcfe6c53974).

Current DurinDoor's [base converter](../../../open-sse/translator/request/openai-to-gemini.js) emits native historical `functionCall` records and synthesizes `DEFAULT_THINKING_AG_SIGNATURE` when no upstream or cached signature exists (except Gemma 4). It then emits matched native `functionResponse` records. The [Gemini thought-signature store tests](../../../tests/translator/gemini-thought-signature-store.test.js) demonstrate that cached provider signatures are replayed on follow-up native calls, while an unknown call uses the synthetic default. The source change is therefore not evidence that the compliant hosted Gemini wire requires Antigravity's policy; applying `text` globally would alter an existing native-format contract. Disposition: incompatible as a blanket port; no scoped hosted fix established.

### #2878 then #2927: signatureless Antigravity history

At #2878 the Antigravity path switched signatureless historical calls and results away from native function parts to explicit “historical record only” text. #2927 then refined that behavior: omit the signatureless call record entirely and preserve the prior result as escaped `<previous_tool_result_context>` text. The patch specifically selects `context` for Antigravity Gemini-thinking models; it keeps signed history native. See the pinned [#2878 request diff](https://github.com/cheaper-inference/OmniRoute/commit/a9b5a7cc8c9648b149ee2a94d57bfa1ed4962f2b#diff-4adf1cb9b3cc3ccd634e0c08d77638fd5e89e5f7f0f2f2935fdd6fcfe6c53974) and [#2927 request diff](https://github.com/cheaper-inference/OmniRoute/commit/c2fc3e916f264e7301a6a721843c33cd546e62ee#diff-4adf1cb9b3cc3ccd634e0c08d77638fd5e89e5f7f0f2f2935fdd6fcfe6c53974).

DurinDoor's current `openaiToAntigravityRequest` delegates Gemini-shaped bodies through `openaiToGeminiCLIRequest`; it does not select a signatureless `text` or `context` mode. The shared base path instead emits the synthetic signature and native call/response pair described above. Thus it lacks the source's Antigravity-specific representation. This divergence matters because #2927's reported behavior is specific to Antigravity Gemini-thinking: the context patch avoids exposing a pseudo-call as user-visible text while retaining tool output as prior context. The relevant exact implementation is in the pinned request diff; source tests assert omission of signatureless calls, result retention, escaping of tag-like data, and continued native treatment of signed calls.

**Remaining fix:** implement and route the `context` projection only for the Antigravity Gemini-thinking case, retaining current native signed call/response projection and leaving standard Gemini and Gemini CLI behavior alone. This is a translator/request projection fix; it does not require provider, auth, or tool-feature work. As requested, no product code or tests were changed and no tests were run in this documentation-only audit.

## Local evidence links

- [DurinDoor OpenAI-to-Gemini request converter](../../../open-sse/translator/request/openai-to-gemini.js)
- [DurinDoor Gemini thinking normalization tests](../../../tests/unit/gemini-declared-thinking-efforts.test.js)
- [DurinDoor signature persistence and native replay tests](../../../tests/translator/gemini-thought-signature-store.test.js)
- Pinned source merge commits: [#2676 `4df424498b644074720d5d5654f4380fbb336746`](https://github.com/cheaper-inference/OmniRoute/commit/4df424498b644074720d5d5654f4380fbb336746), [#2801 `0e9aed4d039870b8db229a6fe11f4dcdb6285a63`](https://github.com/cheaper-inference/OmniRoute/commit/0e9aed4d039870b8db229a6fe11f4dcdb6285a63), [#2878 `a9b5a7cc8c9648b149ee2a94d57bfa1ed4962f2b`](https://github.com/cheaper-inference/OmniRoute/commit/a9b5a7cc8c9648b149ee2a94d57bfa1ed4962f2b), [#2927 `c2fc3e916f264e7301a6a721843c33cd546e62ee`](https://github.com/cheaper-inference/OmniRoute/commit/c2fc3e916f264e7301a6a721843c33cd546e62ee).
