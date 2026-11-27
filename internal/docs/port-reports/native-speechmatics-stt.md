# Speechmatics native STT (staged), 2026-11-27

Issue: #2034. The inventory row for `speechmatics` STT (`apikey / bearer / speechmatics`, endpoint `https://asr.api.speechmatics.com/v2/jobs`) was MISSING (`sttConfig`). Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts` `speechmatics` transcription entry: baseUrl `https://asr.api.speechmatics.com/v2/jobs`, authType `apikey`, authHeader `bearer`, `async: true`, format `speechmatics`. The only model is `enhanced`. A source comment says real-time (WebSocket) mode is out of scope; the entry is batch only.
- `open-sse/handlers/audioTranscription.ts`. `handleAudioTranscription` dispatches format `speechmatics` to `handleSpeechmaticsTranscription`. The entry is enabled, and the source test `tests/unit/speechmatics-transcription-provider.test.ts` covers the path.
  1. Multipart `POST /v2/jobs` with `Authorization: Bearer <key>`. Part `config` comes first: `{"type":"transcription","transcription_config":{"language":<language>,"operating_point":<model>}}`. `language` is the trimmed `language` field, or `auto`. `speechmaticsOperatingPoint` passes the model id through unchanged. Part `data_file` follows with the audio. The answer is `{ id }`. A missing id is a 502.
  2. `pollSpeechmaticsJob`: `GET /v2/jobs/{id}` every 2 s for up to 120 s, until `job.status` is `done` or `rejected`. A non-2xx status check is skipped. `rejected` returns 500 with `job.errors[0].message`.
  3. `fetchSpeechmaticsTranscript`: `GET /v2/jobs/{id}/transcript?format=txt` with `Accept: text/plain`. The client gets `{ text }`.
- `open-sse/utils/audioMultipart.ts`: `buildMultipartBody` and the upload file name rule (`.opus` becomes `.ogg`, `audio.wav` when unnamed, `"` and CR/LF become `_`).
- `src/shared/constants/providers/audio.ts`: display entry `Speechmatics`, alias `sm`, icon `record_voice_over`, color `#0A2540`, text icon `SM`, website `https://www.speechmatics.com`, free tier note.

The source has no Speechmatics validation probe and no model fetcher. Models are static, so there is no dynamic discovery to port.

## Fresh-main check

Checked `HEAD` and `origin/main` (`a6cb6dea80`). `git grep -i speechmatics` outside `internal/docs` finds nothing.

- No registry entry uses the id `speechmatics` or the alias `sm`.
- `handleSttCore` in `open-sse/handlers/sttCore.js` has no `speechmatics` format. Its async job formats (`assemblyai` and similar) use other endpoints and envelopes. None submits one multipart `config` + `data_file` body, so none is equivalent.

With no provider and no equivalent, the staged module is the whole delta.

## Staged module

`open-sse/services/providerParity/native-speechmatics-stt/`:

- `config.js`: ID, alias, fixed origin, model, bounds, and `SPEECHMATICS_PROVIDER_DEFINITION` (the staged registry entry, API key only).
- `http.js`: one bounded send, redirect refusal, refusal mapping, bounded JSON reading and accepted-job accounting. It follows the staged Soniox transport.
- `stt.js`: `createSpeechmaticsSttAdapter` and `buildSpeechmaticsTranscriptionRequest`. These follow the `transcribe({ model, formData, credentials, kind, signal })` contract, and the result matches the `handleSttCore` shape.
- `index.js`: exports, plus the default instance `speechmaticsSttAdapter`.
- `registration.json`: exports, IDs, alias, models, endpoints, bounds and integration points.

Production code imports none of these files.

## Supported subset

- Model `enhanced`, sent as `operating_point`. The source comment names `standard` and `melia-1`, but its catalog lists only `enhanced`, so the others are refused.
- `language` is a language code or `auto`. It defaults to `auto`.
- `response_format` accepts `json` (default, `{ text }`) and `text`. `text` is returned as `text/plain`; the source returned `{ text }` for every format.
- The file must be non-empty and at most 100 MiB.
- Native units record `audioSeconds` from the done job's `job.duration` when it is a positive number. The source did not read it. Usage is not reported. The cost is unknown.

## Deviations and restrictions

- **Fixed origin.** The key goes only to `https://asr.api.speechmatics.com`. Connection base URLs are ignored. Requests go through `proxyAwareFetch` with the connection's own proxy options.
- **Redirects.** Every request uses `redirect: "manual"`. A 3xx or redirected answer is never followed.
- **Deadlines.** One 240 s total deadline, and each HTTP call has at most 60 s. The poll interval is the source's 2 s. The adapter stops waiting even when the transport ignores its signal. The caller's signal aborts sends, body reads and the poll wait.
- **No replay.** The job submission is sent once. Status checks repeat only after 408/425/429/5xx or a transport error, and only inside the deadline. The job is never resubmitted.
- **Accepted-job accounting** (`acceptedJob`, cost unknown, `costSource: "accepted-job"`, job id in `meta` when known):
  - `submit-unknown`: the submission got a 5xx other than 503, a redirect, a reset, a timeout or a caller abort after send.
  - `accepted`: the job id is missing or unsafe, the caller aborted while the job ran, or the transcript was lost, non-`text/plain`, oversized, not UTF-8, contained NUL, redirected or refused.
  - `poll-failed`: a status check was refused, redirected or unreadable, or reported an unknown state.
  - `poll-timeout`: the deadline passed while the job ran.
  - A provably unsent submission (DNS or connection refused, or the caller left before sending) carries none.
- **Failed jobs.** `rejected`, `deleted` and `expired` return 502 without `acceptedJob`. Speechmatics' `job.errors` text is not quoted. The source returned it with status 500 and treated only `rejected` as terminal.
- **Refusal mapping.** Speechmatics' text is never quoted:
  - 401 and 403 mean a refused key.
  - 402 sets `quotaExhausted` on this connection only.
  - 429 and 503 keep a usable `Retry-After`.
  - Other 4xx keep their status. Other 5xx become 502.
  - Credentials are redacted through `createErrorResult`.
- **Refusals before submit** (`local: true`, nothing sent):
  - Unknown models and operating points. Translations: `sttConfig.translationModels: []` keeps `supportsSttTranslation` false.
  - Streaming, a `url` input, and a missing, empty or oversized file.
  - `verbose_json`, `srt`, `vtt` and unknown response formats.
  - `prompt`, a non-zero `temperature`, `timestamp_granularities` and diarization flags. The source silently dropped these.
  - A malformed language.
  - A missing key, or a key containing CR/LF.
- **Left on the account.** Jobs are not deleted, as in the source.
- **Auth modes.** API key only (`apiKey`, or `accessToken` as a fallback field). Speechmatics has no OAuth or cookie mode in the source, and no existing DurinDoor connection mode is changed.
- **Not covered.** The Speechmatics real-time WebSocket API (out of scope in the source too), word timings and JSON transcripts, key validation and model discovery (neither exists in the source).

## Registration (serial step, not done here)

See `registration.json` `integrationPoints`:

- Add `open-sse/providers/registry/speechmatics.js` from `SPEECHMATICS_PROVIDER_DEFINITION` plus the model row, after confirming `sm` is still free.
- Add a `provider === "speechmatics"` branch to `handleSttCore`. The existing STT accepted-job recording in `src/sse/handlers/stt.js` then applies.
- Add the display entry and list the provider in `docs/providers/catalog.mdx`.

The test's staging block (`Speechmatics stt staging state`) is the only block that asserts the unregistered state. Registration promotes it to positive identity assertions.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-speechmatics-stt.test.js --maxWorkers=2` reports 43 passed. Every request goes to an injected transport. No live Speechmatics call was made, so passing says nothing about the live service.

`npx eslint open-sse/services/providerParity/native-speechmatics-stt tests/unit/native-speechmatics-stt.test.js` reports no problems.
