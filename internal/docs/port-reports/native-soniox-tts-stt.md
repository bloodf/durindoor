# Soniox native TTS and STT (staged), 2026-11-27

Issue: #2034. The inventory rows for `soniox` TTS (`TTS_ADAPTERS`/`ttsConfig`) and STT (`sttConfig`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts` has two `soniox` entries:
  - STT: baseUrl `https://api.soniox.com/v1/transcriptions`, authType `apikey`, authHeader `bearer`, `async: true`, format `soniox`. Models are `stt-async-v5` and `stt-async-v4`.
  - TTS: baseUrl `https://tts-rt.soniox.com/tts`, authType `apikey`, authHeader `bearer`, format `soniox-tts`. Models are `tts-rt-v2` and `tts-rt-v1`. A source comment says v1 is deprecated upstream and served by v2.
- `open-sse/handlers/audioSpeech.ts` `handleSonioxSpeech`: one `POST` with `Content-Type: application/json` and `Authorization: Bearer <key>`. The body is `{ text, model, language, voice, audio_format }`. `language` is the trimmed request language or `en`. `resolveSonioxVoice` sends the trimmed voice unless it is empty or an OpenAI stock voice; then it sends `Adrian`. `audio_format` is `response_format` or `mp3`, with `pcm` sent as `pcm_s16le`. The answer is streamed and labelled `audio/wav`, `audio/opus` or `audio/mpeg`.
- `open-sse/handlers/audioTranscription.ts` `handleSonioxTranscription`:
  1. Multipart `POST https://api.soniox.com/v1/files` with the single part `file`. The answer is `{ id }`.
  2. JSON `POST /v1/transcriptions` with `{ model, file_id, enable_language_identification: true }`. `enable_speaker_diarization: true`, `context` and `language_hints: [language]` are added only when asked.
  3. `GET /v1/transcriptions/{id}` every 2 s for up to 120 s, until `status` is `completed` or `error`. A non-2xx status check is skipped.
  4. `GET /v1/transcriptions/{id}/transcript`. The text is `text`, or the joined token texts.
  - The default answer is `{ text }`. Diarization (`enable_speaker_diarization`, `diarization`, `speaker_labels` or `diarize`, truthy) or `response_format=verbose_json` gives a verbose body with speaker segments, language and duration. `timestamp_granularities[]=word` adds `words`.
- `open-sse/utils/audioMultipart.ts`: the upload file name rule (`.opus` becomes `.ogg`, `audio.wav` when unnamed, `"` and CR/LF become `_`).
- `src/shared/constants/providers/audio.ts`: display entry `Soniox`, alias `sx`, icon `mic`, color `#5B5BD6`, text icon `SX`, website `https://soniox.com`.
- `src/lib/providers/validation/audioMiscProviders.ts` `validateSonioxProvider`: `GET https://api.soniox.com/v1/transcriptions` with the Bearer key. 401/403 means an invalid key.

The inventory also lists an STT row with `apikey / bearer / soniox-tts` and endpoint `https://tts-rt.soniox.com/tts`. That tuple is the speech entry only. The transcription dispatcher sends format `soniox` to `handleSonioxTranscription`, which only calls `api.soniox.com`. No transcription code reaches `tts-rt.soniox.com`. The row duplicates the TTS row, and nothing is staged for it.

The source has no Soniox model fetcher. Models are static. The only Soniox list call is the validation probe.

## Fresh-main check

Checked `HEAD` and `origin/main` (`a6cb6dea80`). `git grep -i soniox` finds only inventory rows in `internal/docs/port-reports/`.

- No `open-sse/providers/registry/soniox.js` exists. No registry entry uses the id `soniox` or the alias `sx`.
- `TTS_ADAPTERS` and `FORMAT_HANDLERS` have no `soniox` or `soniox-tts` entry.
- `handleSttCore` has no `soniox` format. Its other async job formats use different endpoints and envelopes, so none is equivalent.

With no provider and no equivalent, the staged module is the whole delta.

## Staged module

`open-sse/services/providerParity/native-soniox-tts-stt/`:

- `config.js`: IDs, alias, fixed origins, endpoints, models, bounds, and `SONIOX_PROVIDER_DEFINITION` (the staged registry entry, API key only).
- `http.js`: one bounded send, redirect refusal, refusal mapping, bounded JSON reading and accepted-job accounting.
- `tts.js`: `createSonioxTtsAdapter` and `buildSonioxSpeechRequest`. These follow the `TTS_ADAPTERS` `synthesize` contract.
- `stt.js`: `createSonioxSttAdapter` and `buildSonioxTranscriptionRequest`. These follow the `transcribe({ model, formData, credentials, kind, signal })` contract, and the result matches the `handleSttCore` shape.
- `index.js`: exports, plus the default instances `sonioxTtsAdapter` and `sonioxSttAdapter`.
- `registration.json`: exports, IDs, alias, models, endpoints, bounds and integration points.

Production code imports none of these files.

## Supported subset

Speech (`POST https://tts-rt.soniox.com/tts`):

- Supports both source models, as `model` or as `model/voice`.
- The voice defaults to `Adrian`. OpenAI stock voices map to `Adrian`, as in the source. A voice must be a plain name of at most 64 characters.
- `language` defaults to `en` and must be a language code.
- Containers are `mp3` (default), `wav` and `opus`, the three the source labels. A client may also name `json`, the gateway's base64 wrapper.
- The answer must be audio whose leading bytes match the container: ID3 or an MPEG layer III frame, `RIFF…WAVE`, or `OggS`. The default limit is 50 MiB.
- On success, the adapter returns `{ base64, format, accounting }`. The cost is unknown. `withTtsUsage` in the core adds input characters.

Transcription (`api.soniox.com`, upload, create, poll, transcript):

- Supports both source models.
- `response_format` accepts `json` (default), `verbose_json` and `text`. `text` is returned as `text/plain`; the source returned JSON for every format.
- Diarization uses the four source spellings and implies `verbose_json`.
- `timestamp_granularities` accepts `segment` and `word`, and needs a verbose body. `word` adds `words`.
- `language` (a language code) becomes `language_hints`. `context` is a string of at most 10,000 characters.
- The file must be non-empty and at most 100 MiB.
- Native units record audio seconds from the last token's `end_ms`. Usage is not reported. The cost is unknown.

## Deviations and restrictions

- **Fixed origins.** The key goes only to `https://tts-rt.soniox.com` and `https://api.soniox.com`. Connection base URLs are ignored. Requests go through `proxyAwareFetch` with the connection's own proxy options.
- **Redirects.** Every request uses `redirect: "manual"`. A 3xx or redirected answer is never followed.
- **Deadlines.** Speech has one 120 s deadline for the send and the body. Transcription has one 240 s total deadline, and each HTTP call has at most 60 s. The poll interval is the source's 2 s. The adapter stops waiting even when the transport ignores its signal. The caller's signal aborts sends, body reads and the poll wait.
- **No replay.** The upload, the job create and the speech request are sent once. Status checks repeat only after 408/425/429/5xx or a transport error, and only inside the deadline. The job is never re-created.
- **Accepted-job accounting** (`acceptedJob`, cost unknown, `costSource: "accepted-job"`, job id in `meta` when known):
  - `submit-unknown`: a create or speech request got a 5xx other than 503, a redirect, a reset, a timeout or a caller abort after send.
  - `accepted`: a job id is unusable, the caller aborted while the job ran, or the transcript or audio was lost, malformed, oversized, HTML, an error envelope, or refused.
  - `poll-failed`: a status check was refused, redirected or unreadable, or reported an unknown state.
  - `poll-timeout`: the deadline passed while the job ran.
  - A provably unsent request (DNS or connection refused, or the caller left before sending) carries none.
- **Upload is not billable.** A failed or uncertain upload carries no `acceptedJob`, and no job is created. An unusable file id is refused.
- **Failed jobs.** `status: "error"` returns 502 "Soniox transcription job failed", without `acceptedJob`. Soniox's `error_message` is not quoted. The source returned it with status 500.
- **Refusal mapping.** Soniox's text is never quoted:
  - 401 and 403 mean a refused key.
  - 402 sets `quotaExhausted` on this connection only.
  - 429 and 503 keep a usable `Retry-After`.
  - Other 4xx keep their status. Other 5xx become 502.
  - Credentials are redacted through `createErrorResult`.
- **Refusals before submit** (`local: true`, nothing sent; for STT, nothing uploaded):
  - Unknown models. Translations: `sttConfig.translationModels: []` keeps `supportsSttTranslation` false.
  - Streaming, a `url` input, and a missing, empty or oversized file.
  - `pcm`, `flac`, `ogg` and other containers. The source would forward them unchecked.
  - `speed` other than 1 and non-empty `instructions`, which the source silently dropped.
  - STT `prompt` and a non-zero `temperature`, which the source silently dropped.
  - `srt`, `vtt` and unknown response formats.
  - Granularities without a verbose body. Unknown granularities. `text` output with diarization.
  - Malformed voice, language or context. Conflicting voices or containers. A speech request body over 256 KiB.
  - A missing key, or a key containing CR/LF.
- **Left on the account.** Uploaded files and transcription jobs are not deleted, as in the source.
- **Auth modes.** API key only (`apiKey`, or `accessToken` as a fallback field). Soniox has no OAuth or cookie mode in the source, and no existing DurinDoor connection mode is changed.
- **Not covered.** The Soniox real-time WebSocket APIs. Streaming speech. Dynamic model discovery, which the source does not have.

## Registration (serial step, not done here)

See `registration.json` `integrationPoints`:

- Add `open-sse/providers/registry/soniox.js` from `SONIOX_PROVIDER_DEFINITION` plus model rows, after confirming `sx` is still free.
- Add `soniox: sonioxTtsAdapter` to `TTS_ADAPTERS`, and add `soniox` to `NAMED_FORMAT_PROVIDERS` in `src/sse/handlers/tts.js`.
- Add a `provider === "soniox"` branch to `handleSttCore`. The existing STT accepted-job recording then applies.
- Add the display entry and key validation, and list the provider in `docs/providers/catalog.mdx`.

The test's staging block (`Soniox tts/stt staging state`) is the only block that asserts the unregistered state. Registration promotes it to positive identity assertions.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-soniox-tts-stt.test.js --maxWorkers=2` reports 67 passed. Every request goes to an injected transport. No live Soniox call was made, so passing says nothing about the live service.

`npx eslint open-sse/services/providerParity/native-soniox-tts-stt tests/unit/native-soniox-tts-stt.test.js` reports no problems.
