# Qwen Cloud Token Plan (DashScope) native TTS (staged), 2026-11-27

Issue: #2034. The inventory row for `qwen-cloud-token-plan` TTS (format `dashscope-tts`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT), read at that commit.

- `open-sse/config/audioRegistry.ts`, `AUDIO_SPEECH_PROVIDERS["qwen-cloud-token-plan"]`: id `qwen-cloud-token-plan`, alias `qct`, baseUrl `https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`, authType `apikey`, authHeader `bearer`, format `dashscope-tts`, supportedFormats `["mp3"]`, one model `qwen-audio-3.0-tts-plus` (Qwen Audio 3.0 TTS Plus).
- `open-sse/handlers/audioSpeech.ts`: format `dashscope-tts` dispatches to `handleDashscopeTtsSpeech`.
- `open-sse/executors/dashscopeTts.ts`, `handleDashscopeTtsSpeech`:
  - Sends one `POST` with `Content-Type: application/json` and `Authorization: Bearer <key>`.
  - The body is `{ model, input: { text, voice }, parameters: { format: "mp3", sample_rate: 24000 } }`.
  - `voice` is the trimmed request voice, else `longanlingxin` (`DASHSCOPE_TTS_DEFAULT_VOICE`).
  - A JSON `code` is an error (502) even with HTTP 200.
  - `output.audio.data` (base64) wins. Otherwise `output.audio.url` is downloaded through `fetchRemoteMedia` (public-only guard, pinned DNS, 50 MiB cap). The answer is `audio/mpeg`.
  - The URL comes from `resolveAlibabaProviderMediaBaseUrl` (`src/shared/constants/alibabaProviderRegions.ts`): a custom `providerSpecificData.baseUrl` wins, otherwise `providerSpecificData.region` selects the Singapore or Beijing token-plan host.
- `AUDIO_TRANSCRIPTION_PROVIDERS` has no `qwen-cloud-token-plan` entry. The inventory STT row repeats the speech endpoint and is not a transcription contract, so no STT is staged.

## Fresh-main check

- `open-sse/providers/registry/qwen-cloud-token-plan.js` is the existing chat identity: id `qwen-cloud-token-plan`, alias `qct`, `authType: "apikey"`, chat on `token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`, `serviceKinds: ["llm"]`. It has no `ttsConfig` and no TTS model row, and it has no region selector.
- `TTS_ADAPTERS` has no `qwen-cloud-token-plan` or `qct` entry. `FORMAT_HANDLERS` has no `dashscope-tts` handler.
- The integrated Alibaba video work (`open-sse/services/alibabaVideo/**`, `handlers/videoProviders/alibaba.js`) serves the `alibaba` identity on the `dashscope-intl` / `dashscope` hosts, video only. This unit reuses `alibabaVideoResultUrl` (https, no userinfo, public literal host) read-only and changes nothing there.
- Other Alibaba-family identities stay separate and have no source speech row: `alitp-intl` (Alibaba Token Plan, same host, chat only), `qwencloud` (aliases `qc`, `qctp`, `token-plan.maas.qwencloudapi.com`), `qwen-cloud`, `alibaba`, `alibaba-cn`, `alicode*`, `bailian-coding-plan`. No host, alias or key is shared or substituted.

There is no local equivalent, so this module is the speech delta for the one existing identity.

## Staged module

`open-sse/services/providerParity/native-dashscope-tts/`:

- `config.js`: identity, alias, fixed origin and URL, model row, default voice, sample rate, region aliases, bounds, `DASHSCOPE_TTS_CONFIG` and `DASHSCOPE_TTS_PROVIDER_ADDITIONS`.
- `http.js`: one bounded send, redirect refusal, refusal mapping with safe vendor codes, and accepted-job accounting. It follows the staged Xiaomi MiMo speech transport contract.
- `tts.js`: `createDashscopeTtsAdapter`, `buildDashscopeTtsRequest`, `normalizeDashscopeTtsFormat`, `dashscopeTtsRegionSupported`, `downloadDashscopeTtsAudio` and `dashscopeTtsAccounting`.
- `index.js`: exports, plus the default instance `dashscopeTtsAdapter`.
- `registration.json`: exports, identity, model, endpoints, auth, bounds and integration points for the serial registration step.

Production code imports none of these files.

## Supported subset

- Model: `qwen-audio-3.0-tts-plus` only. An empty model selects it.
- The body sent is exactly the source body.
- `response_format`: `mp3`, `mpeg`, `audio/mp3`, `audio/mpeg`, the gateway's `json` wrapper (served as mp3), or omitted.
- Voice: any string from the request (trimmed), else `longanlingxin`.
- Host: the registry's Singapore SpeechSynthesizer URL only. A connection with no region or a Singapore alias (`global-sg`, `global`, `international`, `singapore`, `ap-southeast-1`) is accepted.
- Answers: inline audio must be strict base64. A result URL must be https on a public literal host. It is fetched with no credential, `Accept: audio/*` only, no redirects, the public-only URL and connection-time DNS guards, a 60 s deadline and the source 50 MiB cap. The bytes must start like an mp3 file.
- Usage: numeric `*_tokens` fields become token counts, and a reported non-negative integer `usage.characters` becomes `nativeUnits.characters`. That value replaces the core's local input count once; it is not added to it. Cost stays unknown, and cost-looking fields are never read as a receipt.

## Refused before submit

Each of these gets a local 400 (401 for the key), and nothing is sent:

- a `response_format` other than the list above, including from the query string once `requestedResponseFormat` is passed;
- `stream: true`, or a `stream_format` other than `audio`;
- `speed` other than 1, `instructions`, or a `language` hint;
- a non-string voice, a `model/voice` suffix, any other model, empty input, or a body over 256 KiB;
- a missing API key, a key with CR/LF, or a connection with only an access token;
- on the pinned instance, a connection whose `providerSpecificData.region` names another region. The regional instance serves the Beijing Token Plan host as well (see Regional parity) and refuses only unknown regions and custom base URLs.

The source honors `providerSpecificData.baseUrl`. The pinned instance ignores it and sends the key only to the fixed URL. The regional instance refuses a non-preset base URL before submit.

## Failures and accounting

- Non-2xx: only the status and a vendor code of a safe shape are kept; DashScope's message is never quoted.
  - 401/403 are key refusals.
  - `Arrearage` / `AccessDenied.Unpurchased` on 400/403, and 402, become 402 with `quotaExhausted` on this connection only.
  - 429/503 keep a bounded `Retry-After`.
  - Other 5xx are 502 with `acceptedJob` (`submit-unknown`).
- HTTP 200 with `code` is a refusal (502, or 402 `quotaExhausted` for the unpaid codes), with no accepted job, as in the source.
- A redirect, a failure after send, a deadline, or a caller abort after send each carry `acceptedJob` (`submit-unknown`). A provably unsent connect failure and an abort before send do not.
- After a 2xx, every failure to deliver audio carries `acceptedJob` (`accepted`). That covers a stalled or oversized body, invalid JSON, missing, non-base64 or non-mp3 audio, an unsafe URL, and a failed, redirected, non-audio, oversized or timed-out download. Nothing is ever resent.
- Every fetch is bounded by the caller's signal and a deadline, including when the transport ignores its signal.

## Tests

`tests/unit/native-dashscope-tts.test.js` uses closed mocks only, with injected API and download transports and synthetic keys. The isolated staging block is the only one that asserts unregistered state; registration promotes it to positive identity assertions. Other blocks cover:

- the exact URL, auth and body, and the defaults;
- inline and URL audio, and the download guards;
- two overlapping credentials kept isolated;
- base URL and region handling;
- every pre-submit refusal;
- status, vendor-code and quota mapping;
- unsent versus uncertain sends, abort and deadline for the send, the body and the download;
- accepted-job outcomes for each lost result, with no replay;
- usage counted once, with no leak of keys, upstream text or signed URLs;
- test-local `handleTtsCore` wiring.

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-dashscope-tts.test.js --maxWorkers=2
```

## Regional parity

The map is `native-dashscope-image/regions.js`. It is a finite, literal map from (identity, region) to origin. The image, video and speech adapters all use it. It ports `src/shared/constants/alibabaProviderRegions.ts` at `c71f0065`, including `ALIBABA_PROVIDER_REGION_VALUES`, `normalizeAlibabaProviderRegion`, the chat presets (`ALIBABA_PROVIDER_ENDPOINTS` and `LEGACY_FAMILY_PRESETS`), and `resolveAlibabaProviderMediaBaseUrl` with `ALIBABA_PROVIDER_MEDIA_OVERRIDES`.

| Identity | global-sg | china-beijing |
| --- | --- | --- |
| `alibaba`, `qwen-cloud` | `dashscope-intl.aliyuncs.com` | `dashscope.aliyuncs.com` |
| `qwen-cloud-token-plan` | `token-plan.ap-southeast-1.maas.aliyuncs.com` | `token-plan.cn-beijing.maas.aliyuncs.com` |
| `bailian-coding-plan` (media override) | `coding-intl.dashscope.aliyuncs.com` | `coding.dashscope.aliyuncs.com` |

- The region comes from the selected connection's `providerSpecificData.region`. An unset or blank value means `global-sg`, which is the source default. The source spellings are case-insensitive. The origin comes only from the adapter's own identity and that region. Neither the caller nor the connection can supply a URL.
- A saved source chat preset in `providerSpecificData.baseUrl` counts as unset, as in the source `isFamilyPresetUrl`. This includes current and retired presets for the same identity. The region still decides the host.
- Explicit refusals, each a 400 before any network call:
  - an unrecognized or non-string region, where the source silently falls back to global-sg and could send the key to a region the owner did not choose;
  - a custom, non-preset base URL, including another identity's preset, where the source sends the key to it;
  - any identity outside the map (`alibaba-cn` and the other Alibaba-family ids are separate identities).
- After the send, redirects are refused, and an answer whose URL names another origin is an unknown outcome carrying `acceptedJob`. It is never resent. Success accounting records `meta.region`.
- The pinned default instances and factories keep their first contract: global-sg only. The existing native suites still assert that contract. The regional instances are separate exports, opted in with `regional: true`, and `registration.json` wires those for registration. Nothing is registered here.

Speech uses `qwen-cloud-token-plan` only: `https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer` and `https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer`. The source speech handler reads no caller timeout option, so the gateway bounds apply unchanged. Registration wires `dashscopeRegionalTtsAdapter` into `TTS_ADAPTERS`.

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/native-dashscope-region-parity.test.js unit/native-dashscope-image.test.js unit/native-dashscope-video.test.js unit/native-dashscope-tts.test.js --maxWorkers=2
```

`tests/unit/native-dashscope-region-parity.test.js` covers these cases with closed mocks: the exact origin, auth and envelope for each identity and region; alias and model handling; unsupported regions and base URLs refused before the network; redirect and other-origin refusal; two-account isolation across regions; quota; accepted jobs with no replay; and cancellation and deadlines. No live account or provider was called.
