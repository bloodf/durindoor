# Upstream PR Port — #3168 iFlow authorization fallback (2026-08-11)

| PR | Verdict | Behavior | Adaptation | Tests |
| --- | --- | --- | --- | --- |
| [#3168](https://github.com/decolua/9router/pull/3168) `fix(iflow): add accessToken authorization fallback` | PORTED | Resolve one request-local token as `credentials.apiKey || credentials.accessToken || ""`; API key keeps precedence. Use that token for both the iFlow HMAC signature and optional Bearer authorization. Missing credentials yield neither Bearer authorization nor a signature. | This fork already resolved the shared token for signing. Ported the remaining upstream change: authorization now tests and emits that resolved token rather than only `credentials.apiKey`. | `tests/unit/iflow-executor.test.js` fixes time and session ID, then asserts API-key precedence, access-token authorization fallback with matching HMAC, and empty credentials. |
