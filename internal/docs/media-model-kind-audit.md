# Model-kind audit for #1136

The table records tests, not a claim that every upstream accepts every model.
A cell marked helper has a cross-kind test of the common validator; the named
endpoint tests exercise a known chat model through the handler. Unknown IDs
remain dispatchable, and explicit custom or synced metadata can override a
registry row. Provider-only search and fetch use provider identities rather
than arbitrary model IDs.

| Endpoint or picker | Chat model | Image, speech, transcription, embedding or video model of a different kind | Evidence and remaining gap |
| --- | --- | --- | --- |
| Image generation and edit | Handler test | No individual cross-kind endpoint matrix | `tests/unit/image-model-kind.test.js:39,111` |
| Speech | Handler test | Helper test | `tests/unit/nonchat-model-kind.test.js:54,98` |
| Transcription and translation | Both handler tests | Helper test | `tests/unit/nonchat-model-kind.test.js:54,98` |
| Embeddings | Handler test | Helper test | `tests/unit/nonchat-model-kind.test.js:54,98` |
| Synchronous and asynchronous video | Both handler tests | Helper test | `tests/unit/nonchat-model-kind.test.js:54,67,98` |
| Music and rerank | Handler test | Helper test | `tests/unit/nonchat-model-kind.test.js:54,98` |
| Web search and fetch | Search handler test; fetch not tested | No explicit cross-kind test | `tests/unit/nonchat-model-kind.test.js:61`; `src/sse/handlers/fetch.js:192`; full provider/model IDs are not search/fetch provider identities |
| Media route picker | Tested for speech, transcription, embedding, video, search and music | No other wrong-kind picker matrix | `tests/unit/media-routes.test.js:106` |
| CLI combo picker | Correct kind included | Image and web-fetch rows excluded; other kinds lack individual assertions | `tests/unit/tui-combo-kind.test.js:13` |
| Chat on mixed providers | Not applicable | Deferred to #1090, which owns the chat handler | `src/sse/handlers/chat.js:189,202,894` checks image separately and provider-level chat capability |

Per-vendor response fixtures without a documented source were not added. No live
provider calls were made. The full browser matrix and the remaining #1136
catalog, picker, endpoint-pair, and fixture evidence remain open.
