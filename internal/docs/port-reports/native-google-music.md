# Native Google music (Gemini API Lyria 3): staged port report

Issue: #2034. Source: OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (read-only checkout; `git rev-parse HEAD` verified).

- `open-sse/config/musicRegistry.ts`: registry key `gemini` (no alias), `baseUrl: "https://generativelanguage.googleapis.com/v1beta/models"`, `authType: "apikey"`, `authHeader: "x-goog-api-key"`, `format: "gemini-lyria"`, models `lyria-3-pro-preview`, `lyria-3-clip-preview`, `lyria-3.5`.
- `open-sse/handlers/musicGeneration.ts`: the `gemini-lyria` branch dispatches to `handleGeminiMusicGeneration`.
- `open-sse/handlers/mediaGeneration/geminiMusic.ts`: the wire contract (headers, body, response normalization).
- `open-sse/executors/vertexMedia.ts`: `extractInlineAudio` (first `candidates[0].content.parts[].inlineData` with data).
- `src/lib/providerModels/geminiModelsParser.ts`: a `lyria-*` model listing `generateContent` is classified as music, not chat.

## Gap check (branch HEAD `62e754ad13`, includes `origin/main` `a6cb6dea80`)

- `open-sse/handlers/musicGenerationCore.js` dispatches MiniMax, Vertex Lyria 2 (`native-vertex-music`), fal, and the Suno/Udio cookie adapters. Nothing dispatches `gemini`.
- `open-sse/providers/registry/gemini.js` has `serviceKinds` without `music`, no `lyria-*` model and no `musicConfig`.
- `rg 'lyria|gemini-lyria'` outside tests finds only Vertex `lyria-002`. That path is `:predict` returning `predictions[].bytesBase64Encoded`. It is a different endpoint, host, auth (Vertex SA/ADC/Express) and envelope, so it is not an equivalent.
- Gemini TTS/STT (`ttsConfig`, `sttConfig`) use `generateContent` on the same host but with a speech request and a PCM reply. They do not accept music prompts and are not equivalents either.
- The local `gemini` model discovery (`src/app/api/providers/[id]/models/modelsConfig.js`) lists every model with no Lyria-to-music rule.

The native music contract is a real delta.

## Staged files

- `open-sse/services/providerParity/native-google-music/config.js`: identity, the pinned registry entry, and mime/format maps.
- `open-sse/services/providerParity/native-google-music/transport.js`: auth headers, deadline race, bounded reads, Google status label.
- `open-sse/services/providerParity/native-google-music/discovery.js`: static list, `models.list` parser and paged discovery.
- `open-sse/services/providerParity/native-google-music/index.js`: request validation and the generate handler. Nothing in production imports it.
- `open-sse/services/providerParity/native-google-music/registration.json`: exports, identity, endpoints, connection modes and integration points.
- `tests/unit/native-google-music.test.js`: 49 closed-network contract tests.

## Wire contract

| Connection mode | Credential | Header |
| --- | --- | --- |
| API key | `credentials.apiKey` (trimmed) | `x-goog-api-key: <key>` |
| OAuth | `credentials.accessToken` | `Authorization: Bearer <token>` |

The API key wins when both are present, as in the source. Headers are exactly `Content-Type: application/json` plus the auth header.

- **Generate:** `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`. The origin is fixed; there is no base URL override.
- **Body:** `{ contents: [{ role: "user", parts: [{ text: <trimmed prompt> }] }] }`. No `generationConfig` is sent, as in the source (pinning an audio modality makes the model answer with text).
- **Reply:** the first inline part with data is the track. Text parts (`<instrumental>`, `[[A0]]`) are dropped, as in the source.
- **Output:** `{ object: "music.generation", created, provider: "gemini", model, status: "completed", data: [{ b64_json, format, mime_type, duration_seconds? }] }`. `duration_seconds` is present only for WAV, where it is measured from the data chunk. The upstream body is never echoed.
- **Discovery:** `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000[&pageToken=…]`. It keeps `lyria-*` ids that list `generateContent`. The key goes in `x-goog-api-key` (the local generic discovery puts it in `?key=`; this adapter keeps it out of URLs). OAuth uses Bearer.

## Supported subset and restrictions

- **Models:** the three pinned ids, plus ids the caller passes in `models` from `discoverGeminiMusicModels` for the same connection. Every id must match `^lyria-[a-z0-9][a-z0-9.-]{0,62}$`. `lyria-002` (Vertex only), chat models and empty ids return 400 before any request.
- **Accepted fields:** `model`, `prompt` (required, at most 32 000 characters after trimming), `response_format` (`b64_json` only), `stream` (`false` only), `user`.
- **Rejected fields:** anything else returns 400, including `negative_prompt`, `lyrics`, `duration`, `seed`, `sample_count`, `output_format` and `audio_url`. The source drops them silently. The gateway rejects them because the Gemini API Lyria contract has no field for them and they would be silently ignored.
- **Output containers:** only the source mime map (`audio/mpeg|mp3`, `audio/wav|x-wav|wave`, `audio/ogg`, `audio/flac`, `audio/aac`, `audio/mp4`, `audio/webm`). Decoded bytes must start with the matching container signature.
- **Source deviation, mime type:** the source defaults a missing mime type to `audio/L16;rate=24000` and an unknown one to `mp3`. That would label raw PCM or arbitrary bytes as MP3, so both are rejected as malformed here.
- **Not supported:** streaming, jobs, polling and a GET lifecycle. The call is synchronous. `musicGenerationCore` must reject a `requestId` for this provider.
- **Lyria RealTime:** `lyria-realtime-*` (`bidiGenerateContent` WebSocket) is not part of the pinned source contract and is excluded. Discovery ignores it.

## Safety, accounting and failure semantics

- **Deadlines:** total deadline 300 s by default, capped at 600 s. Discovery defaults to 30 s, capped at 120 s. The caller signal and the deadline are combined, passed to fetch and raced, so a hung socket or a stalled body read is cut off. Readers are cancelled on abort.
- **Bodies:** success bodies are capped at 64 MiB, error bodies at 16 KiB, discovery pages at 4 MiB, and discovery at 10 pages.
- **Redirects:** `redirect: "manual"`. Any 3xx is refused and not followed. Generated URLs are checked against the fixed origin.
- **Submits:** exactly one per call; never retried.
  - Network error, abort or deadline after dispatch: `outcome_unknown` (502, 499 or 504) with `acceptedJob`.
  - Non-503 5xx: `outcome_unknown` with `acceptedJob`.
  - 400/401/403/404/429/503 are refusals with no `acceptedJob`. 429 and 503 carry `resetsAtMs` from `Retry-After`. Other 4xx become 502.
  - A 2xx that is unreadable, malformed or blocked is an accepted job: `accepted_unreadable`, `accepted_malformed`, or `accepted_blocked` (400 carrying only the `blockReason`/`finishReason` enum).
- **Errors:** messages carry only the HTTP status and the Google `error.status` enum. `createErrorResult` also redacts the selected connection's credential values.
- **Accounting:** `mediaAccounting(parsed, "gemini", "music")` keeps `usageMetadata` tokens and leaves the cost unknown. `acceptedJob` is the same shape with `costSource: "accepted-job"`, its `jobState`, and tokens when a 2xx reported them. MP3/OGG/etc. duration is not guessed; only WAV sets `nativeUnits.audioSeconds`.
- **Connection identity:** `connectionId` is returned on every result. Proxy options come from `resolveCredentialProxyOptions(credentials)` for the selected connection. The existing gemini API-key and OAuth modes are unchanged; token refresh stays in the public handler's existing credential path.

## Registration (serial step, not done here)

See `registration.json` → `publicHandlerIntegration`:

1. In `musicGenerationCore.js`, dispatch `isGeminiMusicProvider(provider)` to `handleGeminiMusicGeneration` and reject `requestId`.
2. `src/sse/handlers/music.js` needs no change. Its `acceptedJob` branch already records unknown-cost usage and refuses fallback.
3. Add `music` to `serviceKinds` in `providers/registry/gemini.js`, add the three Lyria models with `kind: "music"`, and add `musicConfig`.
4. Classify Lyria as music in the gemini `modelsConfig.js` discovery (`parseGeminiMusicModels`).
5. Add music to the Gemini row in `docs/providers/catalog.mdx`.

Only the staging `describe` block in the test asserts the unregistered state. Registration promotes it to positive identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-google-music.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 49 passed (49)
npx eslint open-sse/services/providerParity/native-google-music tests/unit/native-google-music.test.js  # exit 0
```
