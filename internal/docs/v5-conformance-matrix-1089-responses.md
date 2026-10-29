# #1089 OpenAI Responses client conformance matrix

Counts: already-present 6; failing 1; unsupported-by-contract 0; upstream-pending 0.

| Direction | Feature | Target | Status | Covering test |
|---|---|---|---|---|
| Request | Strict flag, explicit tool choice, parallel limit | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-responses.test.js` |
| Request | function_call/function_call_output pairing | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-responses.test.js` |
| Request | Pairing scoped to assistant turn | OpenAI Chat | failing | `tests/translator/v5-conformance-matrix-responses.test.js` |
| Request | Non-string description | Kiro | already-present | `tests/translator/v5-conformance-matrix-responses.test.js` |
| Stream | response.incomplete | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-responses.test.js` |
| Stream | response.failed | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-responses.test.js` |
| Non-stream | Incomplete status | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-responses.test.js` |

Already covered elsewhere: response JSON projection and custom/namespaced tools in `tests/translator/v5-conformance-responses-json.test.js`; parallel flag in `tests/translator/v5-conformance-responses-json.test.js`; terminal stream cases in `tests/translator/v5-conformance-error-terminals.test.js`; media ceiling in `tests/translator/v5-conformance-tool-media-ceilings.test.js`; schema normalization in `tests/translator/v5-conformance-responses-json.test.js`.
