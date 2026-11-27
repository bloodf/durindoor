# Kie native TTS and STT (staged), 2026-11-27

Issue: #2034. The inventory rows for `kie` TTS (`TTS_ADAPTERS`/`ttsConfig`) and STT (`sttConfig`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts`: two `kie` entries, one per kind. Both use id `kie`, baseUrl `https://api.kie.ai`, authType `apikey`, authHeader `bearer`, and format `kie-audio`.
  - STT models: `elevenlabs/speech-to-text` and `elevenlabs/audio-isolation`.
  - TTS models: `elevenlabs/text-to-speech-multilingual-v2`, `elevenlabs/text-to-speech-turbo-2-5`, `elevenlabs/text-to-dialogue-v3` and `elevenlabs/sound-effect-v2`.
- `open-sse/handlers/audioSpeech.ts`:
  - `handleKieAudioSpeech` submits `{ model, callBackUrl, input: { text, voice, stability, similarity_boost, style, speed, timestamps, previous_text, next_text, language_code } }`. The defaults are 0.5, 0.75, 0, 1, false, "", "" and "".
  - `normalizeKieElevenLabsVoice` maps OpenAI voice names to ElevenLabs voices: alloy to Rachel, echo to Adam, fable to Brian, onyx to Antoni, nova to Bella and shimmer to Dorothy. The default voice is Rachel.
  - `pollKieAudioResult` polls for up to 60 s at a 2 s interval.
  - `findKieAudioUrl` locates the result URL. It skips image URLs.
- `open-sse/handlers/audioTranscription.ts`:
  - `handleKieAudioTranscription` submits `{ model, input: { file_name, file_base64 } }` without a callback.
  - `pollKieTranscriptionResult` polls for up to 120 s at a 2 s interval.
  - `normalizeKieTranscriptionText` reads `data.response.text`, then `data.resultText`, then `data.text`, then `text`.
- `open-sse/executors/kie.ts`:
  - Submit: `POST /api/v1/jobs/createTask` with Bearer and a JSON body.
  - Poll: `GET /api/v1/jobs/recordInfo?taskId=` with Bearer only.
- `open-sse/utils/kieTask.ts`: `normalizeKieTaskState`, `parseKieResultJson`, `getKieTaskId`, and the callback URL fallback.
- `open-sse/utils/audioMultipart.ts`: `getUploadedFileName` renames `.opus` to `.ogg` and falls back to `audio.wav`.
- Source tests: `kie-audio-transcription-result.test.ts` and both `*-kie-error-sanitization-15159.test.ts` files.

## Fresh-main check

`kie` is present for chat only. `open-sse/providers/registry/kie.js` has `serviceKinds: ["llm"]`, an API-key connection, and the chat transport `https://api.kie.ai/v1/chat/completions`. It has no `ttsConfig` and no `sttConfig`.

No equivalent exists in fresh main:

- `TTS_ADAPTERS` (`open-sse/handlers/ttsProviders/index.js`) has no `kie` entry.
- `FORMAT_HANDLERS` (`genericFormats.js`) has no `kie-audio` format.
- The `handleSttCore` format switch (`open-sse/handlers/sttCore.js`) has no `kie-audio` branch.
- The local `elevenlabs` adapter calls ElevenLabs directly at `api.elevenlabs.io` with `xi-api-key`. Kie instead uses its own createTask/recordInfo job API with a Bearer key. The wire protocols differ, so that adapter is not an equivalent.

No alias resolves to Kie audio. The whole delta is the staged module.

## What is staged

`open-sse/services/providerParity/native-kie-tts-stt/` contains the following files. Nothing in production imports them.

- `config.js`: the origin, endpoints, models, excluded models, voice aliases and bounds.
- `http.js`: a bounded, abortable fetch, redirect refusal, bounded JSON reads, refusal mapping (HTTP status or a 200 envelope's `code`), and accepted-job accounting.
- `task.js`: `runKieTask`, the shared createTask call plus the recordInfo poll.
- `tts.js`: the `TTS_ADAPTERS` `synthesize` contract, the request builder and the credential-free audio download.
- `stt.js`: `transcribe({ model, formData, credentials, kind, signal, log })` for a `kie-audio` branch in `handleSttCore`.
- `index.js`: the exports and the default instances `kieTtsAdapter` and `kieSttAdapter`.
- `registration.json`: exports, the canonical ID `kie` (alias `kie`), models, service kinds (`tts` and `stt` added to `llm`), endpoints and auth, bounds, and integration points.

## Supported subset

- Auth uses the selected connection's `apiKey` (or `accessToken`) as `Authorization: Bearer`. The key goes only to `https://api.kie.ai`. A connection base URL is ignored. The existing API-key connection mode is unchanged.
- TTS supports `elevenlabs/text-to-speech-multilingual-v2` and `elevenlabs/text-to-speech-turbo-2-5`.
  - The voice comes from `voice` or a `model/voice` suffix. Naming two different voices is refused. The source aliases apply.
  - The tuning fields are forwarded after a type check.
  - The response is the downloaded audio file, with its container detected from magic bytes. `response_format` may be omitted, `json` (the base64 wrapper), or `mp3`. An `mp3` request fails, with `acceptedJob`, when Kie returns another container.
- STT supports `elevenlabs/speech-to-text`.
  - The file is sent as base64. It must be non-empty and at most 25 MiB.
  - `response_format` may be `json` (the default) or `text`.
  - `language`, `prompt` and `temperature` are accepted and not forwarded, as in the source.
- Model discovery is static only. The source has no fetcher for Kie audio models.

## Restrictions and fork deviations

- Refused before submit:
  - `elevenlabs/text-to-dialogue-v3` and `elevenlabs/sound-effect-v2`. The source sends them a single-speaker speech body, which an OpenAI speech request cannot turn into a dialogue or sound-effect task.
  - `elevenlabs/audio-isolation`. It returns audio, not a transcript; the source would answer an empty text.
  - Translations, streaming (`stream`, `stream_format: sse`), `timestamps: true`, `timestamp_granularities`, and STT formats `srt`/`vtt`/`verbose_json`.
  - TTS containers other than mp3 and json.
  - A caller-supplied `callBackUrl`/`callback_url`/`callbackUrl`.
  - A non-numeric tuning field, and a request body over 256 KiB.
- The callback URL: the source sends a configured callback or a placeholder. This module polls and always sends the non-resolvable `https://durindoor.invalid/api/kie/callback`. A caller URL would receive the result, so it is never forwarded.
- Task state: the source falls back to `record.msg` when `data` has no state. Kie's `msg: "success"` describes the API call, not the task, so this fallback is dropped. A record without a state stays pending until the deadline.
- A 200 envelope whose `code` is not 200 is treated as a refusal. 402 is mapped to a quota error with `quotaExhausted`. 401/403 refuse the key. 429 carries a bounded Retry-After. A 5xx is an unknown submit outcome with `acceptedJob`.
- Bounds: each submit and each status request time out after 30 s. The whole task has a deadline of 60 s for TTS and 120 s for STT. 429/503 status answers are retried at most 5 times with backoff. The caller's abort stops submit, polling and download.
- Redirects are refused (`redirect: "manual"`). An answer from another origin is an unknown outcome.
- Kie's `msg`, `failMsg` and other body text are never quoted. Error messages are fixed and use the status only. Keys are redacted.
- No replay: a timed-out, interrupted, 5xx or redirected submit carries `acceptedJob` (`submit-unknown`) and is not resent. Each of the following also carries `acceptedJob` (`accepted`): an accepted task whose outcome is lost (status error, wrong task echo, unreadable record, deadline, abort, missing or unsafe result URL, failed download, missing text). A task Kie reports as failed is an ordinary failure.
- Result URL: the source scans every value recursively. Here only the source's named keys are read (`audio_url`, `audioUrl`, `stream_audio_url`, `streamAudioUrl`, `resultUrl`, `url`, `downloadUrl`, `resultUrls`), on the source's candidate objects. A recursive scan could pick up an echoed callback.
  - The URL must be https on a public host, without userinfo.
  - The download sends no credential, uses the public-only DNS guard, follows no redirects, and has a 60 s / 50 MiB bound. Non-audio content is refused.
  - The download does not use the connection's proxy. It connects directly under the public-only guard.
- Usage: TTS counts input characters (in `ttsCore`). STT reports no duration or tokens. Cost is `unknown` for both, and `acceptedJob` uses `costSource: "accepted-job"`.

## Registration (serial step, not done here)

See `registration.json` `integrationPoints`:

1. Add `kie: kieTtsAdapter` to `TTS_ADAPTERS`.
2. Pass `requestedResponseFormat` for `kie` in `src/sse/handlers/tts.js`.
3. Add a `kie-audio` case in `handleSttCore` that calls `kieSttAdapter.transcribe`.
4. Give `src/sse/handlers/stt.js` an accepted-job record-once path with no account fallback. The STT route has none today, so an STT `acceptedJob` is not recorded until this lands.
5. Add `tts`/`stt` to `kie.js` (models and `sttConfig`, format `kie-audio`), then update the catalog doc.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-kie-tts-stt.test.js --maxWorkers=2`: 68 tests passed. The tests use closed fetch mocks only. Every request is answered by the test, and an unexpected request fails it. Keys are synthetic. Download hosts are public IP literals, so no DNS lookup runs.

The tests cover:

- Exact URLs, headers and bodies, and the voice and default mapping.
- Pre-submit refusals.
- Synchronous and polled results, and every source STT result envelope.
- Two credentials concurrently and in sequence.
- 401/402/403/422/429/5xx, both as HTTP status and as a 200 envelope `code`.
- Unsent and uncertain transport failures, submit and task deadlines, abort before and during polling, and bounded transient retries.
- Redirect refusal, wrong task echo, unreadable bodies, private, http and image result URLs, and non-audio, empty, oversized or redirected downloads.
- Container mismatch, and leak checks on every error.

ESLint and oxlint (anti-slop config) report nothing for the staged files and the test. Passing tests say nothing about the live service.
