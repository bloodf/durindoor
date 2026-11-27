# deAPI native TTS and STT (staged), 2026-11-27

Issue: #2034. The inventory rows for `deapi` TTS (`TTS_ADAPTERS`/`ttsConfig`) and STT (`sttConfig`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts` has two `deapi` entries:
  - STT: baseUrl `https://oai.deapi.ai/v1/audio/transcriptions`, authType `apikey`, authHeader `bearer`, format `openai`. Models are `WhisperLargeV3Ct2` and `WhisperLargeV3`. A source comment says the CT2 build adds word-level timestamps and `diarized_json`.
  - TTS: baseUrl `https://oai.deapi.ai/v1/audio/speech`, authType `apikey`, authHeader `bearer`, format `openai`, `supportedFormats: ["mp3"]`. Models are `Kokoro`, `Chatterbox`, `Qwen3_TTS_12Hz_1_7B_CustomVoice` and `Qwen3_TTS_12Hz_1_7B_VoiceDesign`. A source comment says deAPI maps the OpenAI stock voices onto its own voices, and that VoiceDesign needs `instructions`.
- `open-sse/handlers/audioSpeech.ts`: the OpenAI-compatible default branch of `handleAudioSpeech` sends `POST` with `Content-Type: application/json` and `Authorization: Bearer <key>`. The body is `{ model, input, voice: voice || "alloy", response_format, speed: speed || 1.0, instructions? }`. `instructions` is sent only when it is a non-empty string. The audio stream is passed through.
- `open-sse/handlers/audioTranscription.ts`: the OpenAI-compatible default branch of `handleAudioTranscription` sends one multipart `POST` with `Authorization: Bearer <key>`. The fields are `model`, then `language`, `prompt`, `response_format`, `temperature` and `timestamp_granularities[]` when present, then `file`. The answer text is passed through with its content type.
- `open-sse/utils/audioMultipart.ts`: in `buildMultipartBody`, the file name comes from `getUploadedFileName`. That function renames `.opus` to `.ogg` and falls back to `audio.wav`. Then `"` and CR/LF are replaced with `_`. The file part uses the file's own type, or `application/octet-stream`.
- `src/shared/constants/providers/apikey/specialty-media.ts`: the `deapi` display entry (name `deAPI`, icon `image`, color `#18181B`, text icon `DE`, website `https://deapi.ai`). Auth is an API key sent as Bearer.
- `tests/unit/deapi-provider.test.ts`: speech body assertions (VoiceDesign `instructions`, default `alloy`, no `instructions` when none is sent).

The source has no deAPI model fetcher and no `validateUrl`. Audio models are static.

## Fresh-main check

Checked `HEAD` and `origin/main` (`f14f877ec1`). `git grep -il deapi` over `open-sse` and `src` finds only unrelated substrings: `resolveHordeApiKey`, `actModeApiProvider` and `includeApiType`.

- No `open-sse/providers/registry/deapi.js` exists. No provider, alias, model row, `ttsConfig` or `sttConfig` names deAPI.
- `TTS_ADAPTERS` has no `deapi` entry.
- The generic paths match the wire envelope but are not equivalent:
  - `FORMAT_HANDLERS.openai` (`genericFormats.js`, `openaiCompat`) builds the same JSON body. It also sets no deadline, follows redirects, forwards every extra body field, throws the upstream error text, and streams unchecked bytes.
  - `transcribeOpenAICompatible` (`sttCore.js`) builds the same multipart shape. It also forwards every client field, sets no deadline, follows redirects, quotes the upstream error, and has no accepted-job outcome.
- `src/sse/handlers/stt.js` has no accepted-job recording.

With no provider and no safe equivalent, the staged module is the whole delta.

## Staged module

`open-sse/services/providerParity/native-deapi-tts-stt/`:

- `config.js`: IDs, the fixed origin, endpoints, models, bounds, and `DEAPI_PROVIDER_DEFINITION` (the staged registry entry).
- `http.js`: one bounded send, redirect refusal, refusal mapping, and accepted-job accounting.
- `tts.js`: `createDeapiTtsAdapter` and `buildDeapiSpeechRequest`. These follow the `TTS_ADAPTERS` `synthesize` contract.
- `stt.js`: `createDeapiSttAdapter` and `buildDeapiTranscriptionRequest`. These follow the Kie-style `transcribe({ model, formData, credentials, kind, signal })` contract, and the result matches the `handleSttCore` shape.
- `index.js`: exports, plus the default instances `deapiTtsAdapter` and `deapiSttAdapter`.
- `registration.json`: exports, IDs, models, endpoints, bounds and integration points.

Production code imports none of these files.

## Supported subset

Speech (`POST https://oai.deapi.ai/v1/audio/speech`):

- Supports the four source models, as `model` or as `model/voice`. The voice defaults to `alloy`.
- `speed` must be a number from 0.25 to 4.0. It defaults to 1.0.
- `instructions` must be a string. The VoiceDesign model requires it.
- `response_format` is always sent as `mp3`. A client may name `mp3` or `json`, or omit it; `json` is the gateway's base64 wrapper.
- The answer must be mp3: an ID3 tag or an MPEG layer III frame. The default limit is 50 MiB.
- On success, the adapter returns `{ base64, format: "mp3", accounting }`. The cost is unknown. `withTtsUsage` in the core adds input characters.

Transcription (`POST https://oai.deapi.ai/v1/audio/transcriptions`):

- Supports both source models.
- `response_format` accepts `json` (the default), `text`, `verbose_json` and `diarized_json`. `diarized_json` is accepted on the CT2 model only.
- `timestamp_granularities` is accepted only with `verbose_json`. Supported values are `segment` and `word`; `word` is accepted on the CT2 model only. Both client spellings are merged, and every distinct value is sent.
- `language` and `prompt` are optional strings of at most 4096 characters. `temperature` must be from 0 to 1.
- The uploaded file must be non-empty and at most 25 MiB.
- JSON answers must be an object with a string `text`. They are passed through unchanged. For `text`, the transcript is returned as `text/plain`.
- The adapter records usage from `usage` when it is an object. It records audio seconds from `duration`, or from `usage.seconds` when `usage.type === "duration"`. The cost is unknown.

## Deviations and restrictions

- **Fixed origin.** The key goes only to `https://oai.deapi.ai`. Connection base URLs are ignored. Requests go through `proxyAwareFetch` with the connection's own proxy options.
- **One request, no retry or replay.** Redirects are refused (`redirect: "manual"`). A 3xx or redirected answer is not followed.
- **Deadline and cancellation.** Each call has one deadline that covers the send and the body: 120 s for TTS and 300 s for STT. The adapter stops waiting even when the transport ignores its signal. The caller's signal aborts both the send and the body read.
- **Refusals before submit.** The adapter refuses these inputs before anything is sent, with `local: true`:
  - Unknown models.
  - Streaming (`stream`, or a `stream_format` other than `audio`).
  - Speech containers other than mp3.
  - VoiceDesign without `instructions`.
  - A wrong `speed`, `voice` or `instructions` type, or a voice named twice with different values.
  - A speech request body over 256 KiB.
  - Translations. The source registers no translation route for deAPI, and the staged `sttConfig.translationModels: []` keeps `supportsSttTranslation` false.
  - `srt` and `vtt` output. The source does not list them for deAPI.
  - `diarized_json` or word timestamps on `WhisperLargeV3`.
  - Granularities without `verbose_json`.
  - A bad `temperature`.
  - A missing, empty or oversized file.
  - A `url` input. The source downloads `url` input through a route-injected fetcher; DurinDoor's STT route has no equivalent.
  - Fields outside the source list, such as `include[]`. These are not forwarded, as in the source.
- **Refusal mapping.** deAPI's text is never quoted, and the selected connection's key is redacted.
  - 401 and 403 are kept as auth refusals.
  - 402 becomes `quotaExhausted` on that connection.
  - 429 and 503 keep a bounded `Retry-After`.
  - Other 4xx statuses pass through.
  - Any other 5xx is an unknown outcome and carries `acceptedJob` (`submit-unknown`).
- **Uncertain outcomes.** These cases carry `acceptedJob` with `cost: null`, `costStatus: "unknown"` and `costSource: "accepted-job"`:
  - A timeout after the send.
  - A network failure after the send. Only `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` and `UND_ERR_CONNECT_TIMEOUT` count as provably unsent.
  - A caller abort after the send.
  - A refused redirect.
  - A 2xx that is unreadable, oversized, empty, HTML, non-mp3, or lacks `text`.

  The route records these once on the selected connection and never resubmits them elsewhere.
- **Error envelopes.** A 200 JSON error envelope is a refusal that produced no output, following the local 9router #5864 convention. It does not carry `acceptedJob`, and its text is not quoted.

## Registration (serial step, not done here)

Integration points, from `registration.json`:

1. Add a new `open-sse/providers/registry/deapi.js` from `DEAPI_PROVIDER_DEFINITION`:
   - `serviceKinds` `["tts", "stt"]`, plus kinds from the other deAPI #2034 rows (image, video, embeddings), which must merge into the same entry.
   - Model rows with `kind`.
   - `sttConfig` with `translationModels: []`.
   - No `ttsConfig`, so the generic `openaiCompat` handler can never serve deAPI.
2. In `open-sse/handlers/ttsProviders/index.js`, add `deapi: deapiTtsAdapter` to `TTS_ADAPTERS`.
3. In `src/sse/handlers/tts.js`, pass `requestedResponseFormat` for `deapi`. `recordAcceptedTts` already exists.
4. In `open-sse/handlers/sttCore.js`, add a `deapi` branch before the format switch so `transcribeOpenAICompatible` never serves deAPI.
5. In `src/sse/handlers/stt.js`, record `result.acceptedJob` once and stop account fallback for it.
6. In `docs/providers/catalog.mdx`, list the deAPI kinds.

The isolated staging block in the test asserts that `TTS_ADAPTERS` has no `deapi` entry, that `registry/deapi.js` does not exist, and that `registration.json` says `staged-unregistered`. At registration, only that block should flip to positive identity assertions.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-deapi-tts-stt.test.js --maxWorkers=2`: 60 tests pass. The tests use closed mocks only: an injected transport, synthetic keys, and no network, browser or live account.

The tests cover:

- Exact URLs, headers, JSON body and multipart field order and file part.
- Success normalization and accounting.
- Two credentials on separate requests.
- Proxy options handed to the transport.
- Every refusal before submit, with no transport call.
- Status mapping with no leaked key or body.
- Redirect refusal.
- Unsent and post-send transport failures.
- Abort before and after send.
- A deadline with a transport that ignores its signal.
- A stalled body.
- Error envelopes and malformed, non-mp3, empty or oversized answers.

`eslint` and the repository oxlint/anti-slop config both report no problems on the changed files.

Passing these tests says nothing about the live deAPI service.
