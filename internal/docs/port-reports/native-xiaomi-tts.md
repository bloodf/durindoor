# Xiaomi MiMo native TTS (staged), 2026-11-27

Issue: #2034. The inventory row for `xiaomi-mimo` TTS (format `xiaomi-mimo-tts`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts`, `AUDIO_SPEECH_PROVIDERS["xiaomi-mimo"]`: id `xiaomi-mimo`, baseUrl `https://api.xiaomimimo.com/v1/chat/completions`, authType `apikey`, authHeader `bearer`, format `xiaomi-mimo-tts`, supportedFormats `["mp3", "wav"]`, models `mimo-v2.5-tts` (MiMo V2.5 TTS), `mimo-v2.5-tts-voicedesign` (MiMo V2.5 Voice Design) and `mimo-v2.5-tts-voiceclone` (MiMo V2.5 Voice Clone). The registry key is the source key `xiaomi-mimo`; no alias was invented.
- `open-sse/handlers/audioSpeech.ts`, `handleXiaomiMimoSpeech`:
  - Sends one `POST` with `Content-Type: application/json` and `Authorization: Bearer <key>`.
  - The body is `{ model, messages: [{ role: "assistant", content: input }], audio: { format, voice } }`.
  - `format` is the enum `mp3` or `wav` from `normalizeXiaomiMimoRequestFormat`. A missing format becomes `mp3`. Any other format gets a 400 before the upstream call.
  - `voice` is the request voice, else `providerSpecificData.defaultVoice`, else `mimo_default`.
  - An `audio/*` answer is streamed through. A JSON answer is read in the `getXiaomiMimoAudioData` path order, starting at `choices[0].message.audio.data`, then decoded with `atob`.
  - The URL comes from `providerSpecificData.baseUrl`, or from the registry `baseUrl` normalized to `/chat/completions`.
- `tests/unit/audio-speech-handler.test.ts`: pins the exact body, the Bearer header, the `mp3`/`wav` enum (never an IANA media type) and the refusal before any network call.
- `tests/unit/xiaomi-mimo-models-fetch-15307.test.ts`: dynamic discovery is `GET https://api.xiaomimimo.com/v1/models` with the connection key. The live list includes the three TTS IDs alongside chat and ASR models, and the local catalog is the fallback on failure.

## Fresh-main check

I checked the worktree `HEAD` and `origin/main` (`a6cb6dea80`). Neither has the native Xiaomi TTS path.

- `open-sse/providers/registry/xiaomi-mimo.js` is the chat provider. Its fields:
  - id `xiaomi-mimo`, aliases `mimo`, `mimo-desktop` and `xmd`;
  - `authModes: ["oauth", "apikey"]`, where oauth means a Xiaomi account session with `mimoPassToken`;
  - chat transports on `api.xiaomimimo.com`.

  It has no `tts` service kind, no `ttsConfig` and no TTS model row.
- `TTS_ADAPTERS` has no entry for `xiaomi-mimo` or its aliases. `FORMAT_HANDLERS` has no `xiaomi-mimo-tts` handler. `src/shared/constants/ttsProviders.js` and `src/sse/handlers/tts.js` do not mention it.
- `open-sse/providers/registry/xiaomi-tokenplan.js` is a separate provider: `tp-` keys on `token-plan-<region>.xiaomimimo.com`. It lists `mimo-v2.5-tts`, `-voiceclone` and `-voicedesign` with `kind: "tts"`. Those rows are dormant: there is no `ttsConfig` and no adapter, so `handleTtsCore` answers 400 "does not support TTS via this route" before any network call. The staging block pins this. It is not the source `xiaomi-mimo` entry and is not activated here.
- `open-sse/providers/registry/xiaomi-mimo-token-plan.js` is a separate chat-only provider.
- `open-sse/executors/xiaomi-mimo.js` handles chat only. Its account-session route on `mimo-server-<region>` does not serve speech.

There is no local equivalent, so this module is the speech delta. It reuses the existing `xiaomi-mimo` connection's API key and adds no new provider.

## Staged module

`open-sse/services/providerParity/native-xiaomi-tts/`:

- `config.js`: IDs, aliases, auth modes, fixed origin and endpoints, model rows, the speech-model ID pattern, bounds, `XIAOMI_MIMO_TTS_CONFIG` and `XIAOMI_MIMO_TTS_PROVIDER_ADDITIONS`.
- `http.js`: one bounded send, redirect refusal, refusal mapping and accepted-job accounting. It follows the staged Hyperbolic and deAPI speech transport contract.
- `tts.js`: `createXiaomiMimoTtsAdapter`, `buildXiaomiMimoSpeechRequest`, `normalizeXiaomiMimoRequestFormat`, `xiaomiMimoAudioData` and `discoverXiaomiMimoTtsModels`.
- `index.js`: exports, plus the default instance `xiaomiMimoTtsAdapter`.
- `registration.json`: exports, IDs, aliases, models, endpoints, auth, bounds and integration points.

Production code imports none of these files.

## Supported subset

Speech (`POST https://api.xiaomimimo.com/v1/chat/completions`):

- Models: the three source rows. A newer catalog ID matching `^mimo-v<N>(.<N>)*-tts(-<suffix>)?$` (for example `mimo-v2.6-tts`) is also accepted, because discovery can surface it. An empty model selects `mimo-v2.5-tts`.
- The body sent is exactly the source body.
- `response_format`: `mp3`, `mpeg`, `audio/mp3`, `audio/mpeg`, `wav`, `wave`, `audio/wav`, `audio/wave`, the gateway's `json` wrapper (served as mp3), or omitted (mp3). `audio.format` is always the enum.
- Voice: any string from the request, else the connection's `providerSpecificData.defaultVoice`, else `mimo_default`.
- Accepted answers:
  - A bounded JSON envelope whose audio, found in the source path order, is strict base64.
  - A bounded `audio/*` body.
  - Either way, the decoded bytes must match the requested container: ID3 or an MPEG frame for mp3, `RIFF…WAVE` for wav. Decoded audio is capped at 25 MiB.
- On success the adapter returns `{ base64, format, accounting }`. The cost is unknown. Only numeric `*_tokens` usage fields are kept as token counts; cost-looking fields are never read as a receipt. `withTtsUsage` adds input characters.

Discovery (`discoverXiaomiMimoTtsModels`):

- Sends `GET https://api.xiaomimimo.com/v1/models` with the selected key, a 15 s deadline, a 1 MiB cap and redirect refusal.
- Returns only speech IDs, de-duplicated, as `{ models, source: "api" }`.
- On any failure (no key, non-2xx, redirect, invalid JSON, transport error, deadline) it returns the static rows as `{ models, source: "local_catalog", status }`. It never throws and never returns upstream text.

## Refused before submit

Anything the source would silently drop gets a local 400, and nothing is sent:

- a `response_format` outside the list above, including from the query string once `requestedResponseFormat` is passed;
- `stream: true`, or a `stream_format` other than `audio`;
- `speed` other than 1, `instructions`, or a `language` hint;
- a non-string voice, or a `model/voice` suffix;
- any non-speech model (chat, ASR, unknown), empty input, or a body over 256 KiB.

The source honors `providerSpecificData.baseUrl`; this adapter ignores it and sends the key only to `https://api.xiaomimimo.com`.

## Auth and connections

- Only `credentials.apiKey` is used, as `Authorization: Bearer <key>`, matching the source `authType: "apikey"`.
- An account-session (oauth) connection with no `apiKey` gets a 401 without a request. Its `accessToken` and `mimoPassToken` are never sent to the speech API and never appear in results. The existing connection modes are unchanged.
- A missing key or a key containing CR/LF gets a 401 without a request.
- Each request carries the selected connection's key. Its egress policy is forwarded to `proxyAwareFetch`.

## Transport and failures

- Each request is sent once and never retried or replayed. A 120 s deadline covers the request and its body. A caller abort or the deadline aborts the transport signal, and the wait ends even if the transport ignores the signal.
- Redirects are refused (`redirect: "manual"`).
- Refusals keep only the HTTP status and never quote Xiaomi's body:
  - 400, 401, 403, 404 and 422 pass through.
  - 402 marks quota exhausted on this connection only.
  - 429 and 503 keep a bounded `Retry-After`.
  - Any other 5xx is an uncertain job: `acceptedJob` with `submit-unknown` and unknown cost.
- A provably unsent connect failure has no `acceptedJob`. A failure after send, a timeout, a caller abort after send, or a redirect carries `acceptedJob` with `submit-unknown`.
- A 2xx with an error envelope and no audio is a refusal without `acceptedJob`.
- A 2xx without usable audio is a lost result with `acceptedJob` `accepted`. That covers missing or non-base64 audio, a data URL, the wrong container, empty, HTML, invalid JSON, oversized, stalled or aborted bodies.

## Registration (serial step, not done here)

From `registration.json`:

1. `open-sse/providers/registry/xiaomi-mimo.js`: merge `XIAOMI_MIMO_TTS_PROVIDER_ADDITIONS`. Add `serviceKinds: ["llm", "tts"]`, the three rows with `kind: "tts"`, and `ttsConfig`. Keep id, aliases, display, auth modes, regions and chat transports unchanged.
2. `open-sse/handlers/ttsProviders/index.js`: add `xiaomi-mimo: xiaomiMimoTtsAdapter` to `TTS_ADAPTERS`.
3. `src/sse/handlers/tts.js`: add `xiaomi-mimo` to `NAMED_FORMAT_PROVIDERS`. Accepted-job recording already exists there.
4. Optional: `src/app/api/providers/[id]/models/fetchConnectionModels.js` can use `discoverXiaomiMimoTtsModels` for the TTS selector.
5. `docs/providers/catalog.mdx`: list the TTS kind.

Only the staging block in the test file asserts unregistered state, including the dormant `xiaomi-tokenplan` TTS rows. Registration promotes it to positive identity assertions.

## Remaining restrictions

- Voice design and voice clone get the source body only. No design prompt, clone sample or other option is sent, because the source sends none and the live wire names are not pinned.
- mp3 and wav only. No other containers, no transcoding, no streaming.
- No token-plan or regional host. Those belong to the separate token-plan providers.
- The cost is unknown. The source documents no price for this route.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-xiaomi-tts.test.js --maxWorkers=2
```

71 tests passed, all on closed mocks. They cover:

- source-exact headers and body, including the format enum and its aliases;
- voice defaults, every source audio path, and raw `audio/*` answers;
- two connections, and an account session refused without leaking its tokens;
- the ignored base URL override and egress policy forwarding;
- refusals before submit;
- status mapping without leaks, 402 quota, `Retry-After` and uncertain 5xx;
- redirect refusal, and unsent versus sent transport failures;
- abort before and after send, a deadline with a transport that ignores its signal, and a stalled body;
- malformed and unsafe answers, size caps, and token-only usage;
- live discovery and its fallbacks;
- the `handleTtsCore` contract through test-local wiring.

`eslint` on the new files and the anti-slop gate (`scripts/check-anti-slop.mjs`) report nothing.
