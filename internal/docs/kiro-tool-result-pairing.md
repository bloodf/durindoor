# Kiro tool-result pairing

Kiro validates that every `toolResults` entry answers a `toolUses` entry of the assistant turn immediately before it. `reconcileOrphanedToolResults` in `open-sse/translator/request/openai-to-kiro.js` enforces this for history turns and the current message when the client declared tools.

- A result pairs only with the immediately preceding assistant turn. An id used by an earlier turn is still unpaired (a stale or duplicate result).
- Paired results stay structured. Unpaired results are folded into the user message text, so their content survives and only the structured reference is dropped.
- Without client tools, `flattenToolInteractions` already turns every call and result into text.

Ported from OmniRoute #20339. Tests: `tests/unit/port-omni-20339-kiro-tool-result-pairing.test.js`.
