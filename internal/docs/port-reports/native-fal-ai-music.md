# fal.ai ACE-Step music (staged), 2026-11-27

Issue: #2034. Decision15 accepted this delta. The parity inventory row is: Music, `fal-ai`, apikey / key / `fal-ai-music`, endpoint `https://queue.fal.run`, `open-sse/config/musicRegistry.ts` → `handlers/musicGeneration.ts`, DurinDoor equivalent: MISSING (`MUSIC_ADAPTERS` / `musicConfig`).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The checkout at `/tmp/omni-2034` was confirmed to be at that HEAD.

- `open-sse/config/musicRegistry.ts`: the `fal-ai` entry. It has `id: "fal-ai"`, `baseUrl: "https://queue.fal.run"`, `authType: "apikey"`, `authHeader: "key"`, `format: "fal-ai-music"`, and one model, `ace-step` ("ACE-Step").
- `open-sse/handlers/musicGeneration.ts`: dispatches `fal-ai-music` to `handleFalMusicGeneration` with the route's signal and `prepareFalInput`.
- `open-sse/handlers/mediaGeneration/fal.ts`: `buildFalMusicRequestBody`, `normalizeFalMediaResult`, `runFalQueue` (native mode), and `handleFalMusicGeneration`. The built-in body is used for `ace-step` unless the request carries `fal_input`. A request with `fal_input` is prepared from the endpoint's discovered schema.
- `open-sse/config/falEndpoint.ts`: the legacy alias `ace-step` → `fal-ai/ace-step`.
- `open-sse/handlers/fal/client.ts`, `compatibility.ts`, `schema.ts`: fixed fal origins, `redirect: "error"`, sanitized upstream errors, bounded read retries, tracking-URL pinning, catalog discovery (`GET https://api.fal.ai/v1/models?endpoint_id=…&expand=openapi-3.0`), and the compatibility input with strict schema validation.

## What already existed locally

No music equivalent existed:

- `open-sse/handlers/musicGenerationCore.js`: `MUSIC_ADAPTERS` holds only `suno` and `udio`, which are cookie web adapters. `minimax` and `minimax-cn` are special-cased. `handleMusicGenerationCore({ provider: "fal-ai" })` returns 400.
- `open-sse/providers/registry/fal-ai.js`: `serviceKinds: ["image"]`, image models only, `imageConfig.baseUrl` `https://queue.fal.run`, alias `fal`.
- `open-sse/handlers/imageProviders/falAi.js`: the same queue and `Key` header, but for an image body (`prompt`, `num_images`) and image normalization (`images[]`). It has no music body, no audio normalization, no discovery, and no `acceptedJob`. The shared provider id and credential do not make it a music equivalent.

## What landed (private, unregistered)

| File | Role |
| --- | --- |
| `open-sse/services/providerParity/native-fal-ai-music/config.js` | Provider id, alias, format, origins, model, and catalog metadata. |
| `.../request.js` | Built-in ACE-Step body, envelope checks, and the `fal_input` compatibility input. Unsupported input is refused before any credential use. |
| `.../discovery.js` | Catalog discovery, OpenAPI input-schema selection, the local validator, and the connection-scoped definition store hook. |
| `.../transport.js` | Fixed-origin bounded reads with bounded 429/503 retry, tracking-URL pinning, and bounded JSON reads. |
| `.../job.js` | Bounded submit, polling, result read, and `acceptedJob` accounting. |
| `.../result.js` | Audio result normalization with public-URL checks. |
| `.../adapter.js` | Music adapter (`generate`) following the music core result contract. |
| `.../index.js` | Re-exports everything above. |
| `.../registration.json` | Exports, ids, models, endpoints and auth, and the integration points for the registration change. |
| `tests/unit/native-fal-ai-music.test.js` | 82 tests over a closed network. |

Production code imports none of these modules. These files are unchanged: `musicGenerationCore.js`, `open-sse/providers/registry/**`, the docs catalog, and `src/**`. The assertion that fal music is unregistered lives in its own staging block. The registration change can replace that block with positive identity checks without touching the protocol, auth, security, or usage tests.

## Supported subset

Wire contract (source-derived):

- **Auth:** `Authorization: Key <key>`. The key is `credentials.apiKey`, else `credentials.accessToken`. A missing key is a local 401, "Fal API key is required", and nothing is sent.
- **Submit:** `POST https://queue.fal.run/fal-ai/ace-step` with `Content-Type: application/json` and the ACE-Step body: `tags`, `lyrics`, `duration`, `seed`, eight numeric guidance and step controls, `scheduler`, and `guidance_type`.
- **Accept:** `{ request_id, status_url, response_url }`. Without tracking URLs, the source paths `{queue}/requests/{id}/status` and `{queue}/requests/{id}` are used. An accept body without `request_id` is the finished result.
- **Poll:** `GET` the status URL until `COMPLETED`. `IN_QUEUE` and `IN_PROGRESS` keep waiting, at most 1 s apart. `GET` the result URL on `COMPLETED`.
- **Result:** `audio.url`. The format comes from the `content_type` subtype, else the file extension, else `wav`.
- **Discovery** (requests with `fal_input` only): `GET https://api.fal.ai/v1/models?endpoint_id=fal-ai%2Face-step&expand=openapi-3.0`. The page must have a `models` array and a boolean `has_more`, and must list the endpoint. The POST operation at `/fal-ai/ace-step` must have an `application/json` schema, with local `$ref`s only. The input is the public fields (envelope dropped, optional controls only when documented, `prompt` mapped to `tags`) with `fal_input` merged last, then validated. When a store is injected, the definition is cached for the selected connection only.

Public contract:

- **Model:** `ace-step` (alias `fal-ai/ace-step`), provider `fal-ai` (alias `fal`).
- **Accepted:** `prompt` or `tags` (one style description), `lyrics`, `duration` (5 to 240 s), an integer `seed`, the numeric controls, `scheduler` (`euler` or `heun`), `guidance_type` (`cfg`, `apg`, or `cfg_star`), `fal_input`, `n` = 1, and `response_format` = `url`.
- **Response:** `{ object: "music.generation", provider: "fal-ai", model, status: "completed", created, data: [{ id, audio_url, url, format, content_type?, file_name?, file_size?, seed? }] }`. The only format is a URL. fal hosts the file, and the gateway does not download it.
- **Accounting:** `state: "complete"`, `nativeUnits.tracks = 1`, unknown cost. Neither requested duration nor prompt length is billed.

## Fork deviations from the source

- **Refused instead of silently changed:**
  - an empty `tags` (the source sent `""`)
  - a duration outside 5 to 240 s (the source clamped it)
  - an unknown `scheduler` or `guidance_type`, or a non-number control (the source dropped them)
  - `prompt` and `tags` that differ (the source used `tags`)
  - media inputs, `size`, `instrumental`/`make_instrumental` set to true, `n` > 1, `stream`, and `response_format` other than `url`. The source never forwarded or honored these.
- **Schema validation:** the source validates with Ajv, which this package does not depend on. The local validator checks unknown keys (unless `additionalProperties` is true), `required`, and per property: `type`, `nullable`, `enum`, `const`, `minimum`/`maximum`, numeric `exclusiveMinimum`/`exclusiveMaximum`, `minLength`/`maxLength`, and `minItems`/`maxItems`, through local `$ref` and `allOf`. A property schema with `anyOf`/`oneOf` is type-checked only when every alternative names the same type. `format`, `pattern`, nested object, and array item schemas are not checked; fal still validates them (a 422 is refused without `acceptedJob`).
- **Errors never carry upstream text.** The source's non-native path returned up to 500 characters of the upstream body. Here only the HTTP status is kept, plus, for 422, the names of rejected fields when they match `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. A safe status name (`^[A-Z_]{1,32}$`) is kept for an unknown queue status. Every error redacts the connection's key and access token.
- **Submit outcomes:**
  - 401 and 403 are refused as credential errors.
  - 402, or a 403 whose `detail` reports an exhausted or locked balance, returns 402 with `quotaExhausted`.
  - 429 carries Retry-After evidence and is not retried.
  - 422 and other 4xx responses are refused, with no `acceptedJob`.
  - 5xx, a timeout, a reset after send, an abort during the request, and an answer from another origin (a followed redirect) are each an unknown submit: `acceptedJob` with `submit-unknown`. These are never resent.
  - A pre-connect failure (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`) or an abort before send is not an accepted job.
- **Redirects** are refused: `manual` on submit (any 3xx is refused, and nothing is queued), `error` on reads. Reads go only to `https://queue.fal.run` and `https://api.fal.ai`, with no userinfo or fragment.
- **Tracking URLs** must stay on `https://queue.fal.run`, have no query, userinfo, or fragment, and end in `/requests/{id}/status` or `/requests/{id}` for this request id. The request id must match `^[A-Za-z0-9][A-Za-z0-9-]{7,127}$`. Otherwise the key is never sent, and the job is accepted-unknown.
- **Read retries:** reads (status, result, and discovery) retry 429 and 503 at most twice, only when Retry-After is at most 5 s and fits the per-request budget. This is the source FalClient bound.
- **Accepted jobs:** every accepted request that does not return usable audio carries `acceptedJob`, because fal does not report whether a failed request bills. That covers status errors, result errors (including 422), an unknown status, the deadline, an abort, and an unusable result (`completed`). The source reported these as ordinary failures.
- **Result URLs** must be https, carry no userinfo, and name a public host (`src/shared/utils/ssrfGuard.js` `assertPublicUrl`). `data:` and `blob:` results are refused. A non-`audio/*` content type is refused. The source's native `output` and `artifacts` passthrough is not returned; only the track and its seed are.
- **Bounds:**
  - Time: the whole job is limited to 300 s, the submit to 30 s, each read to 30 s (capped by the job deadline), and discovery to 15 s. Every wait, request, and body read aborts on the caller's signal.
  - Body size: the accept body is limited to 1 MiB (it may be the result), error bodies to 16 KiB, status bodies to 256 KiB, the result to 1 MiB, and the catalog page to 2 MiB.
- **Cancellation:** the source never cancels an accepted request, so neither does this client (fal's `cancel_url` is not called).

## Remaining restrictions

- Only `fal-ai/ace-step`. The source also routed any non-built-in fal endpoint through discovery. Those endpoints stay out of this music adapter until each has a model entry and a tested contract.
- No `b64_json` and no download of the hosted file. No streaming, realtime, or `fal.run` direct transport.
- The music route (`src/sse/handlers/music.js`) does not yet record `acceptedJob` on failures. The registration change must add that, as `video.js` does; see `registration.json`.

## Evidence

```
cd tests && node node_modules/vitest/vitest.mjs run unit/native-fal-ai-music.test.js --maxWorkers=2
 Test Files  1 passed (1)
      Tests  82 passed (82)
npx eslint open-sse/services/providerParity/native-fal-ai-music tests/unit/native-fal-ai-music.test.js   # exit 0
```

These are closed mocks only. No live fal account, key, or network was used.
