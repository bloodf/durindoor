# NanoGPT native TTS and STT (staged), 2026-11-27

Issue: #2034. The inventory rows for `nanogpt` TTS (`TTS_ADAPTERS`/`ttsConfig`) and STT (`sttConfig`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts` has two `nanogpt` entries. Neither sets `format`, so both use the OpenAI-compatible default branch of their handler.
  - STT: baseUrl `https://nano-gpt.com/api/v1/audio/transcriptions`, authType `apikey`, authHeader `bearer`. Models are `whisper-1` (Whisper 1) and `gpt-4o-transcription` (GPT-4o Transcription).
  - TTS: baseUrl `https://nano-gpt.com/api/v1/audio/speech`, authType `apikey`, authHeader `bearer`. Models are `tts-1-hd` (TTS 1 HD) and `tts-1` (TTS 1). No `defaultVoice`.
- `open-sse/handlers/audioSpeech.ts`: the default branch of `handleAudioSpeech` sends `POST` with `Content-Type: application/json` and `Authorization: Bearer <key>`. The body is `{ model, input, voice: voice || "alloy", response_format, speed: speed || 1.0, instructions? }`. `response_format` comes from `normalizeSpeechResponseFormat`: missing becomes `mp3`, values are lower-cased, and `ogg` becomes `opus`. `instructions` is sent only when it is a non-empty string. The audio stream is passed through.
- `open-sse/handlers/audioTranscription.ts`: the default branch of `handleAudioTranscription` sends one multipart `POST` with `Authorization: Bearer <key>`. The fields are `model`, then `language`, `prompt`, `response_format`, `temperature` and `timestamp_granularities[]` when present, then `file`. The answer text is passed through with its content type.
- `open-sse/utils/audioMultipart.ts`: in `buildMultipartBody`, the file name comes from `getUploadedFileName` (`.opus` becomes `.ogg`, fallback `audio.wav`), then `"` and CR/LF are replaced with `_`. The file part uses the file's own type, or `application/octet-stream`.
- `open-sse/config/providers/registry/nanogpt/index.ts`: the chat entry (apikey, Bearer, `modelsUrl` for the chat catalog).

The source lists NanoGPT audio models statically. It has no audio model fetcher; the `modelsUrl` is the chat catalog.

### Inventory note

The #2034 inventory has a second STT row with endpoint `https://nano-gpt.com/api/v1/audio/speech`. The pinned source has no such pairing. That URL belongs to the speech entry, and `handleAudioTranscription` posts only to the transcription entry's `baseUrl`. The row duplicates the speech row, so nothing is staged for it.

## Fresh-main check

Checked `HEAD` (`42df15c70b`) and `origin/main` (`fdbb72865a`).

- `open-sse/providers/registry/nanogpt.js` exists and is the same on both. It has id and alias `nanogpt`, apikey auth, the chat transport, `modelsFetcher`, and `serviceKinds: ["llm"]`. It has no `ttsConfig`, no `sttConfig` and no audio model rows.
- `TTS_ADAPTERS` (`open-sse/handlers/ttsProviders/index.js`) has no `nanogpt` entry. `synthesizeViaConfig` needs `ttsConfig`, which NanoGPT lacks.
- `handleSttCore` (`open-sse/handlers/sttCore.js`) returns "does not support STT" when there is no `sttConfig`.
- `git grep -i nanogpt` finds no NanoGPT reference under `open-sse/handlers` or `src/sse`.
- The generic OpenAI paths (`FORMAT_HANDLERS.openai` in `genericFormats.js`, and `transcribeOpenAICompatible` in `sttCore.js`) match the wire envelope but are not equivalent. They set no deadline, follow redirects, quote the upstream error text, and have no accepted-job outcome. They also cannot reach NanoGPT today.

The provider exists for chat only. No TTS or STT path reaches NanoGPT, so the staged module is the whole audio delta.

## Staged module

`open-sse/services/providerParity/native-nanogpt-tts-stt/`:

- `config.js`: IDs, the fixed origin, endpoints, models, bounds, and `NANOGPT_AUDIO_DEFINITION` (the audio fields to merge into the existing registry entry).
- `http.js`: one bounded send, redirect refusal, refusal mapping, and accepted-job accounting. It follows the deAPI staged transport.
- `tts.js`: `createNanogptTtsAdapter`, `buildNanogptSpeechRequest`, `resolveNanogptContainer` and `matchesContainer`. These follow the `TTS_ADAPTERS` `synthesize` contract.
- `stt.js`: `createNanogptSttAdapter` and `buildNanogptTranscriptionRequest`. These follow the `transcribe({ model, formData, credentials, kind, signal })` contract, and the result matches the `handleSttCore` shape.
- `index.js`: exports, plus the default instances `nanogptTtsAdapter` and `nanogptSttAdapter`.
- `registration.json`: exports, IDs, models, endpoints, bounds and integration points.

Production code imports none of these files.

## Supported subset

Speech (`POST https://nano-gpt.com/api/v1/audio/speech`):

- Supports `tts-1-hd` and `tts-1`, as `model` or as `model/voice`. The voice defaults to `alloy`.
- `speed` must be a number from 0.25 to 4.0. It defaults to 1.0.
- `instructions` must be a string. It is sent only when non-empty, as in the source.
- Containers: `mp3` (default), `opus` (also named `ogg`), `aac`, `flac` and `wav`. The container comes from the body `response_format` (or the route's `requestedResponseFormat`), or else from the query-string format. `json` names the gateway's base64 wrapper, not a container.
- The answer must start with the requested container's signature: ID3 or an MPEG layer III frame for mp3, `OggS` for opus, ADTS or `ADIF` for aac, `fLaC` for flac, and `RIFF`…`WAVE` for wav. The default limit is 50 MiB.
- On success, the adapter returns `{ base64, format: <container>, accounting }`. The cost is unknown. `withTtsUsage` in the core adds input characters, and gives no price because NanoGPT is not the official OpenAI origin.

Transcription (`POST https://nano-gpt.com/api/v1/audio/transcriptions`):

- `whisper-1` accepts `response_format` `json` (the default), `text` and `verbose_json`, and `timestamp_granularities` `segment` and `word` with `verbose_json` only. Both client spellings are merged, and every distinct value is sent.
- `gpt-4o-transcription` accepts `json` and `text` only, with no timestamps.
- `language` and `prompt` are optional strings of at most 4096 characters. `temperature` must be from 0 to 1.
- The uploaded file must be non-empty and at most 25 MiB.
- JSON answers must be an object with a string `text`. They are passed through unchanged. For `text`, the transcript is returned as `text/plain`, from a text body or from the `text` field of a JSON body.
- The adapter records usage from `usage` when it is an object. It records audio seconds from `duration`, or from `usage.seconds` when `usage.type === "duration"`. The cost is unknown.

## Deviations and restrictions

- **Fixed origin.** The key goes only to `https://nano-gpt.com`. Connection base URLs are ignored. Requests go through `proxyAwareFetch` with the connection's own proxy options.
- **Auth.** Only the selected connection's `apiKey` (or `accessToken`) is sent, as `Authorization: Bearer`. A key with CR/LF is refused. The existing apikey connection mode is unchanged; NanoGPT has no cookie or OAuth mode.
- **One request, no retry or replay.** Redirects are refused (`redirect: "manual"`).
- **Deadline and cancellation.** Each call has one deadline that covers the send and the body: 120 s for TTS and 300 s for STT. The adapter stops waiting even when the transport ignores its signal. The caller's signal aborts both the send and the body read.
- **Refusals before submit.** These are refused with `local: true` before anything is sent:
  - Unknown models, including chat models.
  - Streaming (`stream`, or a `stream_format` other than `audio`).
  - `pcm` speech output. It has no signature to check, so the adapter could not tell audio from an error page.
  - Unknown speech containers, and two different named containers.
  - A wrong `speed`, `voice` or `instructions` type, or a voice named twice with different values.
  - A speech request body over 256 KiB.
  - Translations. The source registers no translation route for NanoGPT, and `sttConfig.translationModels: []` keeps `supportsSttTranslation` false.
  - `srt`, `vtt` and `diarized_json` output. The source passes any value through; this subset keeps only formats whose answer can be checked.
  - `verbose_json` or timestamps on `gpt-4o-transcription`. This is a conservative restriction: the source does not say NanoGPT returns them for that model.
  - Granularities without `verbose_json`, or values other than `segment` and `word`.
  - A bad `temperature`, or `language` or `prompt` over 4096 characters.
  - A missing, empty or oversized file.
  - A `url` input. The source downloads it through a route-injected fetcher; DurinDoor's STT route has no equivalent.
  - Fields outside the source list, such as `include[]`, are not forwarded, as in the source.
- **Refusal mapping.** NanoGPT's text is never quoted, and the selected connection's key is redacted.
  - 401 and 403 are kept as auth refusals.
  - 402 becomes `quotaExhausted` on that connection only. Another connection still works.
  - 429 and 503 keep a bounded `Retry-After`.
  - Other 4xx statuses pass through.
  - Any other 5xx is an unknown outcome and carries `acceptedJob` (`submit-unknown`).
- **Uncertain outcomes.** These carry `acceptedJob` with `cost: null`, `costStatus: "unknown"` and `costSource: "accepted-job"`:
  - A timeout, network failure or caller abort after the send. Only `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` and `UND_ERR_CONNECT_TIMEOUT` count as provably unsent.
  - A refused redirect.
  - A 2xx that is unreadable, oversized, empty, HTML, the wrong container, lacks `text`, or (for `text`) is a JSON or HTML document.

  The route records these once on the selected connection and never resubmits them elsewhere.
- **Error envelopes.** A 200 JSON error envelope is a refusal that produced no output, following the local 9router #5864 convention. It does not carry `acceptedJob`, and its text is not quoted.
- **Quota fetcher.** `open-sse/config/providerQuota.js` marks `nanogpt` as `provider-not-present`. The source's NanoGPT subscription usage fetcher is chat-quota scope and is not part of this row.

## Registration (serial step, not done here)

Integration points, from `registration.json`:

1. In `open-sse/providers/registry/nanogpt.js`, keep every existing field. Set `serviceKinds` to `["llm", "tts", "stt"]`, append the model rows with `kind`, and add `sttConfig` from `NANOGPT_AUDIO_DEFINITION` (with `translationModels: []`). Add no `ttsConfig`, so the generic `openaiCompat` handler can never serve NanoGPT.
2. In `open-sse/handlers/ttsProviders/index.js`, add `nanogpt: nanogptTtsAdapter` to `TTS_ADAPTERS`.
3. In `src/sse/handlers/tts.js`, add `nanogpt` to `NAMED_FORMAT_PROVIDERS`. `recordAcceptedTts` already exists.
4. In `open-sse/handlers/sttCore.js`, add a `nanogpt` branch before the format switch so `transcribeOpenAICompatible` never serves NanoGPT.
5. In `src/sse/handlers/stt.js`, record `result.acceptedJob` once and stop account fallback for it.
6. In `docs/providers/catalog.mdx`, list the NanoGPT tts and stt kinds.

The isolated staging block in the test asserts that `TTS_ADAPTERS` has no `nanogpt` entry, that the registry entry has `serviceKinds: ["llm"]` with no `ttsConfig` or `sttConfig`, and that `registration.json` says `staged-unregistered`. At registration, only that block should flip to positive identity assertions.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-nanogpt-tts-stt.test.js --maxWorkers=2`: 72 tests pass. The tests use closed mocks only: an injected transport, synthetic keys, and no network, browser or live account.

The tests cover:

- Exact URLs, headers, JSON body, multipart field order and the file part.
- Each container with its signature check, and container resolution.
- Success normalization and accounting.
- Two credentials on separate requests, a 402 on one with the other still working, and an ignored connection base URL.
- Proxy options handed to the transport.
- Every refusal before submit, with no transport call.
- Status mapping with no leaked key or body.
- Redirect refusal.
- Unsent and post-send transport failures.
- Abort before and after send.
- A deadline with a transport that ignores its signal, and a stalled body.
- Error envelopes, and malformed, wrong-container, empty or oversized answers.

`eslint` and the repository oxlint config (with the anti-slop plugin) report no problems on the changed files.

Passing these tests says nothing about the live NanoGPT service.
