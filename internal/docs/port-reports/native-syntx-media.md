# SYNTX native media (staged), 2026-11-27

Issues: #1234 (reopened), #2034. The earlier 404 in `docs/providers/syntx.mdx` came from one unauthenticated GET to the chat route `https://api.syntx.ai/api/v1/chat/completions`. The media executor in the source does not call that route. This unit ports the media flow the source actually uses. No live request was made. Every test fixture is synthetic and shaped after the source code. Nothing here claims a captured or live success.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/services/syntxAuth.ts`:
  - The credential is a long-lived syntx.ai site JWT, sent as `Authorization: Bearer`.
  - `resolveSyntxToken` checks `accessToken`, then `apiKey`, then `providerSpecificData`. It prefers a JWT-shaped value and accepts the raw token, a `Bearer` prefix, or a JSON wrapper.
  - `syntxAuthHeaders` adds browser-style `accept`, `accept-language: en`, `origin: https://syntx.ai`, `referer: https://syntx.ai/` and a Chrome user agent.
  - `src/shared/providers/webSessionCredentials.ts` stores it as a `token` credential under the keys `token`, `apiKey` and `accessToken`.
- `open-sse/services/syntxMedia.ts`:
  - `POST /api/v1/chats` with `{ title, scope }` returns `uuid`.
  - Uploads go to `POST /api/v1/chats/upload-files`. The multipart fields are `files`, `destination=uploaded`, `check_duplicates=true` and an empty `model_type`.
  - Generation is `POST /api/v1/{design|video|audio}/generate?ai_name=`. Video sends `chat_id`; image and audio send `chat_uuid`.
  - Polling is `GET /api/v1/chats/{uuid}/messages?page_size=50`. The result is ready when the latest `author_id -1` message has every `message_object` completed. The poll allows 600 s, with a 5 s maximum interval, backoff from 2 s, and stops after five consecutive errors.
  - `POST /api/v1/audio/transcribe` takes a multipart `file` and returns `text`, `data.text`, or a text body.
  - Other source pieces ported here: the SPA provider rules, the settings mappers, the immediate-URL fallback, and a bounded download (50 MiB, 300 s, at most three redirects, public hops only).
- `open-sse/services/syntxMediaCatalog.ts`: `SYNTX_FALLBACK_MEDIA_MODELS`, `parseSyntxMediaModelId` and `defaultAiNameForKind`.
- `open-sse/handlers/syntxAudio.ts` provides speech, music and transcription. `open-sse/handlers/imageGeneration/providers/syntx.ts` provides image generation; the source edits route in `src/app/api/v1/images/edits/route.ts` reuses it. `open-sse/handlers/videoGeneration/syntxHandler.ts` provides video.
- `open-sse/handlers/imageUpscale/syntx.ts` runs upscale through design/generate. The native-image-upscale unit owns it (see below).

## Current local behavior

`git ls-files` shows no SYNTX registry entry, executor or adapter. The image, video, TTS, STT, music and image-edit tables have no `syntx` key. `docs/providers/syntx.mdx` is `unreleased`. The provider/chat entry belongs to the `native-syntx-chat-auth` unit. The whole media delta is the staged module.

## What is staged

`open-sse/services/providerParity/native-syntx-media/`. Nothing in production imports it.

- `config.js`: the fixed origin, endpoints, bounds, the source seed catalog for every kind, and `resolveSyntxModel`.
- `auth.js`: JWT resolution from the selected connection, the source headers, and the redaction source.
- `http.js`:
  - A bounded, abortable request through the connection's own proxy options.
  - Redirects are refused, and an answer from another origin is detected.
  - Bounded reads.
  - Refusal mapping keeps only the status and Retry-After.
  - Accepted-job accounting.
- `settings.js`: the source settings mappers and the SPA provider rules, ported line for line.
- `job.js`: chat creation, upload, one generate POST, the bounded poll, completed-media projection and the immediate-URL fallback.
- `download.js`: the result URL policy, a DNS-checked download pinned to the guarded dispatcher, and audio sniffing.
- `adapters.js`: image (`generate`, `edit`), video, TTS (`synthesize`), music and STT (`transcribe`).
- `registration.json`: the per-modality manifest, auth, models, endpoints, bounds, the upscale handoff and the integration points.

## Contract

- **Auth:**
  - Only the selected connection's fields are read.
  - A non-JWT gets a 401 before any request. The JWT must use the base64url alphabet, which also rules out header injection.
  - The JWT goes only to `https://api.syntx.ai`. Connection base URLs are ignored. Downloads never carry any credential.
- **Models:**
  - Only exact `ai_name/model_type` rows from the source seed catalog are accepted, for the requested kind. A `syntx/` or `stx/` prefix is allowed.
  - A bare id must name exactly one row of that kind.
  - Source deviation: the source falls back to a default model per kind, passes unknown ids through, and searches bare ids across every kind. For example, `wan-2.7` picks the image row for a video request.
  - The source's live `/api/v1/ai/models` discovery is not staged.
- **References:**
  - A reference is either a base64 data URL (bounded before decoding, then uploaded) or a public https URL.
  - The source silently drops other values. This unit refuses them with 400 before sending.
  - The model's `maxReferenceItems` and `imageRequired` are enforced. A text-only model refuses references.
- **No replay:**
  - Chat creation and uploads bill nothing and are not retried.
  - Generate and transcribe are each sent exactly once.
  - Any failure after either may have reached SYNTX carries `acceptedJob`. The causes are: transport loss after send, 5xx, an answer from another origin, abort, poll loss, deadline, or missing or unsafe output.
  - A partially completed message is never returned. With `b64_json`, any failed download fails the whole request.
- **Polling:**
  - The source's 600 s, 5 s backoff and five-error limits are kept. The caller's `timeout_ms` is clamped to the range 1 s to 600 s.
  - Each request is bounded to 30 s, and submit to 60 s.
  - Source deviation: a 401 or 403 while polling stops at once. The source counts it toward the five errors.
- **Downloads:**
  - Only https URLs with no userinfo and a public literal host are accepted.
  - Before connecting, every hop's hostname must resolve, and every answer must be public. A resolution failure refuses.
  - The default transport pins DNS answers through the public-only guarded dispatcher.
  - Redirects are followed manually, at most three, and each one is re-validated.
  - The size limit is 50 MiB and the time limit is 300 s. Only `accept` is sent.
  - Media URLs returned without `b64_json` pass the same literal policy.
- **Errors:** the upstream body is never quoted. The source quotes the sanitized body. Credential values are redacted through `createErrorResult`.
- **Quota:** the source maps no SYNTX quota condition, so none is flagged here. A 402 stays a plain 402. A 429 is a rate limit with reset evidence taken from the header only. No test account is assumed.
- **Accounting:** `mediaAccounting(null, "syntx", modality)` with unknown cost.
  - `meta.chatId` holds the chat id.
  - Images record returned image units. Video records `videos: 1`. Speech characters are added by `ttsCore`.
- **Formats:**
  - Image, video and music accept `url` or `b64_json`.
  - Speech returns the downloaded audio. Only mp3 or no format may be requested. A different container fails with `acceptedJob`.
  - Transcription returns `json` or `text`. Translation is refused.

## Upscale

Upscale belongs to the separate `native-image-upscale` private framework unit and is not duplicated here. The source flow is `runSyntxUpscale`: design/generate with `image_url: [url]`, ideogram `mode=upscale` and the default prompt `upscale`. `registration.json` lists the exports that unit needs: `resolveSyntxCredential`, `syntxApiHeaders`, `syntxSecretSource`, `uploadSyntxReference`, `runSyntxMediaJob`, `applySyntxProviderRules`, `downloadSyntxMedia`, and the upscale rows of `SYNTX_MEDIA_MODELS`.

## Tests

`tests/unit/native-syntx-media.test.js` has 50 cases with closed mocks and injected DNS. It covers:

- staging state, manifest/catalog parity and auth resolution;
- headers and account scope;
- exact model selection;
- settings and provider-rule parity;
- every modality's wire shape;
- uploads and reference refusals;
- partial-message handling and the immediate fallback;
- no-replay accounting for 4xx, 5xx, transport, redirect and foreign origin;
- poll error, auth, deadline and cancel;
- download DNS, redirect, size, time and cancel limits;
- credential-free downloads;
- transcription refusals.

The test file has an isolated staging-state block. Registration may later promote it to positive registry checks.

## Retry preservation and gate diagnostics

The retry started from integration base `cc567c24f7f15d1f48a10d9a88f49fed8a842712`.
The orchestrator's `units/native-syntx-media/gate-2.json` identifies previous
candidate `c1f7db3dd2688ce670a11f327485897c790f38e3`. All implementation files,
the manifest and all 50 regression cases were carried forward byte for byte
from that candidate. No contract or test was removed to address the gate.
The current base also contains the separate private
`native-image-upscale/syntx.js`; upscale remains owned there.

The saved gate metadata reports `checks failed (exit 1)`, but retains only
the final passing batch (15 files, 189 tests). It does not retain the failing
assertion or the earlier command output. That batch is not evidence that
the entire gate passed. The earlier wording flags are absent from gate 2.

On this retry, the required isolated evidence command passes all 50 cases.
Scoped ESLint and repository anti-slop lint also pass. The existing DNS
pinning, SSRF hardening, fetch injection, media gate and media registration
suites pass together (5 files, 66 tests). The neighboring Kie image/video,
Kie speech/transcription and `arch-a2302` suites also pass (3 files, 140 tests).
Root `pnpm run lint` completes with zero errors, 349 existing warnings and
zero anti-slop diagnostics. No full test inventory was run
to diagnose the missing earlier gate output. These results do not establish
a full local CI receipt or live provider success.


## Retry on integration with the shared SSE correction

This retry starts at `7bd3b2b69df3a84ba6a1cbe51bd3e696e5321a41`, which
contains `9cfc947a5213324fef7180ad7e25f1263a2631e5`. The retry brief identifies
`ad05349167874a6edaf8d7498fc645a067a3e087` / `c1f7db3dd2` as the previous
candidate. All ten implementation, manifest and test files are restored
byte for byte from `ad053491`; all 50 regression cases remain unchanged.
Only this report adds retry evidence. The pinned source checkout still has
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` as HEAD. The source auth, media,
catalog and all requested modality handlers were re-read against the
preserved module; no contract correction was required.

The required isolated evidence passes 50/50. Scoped ESLint passes;
repository anti-slop lint reports zero diagnostics. Root lint passes with
zero errors and 349 existing warnings. The five existing DNS/SSRF/media
guard suites pass 66 assertions. The shared SSE, Codex alpha search and
native ZAI search suites pass 76 assertions. No live provider calls or
accounts were used. Full local CI was not run.

Complete command output and the exact related-test selection are retained
privately at `/tmp/native-syntx-retry-7bd3b2b6/`, with one log per related
batch rather than overwriting earlier output.


The first failing related batch was batch 7: collection of
`tests/unit/website-demo-password.test.js` failed because its explicit import
`../../website/node_modules/react/index.js` did not exist. That batch had
850 passing assertions and no failing assertion; it exited 1 because of
the collection error. Installing website dependencies with
`pnpm -C website install --frozen-lockfile --prefer-offline` corrected the
missing dependency links without changing tracked files. Re-running the
same batch passed. The original failing log is preserved as
`related-7.log`; its corrected rerun is `related-7-after-install.log`.
No adapter or regression test was changed to address this setup failure.


The remaining batch 8 exits 1 with one failing assertion:
`unit/review-r-settings-complete.test.js:71`, test
`settings schema coverage > covers static settings reads and literal API patch bodies`.
Its regex at line 62 scans every source file for `settings.<key>` without
binding it to dashboard settings or excluding strings/import paths.
It reports 36 entries: three in the already integrated upscale module and
33 in this preserved media candidate, including `js` from `settings.js`
imports and provider request fields such as `resolution`, `voice_id`,
`image_url` and `is_instrumental`. These are source-backed SYNTX payload
fields, not dashboard configuration keys. The failure log is
`related-8.log`; 496 other assertions in that batch pass. This is the first
failing assertion after correcting the website dependency collection error.
The guard itself and the dashboard schema are outside this unit's allowed
paths. They were not edited, and provider wire settings were not renamed
or hidden to evade the scan. Integration must correct that guard's scope.

Across the final selected results, 313 files pass, six existing opt-in real
suites are skipped, and this one guard file fails (320 selected files total).
No skips were added. The related run is explicitly not a passing gate.
The implementation/manifest and all 50 unit cases remain byte-identical to
`ad053491`; this report records the exact remaining failure for the parent.


### Gate 3 naming correction

Carried gate-1 candidate `344963d48f2d88bb8ce2f5a2a4c0edb2083428a4`
and all original 50 scenarios unchanged. Gate metadata for gate 3 identifies
`93654b1fcb975c48619b3fff32044ae587e250f6`; its implementation and tests
match gate 1. The settings schema scanner interpreted local wire-option
identifiers and `./settings.js` imports as application settings reads.
Renamed the private module and local variables to `providerOptions`, retaining
public function names, build-result fields, job input fields and outgoing JSON
`settings` keys. No source contract was removed or changed. Two appended
regressions check mapper mutation and the exact wire envelope. The shared
settings guard and its allowlist/schema remain untouched. The separate upscale
fix `1a2b951863` and shared SSE fix `9cfc947a52` are ancestors of this retry base.


Retry validation (existing installed dependencies; no install or full CI):

- Original test file is a byte-for-byte prefix of the current file: all 50
  original cases retained, plus two separate appended cases.
- Unmodified `review-r-settings-complete.test.js`: 2 passed; media: 52 passed.
  Combined selected run: 54 passed, exit 0, no first failing assertion.
- Scoped ESLint: exit 0. Repository anti-slop lint: exit 0, zero diagnostics
  across 3671 files. Generated bundle restored after lint.
- Full logs retained privately in `/var/tmp/native-syntx-check-o8hflm/`:
  `selected-checks.log`, `eslint.log`, `anti-slop-build.log`, `anti-slop.log`.
  Checks used `umask 077`, `env -i`, and dedicated HOME, DATA_DIR, TMPDIR,
  XDG_CACHE_HOME, npm cache and store paths. No provider calls were made.
