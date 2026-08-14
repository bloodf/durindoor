# Upstream Port Ledger — D1 PR Batch (2026-08-09)

Scope: `decolua/9router` open PRs #3117, #3081, #3083, #3088, #3078.

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| #3117 `fix(translator): preserve image blocks when routing Claude -> Antigravity` | GAP | DurinDoor's `convertOpenAIContentToParts` (Gemini format helper) and `wrapInCloudCodeEnvelopeForClaude` (Claude→Antigravity envelope builder) emitted the non-standard `mime_type` key for `inlineData` instead of Gemini's `mimeType`, and Claude tool-result content arrays carrying raw OpenAI `image_url` items were dropped — only `CLAUDE_BLOCK.IMAGE` base64 blocks were recognized, so tool-result images never reached Antigravity. | Ported: emit `inlineData.mimeType` at all four production sites in `open-sse/translator/formats/gemini.js` (image data URI, `input_audio`, audio data URI, file/document); teach `wrapInCloudCodeEnvelopeForClaude` in `open-sse/translator/request/openai-to-gemini.js` to recognize raw `image_url` items (via `parseDataUri`) inside `CLAUDE_BLOCK.TOOL_RESULT` content, attaching them as `functionResponse.parts` image entries alongside the existing base64-image path. Updated stale `mime_type` expectations in `tests/unit/gemini-chat-file-data-pdf.test.js`, `tests/unit/file-block-routing.test.js`, `tests/unit/multimodal-drop-lock.test.js`, and `tests/translator/__snapshots__/golden-request.test.js.snap` to the corrected `mimeType` contract. |
| #3081 `fix(executor): request stream usage when internally streaming` | GAP | `DefaultExecutor.transformRequest` in `open-sse/executors/default.js` never asked OpenAI-compatible upstreams to include usage in the final SSE chunk for internally-streamed requests, so `/v1` streaming responses through generic providers recorded `IN 0 · OUT 0` instead of real token counts. | Ported: inject `stream_options = { include_usage: true }` when `stream === true`, the body has `messages`, and the client did not already send `stream_options`, placed after `stripUnsupportedParams` so the field survives param stripping. |
| #3083 `fix(usage): account nested cached prompt tokens` | DUPLICATE | `open-sse/utils/usageTracking.js:211` already computes `cached = num(usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens)`, equivalent to the upstream fix. | No port. |
| #3088 `fix(kimi): use API-key OpenAI transport` | PENDING | Not yet ported in this pass. | — |
| #3078 `fix(security): restrict pxpipe routes to local access` | GAP | Historical finding: `LOCAL_ONLY_PATHS` in `src/dashboardGuard.js` had no `/api/pxpipe` prefix, leaving every pxpipe control endpoint outside the existing loopback/CLI-token guard. | Historical port superseded: blanket local-only routing was replaced by dedicated PXPIPE authorization; see the #3078 implementation record below. |

## Implemented changes (#3117)

- `open-sse/translator/formats/gemini.js`
  - `convertOpenAIContentToParts`: `inlineData.mimeType` (was `mime_type`) at the image data-URI, `input_audio`, audio data-URI, and file/document sites.
- `open-sse/translator/request/openai-to-gemini.js`
  - `wrapInCloudCodeEnvelopeForClaude`: `CLAUDE_BLOCK.TOOL_RESULT` content-array handling now also recognizes raw `{ type: "image_url", image_url: { url } }` items (via `parseDataUri`) and attaches them to `functionResponse.parts`, in addition to existing base64 `CLAUDE_BLOCK.IMAGE` handling.
  - Added `parseDataUri` import from `../concerns/image.js`.
- Tests:
  - `tests/unit/gemini-inline-data-mime-type.test.js` (new) — asserts `mimeType` contract for all four `convertOpenAIContentToParts` sites.
  - `tests/translator/bugs-antigravity.test.js` — new `describe("Claude → Antigravity image preservation", ...)` covering user image + tool-result image preservation end to end.
  - Updated `mime_type` → `mimeType` expectations in `tests/unit/gemini-chat-file-data-pdf.test.js`, `tests/unit/file-block-routing.test.js`, `tests/unit/multimodal-drop-lock.test.js`, `tests/translator/__snapshots__/golden-request.test.js.snap`.

## Verification (#3117)

- Focused suite: `unit/gemini-inline-data-mime-type`, `unit/gemini-chat-file-data-pdf`, `unit/file-block-routing`, `unit/multimodal-drop-lock`, `translator/golden-request`, `translator/bugs-antigravity` — 6 files, 51 tests passed.
- Revert-proof: reverting `gemini.js` + `openai-to-gemini.js` alone (tests unchanged) produced 14 failures across all 6 files (RED); restoring the source edits returned 51/51 passing (GREEN).


## Implemented changes (#3081)

- `open-sse/executors/default.js`
  - `transformRequest`: after `stripUnsupportedParams(...)`, inject `transformed.stream_options = { include_usage: true }` when `stream === true`, `transformed.messages` is present, and no `stream_options` was already set by the client.
- Tests:
  - `tests/unit/default-executor-stream-usage.test.js` (new) — asserts injection on streaming requests, no injection on non-streaming requests, and preservation of a client-supplied `stream_options`.

## Verification (#3081)

- Focused suite: `unit/default-executor-stream-usage.test.js` — 3/3 passed (GREEN).
- Revert-proof: reverting `open-sse/executors/default.js` alone (test unchanged) produced 1 failure — `expected undefined to deeply equal { include_usage: true }` — the other two tests passed trivially since no injection also satisfies "no injection"/"preserve existing" assertions on unrelated paths; restoring the source edit returned 3/3 passing (GREEN).

## Implemented changes (#3078)

Historical implementation (superseded):

- `src/dashboardGuard.js`: added `/api/pxpipe` to `LOCAL_ONLY_PATHS`.
- `tests/unit/dashboard-guard.test.js`: asserted remote requests to `/api/pxpipe/start` and `/api/pxpipe/status` failed with the local-only 403.

Current authorization contract:

- PXPIPE management endpoints use dedicated authorization instead of blanket local-only routing.
- Proxied requests require a dashboard JWT or machine-bound CLI authentication even when `requireLogin` is disabled.
- Direct loopback requests follow the normal local `requireLogin` policy.
- API keys are not PXPIPE management credentials.

Source / coverage pointer:

- Implementation: `src/dashboardGuard.js` — `isPxpipePath` matcher and `canAccessPxpipeRoute` authorization helper implement the contract above.
- Tests: `tests/unit/dashboard-guard.test.js` exercises both helpers (proxied + loopback matrix, JWT / CLI-token / API-key cases, `requireLogin` disabled behavior).

## Verification (#3078)

Historical verification for the superseded blanket-local implementation:

- Focused suite: `unit/dashboard-guard.test.js` — 36/36 passed (GREEN).
- Revert-proof: before the source edit, both new pxpipe tests failed with `expected 401 to be 403`; restoring the source edit returned 36/36 passing (GREEN).