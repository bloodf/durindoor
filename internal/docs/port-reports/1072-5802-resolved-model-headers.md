# #1072 Port 9router #5802: resolved model and context window response headers

Source: [decolua/9router#5802](https://github.com/decolua/9router/pull/5802) at head `6255c18c5f377bd38790d02f9dd891e4fc4f83a4` (open).

## What was ported

- Added `resolvedModelHeaders(provider, model)` in `open-sse/utils/routeResponseHeaders.js` next to `withRouteResponseHeaders`, using DurinDoor's `resolveModelLimits` (with `stripThinkingSuffix` fallback when the suffixed id is not matched directly) and `src/shared/utils/typeChecks.js` (`isString`).
- Emits DurinDoor-branded headers only (`x-durindoor-model` as `<provider>/<model>` or `<model>`, and `x-durindoor-context-window` only when capability lookup reports a known positive finite `contextWindow`), rejecting missing or control-character values and never emitting `x-9router-*`, credentials, account names, or connection identifiers.
- Preserved an already-resolved `x-durindoor-model` value (and exposed `x-durindoor-model` / `x-durindoor-context-window` via `access-control-expose-headers`) inside `withRouteResponseHeaders` so single-model and combo callers in `src/sse/handlers/chat.js` and `open-sse/services/combo.js` retain `<provider>/<model>` after fallback.
- Wired `resolvedModelHeaders(provider, model)` into all success `Response` paths in:
  - `open-sse/handlers/chatCore/streamingHandler.js`
  - `open-sse/handlers/chatCore/nonStreamingHandler.js` (JSON and `streamToClient` synthetic SSE branches)
  - `open-sse/handlers/chatCore/sseToJsonHandler.js` (Responses API SSE and Chat Completions SSE branches)

## Verification

- `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/port9r-5802-resolved-model-headers.test.js` proves `resolvedModelHeaders` formatting/omission/validation, streaming, non-streaming JSON + synthetic SSE, forced-SSE-to-JSON (Chat & Responses), non-streaming error omission, and combo fallback preservation.
