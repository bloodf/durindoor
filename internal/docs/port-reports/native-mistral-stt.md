# Mistral native STT (staged), 2026-11-27

Issue #2034. Staged and unregistered: nothing in production imports `open-sse/services/providerParity/native-mistral-stt/`.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (read-only checkout, HEAD verified):

- `open-sse/config/audioRegistry.ts`, `mistral` transcription entry: `id: "mistral"`, `baseUrl: "https://api.mistral.ai/v1/audio/transcriptions"`, `authType: "apikey"`, `authHeader: "bearer"`, no `format`, models `voxtral-mini-latest`, `voxtral-mini-2602` (both "Voxtral Mini Transcribe 2") and `voxtral-mini-transcribe-3`.
- `open-sse/handlers/audioTranscription.ts` `handleAudioTranscription`: with no `format`, the entry takes the default OpenAI-compatible multipart branch. It sends `Authorization: Bearer <key>` and a multipart body of `model`, then `language`, `prompt`, `response_format`, `temperature` and `timestamp_granularities[]` (a single `get`) when present, then `file`. It sends once with no deadline, and passes the answer through with its content type. Refusals go through `upstreamErrorResponse`, which keeps a sanitized JSON message.
- `open-sse/utils/audioMultipart.ts` `buildMultipartBody` / `getUploadedFileName`: the file name is relabelled from `.opus` to `.ogg`, is `audio.wav` when unnamed, and has quotes and line breaks scrubbed. The part type comes from the upload or is `application/octet-stream`.

## Vendor contract (verified 2026-11-27)

Public GETs only. Where the vendor contract and the OmniRoute source differ, the vendor contract wins.

- `https://docs.mistral.ai/openapi.yaml` (sha256 `acf0efcbee4617601df77fc40185516ed6aae4369ce090034099317d5866b2db`). The operation is `POST /v1/audio/transcriptions`, operationId `audio_api_v1_transcriptions_post`. It takes a `multipart/form-data` `AudioTranscriptionRequest` and returns a `200` `TranscriptionResponse`. The streaming variant is `audio_api_v1_transcriptions_post_stream` (`stream` const `true`) and is not staged.
  - Request fields: `model` (required), `file`, `file_url`, `file_id`, `language`, `temperature`, `stream` (const `false`), `diarize`, `context_bias`, `speaker_references` and `timestamp_granularities`. There is no `prompt` and no `response_format`.
  - `language` is a string matching `^\w{2}$`, or null.
  - `temperature` is a `number` or null. It has no minimum or maximum.
  - `timestamp_granularities` is an array of `TimestampGranularity` (`segment` or `word`).
  - `TranscriptionResponse` has `model`, `text`, `language` and `usage` (all required), plus `segments` (`TranscriptionSegmentChunk`), and sets `additionalProperties: false`. `usage.prompt_audio_seconds` is an integer or null. The schema has no `duration` field.
  - The operation documents no error response (no 4xx, 5xx or 503 body).
- `mistralai/client-python` at `6e9e31ac6f982c1fdfe177787ded223f458c9f69`: `models/audiotranscriptionrequest.py` marks every field `multipart=True`. `utils/forms.py` `serialize_multipart_form` sends a list as one repeated form field under the plain name, so the name is `timestamp_granularities` with no `[]`. `transcriptions.py` raises `SDKError` for any 4XX or 5XX and retries 429/500/502/503/504 only when the caller configures retries.
- `https://docs.mistral.ai/getting-started/models/models_overview/` (sha256 `1f764d4e7755a688d06dc5f1a9e01a1b27af807977884f83e5c1b634fd9e3807`) lists model ids for Voxtral Mini Transcribe 2 (`voxtral-mini-2602`, `voxtral-mini-latest`) and Voxtral Mini Transcribe 3 (`voxtral-mini-transcribe-3-0`, `voxtral-mini-transcribe-3`, `voxtral-mini-transcribe-latest`). Transcribe 2 is deprecated as of 2026-10-31 and retires on 2027-04-30. All three source ids are listed, so the model list is unchanged.

Corrections that follow from the vendor contract:

- Granularities go out as a repeated `timestamp_granularities` field. The source used `timestamp_granularities[]`.
- `response_format` is not sent. A client `json` (or no value) is still accepted, because the endpoint answers JSON only.
- `language` must match `^\w{2}$` (ASCII), and anything else is refused before submit.
- The temperature range of 0 to 1 is a gateway bound, not a vendor one. The schema declares an unbounded `number`. The bound only refuses inputs and never changes a value on the wire, so it is kept.
- The `duration` fallback for audio seconds is not in the vendor schema. It is a lenient read and is never sent.

Fixtures shaped from these sources live in `tests/unit/mistral-stt-source-contract.test.js`.

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
- Input: the uploaded `file` (at most 25 MiB, not empty), plus optional `language` (two word characters), `response_format=json` (accepted, not forwarded), `temperature` (0–1 gateway bound, forwarded as given) and `timestamp_granularities` `segment`/`word`. Both client spellings are merged and deduplicated under the vendor's repeated `timestamp_granularities` name.
- Output: a JSON object with a string `text`, passed through unchanged as `application/json`. `usage` is kept as `usageValue`. Audio seconds come from `usage.prompt_audio_seconds`, or from `duration`, and are kept only when finite and non-negative. Cost stays unknown.

## Deviations and restrictions

These inputs are refused with a local 400 before submit. Nothing is sent and nothing is billed.
- Translations; the source has no Mistral translation route.
- `stream` set to anything other than `false`.
- A `url` input. The adapter takes an uploaded file only.
- `response_format` other than `json`. This covers `text`, `verbose_json`, `srt` and `vtt`, because the endpoint answers with a JSON transcription object and the adapter does not claim other formats.
- A non-empty `prompt`. The source forwarded it blindly, but `AudioTranscriptionRequest` has no such field.
- A `language` that does not match `^\w{2}$`.
- A temperature that is not a number from 0 to 1 (a gateway bound; the vendor sets none), an unknown granularity, and text fields over 4096 characters.
- A missing, empty or oversized file, and a missing key or a key containing line breaks (401).
- Granularity spellings beyond the source's single `timestamp_granularities[]` value are merged rather than dropped, and they are sent under the vendor name.
- A `url` input stays refused even though the vendor has `file_url`. The gateway takes uploads only.

Transport:
- The request has a 300 s deadline. The wait ends on the deadline or on the caller's abort even when the transport ignores its signal, and a late answer is discarded. The body read is capped at 8 MiB.
- Redirects are refused and not followed, with `acceptedJob` `submit-unknown`.
- A provably unsent failure (aborted before send, or `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` or connect timeout) has no `acceptedJob`. Any failure after send, a timeout, a caller abort after send, and every 5xx (503 included) carry `acceptedJob` (`submit-unknown`, unknown cost). They are never retried or replayed.
- 503 accounting: the original port left 503 out of the uncertain post-dispatch 5xx set. That was wrong, because a 503 status alone does not prove that no billable work ran. The operation documents no error body, so there is no structured proof that a request was rejected before processing. Every post-dispatch 503, whatever its body (JSON, a body claiming "not processed", HTML or empty), is now a 503 with `acceptedJob` `submit-unknown`, and it is recorded once on the selected connection and never replayed. It keeps its status and its `Retry-After` reset, and an unusable `Retry-After` is dropped. The error body is still read under the 16 KiB bound and cancelled when oversized or when the caller leaves, and it is never quoted. No 503 case is treated as unsent, because the vendor documents none.
- Refusals are reported by status only, and Mistral's body is never quoted. 402 sets `quotaExhausted` on that connection only. 429 and 503 carry a `Retry-After` reset when present. Other 4xx codes keep their status and carry no `acceptedJob`.
- A 2xx answer with an error envelope (`object: "error"` or `error`) is a 502 with no transcript and no quoted text. A 2xx answer that is not JSON, is HTML, is malformed, is too large, is not an object, or lacks `text` is a lost result with `acceptedJob` `accepted`.

Dynamic discovery: none. The source lists Mistral transcription models statically. The registry's `validateUrl` (`/v1/models`) validates keys and is not an STT model contract.

## Registration (serial step, not done here)

1. In `open-sse/providers/registry/mistral.js`, add `"stt"` to `serviceKinds`, add the `MISTRAL_STT_MODELS` rows and set `sttConfig: MISTRAL_STT_CONFIG`. Keep the existing kinds, configs and the apikey auth mode.
2. In `open-sse/handlers/sttCore.js`, before the format switch, add `if (provider === "mistral" && cfg.format === "mistral-stt") return await mistralSttAdapter.transcribe({ model, formData, credentials, kind, signal })`.
3. `src/sse/handlers/stt.js` already records `result.acceptedJob` on the selected connection and stops fallback, so confirm that no change is needed.
4. List the stt kind in `docs/providers/catalog.mdx`.
5. Promote the staging block in `tests/unit/native-mistral-stt.test.js` to strict positive identity assertions.

## Evidence

The only runs were the focused closed-mock suites (no live calls). The full suite was not run.

```
cd tests && node node_modules/vitest/vitest.mjs run unit/mistral-stt-source-contract.test.js unit/native-mistral-stt.test.js --maxWorkers=2
Test Files  2 passed (2)
     Tests  58 passed (58)
```

All 37 original tests remain. Three expectations changed, each with a citation in the test: the `response_format` part is no longer sent, the granularity part name is `timestamp_granularities`, and the 503 refusal now carries `acceptedJob` instead of none. The 21 new tests cover the docs-shaped request, response and 503 cases.

`npx eslint open-sse/services/providerParity/native-mistral-stt tests/unit/native-mistral-stt.test.js tests/unit/mistral-stt-source-contract.test.js` reported no problems.

Passing tests check the source-derived contract against mocks. They do not prove anything about the live Mistral service.
