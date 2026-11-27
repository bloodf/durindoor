# MiniMax native video (staged), 2026-11-27

Issue: #2034. Decision 15 accepted the `minimax` video delta (registry `format: "minimax-video"` → video dispatcher).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `minimax`: baseUrl `https://api.minimax.io/v1/video_generation`, statusUrl `https://api.minimax.io/v1/query/video_generation`, authType `apikey`, authHeader `bearer`, filesUrl `https://api.minimax.io/v1/files/retrieve`, format `minimax-video`, models `MiniMax-Hailuo-2.3` ("Hailuo 2.3"), `MiniMax-Hailuo-02` ("Hailuo 02") and `T2V-01-Director` ("T2V 01 Director").
- `open-sse/handlers/videoGeneration.ts`: `format === "minimax-video"` dispatches to `handleMinimaxVideoGeneration`, without the caller's signal.
- `open-sse/handlers/videoGeneration/minimaxHandler.ts`:
  - Credential `apiKey || accessToken`; every request sends `Authorization: Bearer <key>`; the create adds `Content-Type: application/json`.
  - Body `{ model, prompt, duration?, resolution?, first_frame_image?, prompt_optimizer?, fast_pretreatment? }`. The prompt is required (≤ 2,000 characters). Duration is 6 or 10. Resolution is 720P, 768P or 1080P, uppercased. The first frame comes from `first_frame_image`, `image_url` or `image`. Every other field is dropped.
  - Reads `task_id`, then every 5 s `GET {statusUrl}?task_id=<id>` for up to 300 s (`timeout_ms` ≤ 600 s and `poll_interval_ms` ≤ 120 s through `utils/pollBounds.ts`). `Success` → `file_id`; `Fail`/`failed` → 502. 429/503 and `base_resp` 1002 retry up to 5 times (`pollRetry.ts`).
  - Then `GET {filesUrl}?file_id=<id>` → `file.download_url` → `{ created, data: [{ url, format: "mp4" }] }`.
  - Every step checks `base_resp.status_code` (0 = ok), also on HTTP 200: 1004/2049 → 401, 1008 → 402, 1002/1039 → 429, 1026/2013 → 400, else 502. The error message quoted `base_resp.status_msg`.

## Fresh-main check

- `open-sse/providers/registry/minimax.js` exists: alias `minimax`, category `apikey`, `serviceKinds` includes `video`, and the video models `MiniMax-H3`, `MiniMax-H3-Max`, `MiniMax-Hailuo-2.3`, `MiniMax-Hailuo-2.3-Fast` and `MiniMax-Hailuo-02`. `T2V-01-Director` is absent.
- Its `videoConfig` (format `minimax-multi`) has `legacyCreateUrl`, `legacyQueryUrl` and `legacyFileRetrieveUrl`. These are the same three v1 endpoints, also with Bearer auth. The async `/v1/videos` job proxy serves them (`open-sse/handlers/videoCore.js` and `videoProviders/minimax.js`, `minimax-v1:` job ids). `tests/unit/minimax-video.test.js` covers that path.
- That path is not equivalent to the source flow. Same wire endpoints and auth, but:
  - It hands a job id to the client instead of returning the video.
  - It requires both `duration` and `resolution`.
  - It never reads `base_resp.status_code`, so an HTTP 200 refusal surfaces as "did not return a video task id".
  - It quotes upstream bodies (sanitized) in errors.
  - It has no accepted-job accounting.
  - It does not know `T2V-01-Director`.
- `/v1/video/generations` cannot run MiniMax today. `getVideoGenerationAdapter("minimax")` is null (`VIDEO_GENERATION_ADAPTERS` holds `alibaba`, `ali`, `renderhour`, `adobe-firefly-api` and `adobe-firefly-web`). `handleVideoGenerationCore` answers 400 and points to `/v1/videos`.
- The delta is the synchronous create → poll → file-retrieve adapter, plus `T2V-01-Director`. The async proxy is left as it is.

## What landed

All new files are under `open-sse/services/providerParity/native-minimax-video/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and endpoints, auth header, models with per-duration resolution tables, task states, `base_resp` refusal codes, and bounds. |
| `http.js` | Bounded abortable fetch, redirect refusal, bounded JSON reads, `base_resp` parsing, refusal mapping without quoting upstream text, the public https URL check, and accepted-job accounting. |
| `request.js` | `buildMinimaxVideoRequest` and `resolveMinimaxTiming`. |
| `job.js` | `runMinimaxVideoTask`: create, bounded poll, file retrieve. |
| `adapter.js` | `createMinimaxVideoAdapter` (`VIDEO_GENERATION_ADAPTERS` contract). |
| `index.js` | Re-exports, plus the default `minimaxVideoAdapter`. |
| `registration.json` | Exports, canonical ID and alias, models, endpoints, auth, local equivalence notes, and the registration steps. |

Tests are in `tests/unit/native-minimax-video.test.js`: 83 tests over a closed network.

Nothing is registered. `videoProviders/index.js`, `providers/registry/minimax.js` and the docs catalog are unchanged. Only the isolated `staging state` test block asserts that. The metadata tests check that the staged URLs and the Hailuo resolution tables match the existing `videoConfig` legacy fields.

## Supported subset

- Models `MiniMax-Hailuo-2.3`, `MiniMax-Hailuo-02` and `T2V-01-Director` only. The source's list does not include `MiniMax-Hailuo-2.3-Fast` or the H3 models, so they are refused here; they stay on `/v1/videos`.
- Create `POST https://api.minimax.io/v1/video_generation`, headers exactly `Authorization: Bearer <key>` and `Content-Type: application/json`.
- Body `{ model, prompt, duration?, resolution?, first_frame_image?, prompt_optimizer?, fast_pretreatment? }`. Optional fields go out only when given, so MiniMax applies its own defaults, as in the source.
  - `prompt`: required, trimmed, ≤ 2,000 characters.
  - `duration` or `seconds` (number or digit string): whole seconds the model offers. Both together must agree.
  - `resolution`: uppercased and checked against the model's table for the requested duration, or 6 s when none is sent:

    | Model | Text-to-video | Image-to-video |
    | --- | --- | --- |
    | Hailuo 2.3 | 6 s: 768P, 1080P; 10 s: 768P | same |
    | Hailuo 02 | 6 s: 768P, 1080P; 10 s: 768P | 6 s: 512P, 768P, 1080P; 10 s: 512P, 768P |
    | T2V-01-Director | 6 s: 720P | not offered |

    The Hailuo tables equal the local `legacyT2vConstraints` / `legacyI2vConstraints`. The Director row follows MiniMax's model documentation. The source accepted 6/10 s × 720P/768P/1080P for every model.
  - First frame: one of `first_frame_image`, `image_url` or `image`; if several are sent, they must be identical. It must be a public https URL (no userinfo, private or metadata hosts) or a base64 JPEG, PNG or WebP data URL of at most 20 MB.
  - `prompt_optimizer` and `fast_pretreatment`: booleans only.
- Query `GET https://api.minimax.io/v1/query/video_generation?task_id=<id>`, then file `GET https://api.minimax.io/v1/files/retrieve?file_id=<id>`, each with the Bearer key only. Task and file ids may be strings matching `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$` or non-negative safe integers (MiniMax sends numbers). They are URL-encoded.
- Status `Success` (any case) needs a `file_id`. `Fail` and `failed` are ordinary failures (502, with the numeric `base_resp` code when present). Any other status string (`Preparing`, `Queueing`, `Processing`) is pending.
- Answer `{ created, data: [{ url, format: "mp4" }] }`. `nativeUnits.videos` is 1, the cost is unknown, and `meta.jobId` / `meta.fileId` keep the MiniMax ids. `response_format` is `url` only; the download URL is returned, never fetched.
- Timing: 300 s job deadline and 5 s poll interval from the source. `timeout_ms` (≤ 600 s) and `poll_interval_ms` (1 s–120 s) are honored as in the source and never forwarded; a non-positive or non-number value is a 400. Each create, query and file request is bounded at 30 s. A query or file lookup answering 429, 503 or `base_resp` 1002 is retried up to 5 times, with backoff capped at 30 s that honors `Retry-After`.
- The key is the selected connection's `apiKey`, falling back to `accessToken` as the source did. A key containing CR or LF is refused. The connection's proxy options are applied. Connection and provider base URLs are ignored; the key only goes to `https://api.minimax.io`.
- Nothing is cached between calls. A test covers two concurrent connections: each keeps its own key, task id and file id.

## Errors, uncertainty and no replay

- Redirects are refused (`redirect: "manual"`). A 3xx create answer is a 502 without `acceptedJob`. An answer from another origin, or one marked `redirected`, carries `acceptedJob` (`submit-unknown`).
- Create refusals, by HTTP status or by the HTTP 200 `base_resp` code:

  | Answer | Result |
  | --- | --- |
  | 402 or code 1008 | 402 with `quotaExhausted: true`. |
  | 401, 403, code 1004 or 2049 | 401 (403 kept). |
  | 429, code 1002 or 1039 | 429, with `Retry-After` evidence when present. |
  | Code 1026 or 2013, other 4xx | 400 (or the 4xx). |
  | 5xx, or an HTTP 200 with any other non-zero code | 502 with `acceptedJob` (`submit-unknown`). |

  The message carries only the HTTP status and the numeric code; never `status_msg` or the key.
- A transport failure before any connection (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, connect timeout) is a plain 502. Any later transport failure or a create timeout carries `acceptedJob` (`submit-unknown`). Nothing is resent.
- A caller abort before the send is a 499 without `acceptedJob`; after the send, a 499 with `acceptedJob`. The deadline and the caller abort both tear down the socket through the fetch signal and stop the poll wait. This covers the create, each query and the file lookup.
- After a task is accepted, these are unknown outcomes with `acceptedJob` (`accepted`, with `meta.jobId`):
  - an unreadable answer, a malformed `base_resp`, or a non-zero code on a pending status (401, 402 and 429 mappings are passed through, else 502)
  - an answer about another `task_id`, a missing status, or success without a usable `file_id`
  - a file lookup with no `file`, another `file_id`, a refusal code, or no public https `download_url` (`data:`, `http:`, private or metadata hosts and userinfo are refused)
  - a non-OK or redirected query or file answer, retry exhaustion, the deadline (504), and an abort
- A create answer without a usable `task_id`, or with an unreadable body, is also an unknown outcome.

## Refused before any billable send (the source dropped or replaced these)

- Unknown model (including `MiniMax-Hailuo-2.3-Fast` and the H3 models), an empty or non-string prompt, or a prompt over 2,000 characters.
- `n` other than 1, `stream`, `response_format` other than `url`.
- Any field outside `model`, `prompt`, `duration`, `seconds`, `resolution`, `first_frame_image`, `image_url`, `image`, `prompt_optimizer`, `fast_pretreatment`, `n`, `response_format`, `user`, `stream`, `timeout_ms` and `poll_interval_ms`. This covers `callback_url`, `size`, `aspect_ratio` and seeds, which the source silently dropped.
- A duration or resolution the model does not offer, a first frame on `T2V-01-Director`, an unsafe first frame, and non-boolean optimizer flags.

## Remaining restrictions

- Not covered: `minimax-cn` (its own `videoConfig` on `api.minimax.cn`) and `minimax-code` (OAuth gateway). The source entry is `minimax` only.
- No dynamic model discovery: the source has a static list, and the provider's chat discovery must not feed video.
- No subject-reference, last-frame or camera-control inputs. The source did not send them.
- Registration is a separate serial step. Add `minimax: minimaxVideoAdapter` to `VIDEO_GENERATION_ADAPTERS` and the `T2V-01-Director` video row to `providers/registry/minimax.js`, as `registration.json` describes. The async `/v1/videos` path stays as it is.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-minimax-video.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 83 passed (83)
npx eslint open-sse/services/providerParity/native-minimax-video tests/unit/native-minimax-video.test.js   # clean
node scripts/check-anti-slop.mjs   # anti-slop gate OK
```
