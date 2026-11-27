# v0 Vercel Web

> **Available, mocked coverage only.** v0 Vercel Web (`v0-vercel-web`) is registered: you can add a connection from the dashboard (paste, cookie import or extension capture), list its model and send requests through the OpenAI and Anthropic routes. Every test runs against closed mocks; nothing here has been accepted against a live account.

It is separate from the existing `v0-vercel` API-key provider. The pinned OmniRoute executor uses a v0.dev session for `https://v0.dev/api/chat`; its credential catalog names `__vercel_session`.

## Credential and import

Enter the `__vercel_session` value or a Cookie header containing exactly one `__vercel_session=value`. Other cookies are discarded. Keep the value secret.

Dashboard import (Cookie header, cURL command or HAR file) allows one cookie, `__vercel_session`, from the origin `https://v0.dev`, with a cookie domain of `v0.dev` or `.v0.dev`, and stores `__vercel_session=<value>`. The [cookie capture extension](./cookie-capture-extension.mdx) can also send `__vercel_session` from a signed-in `https://v0.dev` tab after a dashboard pairing; its compiled table allows only that origin and cookie. There is no web login: the pinned source defines no sign-in contract. An import from any other origin is refused.

The cookie is sent only to the fixed v0.dev chat endpoint, with redirects refused. A `401`, `403` or redirect requires a fresh session; no refresh or expiry timestamp is established by the source.

## Validation and discovery

v0 has no read-only session check in the pinned source; its only request is a chat. **Validate** and **Test Connection** reject a malformed value locally and otherwise skip the network check, so a skipped check does not prove the cookie works.

Discovery returns only `v0-default`, the pinned executor's fallback model, without sending the cookie; no remote discovery endpoint is established.

## Responses and usage

JSON answers are mapped to an OpenAI completion and keep any `usage` v0 reports; the gateway records those counts against the selected connection. A streamed answer is passed through as v0's SSE; the mocked final chunk carries `usage`, and the gateway records it. A stream without usage has not been tested.

## Mocked evidence

`tests/unit/v0-vercel-web-provider.test.js` covers credentials, selected accounts, the request envelope, JSON, SSE, usage, errors and redirects. `tests/unit/provider-session-registration-1127.test.js` runs the registered path with the real executor map: dashboard and extension import into the connection store, the extension's pairing check, Cookie header, cURL and HAR parsing, discovery, OpenAI and Anthropic JSON and SSE, account separation, expiry, redirects, server errors and recorded usage. They do not establish live acceptance, endpoint stability or reliability.

## Attribution

The request envelope and completion mapping are adapted from [OmniRoute's v0-vercel-web executor](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/executors/v0-vercel-web.ts) (MIT); the credential name comes from its web session credential catalog at the same revision.
