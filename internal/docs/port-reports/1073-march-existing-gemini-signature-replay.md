# #1073: Existing Gemini signature replay boundaries

## Scope and pins

Compared the exact public PR heads with the current local translator, schema cleaner, and offline fixtures. For #245, the enclosing merge contains the named PR patch; the patch itself is the two-line `optional` schema-key addition. For #725 and #731, the pinned commits are the exact PR heads and their diffs are limited to the noted request translators and regression fixture. The excluded #2927 role projection is outside this review.

| PR | Exact patch | Enclosing merge | Patch summary |
|---|---|---|---|
| [OmniRoute #245](https://github.com/cheaper-inference/OmniRoute/pull/245) | [`a1dc2270a26351eb2c7e01e4198713a6867431ab`](https://github.com/cheaper-inference/OmniRoute/commit/a1dc2270a26351eb2c7e01e4198713a6867431ab) | [`5874bd3de6fceb05723757c415694b19b3750b31`](https://github.com/cheaper-inference/OmniRoute/commit/5874bd3de6fceb05723757c415694b19b3750b31) | Removes `optional` from unsupported Gemini JSON Schema constraints. |
| [OmniRoute #725](https://github.com/cheaper-inference/OmniRoute/pull/725) | [`a26c4bef80a7532425b7ee526f5c1104c50241c5`](https://github.com/cheaper-inference/OmniRoute/commit/a26c4bef80a7532425b7ee526f5c1104c50241c5) | [`48182edbd5f62465b39bed744f2babf525bb287f`](https://github.com/cheaper-inference/OmniRoute/commit/48182edbd5f62465b39bed744f2babf525bb287f) | Removes unconditional synthetic `thoughtSignature` from OpenAI→Gemini `functionCall` parts. |
| [OmniRoute #731](https://github.com/cheaper-inference/OmniRoute/pull/731) | [`c5003665c3f70b1545684f9d29ce8bc30e0d0af8`](https://github.com/cheaper-inference/OmniRoute/commit/c5003665c3f70b1545684f9d29ce8bc30e0d0af8) | [`f11ec4e142cf5fb52568aadc0e307d03e4c32725`](https://github.com/cheaper-inference/OmniRoute/commit/f11ec4e142cf5fb52568aadc0e307d03e4c32725) | Extends that unconditional removal to Claude→Gemini as well as OpenAI→Gemini. |

## Current behavior and offline evidence

### Schema keys

The current `cleanJSONSchemaForAntigravity` removes unsupported keywords recursively, and its unsupported-key list includes `optional`, `~optional`, plus the broader `~`-prefixed metadata handling. It is used for Gemini response schemas and function/tool parameters in the OpenAI→Gemini request translator. The offline fixture `tests/translator/bugs-antigravity.test.js` asserts that nested `optional` is removed while the supported `type` and `description` remain. `tests/unit/gemini-schema-tilde-keys.test.js` asserts that `~optional` is removed recursively without deleting a user property whose name starts with `~`.

Evidence: [current schema cleaner](../../../open-sse/translator/formats/gemini.js), [request call sites](../../../open-sse/translator/request/openai-to-gemini.js), [optional fixture](../../../tests/translator/bugs-antigravity.test.js), [tilde-key fixture](../../../tests/unit/gemini-schema-tilde-keys.test.js).

### Signature replay and route ownership

Current OpenAI→Gemini replay decodes an explicitly transported provider signature first, then checks the persisted signature store for the raw tool-call ID and compatible model family. Only if neither exists does it emit the synthetic Gemini signature, and it omits signatures for Gemma 4 on the Gemini API. Therefore the old unconditional fallback was narrowed without losing native signed replay. The transport encoding is opt-in (`agsig1_`); ordinary IDs pass through unchanged.

Claude→Gemini remains a direct route. It resolves explicit `thoughtSignature`/`thought_signature` or a signature saved from the matching Gemini response, and only attaches a signature when one exists. The route does not invent a synthetic fallback. Gemini↔Claude response/request fixtures cover signature association, FIFO pairing, explicit signature precedence, connection isolation, and unsigned calls. Antigravity fixtures cover model-family rejection of Claude signatures on Gemini requests and preservation of same-family Gemini signatures. Gemma 4 fixtures assert both synthetic thoughts and signatures are omitted, while ordinary Gemini fixtures assert their expected signature remains.

Evidence: [OpenAI→Gemini request](../../../open-sse/translator/request/openai-to-gemini.js), [Claude→Gemini request](../../../open-sse/translator/request/claude-to-gemini.js), [signature transport](../../../open-sse/translator/concerns/signatureTransport.js), [signature store](../../../open-sse/services/thoughtSignatureStore.js), [direct Gemini/Claude fixture](../../../tests/translator/gemini-thought-signature.test.js), [model-family fixture](../../../tests/unit/antigravity-thought-signature-family.test.js), [Gemma 4 fixture](../../../tests/translator/gemma4-gemini.test.js).

## Disposition

- **#245 — Already covered; no port.** The exact schema-key fix is present in the current recursive cleaner, with offline coverage for both plain `optional` and `~optional` metadata. No narrow gap is demonstrated.
- **#725 — Partially superseded; do not port verbatim.** The historical unconditional synthetic signature was too broad for native replay. Current behavior prefers signed native replay and cached signatures, retains a synthetic fallback only where needed, and excludes Gemma 4. Replacing it with unconditional omission would break the current signed replay boundary. Offline fixtures establish both replay preservation and the Gemma 4 exception; no narrow gap is demonstrated.
- **#731 — Partially superseded; do not port verbatim.** The OpenAI→Gemini synthetic fallback is handled by the same scoped behavior as #725. The Claude→Gemini path does not add the old unconditional fallback; it carries explicit or stored native signatures only. Removing signatures wholesale from function calls would discard valid native replay on that direct route. Offline route fixtures cover the distinction; no narrow gap is demonstrated.

No code change is indicated by these patches. Ordinary offline acceptance for any future narrow gap is the focused schema/signature fixture set named above, run through the repository's standard offline Vitest workflow; no live-provider evidence is needed for this comparison.
