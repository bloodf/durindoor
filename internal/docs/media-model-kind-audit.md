# Model-kind audit for #1136

The table records tests, not a claim that every upstream accepts every model.
A cell marked helper has a cross-kind test of the common validator; the named
endpoint tests exercise a known chat model through the handler. Unknown IDs
remain dispatchable. Explicit custom or enabled synced kinds participate in
the check, including IDs absent from the registry (`tests/unit/nonchat-model-kind.test.js:75`). Provider-only search and fetch use provider identities rather
than arbitrary model IDs.

| Endpoint or picker | Chat model | Image, speech, transcription, embedding or video model of a different kind | Evidence and remaining gap |
| --- | --- | --- | --- |
| Image generation and edit | Handler test | No individual cross-kind endpoint matrix | `tests/unit/image-model-kind.test.js:39,111` |
| Speech | Handler test | Helper test | `tests/unit/nonchat-model-kind.test.js:55,172` |
| Transcription and translation | Both handler tests | Helper test | `tests/unit/nonchat-model-kind.test.js:55,172` |
| Embeddings | Handler test | Helper test | `tests/unit/nonchat-model-kind.test.js:55,172` |
| Synchronous and asynchronous video | Both handler tests | Helper test | `tests/unit/nonchat-model-kind.test.js:55,68,172` |
| Music and rerank | Handler test | Helper test | `tests/unit/nonchat-model-kind.test.js:55,172` |
| Web search and fetch | Search handler test; fetch not tested | No explicit cross-kind test | `tests/unit/nonchat-model-kind.test.js:62`; `src/sse/handlers/fetch.js:192`; full provider/model IDs are not search/fetch provider identities |
| Media route picker | Tested for speech, transcription, embedding, video, search and music | No other wrong-kind picker matrix | `tests/unit/media-routes.test.js:106` |
| CLI combo picker | Correct kind included | Image and web-fetch rows excluded; other kinds lack individual assertions | `tests/unit/tui-combo-kind.test.js:13` |
| Chat on mixed providers | Not applicable | Speech, transcription and embedding handler assertions authored; broader pair matrix remains open | `tests/unit/non-chat-model-guard.test.js` covers registry and catalog-only kinds; validation pending |

Per-vendor response fixtures without a documented source were not added. No live
provider calls were made. The full browser matrix and the remaining #1136
catalog, picker, endpoint-pair, and fixture evidence remain open.
