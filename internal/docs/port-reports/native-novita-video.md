# Novita native video (staged), 2026-11-27

Issue: #2034. The inventory row for `novita` video (registry `format: "novita-video"` → video dispatcher) was MISSING. Decision 15 accepted this delta.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `novita`: baseUrl `https://api.novita.ai/v3/async`, statusUrl `https://api.novita.ai/v3/async/task-result`, authType `apikey`, authHeader `bearer`, format `novita-video`, models `wan-t2v` ("Wan 2.1 Text-to-Video") and `kling-v1.6-t2v` ("Kling V1.6 Text-to-Video").
- `open-sse/handlers/videoGeneration.ts`: `format === "novita-video"` dispatches to `handleNovitaVideoGeneration` with the caller's signal.
- `open-sse/handlers/videoGeneration/novita.ts` (pure helpers) and `novitaHandler.ts` (orchestration):
  - Credential `apiKey || accessToken`; submit `POST {baseUrl}/{model}` with `Authorization: Bearer <key>` and `Content-Type: application/json`.
  - Body `{ prompt, negative_prompt?, duration?, width?, height? }`. Width and height come from a `WxH` / `W*H` prefix of `size`; `duration` only when it is a positive number.
  - Reads `task_id`, then every 2.5 s `GET {statusUrl}?task_id=<id>` with the Bearer key only, for up to 300 s. `timeout_ms` and `poll_interval_ms` from the body are clamped by `utils/pollBounds.ts` (600 s, 120 s).
  - `TASK_STATUS_SUCCEED`/`SUCCEED`/`SUCCEEDED` with `videos[0].video_url` → `{ created, data: [{ url, format: "mp4" }] }`; `TASK_STATUS_FAILED`/`FAILED`/`UNKNOWN_ERROR` → 502 with `task.reason`; deadline → 504.
  - A submit error returned the upstream `message` verbatim.

## Fresh-main check

- `open-sse/providers/registry/novita.js` exists: alias `novita`, `authType: "apikey"`, default Bearer, chat transport `https://api.novita.ai/openai/v1/chat/completions`, `validateUrl` `/openai/v1/models`, four chat models, no `serviceKinds` (defaults to `["llm"]` in `src/shared/constants/providers.js`).
- `rg -i novita open-sse/handlers open-sse/services` finds no match outside this staging folder. `VIDEO_GENERATION_ADAPTERS` holds `alibaba`, `ali`, `renderhour`, `adobe-firefly-api` and `adobe-firefly-web`; `getVideoGenerationAdapter("novita")` returns null. No async `/v1/videos` config exists for Novita.
- Nothing in `open-sse` or `src` sends to `api.novita.ai/v3/async`. The other Novita uses (`src/app/api/providers/[id]/models/modelsConfig.js`, `test/testUtils.js`, `validate/route.js`) all hit `/openai/v1/models`. No generic adapter speaks the Novita task envelope (`task_id`, `GET /v3/async/task-result?task_id=`, `task.status`, `videos[].video_url`). No equivalent exists, so the delta is real.

## What landed

All new files are under `open-sse/services/providerParity/native-novita-video/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and endpoints, auth header, models, task states and bounds. |
| `http.js` | Bounded abortable fetch, redirect refusal, bounded JSON reads, refused-answer mapping without quoting upstream text, the public https URL check, and accepted-job accounting. |
| `request.js` | `buildNovitaVideoRequest` and `resolveNovitaTiming`. |
| `job.js` | `runNovitaVideoTask`: submit + bounded poll. |
| `adapter.js` | `createNovitaVideoAdapter` (`VIDEO_GENERATION_ADAPTERS` contract). |
| `index.js` | Re-exports, plus the default `novitaVideoAdapter`. |
| `registration.json` | Exports, canonical ID and alias, models, endpoints, auth, and the registration steps. |

Tests are in `tests/unit/native-novita-video.test.js`: 62 tests over a closed network.

Nothing is registered. `videoProviders/index.js`, `providers/registry/novita.js` and the docs catalog are unchanged. Only the isolated `staging state` test block asserts that.

## Supported subset

- Models `wan-t2v` and `kling-v1.6-t2v` only. Text-to-video only.
- Submit `POST https://api.novita.ai/v3/async/{model}`, headers exactly `Authorization: Bearer <key>` and `Content-Type: application/json`.
- Body `{ prompt, negative_prompt?, duration?, width?, height? }`:
  - `negative_prompt`: string up to 8,000 characters; empty is skipped, as in the source.
  - `duration` or `seconds` (number or digit string): whole seconds from 1 to 60. Both together must agree.
  - `size`: exactly `WIDTHxHEIGHT` or `WIDTH*HEIGHT`, each side 64–4096.
- Status `GET https://api.novita.ai/v3/async/task-result?task_id=<id>` with the Bearer key only. Task ids must match `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$` and are URL-encoded.
- `TASK_STATUS_SUCCEED`, `SUCCEED` and `SUCCEEDED` finish with `videos[0].video_url`. `TASK_STATUS_FAILED` and `FAILED` are ordinary failures (502). Any other status string is pending.
- Answer `{ created, data: [{ url, format: "mp4" }] }`. `nativeUnits.videos` is 1, the cost is unknown, and `meta.jobId` keeps the Novita task id. `response_format` is `url` only.
- Timing: 300 s job deadline and 2.5 s poll interval from the source. `timeout_ms` (≤ 600 s) and `poll_interval_ms` (1 s–120 s) are honored as in the source and never forwarded; a non-positive or non-number value is a 400. Each submit and each status request is bounded at 30 s. A 429 or 503 status check is retried up to 5 times with backoff that honors `Retry-After`.
- The key is the selected connection's `apiKey`, falling back to `accessToken` as the source did. A key containing CR or LF is refused. The connection's proxy options are applied. A connection base URL is ignored; the key only goes to `https://api.novita.ai`.
- Nothing is cached between calls. Concurrent calls from two connections keep their own keys and task ids, and a test covers this.

## Errors, uncertainty and no replay

- Redirects are refused (`redirect: "manual"`). A 3xx submit answer is a 502 without `acceptedJob`. An answer from another origin, or one marked `redirected`, carries `acceptedJob` (`submit-unknown`).
- Refused submit answers:

  | Answer | Result |
  | --- | --- |
  | 402, or a 400/403/429 whose `reason` matches `quota`, `balance`, `credit` or `insufficient` | 402 with `quotaExhausted: true`. |
  | 401 or 403 | Passed through. |
  | 429 | Rate limited, with `Retry-After` evidence when present. |
  | Other 4xx | Status passed through. |
  | 5xx | 502 with `acceptedJob` (`submit-unknown`). |

  The message carries only the status and a `reason` code of a safe shape (for example `NOT_ENOUGH_BALANCE`); never the upstream `message`, `task.reason` or the key.
- A transport failure before any connection (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, connect timeout) is a plain 502. Any later transport failure or a submit timeout carries `acceptedJob` (`submit-unknown`). Nothing is resent.
- A caller abort before the send is a 499 without `acceptedJob`; after the send, a 499 with `acceptedJob`. The deadline and the caller abort both tear down the socket through the fetch signal and stop the poll wait. The source's submit had no signal or deadline.
- After a task is accepted, these are unknown outcomes with `acceptedJob` (`accepted`): `UNKNOWN_ERROR` (the source called it a failure, but it does not say whether the work ran), an unreadable status body (the source kept polling), an answer without `task` or without a status string, an answer about another `task_id`, success without a usable public https URL (`data:`, `http:`, private or metadata hosts and userinfo are refused), a non-OK poll (401, 403 and 429 are passed through), a redirected poll, retry exhaustion, the deadline (504), and an abort. A submit answer without a usable `task_id` is also an unknown outcome.

## Refused before any billable send (the source dropped or replaced these)

- Unknown model, empty or non-string prompt (the source stringified it), a prompt over 8,000 characters.
- `n` other than 1, `stream`, `response_format` other than `url`.
- Any field outside `model`, `prompt`, `negative_prompt`, `duration`, `seconds`, `size`, `n`, `response_format`, `user`, `stream`, `timeout_ms`, `poll_interval_ms`. This covers input images, seeds, aspect ratios, steps and guidance, which the source silently dropped.
- A fractional, zero, negative or over-60 duration; a `size` that is not exactly `WxH` (the source accepted a prefix and dropped an unparseable value).

## Remaining restrictions

- Per-model fields: the source sends the same five fields to both models, and this port keeps that. Whether `kling-v1.6-t2v` honors `width`/`height`, or which durations each model accepts, was not verified live; Novita's own refusal (4xx) is passed through without `acceptedJob`.
- Model discovery: the source has no dynamic discovery for Novita video; the list is static. The provider's `/openai/v1/models` discovery lists chat models and is not used for video.
- Image-to-video and other Novita async video models: not in the source registry, so not offered.
- Base64 output: the source answered the URL too; `b64_json` is refused before submit.
- Cancellation: no upstream cancel is sent, and the source sends none. An abandoned task may still run and bill; `acceptedJob` records it.
- `/v1/videos`: the async proxy (`videoCore.js`) gets no Novita config, because it has no accepted-job ledger.
- No live Novita call was made. The wire shapes come from the pinned source only.

## Registration (separate, serial)

See `registration.json` → `integrationPoints`:

1. Add `novita` to `VIDEO_GENERATION_ADAPTERS`.
2. In `registry/novita.js`: set `serviceKinds` to `["llm", "video"]` and add the two video model rows (`kind: "video"`). Keep alias `novita`, `authType: "apikey"`, the Bearer transport, the chat base URL and `validateUrl`.
3. Update the docs catalog.
4. Replace the isolated `staging state` test block with positive registry identity assertions.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-novita-video.test.js --maxWorkers=2
# Test Files 1 passed (1) · Tests 62 passed (62)
npx eslint open-sse/services/providerParity/native-novita-video tests/unit/native-novita-video.test.js
# clean
node scripts/check-anti-slop.mjs
# anti-slop gate OK
```
