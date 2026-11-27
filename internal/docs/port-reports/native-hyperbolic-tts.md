# Hyperbolic native TTS (staged), 2026-11-27

Issue: #2034. The inventory row for `hyperbolic` TTS (`TTS_ADAPTERS`/`ttsConfig`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts`, `AUDIO_SPEECH_PROVIDERS.hyperbolic`: id `hyperbolic`, baseUrl `https://api.hyperbolic.xyz/v1/audio/generation`, authType `apikey`, authHeader `bearer`, format `hyperbolic`, models `[{ id: "melo-tts", name: "Melo TTS" }]`.
- `open-sse/handlers/audioSpeech.ts`, `handleHyperbolicSpeech`: one `POST` with `Content-Type: application/json` and `Authorization: Bearer <key>` (from `buildAuthHeaders`). The body is exactly `{ text: body.input }`. The model ID, voice, speed and format are not sent. The answer `{ audio: "<base64>" }` is decoded with `atob` and served as `audio/mpeg`. A non-2xx answer is returned with the upstream text.
- `tests/unit/audio-speech-handler.test.ts`: `hyperbolic/melo-tts` sends `{ text }` and decodes `{ audio }`.

The source has no speech model discovery for Hyperbolic. The one model is static.

## Fresh-main check

Checked `HEAD` and `origin/main` (`fdbb72865a`).

- `open-sse/providers/registry/hyperbolic.js` exists as a chat provider: id `hyperbolic`, alias `hyperbolic`, aliases `["hyp"]`, authType `apikey`, chat baseUrl `https://api.hyperbolic.xyz/v1/chat/completions`, validateUrl `https://api.hyperbolic.xyz/v1/models`. It has no `serviceKinds` with `tts`, no `ttsConfig` and no `melo-tts` row.
- `open-sse/handlers/ttsProviders/genericFormats.js` has `FORMAT_HANDLERS.hyperbolic`. It uses the same wire envelope (same URL when configured, same Bearer header, body `{ text }`, reads `data.audio`). It is unreachable: `synthesizeViaConfig` returns `null` because `AI_PROVIDERS.hyperbolic.ttsConfig` is undefined. It also sets no deadline, uses the global `fetch` without the connection egress policy, follows redirects, throws the upstream error text, has no accepted-job outcome, does not check the base64 or the audio bytes, and silently drops voice and speed.
- `TTS_ADAPTERS` has no `hyperbolic` or `hyp` entry.
- `src/shared/constants/ttsProviders.js` already has dashboard config for `hyperbolic` (model selector, config voices).

So the provider and its API-key connection exist, and the speech route is dormant. The dormant handler matches the wire envelope but not the safety contract. The test file pins that equivalence in the staging block. This module is the speech delta. It reuses the existing connection and auth mode and adds no new provider.

## Staged module

`open-sse/services/providerParity/native-hyperbolic-tts/`:

- `config.js`: IDs, the `hyp` alias, the fixed origin and endpoint, the model row, bounds, `HYPERBOLIC_TTS_CONFIG` and `HYPERBOLIC_TTS_PROVIDER_ADDITIONS` (what the registry entry gains).
- `http.js`: one bounded send, redirect refusal, refusal mapping and accepted-job accounting. Same contract as the staged deAPI speech transport.
- `tts.js`: `createHyperbolicTtsAdapter` and `buildHyperbolicSpeechRequest`. These follow the `TTS_ADAPTERS` `synthesize` contract.
- `index.js`: exports, plus the default instance `hyperbolicTtsAdapter`.
- `registration.json`: exports, IDs, aliases, models, endpoint, bounds and integration points.

Production code imports none of these files.

## Supported subset

Speech (`POST https://api.hyperbolic.xyz/v1/audio/generation`):

- Model `melo-tts`. An empty model selects it. The body sent is exactly `{ text }`.
- A client may name `mp3` or `json` as `response_format`, or omit it. `json` is the gateway's base64 wrapper.
- The answer must be a JSON object whose `audio` is strict base64 (no data URL, no whitespace) of mp3 bytes: an ID3 tag or an MPEG layer III frame. The decoded audio limit is 25 MiB; the JSON body limit follows from it.
- On success the adapter returns `{ base64, format: "mp3", accounting }`. The cost is unknown, and extra answer fields are not read as a receipt. `withTtsUsage` in the core adds input characters.

## Refused before submit

The source sends only `text`, so anything it would silently drop is refused with a local 400 and nothing is sent:

- a non-empty `voice`, a non-string voice, or a `melo-tts/<voice>` suffix;
- `speed` other than 1, `instructions`, or a `language` hint;
- `stream: true` or a `stream_format` other than `audio`;
- a `response_format` other than mp3 or json (including from the query string, once `requestedResponseFormat` is passed);
- any model other than `melo-tts`, empty input, or a body over 256 KiB.

A missing key, or a key with CR/LF, returns 401 without a request.

## Transport and failures

- The key goes only to `https://api.hyperbolic.xyz`. A connection `baseUrl` is ignored. The connection egress policy is forwarded to `proxyAwareFetch`.
- Each request is sent once and never retried or replayed. A 120 s deadline covers the request and its body. A caller abort or the deadline aborts the transport signal, and the wait ends even if the transport ignores the signal.
- Redirects are refused (`redirect: "manual"`), never followed with the key.
- Refusals keep only the HTTP status and never quote Hyperbolic's body:
  - 400, 401, 403, 404 and 422 pass through.
  - 402 is quota exhausted on this connection only.
  - 429 and 503 keep a bounded `Retry-After`.
  - Any other 5xx is an uncertain job (`acceptedJob`, `submit-unknown`, unknown cost).
- A provably unsent connect failure (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, connect timeout) has no `acceptedJob`. A failure after send, a timeout, a caller abort after send, or a redirect carries `acceptedJob` with `submit-unknown`.
- A 2xx with an error envelope and no audio is a refusal without `acceptedJob`. A 2xx without usable audio (missing or non-base64 `audio`, non-mp3 bytes, HTML, raw audio instead of JSON, invalid JSON, oversized, stalled or aborted body) is a lost result with `acceptedJob` `accepted`.

## Registration (serial step, not done here)

From `registration.json`:

1. `open-sse/providers/registry/hyperbolic.js`: merge `HYPERBOLIC_TTS_PROVIDER_ADDITIONS`: add `tts` to `serviceKinds` (with `llm`, plus `image` from its own #2034 row), the `melo-tts` row with `kind: "tts"`, and `ttsConfig`. Keep id, aliases, display and chat transport unchanged.
2. `open-sse/handlers/ttsProviders/index.js`: add `hyperbolic: hyperbolicTtsAdapter, hyp: hyperbolicTtsAdapter` to `TTS_ADAPTERS`, so `handleTtsCore` uses the adapter before `synthesizeViaConfig`. The dormant `FORMAT_HANDLERS.hyperbolic` is then unused.
3. `src/sse/handlers/tts.js`: add `hyperbolic` to `NAMED_FORMAT_PROVIDERS`. Accepted-job recording already exists there.
4. `docs/providers/catalog.mdx`: list the TTS kind.

Only the staging block in the test file asserts unregistered state. Registration promotes it to positive identity assertions.

## Remaining restrictions

- No voice, speed, language or other Melo TTS options. The source does not send them, and their live wire names are not pinned.
- mp3 only. Other containers would need transcoding.
- No streaming and no speech model discovery.
- Cost is unknown. Hyperbolic reports no usage on this route in the source.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-hyperbolic-tts.test.js --maxWorkers=2
```

52 tests passed, all on closed mocks. They cover: source-exact headers and body; two connections; accessToken fallback; egress policy and ignored base URL; refusals before submit; status mapping without leaks; 402 quota; Retry-After; uncertain 5xx; redirect refusal; unsent versus sent transport failures; abort before and after send; deadline with a transport that ignores its signal; stalled body; malformed and unsafe answers; size caps; and the `handleTtsCore` contract through test-local wiring. `eslint` and the anti-slop oxlint gate report nothing for the new files.
