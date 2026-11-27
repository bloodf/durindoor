# HuggingFace native TTS (staged), 2026-11-27

Issue: #2034. The inventory row for `huggingface` TTS (`TTS_ADAPTERS`/`ttsConfig`) was MISSING. Decision 15 accepted this delta. The STT row is present already (see below) and is not part of this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts`, speech entry `huggingface`: id `huggingface`, baseUrl `https://router.huggingface.co/hf-inference/models`, authType `apikey`, authHeader `bearer`, format `huggingface-tts`, models `canopylabs/orpheus-3b-0.1-ft` (Orpheus 3B), `ResembleAI/chatterbox` (Chatterbox), `hexgrad/Kokoro-82M` (Kokoro TTS).
- Same file, transcription entry `huggingface`: same id, baseUrl, authType and authHeader, format `huggingface-asr`.
- `open-sse/handlers/audioSpeech.ts`, `handleHuggingFaceTtsSpeech`: refuses a model id containing `..` or `//`, then one `POST` to `${baseUrl}/${modelId}` with the Hub id's slash kept as a path separator. Headers are `Content-Type: application/json` and `Authorization: Bearer <key>`. The body is exactly `{ inputs: body.input }`. Voice, speed and format are not sent. A 2xx body is streamed through with the upstream content type, `audio/wav` when none. A non-2xx answer goes through `upstreamErrorResponse`, which reuses a JSON error message.
- `tests/unit/audio-speech-handler.test.ts` and `tests/unit/huggingface-audio-router-host.test.ts`: `huggingface/facebook/mms-tts-eng` and `huggingface/hexgrad/Kokoro-82M` post `{ inputs }` to `https://router.huggingface.co/hf-inference/models/<owner>/<name>` with `Bearer`.

The source has no speech model discovery. It sends any model id it is given.

## Fresh-main check

Checked `HEAD` and local `main` (`863ef3f839`). Both have the same HuggingFace state.

- `open-sse/providers/registry/huggingface.js` exists: id `huggingface`, alias `huggingface`, aliases `["hf"]`, authType `apikey`, `serviceKinds: ["image", "stt"]`, **`hiddenKinds: ["tts"]`**, no `ttsConfig`, no model with `kind: "tts"`, `modelsFetchers` for `image` and `stt` only. `hiddenKinds` has been there since the fork's first commit (`00b2e54d91`).
- Its `sttConfig` is `{ baseUrl: "https://router.huggingface.co/hf-inference/models", authType: "apikey", authHeader: "bearer", format: "huggingface-asr" }`, field-for-field the source STT row. `sttCore.js` `transcribeHuggingFace` serves it. STT is present and is not re-staged. One wire difference is noted below.
- `open-sse/handlers/ttsProviders/genericFormats.js` has `FORMAT_HANDLERS["huggingface-tts"]`. It is unreachable because `synthesizeViaConfig` returns `null` without `AI_PROVIDERS.huggingface.ttsConfig`, and `hiddenKinds` keeps the provider out of TTS lists. Its wire shape also differs from the source:
  - It encodes the Hub id with `encodeURIComponent`. That sends `hexgrad%2FKokoro-82M` where the source sends `hexgrad/Kokoro-82M`. The test file pins this.
  - It uses the global `fetch` without the connection egress policy.
  - It sets no deadline or abort and follows redirects.
  - It throws the upstream error text and records no accepted-job outcome.
  - It labels any answer that is not wav, mp3 or ogg (for example flac) as `wav`.
  - It silently drops voice and speed.
- `TTS_ADAPTERS` has no `huggingface` or `hf` entry.
- `src/shared/constants/ttsProviders.js` already has dashboard config for `huggingface` (model selector, config voices).
- `src/app/api/providers/suggested-models/filters.js` has `huggingface-image` and `huggingface-stt` filters, and no `huggingface-tts` filter.

The provider, its API-key connection and the router origin exist. The TTS kind is hidden and dormant. Its dormant handler matches neither the source path nor the safety contract. This module is the TTS delta. It reuses the existing connection and auth mode and adds no new provider.

## Staged module

`open-sse/services/providerParity/native-huggingface-tts/` contains:

- `config.js`: IDs, the `hf` alias, the fixed router origin and base URL, the Hub id rule, the source model rows, bounds, `HUGGINGFACE_TTS_CONFIG`, the staged `tts` Hub fetcher and its suggestion filter, and `HUGGINGFACE_TTS_PROVIDER_ADDITIONS` (what the registry entry gains).
- `http.js`: one bounded send, redirect refusal, refusal mapping and accepted-job accounting. It has the same contract as the staged Hyperbolic speech transport.
- `tts.js`: `createHuggingFaceTtsAdapter`, `buildHuggingFaceSpeechRequest` and `sniffAudioContainer`. These follow the `TTS_ADAPTERS` `synthesize` contract.
- `index.js`: exports, plus the default instance `huggingfaceTtsAdapter`.
- `registration.json`: exports, IDs, aliases, models, endpoint, bounds and integration points.

Production code imports none of these files.

## Supported subset

Speech goes to `POST https://router.huggingface.co/hf-inference/models/<owner>/<name>`.

- The model is the three source rows or any other Hub id of the form `owner/name`. Each segment starts with a letter or digit and uses only letters, digits, `.`, `_` or `-`, and the id has no `..`. An empty model selects `canopylabs/orpheus-3b-0.1-ft`. The slash stays unencoded, matching the source. The body is exactly `{ inputs }`.
- A client may omit `response_format` or name `json` (the gateway's base64 wrapper). The model picks the container.
- The answer is read up to 25 MiB. Its container comes from its bytes, not its header:
  - `RIFF…WAVE` is wav.
  - `fLaC` is flac.
  - `OggS` is ogg.
  - An ID3 tag or an MPEG layer III frame is mp3.
- `handleTtsCore` serves the audio as `audio/<container>`.
- On success the adapter returns `{ base64, format, accounting }`. The cost is unknown because the router bills compute time and reports none on this route. Response headers are not read as a receipt. `withTtsUsage` in the core adds input characters.
- Discovery is staged as `modelsFetchers.tts`: `https://huggingface.co/api/models?inference_provider=hf-inference&pipeline_tag=text-to-speech&limit=30` (type `huggingface-tts`). It follows the local per-kind image and stt rows. `huggingfaceTtsSuggestions` keeps only well-formed Hub ids, ordered by downloads and then likes.

## Refused before submit

The source sends only `inputs`. Anything it would silently drop gets a local 400, and nothing is sent:

- a non-empty `voice`, a non-string voice, or a third path segment (`owner/name/<voice>`);
- `speed` other than 1, `instructions`, or a `language` hint;
- `stream: true`, or a `stream_format` other than `audio`;
- any named `response_format` other than `json` (including one from the query string, once `requestedResponseFormat` is passed), because the container is not known before submit;
- a model id that is not one Hub id: a bare name, `..`, `//`, `%2F`, a query string or an absolute URL;
- empty input, or a body over 256 KiB.

A missing key, or a key with CR/LF, returns 401 without a request.

## Transport and failures

- The key goes only to `https://router.huggingface.co`. A connection `baseUrl` is ignored. The connection egress policy is forwarded to `proxyAwareFetch`.
- Each request is sent once and is never retried or replayed. A 120-second deadline covers the request and its body. A caller abort or the deadline aborts the transport signal. The wait ends even if the transport ignores the signal.
- Redirects are refused (`redirect: "manual"`) and never followed with the key.
- Refusals keep only the HTTP status and never quote HuggingFace's body:
  - 400, 401, 403, 404 and 422 pass through.
  - 402 means Inference Providers credits are exhausted, on this connection only (`quotaExhausted`).
  - 429 and 503 keep a bounded `Retry-After`. 503 is the router's model-loading or unavailable answer.
  - Any other 5xx is an uncertain job: `acceptedJob` with `submit-unknown` and unknown cost.
- Unsent and sent failures are handled differently:
  - A connect failure proven unsent (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, connect timeout) has no `acceptedJob`.
  - A failure after send, a timeout, a caller abort after send, or a redirect carries `acceptedJob` with `submit-unknown`.
- 2xx answers without usable audio are handled as follows:
  - A JSON error envelope is a refusal without `acceptedJob`.
  - The following are lost results with `acceptedJob` `accepted`:
    - JSON without an error, invalid JSON, or a JSON body over 16 KiB;
    - HTML or other non-audio types;
    - empty or unrecognised bytes;
    - oversized, stalled or aborted bodies.

## Registration (serial step, not done here)

The steps come from `registration.json`:

1. `open-sse/providers/registry/huggingface.js`: merge `HUGGINGFACE_TTS_PROVIDER_ADDITIONS`. Set `serviceKinds` to `["image", "stt", "tts"]`, drop `hiddenKinds`, add the three model rows with `kind: "tts"`, and add `ttsConfig` and `modelsFetchers.tts`. Keep id, aliases, display, auth, `imageConfig` and `sttConfig` unchanged.
2. `open-sse/handlers/ttsProviders/index.js`: add `huggingface: huggingfaceTtsAdapter, hf: huggingfaceTtsAdapter` to `TTS_ADAPTERS`, so `handleTtsCore` uses the adapter before `synthesizeViaConfig`. The dormant `FORMAT_HANDLERS["huggingface-tts"]` is then unused.
3. `src/app/api/providers/suggested-models/filters.js`: add `"huggingface-tts": huggingfaceTtsSuggestions`.
4. `src/sse/handlers/tts.js`: add `huggingface` to `NAMED_FORMAT_PROVIDERS`. Accepted-job recording already exists there.
5. `docs/providers/catalog.mdx`: list the TTS kind.

Only the staging block in the test file asserts the unregistered state. Registration promotes it to positive identity assertions.

## Remaining restrictions

- The adapter supports no voice, speed, language or other per-model `parameters`. The source does not send them, and their names vary per model.
- The container is whatever the model returns. There is no transcoding, so a client cannot ask for a specific one.
- Streaming is not supported.
- The cost is unknown. The router reports no usage on this route.
- No one has checked live which of the three source models the `hf-inference` provider still serves. A model it does not serve gets the router's 4xx, which passes through with no accepted job.
- Observation outside this delta: the existing STT path (`sttCore.js` `transcribeHuggingFace`) also encodes the Hub id (`openai%2Fwhisper-large-v3`), while the source sends the raw slash. This module does not change it.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-huggingface-tts.test.js --maxWorkers=2
```

All 67 tests passed, all on closed mocks. They cover:

- the source-exact URL (unencoded Hub path), headers and body;
- the dormant handler's encoded-path difference;
- the existing STT row matching the source;
- discovery URL and filter;
- container detection for wav, flac, mp3 and ogg, by bytes rather than header;
- two connections, the accessToken fallback, the egress policy and the ignored base URL;
- refusals before submit, including model-id injection;
- status mapping without leaks, 402 quota, Retry-After on 429 and 503, and uncertain 5xx;
- redirect refusal, and unsent versus sent transport failures;
- abort before and after send, the deadline with a transport that ignores its signal, and a stalled body;
- malformed and unsafe answers, and the size cap;
- the `handleTtsCore` contract through test-local wiring.

`eslint` and the anti-slop oxlint gate report nothing for the new files.
