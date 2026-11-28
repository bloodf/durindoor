# Deepgram native TTS (staged), 2026-11-27

Issue: #2034. The inventory row for `deepgram` TTS (`TTS_ADAPTERS`/`ttsConfig`, endpoint `https://api.deepgram.com/v1/speak`) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/audioRegistry.ts` has two `deepgram` entries:
  - STT: `id: "deepgram"`, `baseUrl: "https://api.deepgram.com/v1/listen"`, `authType: "apikey"`, `authHeader: "token"`, `format: "deepgram"`.
  - TTS: `id: "deepgram"`, `baseUrl: "https://api.deepgram.com/v1/speak"`, `authType: "apikey"`, `authHeader: "token"`, `format: "deepgram"`. The models are `aura-asteria-en`, `aura-luna-en` and `aura-stella-en`.
- `open-sse/handlers/audioSpeech.ts` `handleDeepgramSpeech` builds `new URL(baseUrl)` and sets the `model` search parameter. It sends `POST` with `Content-Type: application/json` and `buildAuthHeaders(..., "token")`, which is `Authorization: Token <key>`. The body is `{ text: input }`. On a non-OK answer it calls `upstreamErrorResponse`. On success it streams the body back with `audioStreamResponse`, whose default content type is `audio/mpeg`. It sends no `encoding`, `container`, `sample_rate` or `speed` parameter, and it ignores `voice`, `speed`, `instructions` and `response_format`.
- The token is `credentials.apiKey || credentials.accessToken`.

The source has no Deepgram speech model discovery. Its model list is static.

## Fresh-main check

Checked `HEAD` (`75e6208e9f`) and `origin/main` (`a6cb6dea80`).

- `open-sse/providers/registry/deepgram.js` has id and alias `deepgram`, aliases `["dg"]`, apikey auth, `serviceKinds: ["stt"]` and `sttConfig` (the STT row, served by `open-sse/handlers/deepgramStt.js`). It has no `ttsConfig` and no TTS model rows. The file is the same on `origin/main`.
- `TTS_ADAPTERS` (`open-sse/handlers/ttsProviders/index.js`) has no `deepgram` or `dg` entry.
- `FORMAT_HANDLERS.deepgram` (`open-sse/handlers/ttsProviders/genericFormats.js`) has the same wire envelope: model in the query string, Token auth and a `{ text }` body. `synthesizeViaConfig` reaches it only through `ttsConfig.format`, and Deepgram has no `ttsConfig`, so the handler cannot be reached. It is a same-name config, not an equivalent:
  - it uses plain `fetch`, not the connection's egress policy;
  - it has no deadline and follows redirects;
  - it quotes upstream error text;
  - it has no accepted-job outcome and no pre-submit validation.
- `src/shared/constants/ttsProviders.js` `deepgram` is dashboard UI metadata only.
- `src/app/api/media-providers/tts/deepgram/voices/route.js` lists voices from `GET https://api.deepgram.com/v1/models`. It is unbounded, follows redirects and quotes upstream text. It does not synthesize.

No `/v1/audio/speech` path reaches Deepgram, so the staged module is the whole TTS delta. The STT row already exists and is not touched.

## Staged module

`open-sse/services/providerParity/native-deepgram-tts/`:

- `config.js` holds the IDs, aliases, the fixed origin, endpoints, the source models, the Aura id pattern, bounds, and `DEEPGRAM_TTS_DEFINITION` (the TTS fields to merge into the existing registry entry).
- `http.js` does one bounded send, refuses redirects, maps refusals and records accepted-job accounting. It follows the NanoGPT staged transport and adds `billable: false` for free reads.
- `tts.js` holds `createDeepgramTtsAdapter`, the `ttsCore` adapter contract.
- `discovery.js` holds `listDeepgramTtsModels`, a bounded `GET /v1/models`, plus `parseDeepgramTtsModels` and `groupDeepgramVoices`.
- `index.js` re-exports these and the default `deepgramTtsAdapter`.
- `registration.json` gives the exports, IDs, aliases, models, endpoints, bounds and integration points.

## Supported subset

- Models: the three source rows, plus any id matching `^aura(?:-2)?-[a-z]+-[a-z]{2}$` (Aura-1 and Aura-2 voices from discovery). The model is the voice.
- Request: `POST https://api.deepgram.com/v1/speak?model=<id>`, with headers `Content-Type: application/json` and `Authorization: Token <key>`, and body `{ text }`. The text is sent verbatim, after the core trims it.
- Output: MP3 only. That is Deepgram's default when no encoding is requested, as in the source. `response_format` may be `mp3` or `json`, the gateway's base64 wrapper of the same MP3.
- An OpenAI voice name such as `alloy` is ignored, as in the source.
- `speed` is accepted only when it equals `1`.
- `language` is accepted only when its primary subtag matches the model's language suffix.
- Usage: `cost: null`, `costStatus: "unknown"`. When Deepgram sends a valid `dg-char-count` header, it becomes `nativeUnits.characters` (`meta.nativeUnitsSource: "dg-char-count"`). Otherwise the core counts input characters. A well-formed `dg-request-id` is kept in `meta.requestId`.

## Restrictions (refused before submit, local 400)

- Unknown or non-Aura models, and `model/voice` forms.
- Empty text, and text over 2000 code points (Deepgram's documented per-request limit).
- `stream: true`, or a `stream_format` other than `audio`.
- A `speed` other than 1, and any `instructions`.
- An Aura `voice` that names a different model, and a non-string voice.
- A language that does not match the model.
- Any `response_format`, in the body, the query or the gateway argument, other than `mp3` or `json`. That rules out wav, opus, aac, flac and pcm, because the source never requests other encodings.
- A missing key, or a key with whitespace or line breaks: 401, sent nowhere.

## Transport and safety

- Fixed origin `https://api.deepgram.com`. Connection base URLs are ignored. Redirects use `redirect: "manual"` and are refused, never followed with the key. The request goes through `proxyAwareFetch` with the selected connection's proxy options.
- Deadlines: 120 s for speech (request and body) and 15 s for discovery. The wait ends even when the transport ignores its signal.
- Size bounds: 50 MiB of audio, 2 MiB for a discovery answer, and 16 KiB read from an error body. Error text is never returned.
- Each request is sent once and never retried or replayed.
- Accepted-job outcome (`acceptedJob`, cost unknown):
  - `submit-unknown`: a timeout, abort or transport failure after sending, any 5xx (503 included, see "503 replay" below), or a redirect.
  - `accepted`: an unusable 2xx, meaning a non-audio type, non-MP3 bytes, an empty or oversized body, or a body that stalled or was aborted.
  - Neither: a pre-connect failure (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, connect timeout) or a pre-aborted signal. These carry no accepted job.
- Refusal mapping:
  - 400 to 400;
  - 401 and 403 pass through as an API key refusal;
  - 402 to 402 with `quotaExhausted` on this connection;
  - 429 passes through with `Retry-After` evidence;
  - 503 passes through with `Retry-After` evidence and, for speech, `acceptedJob` (`submit-unknown`);
  - other 4xx pass through.
- A 200 JSON body is not audio. With an `err_code`/`err_msg` or standard error envelope it is a 502 with no audio and no accepted job. Any other JSON is a lost accepted result.
- Discovery keeps only well-formed Aura `canonical_name` rows. Names with control characters or markup fall back to the id, languages are filtered to BCP-47-like codes, and duplicates are dropped. Discovery never carries `acceptedJob`.

## 503 replay (#2034, 2026-11-27)

The adapter used to treat a speech 503 as a refusal with no `acceptedJob`, so the media account loop could send the same text to another account. No primary Deepgram source supports that. Sources (public GET, read 2026-11-27):

- [Errors reference](https://developers.deepgram.com/reference/errors), "Handling HTTP Errors": "503 Service Unavailable: The server isn't ready to handle the request. Common causes include a server that is down for maintenance or is overloaded." The TTS `503` example body has `err_msg` "Please try again later". The page says nothing about billing.
- [Pricing](https://deepgram.com/pricing): TTS is billed per 1,000 input characters. No statement on failed or 5xx requests.

Nothing says a 503 did no work or is not billed, and no structured "not accepted" field is documented. A speech 503 now:

- keeps HTTP status 503 and the bounded `Retry-After` (`resetsAtMs`) for the selected account's health;
- carries `acceptedJob` (`costSource: "accepted-job"`, cost unknown, `jobState: "submit-unknown"`). In `runMediaAccounts`, the TTS handler's `onAccountFailure` records the job on the selected account and ends the loop, so it is never replayed on another account;
- never quotes the body; it is still drained only up to 16 KiB under a 2 s bound.

Model discovery (`billable: false`) is a free read and keeps a plain 503. Same contract as the HuggingFace speech fix (`internal/docs/port-reports/native-audio-503-contract.md`, commit `84b4a16baf`).

Tests: `tests/unit/private-audio-503-replay.test.js` (30 tests, 15 per vendor). It covers absent, empty, malformed, HTML, Deepgram-shaped, Fish-shaped and oversized 503 bodies, Retry-After as seconds, as an HTTP date and missing, a caller abort and a deadline on a stalled 503 body, neighbouring 429/500/502/504, two-account key isolation, the real `runMediaAccounts` loop (one send, one account marked, no second account), and discovery without a job. Mutations: reverting the Deepgram 503 change fails 13 Deepgram cases; applying the job to discovery too fails the discovery case.

Conflict: `tests/unit/native-deepgram-tts.test.js` row `[503, 503, false]` in "maps Deepgram %i to %i without quoting the body" asserts the old no-job outcome and now fails. It was outside this change's allowed files and was left unchanged.

## Registration (serial step, not done here)

See `registration.json` `integrationPoints`:

1. `open-sse/providers/registry/deepgram.js`: set `serviceKinds` to `["stt", "tts"]` and add the TTS model rows. Do not add `ttsConfig`, so `FORMAT_HANDLERS.deepgram` stays unreachable.
2. `open-sse/handlers/ttsProviders/index.js`: add `deepgram: deepgramTtsAdapter` to `TTS_ADAPTERS`, and `dg` if aliases reach it unresolved.
3. `src/sse/handlers/tts.js`: add `deepgram` to `NAMED_FORMAT_PROVIDERS`.
4. Optionally move the dashboard voices route onto `listDeepgramTtsModels` and `groupDeepgramVoices`.
5. `docs/providers/catalog.mdx`: list the TTS kind.

## Evidence

`tests/unit/native-deepgram-tts.test.js` uses closed mocks only: injected transport, synthetic keys, no network. It covers:

- exact URL, query, headers and body, plus the registry fields;
- accessToken fallback and the ignored base URL;
- every pre-submit refusal, with nothing sent;
- MP3 normalization and usage, from both the header and the fallback;
- two connections that each keep their own key;
- the refusal, quota and leak matrix;
- 200 error envelopes and lost results;
- the audio size bound and redirect refusal;
- pre-send abort, post-send abort, request and body deadlines, and pre-connect versus mid-flight failures, each sent once;
- discovery: shape, filtering, refusals, timeout, malformed, oversized and keyless answers.

Unregistered-state assertions sit only in the final `staging: unregistered state` block.

```
cd tests && node node_modules/vitest/vitest.mjs run unit/native-deepgram-tts.test.js --maxWorkers=2
Test Files  1 passed (1)
     Tests  53 passed (53)
```

ESLint on the staged module and the test file reported no problems.
