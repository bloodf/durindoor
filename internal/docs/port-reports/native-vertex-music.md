# Native Vertex music (Lyria 2): staged port report

Issue: #2034. Source: OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (read-only checkout HEAD verified).

- `open-sse/config/musicRegistry.ts`: `vertex` entry with `baseUrl: "https://us-central1-aiplatform.googleapis.com/v1"`, `authType: "apikey"`, `authHeader: "bearer"`, `format: "vertex-lyria"` and model `lyria-002`.
- `open-sse/handlers/musicGeneration.ts`: the `vertex-lyria` branch calls `vertexGenerateMusic` and returns `{ created, data: [{ b64_json, format: "wav" }] }`.
- `open-sse/executors/vertexMedia.ts`: `vertexGenerateMusic` and `buildModelRequest`. These define the wire contract.

## Gap check (local `main` at `bfe8526724`, merged into this branch)

- `open-sse/handlers/musicGenerationCore.js`: `MUSIC_ADAPTERS` has only `suno` and `udio`. MiniMax is dispatched directly. There is no Vertex branch.
- `open-sse/providers/registry/vertex.js`: `serviceKinds: ["llm", "imageToText"]`. No music models and no `musicConfig`.
- `open-sse/executors/vertex.js` handles only Gemini `generateContent` and partner chat. No `:predict` path exists.
- `src/sse/handlers/music.js` has no Vertex handling, and its fallback loop does not record `acceptedJob`.

No equivalent exists, so this is a real delta. The `gemini` Lyria 3 `generateContent` entry is a different source registry entry and is out of scope.

## Staged files

- `open-sse/services/providerParity/native-vertex-music/index.js`: a private adapter. No production code imports it.
- `open-sse/services/providerParity/native-vertex-music/registration.json`: the exports, identity, endpoints, connection modes and integration points.
- `tests/unit/native-vertex-music.test.js`: closed-network contract tests.

## Wire contract

| Connection mode | Credential | Endpoint | Auth |
| --- | --- | --- | --- |
| Service Account | `apiKey` = SA JSON | `https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/publishers/google/models/lyria-002:predict` | `Authorization: Bearer` (minted with `refreshVertexToken`) |
| ADC | `apiKey` = `authorized_user` JSON | same, with project = `quota_project_id` | Bearer (from `refreshGoogleToken`) |
| OAuth token | `accessToken` + `providerSpecificData.projectId` | same | Bearer |
| Express | opaque `apiKey` | `https://aiplatform.googleapis.com/v1/publishers/google/models/lyria-002:predict?key=…` | query key |

- **Location:** taken from `providerSpecificData.location` (the local field). If that is missing, `providerSpecificData.region` (the source field) is used. The default is `us-central1`, as in the source.
- **Location hosts:** `us` and `eu` use the local `aiplatform.{us|eu}.rep.googleapis.com` hosts. `global` uses `aiplatform.googleapis.com`.
- **Validation:** locations must match a strict pattern, and project IDs must match the GCP project-ID pattern. The built URL must keep the expected `*.googleapis.com` origin.
- **Express:** the location is ignored, as in the source.
- **Request body:** `{ instances: [{ prompt, negative_prompt?, seed? }], parameters: { sample_count? } }`. These are exact source field names.
- **Response:** every `predictions[].bytesBase64Encoded` is returned. The source returned only `[0]`, which under-reported clips the caller paid for. The output shape is `{ object: "music.generation", created, provider: "vertex", model, status: "completed", data: [{ b64_json, format: "wav", mime_type: "audio/wav", duration_seconds }] }`. The upstream body is never echoed.

## Supported subset and restrictions

- **Model:** only `lyria-002`. An empty model defaults to `lyria-002`, as in the source. Other IDs return 400 before any token is minted or request is sent.
- **Accepted fields:**
  - `prompt` (required)
  - `negative_prompt`
  - `seed` (integer, 0 to 2³²−1)
  - `sample_count` (integer, 1 to 4; the cap is a gateway bound)
  - `response_format` (`b64_json` only)
  - `output_format` and `format` (`wav` only)
  - `instrumental`, `is_instrumental` and `make_instrumental` (`true` only, because Lyria 2 is instrumental-only)
  - `user`
- **Rejected fields:** any other field returns 400, including `stream`, `lyrics`, `audio_url` and `duration`.
- **`seed` with `sample_count`:** rejected, because Vertex does not allow them together.
- **Streaming:** none. Lyria 2 `:predict` is synchronous: there is no job ID, no polling and no GET lifecycle.
- **Discovery:** none. The pinned source has only a static model list, which `listVertexMusicModels()` returns.

## Safety, accounting and failure semantics

- **Deadlines:** total deadline 180 s by default (max 600 s), and token-mint deadline 15 s.
  - The caller signal and the deadline are combined and passed to fetch, so the socket is aborted.
  - Response body readers are cancelled when the deadline or abort fires.
- **Size limits:** success bodies are bounded at 64 MiB and error bodies at 16 KiB.
- **Redirects:** sent with `redirect: "manual"`. Any 3xx response is refused and not followed.
- **No replay:** exactly one submit. Nothing is ever retried.
- **Possibly-billed outcomes:** these return `acceptedJob`, which is `mediaAccounting` with `costSource: "accepted-job"` and `costStatus: "unknown"`. They cover:
  - network loss after dispatch
  - caller abort or deadline after dispatch (499 or 504)
  - 5xx responses other than 503 (`submit_outcome_unknown`)
  - 2xx bodies that cannot be read or parsed (`accepted_unreadable`)
  - 2xx bodies with malformed audio (`accepted_malformed`): no predictions, more clips than requested, invalid base64, an unexpected `mimeType`, or a buffer that is not RIFF/WAVE
- **Refusals:**
  - 400, 401, 403, 404, 429 and 503 pass through with status `refused`. 429 and 503 carry `resetsAtMs` from `Retry-After`.
  - Other 4xx responses become 502.
  - The message includes only the Google `error.status` enum, never upstream text.
  - All errors go through `createErrorResult` with the selected credentials, so key, token and secret values are redacted.
- **Usage:** `nativeUnits.audioSeconds` is measured from each WAV `data` chunk divided by the `fmt ` byte rate. Cost stays unknown: no tariff is invented.
- **Connection identity:** `connectionId` is echoed on every result. Tokens are minted from the selected connection's own credential and proxy options.

## Evidence

`cd tests && node node_modules/vitest/vitest.mjs run unit/native-vertex-music.test.js --maxWorkers=2`: 40 passed. ESLint on both files: clean.

## Registration follow-up (not done here)

See `registration.json` → `publicHandlerIntegration`. To register:

1. In `musicGenerationCore`, dispatch `vertex` to `handleVertexMusicGeneration`.
2. In `src/sse/handlers/music.js`, record `result.acceptedJob` with `recordAcceptedJobUsage`, and do not fall back to another connection after an accepted job.
3. Add the `music` service kind and model `lyria-002` to the vertex registry.
4. Update the catalog docs.

The test's staging block is the only part that asserts the unregistered state. Registration promotes it to positive identity assertions.
