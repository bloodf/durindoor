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

- On the default `geminiLiveSttAdapter` only: any audio other than 16 kHz/16-bit/mono PCM WAV (415). That instance spawns no process. Registration wires `geminiLiveConvertingSttAdapter`, which converts other uploads as the source does (see "Uploaded-audio conversion").
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

## Uploaded-audio conversion

Source: `geminiLiveTranscribe.ts` `convertToPcm16k`/`runFfmpegPcm16k` at the same commit. The source keeps the WAV fast path and otherwise pipes the upload through `ffmpeg ... -protocol_whitelist pipe -i pipe:0 -vn -t 600 -f s16le -acodec pcm_s16le -ac 1 -ar 16000 pipe:1`, with a 60 s timeout, an 8 KiB stderr cap, a decoded-PCM cap and SIGKILL on timeout, abort or overflow. It converts before it resolves the socket URL and headers.

`convert.js` ports this as `createGeminiLiveAudioConverter`. `createGeminiLiveConvertingSttAdapter` passes it to `createGeminiLiveSttAdapter` through the new `convertAudio` option, and `geminiLiveConvertingSttAdapter` is the instance named in `registration.json`. Without `convertAudio`, the factory and `geminiLiveSttAdapter` behave exactly as before, and `tests/unit/native-google-stt.test.js` is unchanged.

The existing helper `open-sse/handlers/codexSttAudio.js` is not reused. It writes the upload to a temp file, whitelists the `file` protocol, finds ffmpeg on `PATH` and gives the child the full server environment.

Contract:

- Order: field checks, then upload size, then the WAV bypass (`extractPcmFrom16kWav`), then conversion, then the PCM checks, and only after that credentials, the proxy agent and the socket. A conversion failure therefore sends nothing and never carries `acceptedJob`. Every conversion failure is `local`.
- Executable: the first executable of `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg` and `/opt/homebrew/bin/ffmpeg`. There is no `PATH` lookup and no caller value.
- Input: the uploaded bytes only, written to stdin. Filename, content type and any `url` field are ignored. The container is sniffed from magic bytes: WAV, MP3 (ID3 or frame sync), FLAC, Ogg, M4A/MP4 (`ftyp`), WebM/Matroska (EBML) and ADTS AAC. Anything else, including playlists, concat scripts, URLs and paths, gets 415 before spawning.
- Argv: a fixed array. Only the demuxer varies, and it comes from the container table. That demuxer is forced with `-f` and is the only entry of `-format_whitelist`. `-protocol_whitelist pipe` matches the source. Output is the first audio stream as s16le, mono, 16 kHz, on stdout.
- Child: `shell: false`, `cwd: "/"`, and `env` limited to `{ LC_ALL: "C", AV_LOG_FORCE_NOCOLOR: "1" }`, so no server or provider credential is inherited. stdio uses pipes only, and no file is written.
- Bounds: 25 MiB input, 60 s conversion (source), and the shared 120 s total deadline, so the socket gets only the time left. Decoded PCM is capped at 600 s and longer audio gets 413; the source cut it silently at 600 s with `-t 600`. stderr is drained, capped at 8 KiB and never surfaced. On timeout, abort or overflow the child gets SIGKILL and its pipes are destroyed. The result returns once the child is reaped, or after a 2 s reap window.
- Output: odd-length PCM gives 500. Empty output gives 400. A non-zero exit gives 400 without quoting stderr. The PCM is framed with `encodePcm16kWav` (exact 44-byte header) and read back with `extractPcmFrom16kWav` before use.
- Missing ffmpeg: a local 503 that names ffmpeg and the checked paths. It needs no account and does not penalize one. 16 kHz mono 16-bit PCM WAV still works without ffmpeg.
- Limits: M4A/MP4 files whose `moov` atom follows the media data cannot be read from a pipe, the same as in the source. Windows hosts have no candidate path and get the 503.

Public docs: `docs/providers/catalog.mdx` is outside this unit. The registration integration point records the text to publish: non-WAV uploads need ffmpeg in one of the fixed locations (the Docker image installs `/usr/bin/ffmpeg`), and without it those uploads get HTTP 503.

## Registration (serial, after this stage)

See `registration.json` `integrationPoints`. Expose `gemini-3.5-transcribe-live` to STT in `gemini.js` and keep its `live` row and the existing `gemini-stt` models. Add a branch in `handleSttCore` ahead of the format switch for `provider === "gemini" && model === "gemini-3.5-transcribe-live"` that calls `geminiLiveConvertingSttAdapter`. `src/sse/handlers/stt.js` already honors `acceptedJob`. At registration, promote the isolated staging block in `tests/unit/native-google-stt.test.js` to positive identity assertions.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/gemini-live-audio-inputs.test.js unit/native-google-stt.test.js --maxWorkers=2`: 83 tests (34 + the original 49). The tests use closed synthetic WebSocket mocks and an injected synthetic ffmpeg child only. They run no ffmpeg binary, make no network calls and launch no browser, so they say nothing about a real ffmpeg build.
