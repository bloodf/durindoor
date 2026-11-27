# Grok CLI native video (staged), 2026-11-27

Issue: #2034. Decision 15 accepted the `grok-cli` video delta (registry `format: "xai-video"` on the Grok Build proxy).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/videoRegistry.ts`, entry `grok-cli`: `id: "grok-cli"`, `alias: "gc"`, `baseUrl: ${GROK_BUILD_PROXY_BASE_URL}/videos`, `statusUrl: ${GROK_BUILD_PROXY_BASE_URL}/videos`, `authType: "oauth"`, `authHeader: "bearer"`, `format: "xai-video"`, model `grok-imagine-video` ("Grok Imagine Video (OAuth)").
- `open-sse/config/grokBuildEndpoints.ts`: `GROK_BUILD_PROXY_BASE_URL = "https://cli-chat-proxy.grok.com/v1"`.
- `open-sse/handlers/videoGeneration.ts`: `format === "xai-video"` dispatches to `handleXaiVideoGeneration` with the caller's signal (shared with the API-key `xai` entry).
- `open-sse/handlers/videoGeneration/xaiGrokImagineHandler.ts`:
  - Body `{ model, prompt, image?, reference_images?, duration?, aspect_ratio?, resolution? }`. A string `image` becomes `{ url }`; `duration` goes through `Number()`.
  - Create: `POST {baseUrl}/generations`, one-shot body, `redirect: "error"`, job deadline signal. A create timeout is a 504 "not resubmitted".
  - `request_id` must match `^[A-Za-z0-9_-]+$`. Poll `GET {statusUrl}/{request_id}` every 2.5 s (floor 1 s) for up to 300 s (ceiling 30 min) and 300 polls; `timeout_ms`, `poll_interval_ms` and `max_polls` out of range are a 400.
  - `status: "done"` with `video.url` → `{ created, data: [{ url, format: "mp4" }] }`; `"failed"` → 502; anything else keeps polling. Responses are capped at 1 MiB. Upstream `error.message` was returned after sanitizing.
  - For `provider === "grok-cli"`, `resolveXaiRequestAuth` swaps in `getGrokMediaToken(credentials)` and `grokMediaHeaders(token)`.
- `open-sse/handlers/grokMedia.ts`: `getGrokMediaToken` requires `accessToken`, runs the registered refresher and refuses an expired token (401). `grokMediaHeaders` = `getGrokBuildClientHeaders("headless")` (`x-grok-client-version`, `x-grok-client-identifier: grok-shell`, `x-grok-client-mode: headless`, `User-Agent: grok-shell/<ver> (<os>; <arch>)`) + `X-XAI-Token-Auth: xai-grok-cli` + `Authorization: Bearer <token>`.

Compared reference: CLIProxyAPI `47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e` (`/tmp/cpa-2034`). `internal/runtime/executor/xai_executor_media.go` `executeVideos` sends OAuth xAI video to the cli-chat-proxy base (`xaiChatBaseURL`) with `/videos/generations`, `/videos/edits`, `/videos/extensions` and `GET /videos/{request_id}`, but with the generic `applyXAIHeaders` (no `x-xai-token-auth`, no CLI identity), and forwards `x-idempotency-key`. The OmniRoute header set is the one ported. Edits and extensions are not in the OmniRoute `grok-cli` contract and are not ported.

## Fresh-main check

- `open-sse/providers/registry/grok-cli.js` exists: `authModes: ["oauth"]` (device code), alias `gb`, aliases `gcli` and `grok-build`, Responses transport `https://cli-chat-proxy.grok.com/v1/responses`, chat `modelsUrl`, no `serviceKinds` (defaults to `["llm"]`), no `videoConfig`, no video models.
- `getVideoGenerationAdapter("grok-cli")` is null and `getVideoConfig("grok-cli")` is null, so neither `/v1/video/generations` nor `/v1/videos` serves it.
- `open-sse/handlers/videoCore.js` is the only xAI-shaped video path. It serves `xai` (`videoConfig` `https://api.x.ai/v1/videos`, API key) as a byte passthrough of `generations`/`edits`/`extensions` plus `GET /videos/{id}`. Its `buildHeaders` sends only `Accept`, `Authorization`, `Content-Type` and `Idempotency-Key`; a bare `grok-cli` `videoConfig` would therefore miss the source token-auth and client-identity headers, so it is not an equivalent. The `xai` API-key mode stays on that path, unchanged.
- No local code sends to `cli-chat-proxy.grok.com/v1/videos`. The delta is real.
- Alias: the source alias `gc` is the local Gemini CLI alias. It is not adopted; the existing `gb` / `gcli` / `grok-build` aliases are kept.

## What landed

All new files are under `open-sse/services/providerParity/native-grok-cli-video/`:

| File | Role |
| --- | --- |
| `config.js` | Fixed origin and endpoints, Grok client identity, models, source bounds. |
| `request.js` | Body builder with pre-submit validation; source timing knobs. |
| `http.js` | OAuth token check, media headers, bounded fetch, redirect refusal, bounded JSON, refused-answer mapping, public URL check, accepted-job accounting. |
| `job.js` | Create + bounded poll. |
| `adapter.js` | `VIDEO_GENERATION_ADAPTERS` contract (`async`, `models`, `responseFormats: ["url"]`, `generate`). |
| `index.js` | Exports. |
| `registration.json` | Exports, ids, aliases, models, endpoints, auth and integration points. |

Tests: `tests/unit/native-grok-cli-video.test.js` (57 closed-mock tests). Staging-only negatives live in one isolated `staging state (isolated)` block.

## Supported subset

- Endpoint: `/v1/video/generations` (synchronous adapter), model `grok-imagine-video`, `response_format: "url"`, `n: 1`, no streaming.
- Fields: `prompt` (string, ≤ 8000 chars), `image` (public https URL or base64 `data:image/{png,jpeg,jpg,webp,gif}` URI, string or `{ url }`), `reference_images` (1–8 of the same), `duration` (integer 1–15 s), `aspect_ratio` (`N:M`), `resolution` (`NNNp`), and the never-forwarded knobs `timeout_ms`, `poll_interval_ms`, `max_polls` with the source ranges. Any other field is a 400.
- Auth: the selected connection's OAuth `accessToken` only, sent only to `https://cli-chat-proxy.grok.com` with the source header set. The fork pins `x-grok-client-version` and `User-Agent` to `open-sse/config/grokCli.js` (`GROK_CLI_VERSION`, `GROK_CLI_SHELL_USER_AGENT`) because the proxy rejects older identities with 426; the source default was `1.0.41` with an env override. `apiKey` and connection base URLs are ignored.

## Fork deviations (safety)

- Each create and status request has its own bound (60 s / 30 s) inside the job deadline; the caller signal aborts the request, the body read and the poll wait.
- `redirect: "manual"`; any redirect or foreign-origin answer is refused and never followed with the token.
- Upstream text never reaches the client: only status, a safe-shaped vendor `code` and a bounded `Retry-After`.
- 402 (e.g. `personal-team-blocked:spending-limit`) and quota codes on 400/403/429 → 402 with `quotaExhausted` for the selected connection only. 401/403 pass through; 429 carries rate-limit evidence.
- Nothing is resent. A create with an uncertain outcome (5xx, timeout, reset, abort after send, foreign redirect, unreadable or id-less answer) carries `acceptedJob` (unknown cost). Proven pre-connect failures and pre-send aborts do not.
- After acceptance, every outcome except a reported `"failed"` job carries `acceptedJob`: poll cap, deadline, poll 401/403/5xx, unreadable status, a status about another job, a done job without a public https `video.url`, caller abort.
- 429/503 status answers retry up to 5 times with backoff (≤ 30 s) inside the deadline.
- Result URLs must be https, public host, no userinfo; they are returned, never downloaded.
- Usage: one video plus `video.duration` seconds when reported; cost stays unknown unless a recognized USD receipt is present. The source `saveCallLog` is replaced by the gateway ledger.
- Token refresh is not done in the adapter. An expired `expiresAt` is a 401 before sending, as in the source. Refresh belongs to the route, so the selected connection identity and billing stay fixed (integration point below).

## Remaining restrictions

- No `/v1/videos` async proxy, `edits`, `extensions` or content download for `grok-cli`. Adding them needs Grok media headers in `videoCore.js` and is not in the OmniRoute `grok-cli` contract.
- No dynamic video model discovery: the source has a static list; the chat `/v1/models` discovery must not feed video.
- Not verified against the live proxy; all evidence is closed mocks.

## Registration (serial, not done here)

1. `open-sse/handlers/videoProviders/index.js`: add `"grok-cli": grokCliVideoAdapter`.
2. `open-sse/providers/registry/grok-cli.js`: `serviceKinds: ["llm", "video"]`, add the `grok-imagine-video` row with `kind: "video"`; keep aliases, OAuth-only mode and chat transport; no `videoConfig`.
3. `src/sse/handlers/video.js`: refresh `grok-cli` with `checkAndRefreshToken` before the dispatch snapshot, as for `renderhour`.
4. `docs/providers/catalog.mdx`: list the video kind.
5. Promote the isolated staging block in the test to positive registry identity checks.

## Evidence

```
cd tests && node node_modules/vitest/vitest.mjs run unit/native-grok-cli-video.test.js --maxWorkers=2
Test Files  1 passed (1)
     Tests  57 passed (57)
```

`npx eslint open-sse/services/providerParity/native-grok-cli-video tests/unit/native-grok-cli-video.test.js` exits 0.
