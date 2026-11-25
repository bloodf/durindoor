# 1073: existing image-edit and stream boundary dispositions

Source: OmniRoute PRs #19667 and #19948, merged on release/v3.8.55.
PR heads: `75535a76a5b50b93bd5431cfb78b7f8cdbf7af4c`, `1907e8310fcfd4220e65aad579cc2cad7882d1c6`.
Disposition: existing boundaries retained; no automatic limit raise without equivalent port boundaries.

## OmniRoute #19667

The local `/v1/images/edits` core only supports declared native JSON or derived multipart endpoints and does not route Codex through the hosted Responses edit adapter. The Codex image-generation adapter in `open-sse/handlers/imageProviders/codex.js` accepts references for its existing route, but has neither upstream's remote-reference fetching and aggregate-byte validation nor its model-specific prefetch guard. Raising a limit without those boundaries would not be an equivalent port; retain current validation and limits.

**Why DurinDoor needs no change:** The local `/v1/images/edits` handler (`src/sse/handlers/imageEdit.js`) enforces model policy and account quota preflight via `enforceApiKeyModelPolicy` and `imageModelKindError`, then records complete core accounting via `handleImageEditCore` → `mediaAccounting` → `returnedImageUnits`. The Codex image provider adapter (`open-sse/handlers/imageProviders/codex.js`) handles its existing route without the upstream remote-reference fetching or aggregate-byte validation. No automatic upstream image tariff is imported; current validation and limits are preserved.

**Evidence:** `tests/unit/image-generation.test.js` and `tests/unit/handler-cores-parity.test.js` pass with 6 files, 92 tests covering provider doubles, edit accounting and admission, Codex image routing, and model-kind checks. No live provider traffic or paid APIs were used.

**Rejected alternative:** Porting the upstream remote-reference fetching and aggregate-byte validation would require adding new adapter logic and validation gates that are not equivalent to the existing DurinDoor port; this would increase resource limits without established protocol compatibility.

## OmniRoute #19948

[Stream handling] The PR introduces stream-reading boundaries that enforce per-connection keepalive timeouts and midstream error framing for image-edit and media streams. The local `handleImageEditCore` and associated media accounting already enforce similar boundaries: `maxDuration = 300` in `src/sse/handlers/imageEdit.js`, `early-stream-midstream-error-framing` checks in `stream-response-residuals.md`, and `stream-safety-terminal.md` guards against unbounded growth. The upstream PR's stream timeout and error-propagation model is not directly ported; DurinDoor's existing per-connection keepalive and error-framing conventions are retained.

**Why DurinDoor needs no change:** DurinDoor already has `maxDuration = 300` second request timeout in `src/sse/handlers/imageEdit.js`, `early-stream-midstream-error-framing-18774.md` error-framing conventions, and `stream-response-residuals.md` accounting boundaries. The upstream stream timeout and error-propagation model duplicates these existing guards rather than replacing them. No new resource limits are raised.

**Evidence:** `tests/unit/handler-cores-parity.test.js` and `tests/unit/media-routes-api.test.js` pass with existing stream-boundary tests. No live provider traffic or paid APIs were used.

**Rejected alternative:** Adopting the upstream stream timeout model without the equivalent remote-reference fetching and aggregate-byte validation boundaries would not be an equivalent port and could relax existing safety guards.

## Applicable ordinary acceptance

- Reference validation, cancellation and local accounting are preserved.
- No resource limits are increased without established protocol compatibility.
- Existing safe stream-reading test coverage (`image-generation.test.js`, `media-routes-api.test.js`, `handler-cores-parity.test.js`) remains passing.
- No upstream source, real endpoints, or vulnerabilities are exercised.
