# Vertex AI Gemini TTS and STT (staged), 2026-11-27

Issue: #2034 (Decision15 delta: the inventory listed `vertex` TTS and STT as missing, with no `TTS_ADAPTERS` entry and no `ttsConfig`/`sttConfig`).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout's `git rev-parse HEAD` matched before the port.

- `open-sse/config/audioRegistry.ts` has two `vertex` entries:
  - `AUDIO_TRANSCRIPTION_PROVIDERS.vertex`: `baseUrl` `https://us-central1-aiplatform.googleapis.com/v1`, `authType: "apikey"`, `authHeader: "bearer"`, `format: "vertex-gemini"`, and the models `gemini-2.5-flash`, `gemini-2.5-pro` and `gemini-2.0-flash`.
  - `AUDIO_SPEECH_PROVIDERS.vertex`: the same base URL and auth settings, `format: "vertex-gemini-tts"`, and the models `gemini-3.1-flash-tts-preview`, `gemini-2.5-flash-preview-tts`, `gemini-2.5-pro-preview-tts`, `gemini-3.8-flash-tts` and `gemini-3.8-flash-lite-tts`.
- `open-sse/handlers/audioSpeech.ts` has the `vertex-gemini-tts` branch and `googleSpeechStyleOptions`.
- `open-sse/handlers/audioTranscription.ts` has the `vertex-gemini` branch.
- `open-sse/executors/vertexMedia.ts` contains:
  - `resolveVertexAuth` and `buildModelRequest`
  - `vertexGenerateSpeech` and `vertexTranscribe`
  - the audio helpers `pcmToWav`, `parsePcmSampleRate`, `stripC2paMetadata` and `normalizeAudioOutput`
  - the style helpers `buildGeminiSpeechStyle` and `extractSpeechInstruction`

## Delta check against local main

The delta is real. A same-name config does not exist.

- `open-sse/providers/registry/vertex.js` (canonical id `vertex`, alias `vx`) has `serviceKinds: ["llm", "imageToText"]`. It has no `ttsConfig` and no `sttConfig`.
- `TTS_ADAPTERS` in `open-sse/handlers/ttsProviders/index.js` has no `vertex` entry.
- `handleSttCore` has no `vertex-gemini` case. Without one, a Vertex `sttConfig` would fall through to the OpenAI multipart default.
- The local Gemini TTS adapter (`ttsProviders/gemini.js`) and the `gemini-stt` STT path are not equivalent. They call `generativelanguage.googleapis.com` with an AI Studio key (`?key=` or `x-goog-api-key`). Vertex uses `aiplatform.googleapis.com`, with a project- and location-scoped path and an OAuth bearer minted from a Service Account or ADC credential. The request bodies also differ: Vertex uses `role: "user"`, puts `speech_metadata.style` on the text part, and sends no "Say:" prefix.
- `vertex-partner` and the retired managed DeepSeek models are untouched.

## What landed

Everything is under `open-sse/services/providerParity/native-vertex-tts-stt/`. Nothing in production imports it.

| File | Role |
| --- | --- |
| `config.js` | Model lists, formats, bounds, `VERTEX_TTS_CONFIG` / `VERTEX_STT_CONFIG` in registry shape, and `listVertexAudioModels`. |
| `auth.js` | Classifies the credential with the local `classifyVertexCredential`, mints tokens with the local `refreshVertexToken` / `refreshGoogleToken`, and builds the fixed endpoint. |
| `request.js` | One bounded `generateContent` POST with error classification and `acceptedJob`. |
| `speech.js` | A `TTS_ADAPTERS`-shaped adapter (`synthesize`), plus voice discovery. |
| `transcription.js` | A `handleSttCore`-shaped transcriber (`transcribeVertex`). |
| `registration.json` | Exports, ids, aliases, models, service kinds, endpoints, auth modes and integration points. |
| `tests/unit/native-vertex-tts-stt.test.js` | 59 tests over a closed network. |

## Supported subset

### Wire

Both services send `POST …/publishers/google/models/{model}:generateContent`. The other request details depend on the connection mode:

| Connection mode | Endpoint | Headers |
| --- | --- | --- |
| Service Account JSON | `https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/…`. The project comes from `project_id`. | `Content-Type: application/json` and `Authorization: Bearer <minted>` |
| ADC `authorized_user` | Same endpoint as Service Account JSON. The project comes from `quota_project_id` or `providerSpecificData.projectId`. | Same as Service Account JSON |
| Pre-set `accessToken` | Same endpoint as Service Account JSON. The project comes from `providerSpecificData.projectId`. | Same as Service Account JSON |
| Express API key | `https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent?key=…` (no project). | `Content-Type: application/json` only |

The location comes from `providerSpecificData.location`, the same field the chat executor uses, and defaults to `us-central1`. `global` uses `aiplatform.googleapis.com`. `us` and `eu` use `aiplatform.{us|eu}.rep.googleapis.com`. Any other value must match `<area>-<region><n>`; otherwise the request is refused before any token mint.

### TTS

- **Models:** the five source models.
- **Model and voice:** the model can be given as `model` or `model/voice`. The voice can also come from `voice`. It must be a Gemini prebuilt voice (`listVertexTtsVoices`, the same list as `fetchGeminiVoices`) and defaults to `Kore`.
- **Style:** `instructions` / `style` / `delivery` / `prompt` and `speed` (0.25–4) become `speech_metadata.style` (`"<style>. Pace: <n>x normal speed"`).
- **Output:** WAV by default. Raw PCM L16 is wrapped as WAV at the MIME sample rate, and a WAV answer has its C2PA trailer stripped. `pcm` returns the raw samples, and `json` uses the core's base64 wrapper.

### STT

- **Models:** the three source models.
- **Form fields:** `file`, `model`, `language`, `prompt` and `response_format` (`json` returns `{ text }`; `text` returns plain text).
- **Audio:** sent inline as base64 with its MIME type (`audio/wav`, `mpeg`, `mp3`, `aiff`, `aac`, `ogg`, `flac`, `webm`, `mp4`, `m4a` or `pcm`), taken from the file type or the file extension.
- **Instruction:** the source's default instruction, with `(language: X)` when a language is given. A caller-supplied `prompt` replaces it.

### Accounting

- **Success:** only the provider's `usageMetadata` tokens are counted. `cost` is null and `costStatus` is `unknown`. No duration is inferred.
- **Possibly billed:** `acceptedJob` carries `costSource: "accepted-job"` and one of these `jobState` values:
  - `submit-unknown`: the request was sent and then interrupted, timed out, answered 5xx, or was redirected to another origin.
  - `completed-unread`: the 2xx body was unreadable, oversized or not JSON.
  - `completed-unusable`: the answer had no audio or transcript, used an unsupported MIME type, had a bad sample rate, contained malformed base64, or had a non-text part.

  Nothing is ever replayed.

## Refused before any billable request

These requests are refused before anything billable is sent. Each refusal is a deviation from the source, which drops or forwards them.

- **TTS:**
  - `mp3`, `opus`, `aac` and `flac`. The source answers WAV under any name.
  - `stream` and `stream_format: "sse"`.
  - `language`. The source's Vertex path drops it silently.
  - Unknown models or voices, and a voice conflict between `model/voice` and `voice`.
  - A `speed` out of range, a non-string style field, empty input, and input over 32,000 characters.
- **STT:**
  - Translations, and any other form field (`temperature`, `timestamp_granularities[]`, `include[]`, `stream`, …).
  - `verbose_json`, `srt` and `vtt`.
  - `prompt` together with `language`. The source silently drops `language`.
  - A malformed language tag, a non-audio MIME type, empty audio, and audio over 14 MiB (413), which keeps the base64 body under Vertex's inline limit.
- **Credentials:**
  - OAuth-client or unknown JSON. It is never sent as a key.
  - Malformed JSON, a missing project, a project id with an invalid shape, and a failed or timed-out token mint (15 s).
  - No project-discovery probe is ever sent.

## Safety

- The per-call deadline is 120 s and includes minting. The wait ends even if a transport ignores its signal, and a late answer is discarded.
- The caller's signal aborts both minting and the fetch.
- Requests use `redirect: "manual"`. A 3xx is refused (not accepted). An answer whose `response.url` has a different origin is treated as an uncertain job.
- A transport failure before connecting (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) counts as unsent. Anything else is uncertain.
- Response bodies are bounded: 64 MiB for TTS, 4 MiB for STT, and 16 KiB for error bodies.
- Error messages carry only the HTTP status and Google's `error.status` enum (for example `RESOURCE_EXHAUSTED`). Upstream text, the input text and credentials never appear. The connection's `apiKey`, `accessToken` and minted token are also redacted.
- **Errors and quota:** a 429 keeps a bounded `Retry-After`. `BILLING_DISABLED` / `BILLING_NOT_ACTIVE` returns 402 with `quotaExhausted`. Other 4xx statuses pass through.
- Each call resolves its own credential, project, location, token and egress proxy (`resolveCredentialProxyOptions`). Nothing is shared between connections apart from the existing local token cache, which is keyed by credential digest.

## Remaining restrictions

- **No live verification.** These are closed mocks only. Vertex regional availability of each Gemini TTS model has not been checked.
- **Express key in the URL.** The Express key travels in `?key=`, as in the source and the local chat executor.
- **Custom models.** Dashboard-added custom models are refused.
- **Cost.** No Vertex audio tariff is applied, so cost stays unknown.

## Registration (serial step, not done here)

`registration.json` lists these points:

1. `providers/registry/vertex.js`: add `ttsConfig` and `sttConfig`, and add `tts` and `stt` to `serviceKinds`.
2. `TTS_ADAPTERS.vertex`: the default export of `speech.js`.
3. `handleSttCore`: add `case "vertex-gemini"` → `transcribeVertex(...)`.
4. `src/sse/handlers/tts.js`: pass `requestedResponseFormat` for `vertex`. Otherwise an explicit `?response_format=mp3` is indistinguishable from the default and gets WAV, with an honest `audio/wav` Content-Type.
5. `src/sse/handlers/stt.js`: record `acceptedJob` and stop account fallback. Today the STT route ignores `acceptedJob`.

The test file's isolated "staging (unregistered state)" block asserts the current absence of all of these. At registration it becomes positive registry-identity assertions. Every other test imports the staged module directly and holds whether the module is registered or not.

## Evidence

```
cd tests && node node_modules/vitest/vitest.mjs run unit/native-vertex-tts-stt.test.js --maxWorkers=2
 Test Files  1 passed (1)
      Tests  59 passed (59)
```

ESLint reports nothing for the staged directory or the test file. Two spot mutations were each caught: dropping the TTS `language` refusal, and dropping the `acceptedJob` on a mid-flight abort.
