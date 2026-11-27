# v0 Vercel Web (staged)

This provider is staged and unavailable until the integration batch registers it. It is separate from the existing `v0-vercel` API-key provider. The pinned OmniRoute executor uses a v0.dev session for `https://v0.dev/api/chat`; its credential catalog names `__vercel_session`.

Once registered, manually enter the `__vercel_session` value or a Cookie header containing exactly one `__vercel_session=value`. Other cookies are discarded. Capture, extension import and web login are not supported by this staged profile. The cookie is sent only to the fixed v0.dev chat endpoint, with redirects refused. A 401 or 403 requires a fresh session; no refresh or expiry timestamp is established by the source. Keep session values secret.

Discovery currently returns only `v0-default`, the pinned executor's fallback model; no remote discovery endpoint is established. The focused tests use closed synthetic network mocks for credentials, selected accounts, request envelope, JSON, SSE, usage, errors and redirects. They do not establish live acceptance, endpoint stability or reliability.

The request envelope and completion mapping are adapted from [OmniRoute's v0-vercel-web executor](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/v0-vercel-web.ts) (MIT); the credential name comes from its web session credential catalog at the same revision.
