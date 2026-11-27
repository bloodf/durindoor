# Gladia native STT (staged), 2026-11-27

Issue: #2034. The inventory row for `gladia` STT (`sttConfig`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts` `AUDIO_TRANSCRIPTION_PROVIDERS.gladia`: id `gladia`, baseUrl `https://api.gladia.io/v2/pre-recorded`, authType `apikey`, authHeader `x-gladia-key`, `async: true`, format `gladia`. Models are `solaria-1` (Solaria 1) and `solaria-mini` (Solaria Mini).
- `open-sse/config/registryUtils.ts` `buildAuthHeaders`: authHeader `x-gladia-key` sends `{ "x-gladia-key": <key> }`. The raw key goes in a custom header with no scheme.
- `open-sse/handlers/audioTranscription.ts` `handleGladiaTranscription` and `pollGladiaResultOnce`:
  1. Multipart `POST https://api.gladia.io/v2/upload` with the single part `audio`. A source comment says any other part name gets a 400. The answer is `{ audio_url }`.
  2. JSON `POST https://api.gladia.io/v2/pre-recorded` with `{ audio_url, model }`. The answer is `{ result_url }`. A missing `result_url` gives a 502. A `result_url` outside the API origin is refused.
  3. Wait 2 s, then `GET result_url` through `safeOutboundFetch` (public addresses only, DNS pinned, 15 s per call, redirects refused). This repeats for up to 120 s. A non-2xx poll or a transport error is skipped. `status: "done"` ends the poll. `status: "error"` returns a 500 with Gladia's `error_code` or `error`.
  4. The answer is `{ text }` from `result.transcription.full_transcript`, or `""` when that is missing.
- `open-sse/utils/audioMultipart.ts`: the upload file name rule (`.opus` becomes `.ogg`, `audio.wav` when unnamed, `"` and CR/LF become `_`).
- `src/shared/constants/providers/audio.ts`: display entry `Gladia`, alias `gladia`, icon `record_voice_over`, color `#6425FE`, text icon `GL`, website `https://gladia.io`. That entry lists `serviceKinds: []`.

The source entry can be reached. `getTranscriptionProvider` and `parseTranscriptionModel` read `AUDIO_TRANSCRIPTION_PROVIDERS`, and `handleAudioTranscription` sends format `gladia` to `handleGladiaTranscription`. The empty `serviceKinds` in the display entry affects only the dashboard listing. No translation or speech entry exists for Gladia.

The source has no Gladia model fetcher and no Gladia validation probe. Models are static. Dynamic discovery has nothing to port.

## Fresh-main check

Checked `HEAD` and `origin/main` (`a6cb6dea80`). `git grep -i gladia` finds only inventory rows in `internal/docs/port-reports/`.

- No `open-sse/providers/registry/gladia.js` exists. No registry entry uses the id or alias `gladia`.
- `handleSttCore` has no `gladia` format. No local auth builder emits `x-gladia-key`. Its other async job formats use different endpoints, auth headers and envelopes, so none is equivalent.

With no provider and no equivalent, the staged module is the whole delta.

## Staged module

`open-sse/services/providerParity/native-gladia-stt/`:

- `config.js`: ID, alias, auth header, fixed origin, endpoints, models, bounds, and `GLADIA_PROVIDER_DEFINITION` (the staged registry entry, API key only, `serviceKinds: ["stt"]`).
- `http.js`: one bounded send, redirect refusal, refusal mapping, bounded JSON reading and accepted-job accounting. It follows the same contract as the staged Soniox module.
- `stt.js`: `createGladiaSttAdapter`, `buildGladiaTranscriptionRequest`, plus the helpers `gladiaAudioUrl`, `gladiaResultJob` and `gladiaTranscriptText`. The adapter follows the `transcribe({ model, formData, credentials, kind, signal })` contract, and the result matches the `handleSttCore` shape.
- `index.js`: exports and the default instance `gladiaSttAdapter`.
- `registration.json`: exports, IDs, models, endpoints, auth, bounds and integration points.

Production code imports none of these files.

## Supported subset

- Supports both source models. Any other model is refused.
- The input must be an uploaded `file`: non-empty and at most 100 MiB. It is sent as the `audio` part, with the source file name rule.
- `response_format` accepts `json` (default, `{ text }`) and `text`. `text` is returned as `text/plain`; the source returned JSON for every format.
- A finished job with an empty `full_transcript` returns `""`, as in the source.
- The key comes from the selected connection's `apiKey` (or `accessToken`) and goes only in `x-gladia-key`. A key containing CR/LF is refused.
- Accounting: cost unknown, `nativeUnits` empty, usage not reported. `meta` carries the model, response format and job id. The source reads no duration, so none is claimed.

## Deviations and restrictions

- **Refused before upload.** Translations, streaming, a `url` input, `verbose_json`/`srt`/`vtt` or other formats, and a non-zero `temperature` are refused. Non-empty fields the source drops without telling the caller are also refused: `language`, `prompt`, `timestamp_granularities`, and the diarization spellings. Each refusal is a local 400.
- **Fixed origin.** The key goes only to `https://api.gladia.io`. Connection base URLs are ignored. Requests go through `proxyAwareFetch` with the connection's own proxy options.
- **result_url.** It must be exactly `https://api.gladia.io/v2/pre-recorded/<id>`: no credentials, query or fragment, and an id of `[A-Za-z0-9_-]{1,128}`. When the answer has an `id`, it must match. The poll URL is rebuilt from the fixed origin and that id. No address from an answer is fetched. This is stricter than the source's same-origin check plus public-address guard. Any other `result_url` gives a 502 with an accepted job, because the job was already submitted.
- **audio_url.** It must be a plain `https` URL (no credentials, no whitespace, at most 2,048 characters). It is only sent back to Gladia and never fetched.
- **Redirects.** Every request uses `redirect: "manual"`. A 3xx is never followed.
- **Deadlines.** One 240 s total deadline. The upload and submit have at most 60 s each. Each poll has the source's 15 s, every 2 s, inside the source's 120 s window after the submit. The adapter stops waiting even when the transport ignores its signal. The caller's signal aborts sends, body reads and the poll wait.
- **No replay.** The upload and the submit are sent once. Polls repeat only after 408/425/429/5xx or a transport error, and only inside the window. Any other poll refusal stops the poll. The job is never resubmitted.
- **Accepted-job accounting** (`acceptedJob`, cost unknown, `costSource: "accepted-job"`, job id in `meta` when known):
  - `submit-unknown`: the submit got a 5xx other than 503, a redirect, a reset, a timeout or a caller abort after send.
  - `accepted`: the submit answer had no usable `result_url`, the caller aborted while the job ran, or a finished result had no readable transcript.
  - `poll-failed`: a poll was refused, redirected or unreadable, or reported an unknown state.
  - `poll-timeout`: the window or the total deadline ran out.
  - The upload bills nothing, so an uncertain upload carries no accepted job. A provably unsent submit (refused connection, DNS failure, caller gone before send) carries none either.
- **Refusals** keep only the HTTP status. 401/403 is a bad key. 402 is `quotaExhausted` on the selected connection only. 429/503 carry a Retry-After reset when one is given. Gladia's text is never quoted. A failed job (`status: "error"`) is a 502 that adds only a numeric `error_code` in 400–599, with no accepted job.
- **Bounded reads.** Upload and submit answers are read up to 64 KiB, and poll answers up to 16 MiB. They must be JSON objects. HTML, malformed JSON and oversized answers are treated as unreadable.
- Uploads and jobs are left on the Gladia account, as in the source.

## Registration (serial step)

See `registration.json` `integrationPoints`:

1. Add `open-sse/providers/registry/gladia.js` from `GLADIA_PROVIDER_DEFINITION` and `GLADIA_STT_MODELS`.
2. In `handleSttCore`, add a `gladia` branch ahead of the format switch that calls `gladiaSttAdapter.transcribe(...)`. The existing STT accepted-job recording in `src/sse/handlers/stt.js` then records `result.acceptedJob` on the selected connection.
3. Add the display entry. No validation probe exists in the source.
4. List Gladia `stt` in `docs/providers/catalog.mdx`.

At that point, promote the isolated staging block in `tests/unit/native-gladia-stt.test.js` to positive identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-gladia-stt.test.js --maxWorkers=2
```

40 tests pass against closed mocks: auth/header/body wire shapes, both models, two credentials, `result_url` and `audio_url` safety, refusal and quota mapping, uncertain submit with no replay, the poll window and per-call deadlines, caller aborts, and malformed or unsafe results. `eslint` and `pnpm run lint:anti-slop` are clean for the new files. These tests make no live provider calls.
