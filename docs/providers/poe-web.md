# Poe Web (staged)

This separate web-session provider is staged and unavailable until the registration batch connects it. The existing `poe` API-key provider is separate; do not enter its API key here.

Once registered, manually enter the `p-b` cookie value from a signed-in poe.com session, either as a bare value or as `p-b=value` in a Cookie header. Only `p-b` is sent to `https://www.poe.com/api/gql_POST`. Cookie import, extension capture and web login are not configured. A rejected or expired session must be obtained and entered again; there is no refresh implementation.

The pinned source maps a static set of model IDs to Poe bot names and sends the last text user message in a `ChatViewQuery` GraphQL request. It does not establish dynamic discovery, multi-turn context, tool or image support, or token usage. Discovery exposes that static mapping, not account-specific availability. The upstream JSON answer is returned as a completion or synthesized SSE; streaming is not incremental. One billable dispatch is recorded per request, but token counts are not invented.

Offline tests use closed mocks for credentials, request envelope, model mapping, account isolation, JSON, SSE, errors and redirects. They do not establish current endpoint compatibility, subscription access or live reliability.

Ported logic: [OmniRoute `open-sse/executors/poe-web.ts` at 9671192011beb2d7f83979f40be488c5da8772b9](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/poe-web.ts), and its web-cookie catalog and credential definitions (MIT).
