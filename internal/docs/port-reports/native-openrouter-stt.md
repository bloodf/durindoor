# OpenRouter native STT (staged), 2026-11-27

Issue: #2034. The inventory row for `openrouter` STT (`sttConfig`, format `openrouter-stt`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts`, `openrouter` transcription entry: `id: "openrouter"`, `baseUrl: "https://openrouter.ai/api/v1/audio/transcriptions"`, `authType: "apikey"`, `authHeader: "bearer"`, `format: "openrouter-stt"`, `supportedFormats: ["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"]`. It lists eleven models: `deepgram/nova-3`, `microsoft/mai-transcribe-1.5`, `nvidia/parakeet-tdt-0.6b-v3`, `mistralai/voxtral-mini-transcribe`, `qwen/qwen3-asr-flash-2026-02-10`, `google/chirp-3`, `openai/gpt-4o-mini-transcribe`, `openai/whisper-large-v3`, `openai/whisper-large-v3-turbo`, `openai/whisper-1` and `openai/gpt-4o-transcribe`.
- `open-sse/handlers/audioTranscription.ts`: `handleAudioTranscription` sends `format === "openrouter-stt"` to `handleOpenRouterTranscription`.
- `open-sse/handlers/openrouterTranscription.ts`:
  - `handleOpenRouterTranscription` sends one `POST` to the registry URL with `Authorization: Bearer <key>` (from `buildAuthHeaders`) and `Content-Type: application/json`. The body is `{ model, input_audio: { data: <base64 of the upload>, format } }`. It then adds `language`, `response_format`, `temperature` (parsed to a number, dropped if NaN) and `timestamp_granularities` (an array from repeated `timestamp_granularities[]`) when present. `prompt` is not forwarded. A non-2xx goes through `upstreamErrorResponse`, which reuses a sanitized JSON error message. A 2xx body is passed through with its content type. No deadline, no redirect policy, one attempt.
  - `resolveOpenRouterAudioFormat` uses the file extension first (`.opus` becomes `ogg`), then the base MIME type, and otherwise falls back to `wav`.
- `tests/unit/audio-transcription-opus-filename.test.ts` covers the `.opus` and `audio/opus` rules.

The source has no translation route for OpenRouter and no dynamic discovery for transcription models: the list is static. Nothing in the source fetches OpenRouter's model feed for STT.

## Fresh-main check

Checked `HEAD` (`306c79e5e5`) and `origin/main` (`f14f877ec1`).

- `open-sse/providers/registry/openrouter.js` exists with alias `openrouter`, apikey auth and kinds `llm`, `embedding`, `tts`, `imageToText`, `rerank` and `systemone`. It has `ttsConfig`, `embeddingConfig`, `imageConfig` and `systemoneConfig`, and no `sttConfig` or `stt` model rows.
- `src/sse/handlers/stt.js` reads `AI_PROVIDERS[provider].sttConfig`. With none, `handleSttCore` answers "Provider 'openrouter' does not support STT".
- `handleSttCore` has no `openrouter-stt` case. Its default branch, `transcribeOpenAICompatible`, sends multipart, which is a different wire envelope from OpenRouter's JSON `input_audio` body.
- `git grep openrouter-stt` finds only the inventory row in `internal/docs/port-reports/provider-native-capabilities-1127.md`. `git grep input_audio open-sse/handlers` finds no JSON STT path.

The provider exists but has no transcription path and no equivalent, so the staged module is the whole delta.

## Staged module

`open-sse/services/providerParity/native-openrouter-stt/`:

- `config.js`: IDs, the fixed origin and endpoint, source models and audio formats, bounds, and `OPENROUTER_STT_CONFIG` (the staged `sttConfig` for the existing registry entry).
- `http.js`: one bounded send, redirect refusal, refusal mapping, and accepted-job accounting. Same contract as the staged deAPI STT transport.
- `stt.js`: `createOpenRouterSttAdapter`, `buildOpenRouterTranscriptionRequest`, `resolveOpenRouterAudioFormat` and `sniffOpenRouterAudioFormat`. The adapter follows the `transcribe({ model, formData, credentials, kind, signal })` contract, and the result matches the `handleSttCore` shape.
- `index.js`: exports and the default instance `openrouterSttAdapter`.
- `registration.json`: exports, IDs, models, endpoints, bounds and integration points.

Production code imports none of these files.

## Supported subset

Transcription (`POST https://openrouter.ai/api/v1/audio/transcriptions`):

- The eleven source models only. The registry's `passthroughModels` covers chat and does not extend to transcription.
- Headers are exactly `Authorization: Bearer <key>` and `Content-Type: application/json`, as in the source. The registry's `HTTP-Referer`/`X-Title` headers on other OpenRouter configs are not sent, because the source STT request does not send them.
- Body keys in source order: `model`, `input_audio { data, format }`, then `language`, `response_format`, `temperature` (a number) and `timestamp_granularities` (an array) when named.
- `input_audio.format` follows the source rule: extension, `.opus` as `ogg`, then the base MIME type. When neither is recognized, the leading bytes are checked (RIFF/WAVE, fLaC, OggS, EBML, `ftyp`, ID3, MPEG frame, ADTS).
- `response_format`: `json` (the default, not sent unless named), `text` or `verbose_json`.
- `timestamp_granularities` needs `verbose_json`. Supported values are `segment` and `word`. Both client spellings are merged, and every distinct value is sent.
- `language` is an optional string of at most 4096 characters. `temperature` must be from 0 to 1.
- The file must be non-empty and at most 25 MiB.
- JSON answers must be an object with a string `text`. They are passed through unchanged. For `text`, the transcript is returned as `text/plain`, from either a text body or a JSON body.
- Usage: `usage` is kept as provider usage when it is an object. Audio seconds come from `duration`, or else `usage.seconds`. Any `usage.cost` is not read as USD, so cost stays `null`/`unknown`.

## Deviations and restrictions

- **Fixed origin.** The key goes only to `https://openrouter.ai`. Connection base URLs are ignored. Requests go through `proxyAwareFetch` with the selected connection's proxy options.
- **One request, no retry or replay.** Redirects are refused (`redirect: "manual"`).
- **Deadline and cancellation.** One 300 s deadline covers the send and the body. The adapter stops waiting even when the transport ignores its signal. The caller's signal aborts both the send and the body read.
- **Refusals before submit** (`local: true`, nothing sent):
  - Unknown models.
  - Translations (`kind: "translation"`). The staged `sttConfig` keeps `supportsSttTranslation` false.
  - Streaming.
  - `srt`, `vtt`, `diarized_json` and other response formats.
  - Granularities without `verbose_json`, or values other than `segment`/`word`.
  - A non-empty `prompt`. The source drops it silently; here it is refused rather than ignored.
  - A bad `temperature`.
  - A missing, empty or oversized file, or a `url` input.
  - Audio whose container is not recognizable. The source announced it as `wav`.
  - A missing key, or a key containing CR/LF (401).
  - Other fields outside the source list, such as `include[]`, are not forwarded, as in the source.
- **Refusal mapping.** OpenRouter's text is never quoted, and the selected connection's key is redacted.
  - 401 is a key refusal. 403 is a forbidden refusal (OpenRouter uses it for moderation and key limits).
  - 402 becomes `quotaExhausted` on that connection only.
  - 429 and 503 keep a bounded `Retry-After`.
  - Other 4xx statuses pass through.
  - Any other 5xx is an unknown outcome and carries `acceptedJob` (`submit-unknown`).
- **Uncertain outcomes.** These carry `acceptedJob` with `cost: null`, `costStatus: "unknown"` and `costSource: "accepted-job"`:
  - A timeout, network failure or caller abort after the send. Only `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` and `UND_ERR_CONNECT_TIMEOUT` count as provably unsent.
  - A refused redirect.
  - A 2xx that is unreadable, oversized, HTML, non-JSON for a JSON format, or lacks `text`.

  The route records these once on the selected connection and never resubmits them elsewhere.
- **Error envelopes.** A 2xx JSON error envelope, including one mislabelled `text/plain`, is a refusal that produced no transcript. It is not returned as transcript text, does not carry `acceptedJob`, and its text is not quoted.

## Registration (serial step, not done here)

Integration points, from `registration.json`:

1. In `open-sse/providers/registry/openrouter.js`, add `"stt"` to `serviceKinds`, add model rows from `OPENROUTER_STT_MODELS` with `kind: "stt"`, and set `sttConfig: OPENROUTER_STT_CONFIG`. Keep every existing kind, config and the apikey auth mode.
2. In `open-sse/handlers/sttCore.js`, add an `openrouter` / `openrouter-stt` branch before the format switch, so the multipart default never serves OpenRouter.
3. In `src/sse/handlers/stt.js`, record `result.acceptedJob` once on the selected connection and stop account fallback for it.
4. In `docs/providers/catalog.mdx`, list the OpenRouter `stt` kind.

The isolated staging block in the test asserts that the `openrouter` registry entry has no `stt` kind and no `sttConfig`, and that `registration.json` says `staged-unregistered`. At registration, only that block should flip to positive identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-openrouter-stt.test.js --maxWorkers=2
```

33 tests pass, using closed mocks only. They cover the exact source headers and body, format resolution, success normalization, usage, refusals and quota, two credentials, abort before and after send, the deadline, redirect refusal without replay, and malformed or unsafe answers. ESLint is clean on the staged module and the test. No live call was made.
