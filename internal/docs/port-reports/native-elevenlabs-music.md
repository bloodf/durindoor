# Native ElevenLabs music (Eleven Music): staged port report

Issue: #2034. Source: OmniRoute `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (read-only checkout; `git rev-parse HEAD` verified).

- `open-sse/config/musicRegistry.ts`: registry key `elevenlabs` (no alias), `baseUrl: "https://api.elevenlabs.io/v1/music"`, `authType: "apikey"`, `authHeader: "xi-api-key"`, `format: "elevenlabs-music"`, models `music_v1`, `music_v2`, `music_v2_5`.
- `open-sse/handlers/musicGeneration.ts`: the `elevenlabs-music` branch dispatches to `handleElevenLabsMusicGeneration({ model, body, credentials })`.
- `open-sse/handlers/mediaGeneration/elevenLabsMusic.ts`: the wire contract (field mapping, headers, binary reply normalization).
- `open-sse/handlers/mediaGeneration/elevenLabsSchemas.ts`: `elevenLabsMusicSchema` limits.

## Gap check (branch HEAD `7fec87b11c`)

- `open-sse/handlers/musicGenerationCore.js` dispatches MiniMax, Vertex Lyria 2, fal, and the Suno/Udio cookie adapters (`MUSIC_ADAPTERS`). Nothing dispatches `elevenlabs` or `el`.
- `open-sse/providers/registry/elevenlabs.js` has `serviceKinds: ["tts"]`, a `ttsConfig` for `/v1/text-to-speech`, and no `musicConfig`.
- `rg -i 'v1/music|music_v1|elevenlabs-music' open-sse src` finds only the generic `/v1/music/generations` route constants and MiniMax `/v1/music_generation` entries. Nothing targets `api.elevenlabs.io/v1/music`, and `src/sse/handlers/nativeProviderConfig.js` has no ElevenLabs passthrough.
- ElevenLabs TTS (`open-sse/handlers/ttsProviders/elevenlabs.js`) uses the same host and `xi-api-key` header, but its endpoint is `/v1/text-to-speech/{voice}` with a `{ text, model_id }` body. It does not accept music prompts, so it is not an equivalent.

The native music contract is a real delta.

## Staged files

- `open-sse/services/providerParity/native-elevenlabs-music/config.js`: identity, the pinned registry entry, the content-type map, schema limits and the `output_format` pattern.
- `open-sse/services/providerParity/native-elevenlabs-music/transport.js`: auth header, deadline race, bounded byte reads, the `detail.status` label and `Retry-After`.
- `open-sse/services/providerParity/native-elevenlabs-music/index.js`: request validation, the generate handler and the static model list. Nothing in production imports it.
- `open-sse/services/providerParity/native-elevenlabs-music/registration.json`: exports, identity, endpoints, connection modes and integration points.
- `tests/unit/native-elevenlabs-music.test.js`: 54 closed-network contract tests.

## Wire contract

| Connection mode | Credential | Header |
| --- | --- | --- |
| API key (existing local mode) | `credentials.apiKey` (trimmed) | `xi-api-key: <key>` |
| Source fallback | `credentials.accessToken`, only when there is no API key | `xi-api-key: <token>` |

Headers are exactly `Content-Type: application/json` plus `xi-api-key`. No `Authorization` header is sent. No OAuth flow is added.

- **Generate:** `POST https://api.elevenlabs.io/v1/music?output_format=<format>`. The default format is `mp3_44100_128`. The origin is fixed and has no base URL override. `output_format` is the only query parameter.
- **Body:** this follows the source `buildNativeMusicBody`:
  - `model_id` comes from the model.
  - `music_length_ms` uses `music_length_ms`, or `duration * 1000` when it is absent.
  - `force_instrumental` uses `force_instrumental`, or `instrumental` when it is absent.
  - The source native fields `prompt`, `composition_plan`, `seed`, `finetune_id`, `respect_sections_durations`, `store_for_inpainting` and `sign_with_c2pa` are copied when defined.
  - Undefined keys are dropped.
- **Reply:** raw audio bytes. The format comes from the source content-type map (`audio/mpeg|mp3`, `audio/wav|x-wav`, `audio/pcm`, `audio/ogg`, `audio/flac`). Otherwise it is the codec prefix of the requested `output_format`, as in the source.
- **Output:** `{ object: "music.generation", created, provider: "elevenlabs", model, status: "completed", data: [{ b64_json, format, mime_type, duration_seconds? }] }`. `duration_seconds` is present only for WAV, where it is measured from the data chunk.
- **Discovery:** the source has no ElevenLabs music model discovery. The local `fetchElevenLabsModels` keeps only `can_do_text_to_speech` models. `listElevenLabsMusicModels()` returns the pinned static list and nothing is invented.

## Supported subset and restrictions

- **Models:** only `music_v1`, `music_v2` and `music_v2_5`. Any other id returns 400 before any request.
- **Provider ids:** `elevenlabs` (source key) and `el` (the existing local registry alias for the same connection).
- **Accepted fields:** `model`, the source native fields above, `music_length_ms`, `duration`, `force_instrumental`, `instrumental`, `output_format`, `response_format` (`b64_json` only), `stream` (`false` only), and `user`. Any other field returns 400. The source drops unknown fields silently.
- **Schema checks (source):**
  - Exactly one of `prompt` and `composition_plan` is required.
  - `prompt` is at most 4100 characters.
  - `music_length_ms` is an integer from 3000 to 600000. This applies after the `duration` mapping.
  - `seed` is an integer from 0 to 2147483647.
  - `force_instrumental` and `respect_sections_durations` are booleans.
- **Local hardening:**
  - A whitespace-only `prompt` is rejected.
  - `composition_plan` must be a plain object of at most 256 KiB.
  - `store_for_inpainting` and `sign_with_c2pa` must be booleans.
  - `finetune_id` must be a non-empty string.
  - `duration` must be a number.
- **`output_format`:** must match `^(mp3|pcm|ulaw|alaw|opus|wav)_\d{4,5}(?:_\d{2,3})?$`. The source forwards any string. Restricting it keeps the reported container from being guessed from an arbitrary prefix and keeps the query free of injected parameters.
- **Containers:** `mp3`, `wav`, `ogg`, `opus` and `flac` bytes must start with the matching signature. `pcm`, `ulaw` and `alaw` are raw and only need to be non-empty.
- **Not supported:**
  - Streaming. The source also rejects `stream: true` here.
  - Jobs, polling, and the GET lifecycle; the call is synchronous, so `musicGenerationCore` must reject a `requestId` for this provider.
  - The source's native passthrough routes `/v1/music`, `/v1/music/stream`, `/v1/music/plan` and `/v1/sound-generation` (`src/app/api/v1/music/*`). They are a separate source feature and are not part of the registry entry.

## Safety, accounting and failure semantics

- **Deadlines:** total deadline is 300 s by default, capped at 900 s. Tracks can be up to 10 minutes long. The caller signal and the deadline are combined, passed to fetch and raced. A hung socket or a stalled body read is cut off, and readers are cancelled on abort.
- **Bodies:** audio is capped at 128 MiB and error bodies at 16 KiB.
- **Redirects:** `redirect: "manual"`. Any 3xx is refused and not followed.
- **Submits:** exactly one per call; never retried.
  - Network error, abort or deadline after dispatch: `outcome_unknown` (502, 499 or 504) with `acceptedJob`.
  - Every 5xx, including 503: `outcome_unknown` with `acceptedJob`. ElevenLabs publishes no contract that a 5xx is not billed, unlike the Gemini case in `native-audio-503-contract.md`.
  - 400/401/402/403/404/409/422/429 are refusals with no `acceptedJob`. This keeps the source's 402 paid-plan and 429 quota status pass-through. 429 carries `resetsAtMs` from `Retry-After`. Other 4xx become 502.
  - A 2xx that is non-audio, empty, oversized, signature-mismatched or unreadable is an accepted job: `accepted_malformed` or `accepted_unreadable`. The source returned a plain 502 here.
- **Errors:** messages carry only the HTTP status and the ElevenLabs `detail.status` slug (`^[a-z][a-z0-9_]{0,63}$`). `createErrorResult` also redacts the selected connection's credential values.
  - **Source deviation:** the source surfaced `detail.message`, a free-text upstream body field. It is not echoed here.
- **Accounting:** `mediaAccounting(null, "elevenlabs", "music")` reports unknown cost; ElevenLabs returns no usage receipt in the music reply. `meta` records `clips`, `audioBytes`, `outputFormat` and `requestedMusicLengthMs`. Only WAV sets `nativeUnits.audioSeconds`; no duration is guessed for other formats. `acceptedJob` has the same shape with `costSource: "accepted-job"` and its `jobState`.
- **Connection identity:** `connectionId` is returned on every result. Proxy options come from `resolveCredentialProxyOptions(credentials)` for the selected connection. The existing elevenlabs API-key connection mode is unchanged.

## Registration (serial step, not done here)

See `registration.json` → `publicHandlerIntegration`:

1. In `musicGenerationCore.js`, dispatch `isElevenLabsMusicProvider(provider)` to `handleElevenLabsMusicGeneration` and reject `requestId`.
2. `src/sse/handlers/music.js` needs no change. Its `acceptedJob` branch already records unknown-cost usage and refuses fallback.
3. In `providers/registry/elevenlabs.js`, add `music` to `serviceKinds` and add a `musicConfig` with the three models.
4. Add music to the ElevenLabs row in `docs/providers/catalog.mdx`.

Only the staging `describe` block in the test asserts the unregistered state. Registration promotes it to positive identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-elevenlabs-music.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 54 passed (54)
npx eslint open-sse/services/providerParity/native-elevenlabs-music tests/unit/native-elevenlabs-music.test.js  # exit 0
```
