# Google (Gemini Live) native STT (staged), 2026-11-27

Issue #2034. The module is staged and unregistered. Nothing in production imports `open-sse/services/providerParity/native-google-stt/`.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (read-only checkout, HEAD verified):

- `open-sse/config/audioRegistry.ts`, `AUDIO_TRANSCRIPTION_PROVIDERS.gemini`: `baseUrl: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"`, `authType: "apikey"`, `authHeader: "x-goog-api-key"`, `format: "gemini-live"`, `modelScoped: true`, and one model, `gemini-3.5-transcribe-live`.
- `open-sse/handlers/audioTranscription.ts` `handleGeminiLiveTranscription`: returns 413 above 25 MiB, forwards the `prompt` and `language` form fields, and answers `{ text }` as JSON.
- `open-sse/executors/geminiLiveTranscribe.ts`: converts the upload to 16 kHz mono PCM (WAV fast path, otherwise ffmpeg) and opens the socket. Credentials go in headers only: `x-goog-api-key`, or `Authorization: Bearer` for an access token. The session sends a setup frame, streams 3200-byte `realtimeInput.audio` frames after `setupComplete`, then sends `audioStreamEnd`. It joins `serverContent.inputTranscription.text` values with spaces and finishes 250 ms after `turnComplete`/`generationComplete`. Without one of those, it finishes after a 5 s grace or on close. The session has a 120 s total wait.

### The `google` inventory row

The #2034 inventory lists STT `google` with `gemini-tts` and `https://generativelanguage.googleapis.com/v1beta/models`. Those are the exact fields of the source's `AUDIO_SPEECH_PROVIDERS.google` entry (TTS, `credentialProviderId: "gemini"`). `AUDIO_TRANSCRIPTION_PROVIDERS` has no `google` key, so `getTranscriptionProvider("google")` returns `null` in the source, and the row was attributed to the wrong map. That TTS row already maps to local Gemini TTS. The only native Google AI Studio transcription contract in the source is the `gemini` Live row, and this module ports that row. No `google` STT identity is added.

## Fresh-main check

- `open-sse/providers/registry/gemini.js`: `sttConfig` has `format: "gemini-stt"` with `gemini-3.5-transcribe`, `gemini-2.5-pro` and `gemini-2.5-flash`. `gemini-3.5-transcribe-live` exists only as a `kind: "live"` row.
- `open-sse/handlers/sttCore.js` `transcribeGemini`: Files upload + Interactions for `gemini-3.5-transcribe`, and `generateContent` for the other models. It has no WebSocket path, and per the task those paths are not duplicated here.
- `src/sse/handlers/nativeProviderConfig.js` `gemini["/live"]` + `open-sse/handlers/nativeRealtimeRelay.js`: these relay raw Live sessions on `/v1/realtime/native`. The client sends the setup and the relay authenticates with `?key=`. The relay reaches the same endpoint under a different contract and never turns an uploaded file into a transcript.
- `git grep -n transcribe-live`: the registry row and one relay test only.

File-mode Live transcription is therefore the remaining delta.

## Staged module

| File | Contents |
| --- | --- |
| `config.js` | Provider id, fixed WebSocket URL, the source model (`kind: "stt"`), source and gateway bounds, `GEMINI_LIVE_STT_CONFIG` (`format: "gemini-live-stt"`, `translationModels: []`) |
| `request.js` | Input checks, `extractPcmFrom16kWav` (source port), setup/audio/end frame builders |
| `socket.js` | `runGeminiLiveSocket`: one session that never rejects and resolves an outcome, whether audio left, the text and usage |
| `stt.js` | Auth headers, WebSocket proxy agent, outcome-to-result mapping, adapter factory |
| `index.js` | Exports and the default `geminiLiveSttAdapter` |
| `registration.json` | Exports, canonical id/aliases, models, service kinds, endpoint/auth, bounds, integration points |

## Supported subset

- Model: `gemini-3.5-transcribe-live` only (source `modelScoped`). Other ids are refused. Discovery is static because the source has no dynamic list for Live STT.
- Auth: the selected connection's `apiKey` goes in `x-goog-api-key`. Without one, its `accessToken` goes in `Authorization: Bearer`. A value with CR/LF or only whitespace is unusable (401). Credentials never go in the URL.
- Endpoint: the fixed source URL only. `providerSpecificData.baseUrl` and registry base URLs are ignored, although the source honored them. Egress follows the connection's WebSocket proxy route (`resolveWebSocketProxyRoute` over `resolveCredentialProxyOptions`). A required proxy that cannot be built refuses the call before connecting.
- Input: an uploaded `file` of at most 25 MiB that is a RIFF/WAVE PCM file, mono, 16 kHz, 16-bit, with 1 to 600 s of samples. Optional `language` (BCP-47 shape) maps to `inputAudioTranscription.languageCodes`, and optional `prompt` (≤ 4096 chars, trimmed) maps to `systemInstruction`. Also optional: `response_format=json`.
- Output: HTTP 200 `application/json` `{ text }`. `usageMetadata` frames are kept when numeric and non-negative and feed `mediaAccounting`. `nativeUnits.audioSeconds` is the submitted PCM duration. Cost stays `unknown`. `accounting.meta.completion` records `turn-complete`, `grace` or `close`.

## Deviations and restrictions

The following are refused locally before any socket opens, so nothing is sent or billed:

- Any audio other than 16 kHz/16-bit/mono PCM WAV (415). The source spawned ffmpeg for other containers. This staged adapter spawns no process, and conversion remains a registration-time decision.
- Translations, `stream=true` (live sessions belong to `/v1/realtime/native`), a `url` input, `response_format` other than `json`, and fields the source silently dropped (`timestamp_granularities`, `temperature`, `diarization*`, `custom_vocabulary`, `mode`, `chunking_strategy`, `include`).

Transport and result handling:

- Redirects are never followed (`followRedirects: false`). Any non-101 upgrade answer ends the session with nothing sent, mapped by status: 401, 403, 429 (`quotaExhausted`, `Retry-After` evidence), 503, other 4xx pass through, and everything else becomes 502.
- Deadlines: 10 s handshake, 15 s setup to `setupComplete`, 120 s total (source), 5 s post-end grace (source). Caller abort terminates the socket in every phase. The source only killed ffmpeg on abort.
- Caps: 1 MiB per server frame and 1 MiB of transcript.
- Refusal and error text from Gemini (in-band `error.message`, close reasons) is used only to classify quota and never appears in results. Results are additionally scrubbed of the connection's credentials.
- Close codes before audio: 4429 or a quota reason maps to 429 with `quotaExhausted`, 1008/4403 to 403, 4401 to 401, 1007 to 400. The source mapped every 1008 to 429, which would put an account with a bad key into cooldown.
- After the first audio frame leaves, every failure carries `acceptedJob` (`costSource: "accepted-job"`, unknown cost). Failures before `audioStreamEnd` use `jobState: "submit-unknown"` and failures after it use `"accepted"`. That covers timeout, abort (499), upstream error, abnormal close, and oversized frames or transcript. Nothing is retried or replayed.
- A non-1000/1005 close after `audioStreamEnd` and before `turnComplete` is a lost result. The source returned it as success.
- Not ported: interim hypotheses (the source omits them too), `modelTurn` output, and proxy pools for WebSocket egress (only the connection proxy URL and environment proxy are resolved, as in the realtime relay).

## Registration (serial, after this stage)

See `registration.json` `integrationPoints`. Expose `gemini-3.5-transcribe-live` to STT in `gemini.js` and keep its `live` row and the existing `gemini-stt` models. Add a branch in `handleSttCore` ahead of the format switch for `provider === "gemini" && model === "gemini-3.5-transcribe-live"`. `src/sse/handlers/stt.js` already honors `acceptedJob`. At registration, promote the isolated staging block in `tests/unit/native-google-stt.test.js` to positive identity assertions.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-google-stt.test.js --maxWorkers=2`. The tests use closed synthetic WebSocket mocks only. They make no network calls and launch no browser.
