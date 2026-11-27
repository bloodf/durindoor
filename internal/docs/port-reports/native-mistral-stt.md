# Mistral native STT (staged), 2026-11-27

Issue #2034. Staged and unregistered: nothing in production imports `open-sse/services/providerParity/native-mistral-stt/`.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (read-only checkout, HEAD verified):

- `open-sse/config/audioRegistry.ts`, `mistral` transcription entry: `id: "mistral"`, `baseUrl: "https://api.mistral.ai/v1/audio/transcriptions"`, `authType: "apikey"`, `authHeader: "bearer"`, no `format`, models `voxtral-mini-latest`, `voxtral-mini-2602` (both "Voxtral Mini Transcribe 2") and `voxtral-mini-transcribe-3`.
- `open-sse/handlers/audioTranscription.ts` `handleAudioTranscription`: with no `format`, the entry takes the default OpenAI-compatible multipart branch. It sends `Authorization: Bearer <key>` and a multipart body of `model`, then `language`, `prompt`, `response_format`, `temperature` and `timestamp_granularities[]` (a single `get`) when present, then `file`. It sends once with no deadline, and passes the answer through with its content type. Refusals go through `upstreamErrorResponse`, which keeps a sanitized JSON message.
- `open-sse/utils/audioMultipart.ts` `buildMultipartBody` / `getUploadedFileName`: the file name is relabelled from `.opus` to `.ogg`, is `audio.wav` when unnamed, and has quotes and line breaks scrubbed. The part type comes from the upload or is `application/octet-stream`.

## Fresh-main check

- `open-sse/providers/registry/mistral.js` has `serviceKinds` `llm`, `imageToText` and `embedding`, an `embeddingConfig` and no `sttConfig`. It has no stt model rows and no Voxtral ids.
- `src/sse/handlers/stt.js` reads `AI_PROVIDERS[provider].sttConfig`. Mistral has none, so `/v1/audio/transcriptions` answers "does not support STT".
- `open-sse/handlers/sttCore.js` has no Mistral branch. Its default `transcribeOpenAICompatible` sends the same multipart wire, but it forwards every client field, sets no deadline, follows redirects and returns no `acceptedJob`. `format: "openai"` would also make `supportsSttTranslation` true, but the source has no Mistral translation route. A same-shaped generic path does not prove equivalence, so the transcription half is the delta.
- `git grep -n voxtral` finds only `mistralai/voxtral-mini-transcribe` in the staged OpenRouter STT module. That model uses another provider, endpoint and key, so it is not an alias.

## Staged module

| File | Contents |
| --- | --- |
| `config.js` | Provider id, fixed origin and endpoint, the three source models (`kind: "stt"`), bounds, and `MISTRAL_STT_CONFIG` (`format: "mistral-stt"`, `translationModels: []`) |
| `http.js` | One bounded, abortable POST through `proxyAwareFetch` with the connection's proxy options. It uses `redirect: "manual"`, never retries, maps refusals by status only, and adds accepted-job accounting with unknown cost |
| `stt.js` | Input validation, multipart build, answer validation and the adapter factory |
| `index.js` | Exports and the default `mistralSttAdapter` |
| `registration.json` | Exports, canonical id and alias, models, service kinds, endpoint and auth, bounds and integration points |

## Supported subset

- Models: `voxtral-mini-latest`, `voxtral-mini-2602` and `voxtral-mini-transcribe-3` only. Passthrough ids are refused.
- Auth: the selected connection's `apiKey` (or `accessToken`) is sent as `Authorization: Bearer`. The connection's base URL is ignored, and only `https://api.mistral.ai` is contacted.
- Input: the uploaded `file` (at most 25 MiB, not empty), plus optional `language`, `response_format=json`, `temperature` (0–1, forwarded as given) and `timestamp_granularities` `segment`/`word`. Both client spellings are merged and deduplicated under the source's `timestamp_granularities[]` name.
- Output: a JSON object with a string `text`, passed through unchanged as `application/json`. `usage` is kept as `usageValue`. Audio seconds come from `usage.prompt_audio_seconds`, or from `duration`, and are kept only when finite and non-negative. Cost stays unknown.

## Deviations and restrictions

These inputs are refused with a local 400 before submit. Nothing is sent and nothing is billed.
- Translations; the source has no Mistral translation route.
- `stream` set to anything other than `false`.
- A `url` input. The adapter takes an uploaded file only.
- `response_format` other than `json`. This covers `text`, `verbose_json`, `srt` and `vtt`, because the endpoint answers with a JSON transcription object and the adapter does not claim other formats.
- A non-empty `prompt`. The source forwarded it blindly, but the Voxtral transcription endpoint does not document it.
- A temperature that is not a number from 0 to 1, an unknown granularity, and text fields over 4096 characters.
- A missing, empty or oversized file, and a missing key or a key containing line breaks (401).
- Granularity spellings beyond the source's single `timestamp_granularities[]` value are merged rather than dropped.

Transport:
- The request has a 300 s deadline. The wait ends on the deadline or on the caller's abort even when the transport ignores its signal, and a late answer is discarded. The body read is capped at 8 MiB.
- Redirects are refused and not followed, with `acceptedJob` `submit-unknown`.
- A provably unsent failure (aborted before send, or `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` or connect timeout) has no `acceptedJob`. Any failure after send, a timeout, a caller abort after send, and any 5xx other than 503 carry `acceptedJob` (`submit-unknown`, unknown cost). They are never retried or replayed.
- Refusals are reported by status only, and Mistral's body is never quoted. 402 sets `quotaExhausted` on that connection only. 429/503 carry a `Retry-After` reset when present. Other 4xx codes keep their status.
- A 2xx answer with an error envelope (`object: "error"` or `error`) is a 502 with no transcript and no quoted text. A 2xx answer that is not JSON, is HTML, is malformed, is too large, is not an object, or lacks `text` is a lost result with `acceptedJob` `accepted`.

Dynamic discovery: none. The source lists Mistral transcription models statically. The registry's `validateUrl` (`/v1/models`) validates keys and is not an STT model contract.

## Registration (serial step, not done here)

1. In `open-sse/providers/registry/mistral.js`, add `"stt"` to `serviceKinds`, add the `MISTRAL_STT_MODELS` rows and set `sttConfig: MISTRAL_STT_CONFIG`. Keep the existing kinds, configs and the apikey auth mode.
2. In `open-sse/handlers/sttCore.js`, before the format switch, add `if (provider === "mistral" && cfg.format === "mistral-stt") return await mistralSttAdapter.transcribe({ model, formData, credentials, kind, signal })`.
3. `src/sse/handlers/stt.js` already records `result.acceptedJob` on the selected connection and stops fallback, so confirm that no change is needed.
4. List the stt kind in `docs/providers/catalog.mdx`.
5. Promote the staging block in `tests/unit/native-mistral-stt.test.js` to strict positive identity assertions.

## Evidence

The only run was the focused closed-mock suite (no live calls). The full suite was not run.

```
cd tests && node node_modules/vitest/vitest.mjs run unit/native-mistral-stt.test.js --maxWorkers=2
Test Files  1 passed (1)
     Tests  37 passed (37)
```

`npx eslint open-sse/services/providerParity/native-mistral-stt tests/unit/native-mistral-stt.test.js` reported no problems.

Passing tests check the source-derived contract against mocks. They do not prove anything about the live Mistral service.
