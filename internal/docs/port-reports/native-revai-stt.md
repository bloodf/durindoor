# Rev AI native STT (staged), 2026-11-27

Issue: #2034. The inventory row for `rev-ai` STT (`sttConfig`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts` has one `rev-ai` entry (registry key `rev-ai`, equal to its id and format): baseUrl `https://api.rev.ai/speechtotext/v1`, authType `apikey`, authHeader `bearer`, `async: true`, format `rev-ai`. Models are `machine` (Reverb ASR), `low_cost` (Low-Cost ASR) and `fusion` (Fusion ASR).
- `open-sse/handlers/audioTranscription.ts` `handleRevAiTranscription`:
  1. Multipart `POST https://api.rev.ai/speechtotext/v1/jobs` with `Authorization: Bearer <key>`. Parts: `options` = `JSON.stringify({ transcriber: <model> })`, then the file as `media`. The answer is `{ id, ... }`.
  2. `GET /jobs/{id}` every 2 s for up to 120 s. A non-2xx status check is skipped. `transcribed` continues; `failed` returns 500 with `failure_detail`.
  3. `GET /jobs/{id}/transcript` with `Accept: text/plain`. The answer `{ text }` is returned for every response format.
  - A refused submit returns the upstream status and body text (`upstreamErrorResponse`).
- `open-sse/utils/audioMultipart.ts` `buildMultipartBody`: text fields before the file. The upload file name rule: `.opus` becomes `.ogg`, `audio.wav` when unnamed, `"` and CR/LF become `_`.
- `src/shared/constants/providers/audio.ts`: display entry `Rev AI`, alias `revai`, icon `record_voice_over`, color `#FF5C35`, text icon `RV`, website `https://www.rev.ai`.
- `src/lib/providers/validation/audioMiscProviders.ts` `validateRevAiProvider`: `GET https://api.rev.ai/speechtotext/v1/jobs?limit=1` with the Bearer key. 401/403 means an invalid key.

The source has no Rev AI model fetcher. Models are static. The only Rev AI list call is the validation probe, which lists jobs, not models.

## Fresh-main check

Checked `HEAD` and `origin/main` (`a6cb6dea80`). `git grep -i -E 'rev-ai|revai|rev\.ai'` over `open-sse` and `src` finds nothing. Outside them, only inventory rows in `internal/docs/port-reports/` mention it.

- No registry entry uses the id `rev-ai` or the alias `revai`.
- `handleSttCore` has no `rev-ai` format. Its other async job formats (such as `assemblyai`) use other endpoints, auth schemes and envelopes. None submits an `options`/`media` multipart job or reads a `text/plain` transcript, so none is equivalent.

With no provider and no equivalent, the staged module is the whole delta.

## Staged module

`open-sse/services/providerParity/native-revai-stt/`:

- `config.js`: IDs, alias, fixed origin, endpoints, models, bounds, and `REVAI_PROVIDER_DEFINITION` (the staged registry entry, API key only).
- `http.js`: one bounded send, redirect refusal, refusal mapping, bounded JSON reading and accepted-job accounting. It follows the staged Soniox transport.
- `stt.js`: `createRevaiSttAdapter` and `buildRevaiTranscriptionRequest`. These follow the `transcribe({ model, formData, credentials, kind, signal })` contract, and the result matches the `handleSttCore` shape.
- `index.js`: exports, plus the default instance `revaiSttAdapter`.
- `registration.json`: exports, IDs, alias, models, endpoints, bounds and integration points.

Production code imports none of these files.

## Supported subset

Transcription (`api.rev.ai`, submit, poll, transcript):

- Supports the three source models. The model id is sent as `options.transcriber`, as in the source.
- `response_format` accepts `json` (default, `{ text }`) and `text`. `text` is returned as `text/plain`; the source returned JSON for every format. The transcript is Rev AI's plain-text transcript, passed through unchanged, as in the source.
- `language` may be absent or English (`en`, `en-US` and similar). The source sends no language, and Rev AI then transcribes English.
- `temperature` may be absent or 0.
- The file must be non-empty and at most 100 MiB.
- Native units record `duration_seconds` from the `transcribed` status answer when it is a positive number. The source ignored it. Usage is not reported. The cost is unknown.

## Deviations and restrictions

- **Fixed origin.** The key goes only to `https://api.rev.ai`. Connection base URLs are ignored. Requests go through `proxyAwareFetch` with the connection's own proxy options.
- **Redirects.** Every request uses `redirect: "manual"`. A 3xx or redirected answer is never followed.
- **Deadlines.** One 180 s total deadline covers submit, polling and the transcript read. Each HTTP call has at most 60 s. The poll interval is the source's 2 s. The adapter stops waiting even when the transport ignores its signal. The caller's signal aborts sends, body reads and the poll wait.
- **No replay.** The job submit is sent once. Status checks repeat only after 408/425/429/5xx or a transport error, and only inside the deadline. The job is never re-submitted.
- **Accepted-job accounting** (`acceptedJob`, cost unknown, `costSource: "accepted-job"`, job id in `meta` when known):
  - `submit-unknown`: the submit got a 5xx other than 503, a redirect, a reset, a timeout or a caller abort after send.
  - `accepted`: the job id is unusable, the caller aborted while the job ran or during the transcript read, or the transcript was lost, refused, redirected, HTML, JSON, oversized or binary.
  - `poll-failed`: a status check was refused, redirected or unreadable, answered for another job id, or reported an unknown state.
  - `poll-timeout`: the deadline passed while the job ran.
  - A provably unsent request (DNS or connection refused, or the caller left before sending) carries none.
- **Failed jobs.** `status: "failed"` returns 502 "Rev AI transcription job failed", without `acceptedJob`. Rev AI's `failure_detail` is not quoted. The source returned it with status 500.
- **Refusal mapping.** Rev AI's text is never quoted (the source returned it):
  - 401 and 403 mean a refused key.
  - 402 sets `quotaExhausted` on this connection only.
  - 429 and 503 keep a usable `Retry-After`.
  - Other 4xx keep their status. Other 5xx become 502.
  - Credentials are redacted through `createErrorResult`.
- **Refusals before submit** (`local: true`, nothing sent):
  - Unknown models. Translations: `sttConfig.translationModels: []` keeps `supportsSttTranslation` false.
  - Streaming, a `url` input, and a missing, empty or oversized file.
  - `verbose_json`, `srt`, `vtt` and unknown response formats. The source never produced them.
  - `prompt`, a non-zero `temperature`, a non-English or malformed `language`, timestamp granularities and diarization flags. The source silently dropped them.
  - A missing key, or a key containing CR/LF.
- **Left on the account.** Submitted jobs and media are not deleted, as in the source.
- **Auth modes.** API key only (`apiKey`, or `accessToken` as a fallback field). Rev AI has no OAuth or cookie mode in the source, and no existing DurinDoor connection mode is changed.
- **Not covered.** Rev AI streaming (WebSocket) and `source_config` URL jobs. Rev AI JSON transcripts, other languages, diarization and custom vocabularies, which the source does not send. Dynamic model discovery, which the source does not have.

## Registration (serial step, not done here)

See `registration.json` `integrationPoints`:

- Add `open-sse/providers/registry/rev-ai.js` from `REVAI_PROVIDER_DEFINITION` plus model rows, after confirming `revai` is still free.
- Add a `provider === "rev-ai"` branch to `handleSttCore`. The existing STT accepted-job recording then applies.
- Add the display entry and key validation against `validateUrl`, and list the provider in `docs/providers/catalog.mdx`.

The test's staging block (`Rev AI stt staging state`) is the only block that asserts the unregistered state. Registration promotes it to positive identity assertions.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-revai-stt.test.js --maxWorkers=2` reports 40 passed. Every request goes to an injected transport. No live Rev AI call was made, so passing says nothing about the live service.

`npx eslint open-sse/services/providerParity/native-revai-stt tests/unit/native-revai-stt.test.js` reports no problems.
