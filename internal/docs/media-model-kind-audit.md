# Model-kind audit for #1136

The table records tests, not a claim that every upstream accepts every model.
A cell marked helper has a cross-kind test of the common validator; the named
endpoint tests exercise a known chat model through the handler. Unknown IDs
remain dispatchable. Explicit custom or enabled synced kinds participate in
the check, including IDs absent from the registry (`tests/unit/nonchat-model-kind.test.js:75`). Endpoint-specific model declarations (such as `sttConfig.models`) also participate in endpoint kind checks so explicitly configured routes remain usable. Provider-only search and fetch use provider identities rather
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

## Transport slice (this change)

The media kinds now share one table of "which provider can serve this kind,
and on which endpoint", built from the registry service-kind metadata:

- `src/shared/constants/mediaRoutes.js` holds `MEDIA_KIND_TRANSPORTS` (the
  config key that carries a kind and the endpoints that run it) and
  `MEDIA_ENDPOINT_KINDS` / `mediaKindForEndpoint`.
- `src/sse/services/mediaTransport.js` turns that metadata into
  `mediaTransportSupport` (`supported` / `unsupported` / `unknown`) and
  `mediaEndpointSupport` (kind transport plus the endpoint's own rule). It
  sits apart from `mediaRoutes.js` so an endpoint handler can ask without
  pulling the route service (settings, catalogs, keyless probes) along.
- `src/sse/services/mediaRoutes.js` keeps the route itself: candidates,
  order, saved routes. Discovery now drops a candidate whose provider
  provably cannot serve the kind, for every kind and not only image and
  embedding. A provider the registry does not describe (a custom node or a
  live catalog row) stays `unknown`, so those rows remain dispatchable.
- Endpoint-specific selection is the same rule the handlers use: the
  synchronous video endpoint runs the sync generator, `/v1/videos` runs the
  async job providers, `/v1/audio/translations` runs the providers with a
  translations endpoint.

Rejected pairs now name the endpoint that can serve the model instead of
denying the kind: `Provider 'xai' does not support synchronous video
generation on /v1/video/generations. Use /v1/videos for asynchronous video
jobs.` The same wording covers the reverse direction on `/v1/videos`.

Evidence: `tests/unit/1136-media-discovery.test.js`.

## Per-vendor offline fixtures

`tests/fixtures/media/*.json` records, per vendor, the request the gateway
builds and the response it reads. Each fixture names its documentation source
and the gap that a live call would have to close. **No live provider call was
made for any of them**, so every fixture is marked `verifiedLive: false` and a
fixture may only claim `verifiedLive: true` when it carries `liveEvidence`.

| Fixture | Kind | What the fixture pins | Live gap |
| --- | --- | --- | --- |
| `fal-ai.image.json` | image | Queue submit URL, `Key` auth header, body, submit/poll/result bodies, normalized image list | Queue poll interval, upstream error bodies, account limits |
| `minimax-cn.image.json` | image | China host, `aspect_ratio` body, `data.image_urls` response | Content-filter status codes, upstream error bodies |
| `gemini.image.json` | image | `generateContent` URL and key, request parts, `inlineData` response | Safety blocking responses, upstream error bodies |
| `venice.embedding.json` | embedding | OpenAI-compatible embeddings URL, bearer header, request and response envelope | Dimension and rate limits, upstream error bodies |
| `elevenlabs.tts.json` | tts | `text-to-speech` URL with `output_format`, `xi-api-key` header, body, audio response | Voice and model availability, upstream error bodies |
| `deepgram.stt.json` | stt | `listen` URL with model and formatting query, `Token` header, transcript response | Diarization, utterances and profanity filters |

The fixtures cover image, embedding, speech, transcription, synchronous video
(`veoaifree-web.video-sync.json`) and asynchronous video
(`minimax.video-async.json`). The video fixtures are explicitly synthetic and
have `verifiedLive: false`; their live gaps identify the unverified upstream
behavior. Music, search and fetch have no per-vendor fixture yet. The full
browser matrix, remaining #1136 catalog and picker evidence, and all live
provider verification stay open.
