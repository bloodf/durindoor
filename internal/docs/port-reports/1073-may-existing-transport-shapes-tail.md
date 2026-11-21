# #1073 May existing transport shapes tail

Static review of the exact OmniRoute PR heads named below against the current DurinDoor checkout. Public source links are pinned to those heads; the enclosing merge pins supplied for context are recorded separately. The supplied source mirror did not contain the three enclosing merge objects, so review uses each named head commit's patch, avoiding unrelated merge contents. CI/release and unrelated PR hunks are excluded.

## OmniRoute #1997 — narrow Claude default gap; audio CORS differs

- PR head: [`ad966b15f20f71009b33f73ec8ab7b32d5e3380e`](https://github.com/cheaper-inference/OmniRoute/commit/ad966b15f20f71009b33f73ec8ab7b32d5e3380e)
- Enclosing merge: `e162db2bff492cd7ddd3130b0e0e640a3d4f8b7f`
- Public patch adds missing-header defaults in `BaseExecutor`: Haiku clears thinking fields; non-Haiku Claude Code requests with neither thinking nor effort receive adaptive thinking, high effort, and `clear_thinking_20251015` context management. Its audio handler switches response CORS headers to shared `CORS_HEADERS`. The same patch removes `x-goog-api-client` from OmniRoute's Antigravity header scrub list.

DurinDoor does not have that `BaseExecutor` default branch. `applyThinking` normalizes an intent already present in the request or derived from explicit provider configuration; when neither exists, it returns without injecting adaptive thinking (`open-sse/translator/concerns/thinkingUnified.js`). Current fixtures verify preservation/normalization of explicit adaptive Claude requests and protocol headers, but do not establish omission defaults (`tests/unit/claude-haiku-adaptive-thinking.test.js`, `tests/unit/claude-protocol-parity.test.js`, `tests/translator/thinking-unified.test.js`). This is a narrow behavioral gap for the named Claude Code request shape. The upstream predicate is explicitly no client header override; any port should preserve client intent and should be scoped to the Claude Code/Claude provider path, with Haiku model handling consistent with current capabilities.

DurinDoor exposes STT at `src/app/api/v1/audio/transcriptions/route.js`, parses incoming multipart via `request.formData()` in `src/sse/handlers/stt.js`, and its OpenAI-compatible outbound path builds `FormData` and lets the runtime set the multipart content type and boundary (`open-sse/handlers/sttCore.js`). The public PR's CORS change belongs to OmniRoute's separate handler. DurinDoor's route explicitly supplies wildcard CORS for `OPTIONS`; the STT multipart fixtures establish outbound form fields and account ownership, not browser POST CORS behavior. No same-handler CORS defect is demonstrated by this patch comparison.

Header normalization: DurinDoor has no `antigravityHeaderScrub` equivalent or `x-goog-api-client` removal to undo. Gemini STT explicitly sends provider-owned `x-goog-api-key` and `X-Goog-Upload-*` headers in `open-sse/handlers/sttCore.js`. Do not transplant a general header-retention change from this hunk: no local scrub conflict or fixture demonstrates a gap, and provider-owned headers must remain attached to the Gemini transport.

**Disposition:** accept as report-only; document the narrow Claude omission-default gap for a separately scoped implementation. No audio transport or general header-normalization port is justified here.

## OmniRoute #2763 — no in-scope compatibility change

- PR head: [`a2436d5d47d6c492529984327c66cce5c9edc708`](https://github.com/cheaper-inference/OmniRoute/commit/a2436d5d47d6c492529984327c66cce5c9edc708)
- Enclosing merge: `bea7fe4273b9dbe998ac6004bbfbd21ce4af04e4`
- The relevant runtime hunk removes a leftover `console.error("DEBUG STACK:", error)` from chat error handling. Other changes are ad-hoc scripts. Neither changes Claude defaults, audio CORS/multipart transport, or normal header handling.

**Disposition:** no port; no relevant transport behavior difference found.

## OmniRoute #2842 — multipart shape already covered

- PR head: [`f86651f8fd52518460cd67a1639935f0df6e5996`](https://github.com/cheaper-inference/OmniRoute/commit/f86651f8fd52518460cd67a1639935f0df6e5996)
- Enclosing merge: `1f5c215cc0d218544ded9c3bda7313b893ed810e`
- The patch changes a hand-built multipart byte buffer to `Uint8Array`, quotes the boundary content type, sanitizes quote characters in filenames, and adds local serialization tests.

DurinDoor's OpenAI-compatible STT path uses runtime `FormData`/`File` serialization instead of hand-assembling multipart bytes. The ordinary offline fixture `tests/unit/stt-multipart-undici.test.js` captures the outbound FormData and checks model, language, and filename. `tests/unit/stt-translations.test.js` checks the provider-specific `/audio/translations` URL; `tests/unit/codex-stt-route.test.js` checks that credential failures rotate/refresh only the Codex account path. These fixtures support preserving runtime-generated multipart boundaries and existing provider/account ownership. No evidence here demonstrates a filename serialization defect in DurinDoor, and the upstream filename-specific tests exercise a different builder.

**Disposition:** no port; equivalent multipart transport shape is already provided by FormData and covered by offline fixtures. Do not replace provider-specific authentication, route selection, or account handling with the upstream implementation.

## Offline evidence and acceptance

Reviewed fixtures: `tests/unit/stt-multipart-undici.test.js`, `tests/unit/stt-translations.test.js`, `tests/unit/codex-stt-route.test.js`, `tests/unit/claude-haiku-adaptive-thinking.test.js`, `tests/unit/claude-protocol-parity.test.js`, and `tests/translator/thinking-unified.test.js`. Fixture source was inspected statically; focused execution was unavailable because this checkout does not contain `tests/node_modules/vitest/vitest.mjs`.

For the demonstrated #1997 Claude gap, ordinary offline acceptance for a future narrow change should cover: no thinking/effort on a non-Haiku Claude Code request receives the intended adaptive/high/context-management defaults; explicit thinking/effort headers or request intent win; Haiku behavior remains capability-correct; and non-Claude routes remain unchanged. No test or product change is included in this report-only review.
