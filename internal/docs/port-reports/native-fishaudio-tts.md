# Fish Audio native TTS (staged), 2026-11-27

Issue: #2034. The inventory rows for `fishaudio` TTS (`TTS_ADAPTERS`/`ttsConfig`) and STT (`sttConfig`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts`, `AUDIO_SPEECH_PROVIDERS.fishaudio` (line 601): id `fishaudio`, baseUrl `https://api.fish.audio/v1/tts`, authType `apikey`, authHeader `bearer`, format `fishaudio`, models `s2.1-pro-free`, `s2.1-pro`, `s2-pro`, `s1`, and the legacy `speech-1.6`, `speech-1.5`.
- `open-sse/handlers/audioSpeech.ts`: format `fishaudio` goes to `handleFishAudioSpeech` (line 1032).
- `open-sse/executors/fishAudioTts.ts`: `buildFishAudioSpeechPayload` and `handleFishAudioSpeech`. One `POST` with `Content-Type: application/json`, `Authorization: Bearer <key>` and a `model: <model id>` header. Body `{ text, format, reference_id?, ...provider_options.fishaudio, prosody? }`. `response_format` is lower-cased, `ogg` becomes `opus`, and the allowed formats are `wav`, `pcm`, `mp3`, `opus`. `speed` becomes `prosody.speed`. Options are validated against fixed tables (temperature, top_p, chunk_length, normalize, sample_rate, mp3/opus bitrate, latency, max_new_tokens, repetition_penalty, min_chunk_length, condition_on_previous_chunks, early_stop_threshold, features, prosody). Inline `references` are refused because Fish needs MessagePack for them. The audio is streamed back. A refusal returns Fish's own message after sanitizing it.
- `src/app/api/v1/_shared/fishAudioProxy.ts` and `src/app/api/v1/providers/[provider]/voices/route.ts`: `GET /v1/providers/fishaudio/voices` sends the caller's query string to `https://api.fish.audio/model` using the key-scoped connection (`enforceApiKeyPolicyWithScope`, `getProviderCredentialsWithQuotaPreflight`). The `POST` forwards a multipart voice clone creation.
- `tests/unit/audio-speech-fishaudio.test.ts`: the option mapping that the local test mirrors exactly.

**The STT row does not exist in the source.** `AUDIO_TRANSCRIPTION_PROVIDERS` (line 55) has no `fishaudio` entry. `audioTranscription.ts` never names it. The only `fishaudio` row (line 601) is inside `AUDIO_SPEECH_PROVIDERS` (line 396). The STT inventory row reuses the TTS endpoint, and no handler serves it. Nothing is staged for STT.

## Fresh-main check

Checked `HEAD` (`5ec60a03f1`) and `origin/main` (`a6cb6dea80`). The two match for every file below. No `fishaudio` id exists in `open-sse` or `src`.

- `open-sse/providers/registry/fish-audio.js`: id `fish-audio`, alias `fish`, authType `apikey`, serviceKinds `["tts"]`. Its ttsConfig has baseUrl `https://api.fish.audio/v1/tts`, authHeader `bearer`, format `fish-audio`, and models `s2.1-pro-free`, `s2.1-pro`, `s2-pro`, `s1`.
- `open-sse/handlers/ttsProviders/genericFormats.js` `FORMAT_HANDLERS["fish-audio"]` is reachable through `synthesizeViaConfig`. It uses the same endpoint, the same Bearer header and the same `model` header, so the wire identity is equivalent. Its body is only `{ text, format: "mp3", reference_id? }`. It always asks for mp3. It drops `provider_options`, `speed` and `response_format` without warning and accepts any model id. It sets no deadline, follows redirects, and quotes the upstream body through `throwUpstreamError`. It has no accepted-job outcome and does not check the audio.
- `TTS_ADAPTERS` has no `fish-audio`, `fish` or `fishaudio` entry.
- `src/shared/constants/ttsProviders.js` `fish-audio`: model selector and manual voice id input. It has no browse button.
- There is no local Fish voice listing.

The provider, its API-key connection, the endpoint and the auth already exist and work. This module does not duplicate them. It stages the remaining delta under the existing `fish-audio` identity:
- format selection
- `provider_options.fishaudio`
- prosody and speed
- reference-id arrays
- the legacy model rows
- the `fishaudio` alias
- voice discovery
- the native adapter contract

The staging block in the test pins the existing handler's matching endpoint, auth and header. It also pins that handler's narrower body.

## Staged module

`open-sse/services/providerParity/native-fishaudio-tts/`:

- `config.js`: ids, the `fish` alias, the source id `fishaudio`, the fixed origin and endpoints, the six model rows, the source validation tables, bounds, `FISH_AUDIO_TTS_CONFIG` and `FISH_AUDIO_TTS_PROVIDER_ADDITIONS`.
- `http.js`: one bounded send, redirect refusal, refusal mapping and accepted-job accounting. This is the same contract as the staged Hyperbolic speech transport. A `billable` flag keeps discovery failures free of `acceptedJob`.
- `tts.js`: `createFishAudioTtsAdapter`, `buildFishAudioSpeechRequest`, container and model resolution, and magic-byte checks. It follows the `TTS_ADAPTERS` `synthesize` contract.
- `voices.js`: `createFishAudioVoiceLister`, `buildFishAudioVoicesUrl`, `normalizeFishAudioVoices`.
- `index.js`: exports, plus the default `fishAudioTtsAdapter` and `listFishAudioVoices`.
- `registration.json`: exports, ids, aliases, models, endpoints, bounds and integration points.

No production code imports these files.

## Supported subset

Speech (`POST https://api.fish.audio/v1/tts`, headers `Content-Type`, `Authorization: Bearer <apiKey || accessToken>`, `model`):

- Models: `s2.1-pro-free` (the default when no model is given), `s2.1-pro`, `s2-pro`, `s1`, `speech-1.6`, `speech-1.5`.
- Voice: `provider_options.fishaudio.reference_id` (a string or an array of 1-16), then `voice`, then a `model/<id>` suffix, in that order. That is the source's order plus the local suffix convention. Each id must match `^[A-Za-z0-9_-]+$` (the source's voice-id pattern) and be at most 128 characters.
- Container: the body's `response_format`, or the query's (`requestedResponseFormat`, or a positional query value other than `mp3`/`json`). The allowed values are `mp3`, `wav`, `pcm`, `opus` and `ogg` (sent as `opus`). The default is `mp3`. The gateway's query `json` wraps any container.
- Every source option under `provider_options.fishaudio`, with the source's ranges and enums. `speed` (or `prosody.speed`) must be 0.5-2. `prosody.volume` must be -20 to 20, and `prosody.normalize_loudness` must be a boolean.
- Answer: raw audio, at most 25 MiB, read with the deadline. Its bytes must match the requested container: ID3 or an MPEG frame for mp3, `RIFF....WAVE` for wav, `OggS` for opus, and an even length for pcm.
- Accounting: cost unknown (`costSource: "unavailable"`), with meta `{ nativeUnitsSource: "input-characters", model, container }`. `handleTtsCore` merges in the character count.

Voice discovery (`GET https://api.fish.audio/model`, `Accept: application/json`, Bearer):

- Allowed query parameters: `page_size` (1-100), `page_number`, `title`, `tag`, `self`, `author_id`, `language`, `title_language`, `sort_by` (`score`, `task_count`, `created_at`). Any other key is refused.
- Answer: JSON of at most 2 MiB, reduced to `{ total, voices: [{ id, name, type, languages, tags, visibility, state }], dropped }`. An item whose id is missing or fails the safe pattern is dropped. Control characters are stripped and strings are capped. Upstream URLs (cover images, samples) and author objects are not passed on.

## Refused before submit

- Unknown model, or a suffix on an unknown model.
- An unknown container, or a body `response_format: "json"`.
- A body and query container that disagree.
- `stream: true` or `stream_format` other than `audio`. The adapter buffers the audio.
- `instructions` or a `language` hint. The source drops these without warning.
- Inline `references`. The error message says MessagePack is needed and points to a persistent voice, like the source.
- Any unknown `provider_options.fishaudio` or `prosody` key. The source ignores these.
- `mp3_bitrate` without mp3, or `opus_bitrate` without opus.
- Any out-of-range option or option of the wrong type.
- An unsafe, empty or over-long reference id, or more than 16 ids.
- A `voice` that disagrees with the model suffix.
- Empty input, or a request over 256 KiB.
- A missing key, or a key containing CR/LF. These return 401 and nothing is sent.

## Transport and failures

- One send and no retries. The send carries a 120 s deadline (30 s for discovery) and the caller's signal. The wait ends even if the transport ignores its signal.
- `redirect: "manual"`. Any 3xx or `opaqueredirect` is refused and not followed, so the key is not sent again.
- The connection's egress policy is passed through (`resolveCredentialProxyOptions`). Any connection `baseUrl` is ignored.
- Refusals keep only the HTTP status, and Fish's body is never quoted. 401/403 pass through. 402 sets `quotaExhausted` for this connection. 429/503 keep a valid `Retry-After`. Other 4xx pass through. 5xx other than 503 return 502, and for speech they carry `acceptedJob` (`submit-unknown`). A speech 503 keeps status 503 and also carries `acceptedJob` (`submit-unknown`); see "503 replay" below.
- The following carry `acceptedJob` with unknown cost and are never replayed:
  - aborts after send
  - timeouts
  - resets
  - redirects
  - a 2xx whose body is a document, empty, oversized, stalled or the wrong container
- These failures were provably never sent and carry no `acceptedJob`:
  - an abort before send
  - pre-connect errors (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`)
- Discovery is not billable, so its failures never carry `acceptedJob`.

## 503 replay (#2034, 2026-11-27)

The adapter used to treat a speech 503 as a refusal with no `acceptedJob`, so the media account loop could send the same text to another account. No primary Fish Audio source supports that. Sources (public GET, read 2026-11-27):

- [API errors](https://docs.fish.audio/api-reference/errors), "Status codes": `5xx` is "Server error", "Retry with backoff; if it persists, contact support." The intro says edge `5xx` answers "may not be JSON". "Retries": "Retry `429` and `5xx` with exponential backoff." That is client retry policy, not a no-work or no-billing contract.
- [Pricing and rate limits](https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits): "Requests that return an error response are not billed" appears only under file ASR (`transcribe-1-pro`, `transcribe-1`), and "service errors are not billed" only under Voice Design. The TTS section says nothing about failed requests.

The no-billing statements do not cover `/v1/tts`, and no structured "not accepted" field is documented. A speech 503 now:

- keeps HTTP status 503 and the bounded `Retry-After` (`resetsAtMs`) for the selected account's health;
- carries `acceptedJob` (`costSource: "accepted-job"`, cost unknown, `jobState: "submit-unknown"`). In `runMediaAccounts`, the TTS handler's `onAccountFailure` records the job on the selected account and ends the loop, so it is never replayed on another account;
- never quotes the body; it is still drained only up to 16 KiB under a 2 s bound.

Voice discovery (`billable: false`) is a free read and keeps a plain 503. Same contract as the HuggingFace speech fix (`internal/docs/port-reports/native-audio-503-contract.md`, commit `84b4a16baf`).

Tests: `tests/unit/private-audio-503-replay.test.js` (30 tests, 15 per vendor; see the Deepgram report for the case list). Mutations: reverting the Fish 503 change fails 13 Fish cases; applying the job to discovery too fails the discovery case.

Conflict: `tests/unit/native-fishaudio-tts.test.js` "keeps a bounded Retry-After on 429 and 503" asserts `unavailable.acceptedJob` is undefined and now fails. It was outside this change's allowed files and was left unchanged.

## Registration (serial step, not done here)

See `registration.json` `integrationPoints`:

1. `open-sse/providers/registry/fish-audio.js`: add alias `fishaudio` (keep `fish`), and append `speech-1.6` and `speech-1.5` to `ttsConfig.models`.
2. `open-sse/handlers/ttsProviders/index.js`: add `fish-audio`, `fish` and `fishaudio` to `TTS_ADAPTERS` pointing at `fishAudioTtsAdapter`. Then remove `FORMAT_HANDLERS["fish-audio"]`.
3. `src/sse/handlers/tts.js`: add `fish-audio` to `NAMED_FORMAT_PROVIDERS`.
4. A voices route (or `VOICE_FETCHERS`) that serves `listFishAudioVoices`. The connection must be picked from the caller key's allowed connections. Also flip `hasBrowseButton` in `src/shared/constants/ttsProviders.js`.
5. `docs/providers/catalog.mdx`.

At that point the test's staging block is promoted to positive identity assertions.

## Remaining restrictions

- No STT. The source has none (see Source).
- Voice clone creation (`POST /model`, multipart audio upload) is not staged. It writes data to the account and needs a `src/` route with upload size limits. That is out of scope for this row.
- Inline reference audio (MessagePack) is refused, as in the source.
- Streaming audio is not passed through. The adapter buffers up to 25 MiB.
- Cost stays unknown. Fish documents no usage receipt on this route.
- Fish's own refusal text (for example "invalid reference_id") is not shown to the caller. Only the status code and a fixed message are shown.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-fishaudio-tts.test.js --maxWorkers=2
```

92 tests passed, with closed mocks only. `npx eslint` on the staged directory and the test file reported nothing. The full suite was not run.
