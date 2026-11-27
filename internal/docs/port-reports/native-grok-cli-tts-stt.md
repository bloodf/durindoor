# Grok CLI native TTS and STT (staged), 2026-11-27

Issue: #2034. The inventory rows for `grok-cli` TTS (`TTS_ADAPTERS`/`ttsConfig`) and STT (`sttConfig`) were MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts` has two `grok-cli` entries:
  - Speech: `id: "grok-cli"`, `baseUrl: "https://api.x.ai/v1/tts"`, `authType: "oauth"`, `authHeader: "bearer"`, `format: "grok-tts"`, model `grok-tts`.
  - Transcription: `id: "grok-cli"`, `baseUrl: "https://api.x.ai/v1/stt"`, `authType: "oauth"`, `authHeader: "bearer"`, `format: "grok-stt"`, model `grok-voice-transcribe-2.0`.
- `open-sse/handlers/audioSpeech.ts` routes `format === "grok-tts"` to `handleGrokSpeech`. `open-sse/handlers/audioTranscription.ts` routes `format === "grok-stt"` to `handleGrokTranscription`.
- `open-sse/handlers/grokMedia.ts`:
  - `getGrokMediaToken` takes only `accessToken`, so an API-key-only connection gets 401. It renews the token through a registered refresher and refuses an expired or unparseable `expiresAt` with 401.
  - `grokMediaHeaders` sends `getGrokBuildClientHeaders()` (`x-grok-client-version`, `x-grok-client-identifier: grok-shell`, `x-grok-client-mode: headless`, `User-Agent: grok-shell/<v> (<os>; <arch>)`), plus `X-XAI-Token-Auth: xai-grok-cli` and `Authorization: Bearer <token>`.
  - `handleGrokSpeech` and `buildGrokSpeechPayload` build `{ text, voice_id: voice_id ?? voice ?? "eve", language: language ?? "auto", output_format: { ...native, codec }, speed? }`. The codec comes from `response_format`, then `output_format.codec`, then `mp3`, and must be one of `mp3`, `wav`, `pcm`, `mulaw` or `alaw`. Speed must be a finite number from 0.7 to 1.5. The handler uses a 120 s timeout and `redirect: "error"`, then streams the upstream bytes.
  - `handleGrokTranscription` accepts `response_format` `json`, `verbose_json` or `text`, which is not forwarded. The multipart body has `model`, then the string values of `language`, `diarize`, `multichannel`, `channels`, `sample_rate`, `audio_format`, `format` and `filler_words`, then the file last. It uses a 300 s timeout and `redirect: "error"`. The answer needs a string `text`: `text` returns it as plain text, and the other formats return the native JSON.
- `open-sse/utils/audioMultipart.ts` `getUploadedFileName` relabels `.opus` as `.ogg` and names an unnamed upload `audio.wav`.
- `tests/unit/grok-oauth-media.test.ts` and `docs/providers/grok-cli-media.md` confirm the wire shapes and that voice uses `api.x.ai`, not the CLI chat proxy.

The issue's inventory has a second STT row showing `grok-tts` on `/v1/tts`. That row is a copy error: the pinned STT entry is `grok-stt` on `https://api.x.ai/v1/stt`.

The source has no dynamic discovery for Grok voice models. The list is static.

## Fresh-main check

Checked `HEAD` (`67e313ef41`) and `origin/main` (`fdbb72865a`).

- `open-sse/providers/registry/grok-cli.js` exists with alias `gb`, aliases `gcli` and `grok-build`, and `authModes: ["oauth"]`. It serves device-code OAuth chat on `cli-chat-proxy.grok.com`. It has no `serviceKinds`, `ttsConfig` or `sttConfig`.
- `open-sse/providers/registry/xai.js` has `ttsConfig` (`xai-tts`) and `sttConfig` (`xai-stt`) on the same `api.x.ai/v1/tts` and `/v1/stt` URLs, but with `authType: "apikey"`. These are not equivalent to the source `grok-cli` paths:
  - `xaiTts` (`ttsProviders/genericFormats.js`) sends `Bearer <apiKey>` only. It does not send `X-XAI-Token-Auth` or the Grok client identity, and it requires `language` with no `auto` default. It does not validate the codec or speed.
  - `transcribeNativeSpeech` (`sttCore.js`, `xai-stt`) forwards every form field. It is reachable only through the `xai` provider's API-key connections.
  - The `grok-cli` OAuth connection pool never reaches either path.
- `open-sse/handlers/ttsProviders/index.js` `TTS_ADAPTERS` and `handleSttCore` have no `grok-cli`, `grok-tts` or `grok-stt` path.
- `src/sse/handlers/tts.js` refreshes only `renderhour` before dispatch. `src/sse/handlers/stt.js` refreshes only `codex`.
- `open-sse/handlers/videoCore.js` has no `grok-cli` job dispatch. The source's `grok-cli` video entry belongs to a separate video delta, not these TTS/STT rows, so it is not staged here.

The `xai` API-key voice path is a separate mode and stays unchanged. The `grok-cli` OAuth voice path is missing, so the staged module is the whole delta.

## Staged module

`open-sse/services/providerParity/native-grok-cli-tts-stt/`:

- `config.js`: IDs and aliases, the fixed origin and endpoints, the source models and codecs, the transcription options, bounds, `grokVoiceHeaders`, and `GROK_CLI_TTS_CONFIG`/`GROK_CLI_STT_CONFIG` (staged configs for the existing registry entry).
- `http.js`: OAuth-only token selection (`grokOAuthToken`), one bounded send, redirect refusal, refusal mapping and accepted-job accounting. It has the same contract as the staged deAPI and OpenRouter audio transports.
- `tts.js`: `createGrokCliTtsAdapter`, `buildGrokSpeechRequest` and `matchesGrokCodec`. It follows the `synthesize(text, model, credentials, responseFormat, options)` contract and returns `{ base64, format, accounting }`.
- `stt.js`: `createGrokCliSttAdapter`, `buildGrokTranscriptionRequest` and `grokUploadFileName`. It follows the `transcribe({ model, formData, credentials, kind, signal })` contract.
- `index.js`: the exports plus the default instances `grokCliTtsAdapter` and `grokCliSttAdapter`.
- `registration.json`: the exports, IDs, aliases, models, endpoints, auth, bounds and integration points.

Production code imports none of these files.

## Supported subset

Headers on both routes:

- `x-grok-client-version: <GROK_CLI_VERSION>`
- `x-grok-client-identifier: grok-shell`
- `x-grok-client-mode: headless`
- `User-Agent: <GROK_CLI_SHELL_USER_AGENT>`
- `X-XAI-Token-Auth: xai-grok-cli`
- `Authorization: Bearer <OAuth access token>`

The client version and user agent come from the fork's pinned Grok CLI identity in `open-sse/config/grokCli.js` (`1.0.44`, `linux; x86_64`). The existing `grok-cli` executor already sends this identity. The source default is `1.0.41` with a runtime platform string. The header names and the token-auth value match the source.

Speech (`POST https://api.x.ai/v1/tts`, `Content-Type: application/json`):

- Only the model `grok-tts`. It is a routing ID and is not sent upstream.
- The body is the source body exactly: `text`, `voice_id` (`voice_id`, then `voice`, then `eve`), `language` (default `auto`; the route's empty string counts as missing), `output_format { ...native, codec }`, and `speed` when given.
- Codecs are `mp3`, `wav`, `pcm`, `mulaw` and `alaw`. `response_format` takes precedence over `output_format.codec`.
- Speed must be a finite number from 0.7 to 1.5.
- The gateway's `?response_format=json` wrapper is applied by `ttsCore` around `{ base64, format }`.

Transcription (`POST https://api.x.ai/v1/stt`, multipart, with the boundary set by fetch):

- Only the model `grok-voice-transcribe-2.0`, sent as the first `model` field.
- The source options follow in source order, then `file` last. `.opus` is relabelled `.ogg`, and an unnamed upload is named `audio.wav`.
- `response_format` can be `json` (the default), `verbose_json` or `text`. It is not forwarded, as in the source.
- JSON answers pass the native object through unchanged, including words and duration. `text` returns `text/plain`.
- Audio seconds come from `duration`. A `usage` object is kept as provider usage but never read as USD.

Accounting: on both routes, success and accepted-job accounting use `cost: null` and `costStatus: "unknown"`. Speech characters are counted by `ttsCore`.

## Deviations and restrictions

- **OAuth only.** An `apiKey` is never used in place of the access token, which matches the source. A missing token, a token containing CR/LF, or an expired or unparseable `expiresAt` gets 401 before any send.
- **Token renewal.** The adapter does not renew tokens. The source renews inside the media handler. Here the route refreshes the selected connection before dispatch (see the integration points), so the adapter never writes credentials.
- **Fixed origin.** The token goes only to `https://api.x.ai`. Connection base URLs are ignored. Requests go through `proxyAwareFetch` with the selected connection's proxy options.
- **One request, no retry or replay.** Redirects are refused (`redirect: "manual"`, and a 3xx response is classified as unknown). The source uses `redirect: "error"`.
- **Deadlines and cancellation.**
  - The deadlines match the source: 120 s for speech and 300 s for transcription. Each deadline covers the body read too.
  - The adapter stops waiting even when the transport ignores its signal.
  - The caller's signal aborts both the send and the body read.
  - The source streams speech bytes without bounding the body. Here audio is read in full, up to 50 MiB, within the deadline.
- **Speech refusals before submit** (`local: true`, nothing sent):
  - Unknown models, codecs other than the five listed (including `opus` and `json` as the codec), and speeds outside 0.7 to 1.5 or given as non-numbers.
  - Streaming (`stream: true` or a non-`audio` `stream_format`).
  - An `output_format` that is not an object. The source silently ignores arrays.
  - `output_format` keys other than `codec`, `sample_rate` and `bit_rate`, or non-positive-integer rates.
  - A voice or language that is not a string, contains CR/LF, or is longer than 128 characters.
  - A request body over 256 KiB.
- **Transcription refusals before submit:**
  - Unknown models and translations.
  - Streaming.
  - `response_format` other than `json`, `verbose_json` or `text`.
  - Any form field outside `file`, `model`, `response_format`, `stream` and the eight source options. This covers `prompt`, `temperature`, `timestamp_granularities[]`, `include[]` and others. The source drops these silently; here they are refused rather than ignored.
  - Boolean options other than `true` or `false`.
  - `channels` or `sample_rate` that are not positive integers.
  - Option values that are not short tokens, or options named more than once.
  - A missing, empty or oversized file (over 25 MiB).
- **Answer checks.**
  - Speech must be bounded, non-empty audio with an `audio/*` or octet-stream type. `mp3` must start with an ID3 tag or an MPEG frame, and `wav` must start with RIFF/WAVE. `pcm`, `mulaw` and `alaw` are headerless, so only non-empty is checked.
  - A JSON error envelope on a 200 is a refusal and is not quoted.
  - Other JSON, HTML or mislabelled answers are lost results.
  - A transcript must be a bounded JSON object, at most 8 MiB, with a string `text`.
- **Refusal mapping.** xAI's text is never quoted, and the connection's access, refresh and API-key values are redacted.
  - 401 is an OAuth token refusal. 403 is a per-account forbidden refusal.
  - 402 becomes `quotaExhausted` on that connection only.
  - 429 and 503 keep a bounded `Retry-After`.
  - Other 4xx statuses pass through.
  - Any other 5xx is an unknown outcome and carries `acceptedJob` (`submit-unknown`).
- **Uncertain outcomes.** These carry `acceptedJob` with `cost: null`, `costStatus: "unknown"` and `costSource: "accepted-job"`:
  - A timeout, network failure or caller abort after the send. Only `ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED` and `UND_ERR_CONNECT_TIMEOUT` count as provably unsent.
  - A redirect.
  - A 2xx whose body is lost (`accepted`).
- **Not ported.** The `xai-oauth` provider, the WebSocket/realtime voice, the CLI-proxy Imagine image and video routes, and any dynamic voice-model discovery.

## Registration (serial, after the four additions)

Taken from `registration.json` `integrationPoints`:

1. `open-sse/providers/registry/grok-cli.js`: set `serviceKinds: ["llm", "tts", "stt"]`, add the two model rows with their `kind`, and set `ttsConfig: GROK_CLI_TTS_CONFIG` and `sttConfig: GROK_CLI_STT_CONFIG`. Keep the alias, aliases, OAuth mode, transport and chat models.
2. `open-sse/handlers/ttsProviders/index.js`: add `"grok-cli": grokCliTtsAdapter` to `TTS_ADAPTERS`.
3. `open-sse/handlers/sttCore.js`: add a `grok-cli` + `grok-stt` branch ahead of the token and format switch.
4. `src/sse/handlers/tts.js`: add `grok-cli` to `REFRESHED_BEFORE_DISPATCH`. `src/sse/handlers/stt.js`: refresh `grok-cli` before dispatch, with no resend after a post-send 401, and record `acceptedJob` once on the selected connection.
5. `docs/providers/catalog.mdx`: list the new kinds.

At registration, only the isolated staging block in the test file flips to positive identity assertions.

## Evidence

```
cd tests && node node_modules/vitest/vitest.mjs run unit/native-grok-cli-tts-stt.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 25 passed (25)
node scripts/check-anti-slop.mjs   # anti-slop gate OK (0 diagnostics)
```

The tests use closed mocks only. They cover:

- Exact headers, bodies and multipart order.
- Source defaults and precedence.
- Two credentials with per-connection proxy options.
- API-key and expired-token refusal with nothing sent.
- Refusal and quota mapping, and redirect refusal.
- Unsent versus uncertain failures with no replay.
- Pre-send and post-send aborts.
- The deadline when fetch ignores its signal, and stalled bodies.
- Malformed, mislabelled and oversized answers.
- No leaks of tokens or upstream text.

Passing these tests says nothing about the live service.
