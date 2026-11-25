# #1073 late-June translated output inventory

## Pinned public changes

The inspected source is the supplied OmniRoute Git object store. Each disposition uses the exact PR head; the enclosing merge pin identifies the merge context where unrelated PR content may be present.

| PR | Exact PR head | Enclosing merge | Public change |
|---|---|---|---|
| [OmniRoute #4633](https://github.com/cheaper-inference/OmniRoute/pull/4633) | `6147f884c7f0a58c4fa2f02790a945484ce07ebf` | `2a90a9e589d44ba975e3b4d79f29ccf1fe42e695` | Anthropic thinking `content_block_stop` emits a literal `</think>` text chunk. |
| [OmniRoute #5175](https://github.com/cheaper-inference/OmniRoute/pull/5175) | `fa839c6e5916388ecd4c8a41151a7003dadbac15` | `09b15b72ca1f82434c70a783da6c25f910de8448` | Changelog-only restoration of two bullets; no translated output behavior. |
| [OmniRoute #5197](https://github.com/cheaper-inference/OmniRoute/pull/5197) | `4e3c83ccf09e7fb9f1c48494dd6fb62bc11e4faf` | `503e23409a00374f63e0f3b73832c98a34c00fcc` | Shared finish-reason normalization for Gemini/Antigravity, sanitizer and JSON-to-SSE paths. |
| [OmniRoute #5204](https://github.com/cheaper-inference/OmniRoute/pull/5204) | `81b926edf114633008489fe2d5214d19754b1cc8` | `50c8a495be9f150014dd369f137bfaa6eafa0cfd` | Responses input normalization treats null as empty and leaves missing input distinct. |

## Current local behavior and fixtures

### Anthropic thinking close marker

Local `claudeToOpenAIResponse` already emits `reasoning_content` for `thinking_delta`, tracks the active thinking block, and clears that state on its matching `content_block_stop`; it deliberately emits no literal `</think>` content. The implementation comment explains that state transition is the close signal and that a text sentinel would leak into ordinary OpenAI consumers. Thus #4633's literal output field is not already consumed as a wire variant: it is newly added `delta.content`, and conflicts with the local no-marker output contract.

Fixture evidence: `tests/translator/bugs-claude-thinking-tags.test.js` covers thinking/tag behavior, and `tests/translator/v5-conformance-matrix-claude.test.js` covers Claude response translation. Neither establishes a missing close event: the state transition is the local representation. **Disposition: do not port; preserve the local reasoning-field/state-close convention.**

### Gemini and Antigravity finish reasons

Local `geminiToOpenAIResponse` maps provider finish values through `toOpenAIFinish(candidate.finishReason, "gemini")`, then preserves `tool_calls` when a stop accompanies emitted calls. This already consumes Gemini's uppercase wire variants through a case-normalizing shared helper; safety, recitation, blocklist, prohibited-content and related values map to the local content-filter finish category. `translateNonStreamingResponse` uses the same finish mapping. The upstream #5197 shared string normalizer adds a different set of paths (including generic OpenAI-compatible sanitizer and JSON-to-SSE boundaries), but those are not newly added Gemini response fields. The patch handles finish metadata, not ordinary text or usage fields.

Fixture evidence: `tests/translator/golden-response-stream.test.js`, `tests/translator/responses-nonstream-gemini-1346.test.js`, and the translator's finish-reason conversion in `open-sse/translator/concerns/finishReason.js` establish existing native Gemini text/usage/finish behavior. **Disposition: no Gemini response-translation gap demonstrated; do not port this broad helper patch as part of the translated-output inventory.** The wider generic sanitizer/JSON-to-SSE behavior is outside the requested Claude/Gemini translation surface.

### Responses input distinction

#5204 changes `input: null` to `[]` while preserving absent (`undefined`) input, and includes newline formatting. It does not add a response field. Local Responses request normalization and fixtures already distinguish missing input from an explicit value; ordinary chat conversion treats absent input as an empty list, and the ported Codex-specific path normalizes input at its own boundary.

Fixture evidence: `tests/translator/v5-conformance-responses-json.test.js`, `tests/translator/v5-conformance-matrix-responses.test.js`, and `tests/translator/port-2318-strip-responses-fields.test.js` exercise Responses conversion. The relevant local behavior is request-input handling, not translated output inventory. **Disposition: exclude #5204 from this output inventory; no output gap demonstrated.**

### Changelog-only PR

#5175 restores changelog bullets only. **Disposition: no port; no code or fixture behavior changed.**

## Narrow gap and offline acceptance

The only literal output difference is #4633's added `delta.content: "</think>"` marker. Current behavior and fixtures support keeping thinking in `reasoning_content` and closing the block by state; a literal marker would become ordinary visible text on this translator route. No narrow gap is demonstrated, so no acceptance change is proposed. If a future local contract explicitly requires a client-visible end marker, acceptance should be an ordinary offline translator fixture asserting the intended close signal, retaining ordinary text, usage, tool/terminal/replay behavior, and absent-input distinctions, without live provider traffic.
