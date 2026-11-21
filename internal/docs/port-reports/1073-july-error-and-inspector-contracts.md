# July error response and inspector contracts

## OmniRoute #5893

- Source pin: merge [`8d2c06f5683f00e17b80081aa32e4e5996a9951c`](https://github.com/cheaper-inference/OmniRoute/commit/8d2c06f5683f00e17b80081aa32e4e5996a9951c), compared with first parent `55e638c312c741b9d16a4b27db39b1ec25e3dd79`.
- Upstream changes `open-sse/handlers/chatCore/responseHeaders.ts` so `buildStreamingResponseHeaders` filters every `x-middleware-*` header while retaining its existing denylist, and changes the non-streaming JSON branch in `open-sse/handlers/chatCore.ts` to call `stripNextMiddlewareControlHeaders` before constructing the response. Neither filter depends on response status: ordinary success and error responses traversing those paths get the same header treatment. The streaming regression test checks header construction; the non-streaming assertion checks stripping and preservation of ordinary headers (`tests/unit/middleware-header-strip-5849.test.ts`).
- Local comparison: this fork has no `open-sse/handlers/chatCore.ts` or corresponding `responseHeaders.ts` implementation and no matching offline response-header assertion. The similarly named middleware behavior in `src/proxy.js` and `src/lib/webLoginSession.js` serves different local flows and does not establish the upstream chat response contract.
- Disposition: no direct implementation to port in this fork; record as an upstream-only proxy response contract.

## OmniRoute #6451

- Source pin: merge [`62a74faa4b94dd2b757ace9281f40cf923934d7a`](https://github.com/cheaper-inference/OmniRoute/commit/62a74faa4b94dd2b757ace9281f40cf923934d7a), compared with first parent `a03c22e5ed9da605915c48924ea3ae6277742cb8`.
- Upstream adds `sanitizeHeaders(opts.responseHeaders)` before assigning `intercepted.responseHeaders` in `src/mitm/inspector/agentBridgeHook.ts`, and adds full `set-cookie` redaction to `src/mitm/sanitizeHeaders.ts`. Its offline test asserts string, array, and case-insensitive cookie redaction.
- Local comparison: this fork contains no `src/mitm/inspector/agentBridgeHook` and no matching inspector response-header storage shape. It does contain `src/mitm/sanitizeHeaders.js`: `set-cookie` is in `SECRET_HEADER_NAMES`, and `sanitizeHeaders` maps secret header values to `[REDACTED]` before logger serialization in `src/mitm/logger.js`. The offline assertions in `tests/unit/mitm-sanitize-headers.test.js` cover string and array `Set-Cookie` values and secret header names.
- Disposition: inspector hook/storage change is not applicable because that source inspector contract is absent; the matching local header sanitizer already covers the recorded `set-cookie` field (and other configured secret header names). No stored logs, cookies, or credentials were inspected.
