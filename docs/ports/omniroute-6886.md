# Port: OmniRoute #6886 — route API error responses through `sanitizeErrorMessage`

- **Source:** <https://github.com/diegosouzapw/OmniRoute/pull/6886> ("Rule 12" error-sanitization sweep), full diff 428 lines (9 route files wrapped individually + a node:test sweep test + stryker config).
- **Upstream approach:** nine copied per-route wrappers calling `sanitizeErrorMessage(error)`.
- **Durindoor adaptation (shared root, not nine handlers):** durindoor already funnels API error bodies through `open-sse/utils/error.js` root builders, so the sanitization is applied once at the seam instead of per-route:
  - `buildErrorBody` — sanitizes the resolved message (falls back to the status-specific default for empty input). Covers `errorResponse` (non-streaming) and `writeStreamError` (SSE).
  - `createErrorResult` — a caller-supplied structured `errorBody` bypasses `buildErrorBody`, so its `error.message` is sanitized on a shallow clone (shape, provider type/code, and `upstream_details` preserved verbatim; caller object never mutated).
  - `unavailableResponse` — sanitizes the base message; the human retry suffix is appended after so it survives verbatim; status + `Retry-After` header unchanged.
  - `sanitizeErrorMessage` — extended with upstream's whitespace-token `looksLikeAbsolutePath` logic: POSIX and Windows absolute paths ending in a source extension (ts/tsx/js/jsx/mjs/cjs) are masked as `<path>`; URLs with a scheme are not masked; existing redaction rules (userinfo/Bearer/JSON-field/query-param secrets, `/home|/Users|/var|/tmp` + `file://` paths) are retained; the stack tail (line 2+) is truncated; output cap raised 500 → 4096 chars.
- **Status codes preserved** — sanitization touches only the message string.
- **Files changed (3):**
  - `open-sse/utils/error.js` — root-seam routing + `looksLikeAbsolutePath`/`maskSourcePaths` helpers + JSDoc contract (in-code doc artifact).
  - `tests/unit/error-sanitize.test.js` — targeted behavioral test.
  - `docs/ports/omniroute-6886.md` — this note.
- **Verification:** `node node_modules/vitest/vitest.mjs run unit/error-sanitize.test.js` (from `tests/`, Node 20) → 15 passed (15). Covers: POSIX/Windows/parenthesized source-path masking, safe-URL pass-through, per-control secret redaction (userinfo, JSON field, Bearer, query param), `errorResponse` secret routing + status preservation, `writeStreamError` SSE frame, `createErrorResult` clone/no-mutation/shape-preservation, `unavailableResponse` status + `Retry-After`, 4096-char input cap. No lint/build/gate run (per assignment).
- **Out of scope:** upstream's `sanitizeUpstreamDetails` recursive projection (durindoor's `upstream_details` field is not rewritten here); per-dashboard-route 500 bodies outside `open-sse` root builders.
