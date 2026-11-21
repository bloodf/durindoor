# Provider cookie import

Lets a browser extension hand a signed-in provider session to DurinDoor without the operator copying cookies by hand, and lets the dashboard import the same session from a pasted Cookie header, a pasted cURL command or a local HAR file. It reuses the dashboard's operator authorization, the web-login cookie rules (`src/lib/webLoginSession.js`) and the connection create path (`createProvider` in `src/lib/providerRouteHandlers.js`), so credentials are stored in the same encrypted `providerConnections` row as any other cookie connection.

No code is ported from another project; the design extends DurinDoor's own web-login capture.

## Files

| File | Owns |
| --- | --- |
| `contract.js` | The shared provider metadata (`getCookieImportContract`) and cookie validation (`buildImportedCookieHeader`). |
| `pairing.js` | One-use, short-lived pairing store. |
| `handlers.js` | The two route handlers. |
| `src/shared/utils/cookieImportContract.js` | The client-safe rules both sides read: which origin and cookie names a provider approves. |
| `src/shared/utils/cookieImportParser.js` | The browser-side parsers for a Cookie header, a cURL command and a HAR file. |
| `src/app/(dashboard)/dashboard/providers/[id]/CookieImportModal.js` | The dashboard import dialog. |
| `src/app/api/providers/cookie-import/pairing/route.js` | `POST` mint a pairing (operator). |
| `src/app/api/providers/cookie-import/route.js` | `POST` import (pairing secret only). |

## Dashboard import

The provider page of an importable provider has an **Import cookies** button next to **Add Connection**. The manual paste in the add dialog is unchanged.

The dialog reads its input as data in the browser and never acts on it:

- A pasted `Cookie` header is split into name/value pairs. Values keep every `=` they carry, so a padded token is not truncated. Parts that are not `name=value` pairs are dropped and counted.
- A pasted cURL command is tokenized and read: the URL and the `Cookie` header (or the `-b` value) are taken from the text. The command is never run and the URL it names is never requested.
- A local HAR file is parsed from `request.url`, `request.headers` and `request.cookies`. The file stays in the browser and is never uploaded.

The rules that decide what may be imported live in `src/shared/utils/cookieImportContract.js`, which the server contract also reads, so the client and the server cannot drift:

- Only the provider origin is imported. A cURL command for another origin is refused; a HAR request for another origin is ignored.
- Only the provider's approved cookie names are kept. The others are dropped and their names are listed for the operator.
- A chunked session cookie keeps every chunk. The stale unchunked copy is dropped, and a gap in the chunk sequence is refused before the import.
- At most 16 cookies and 8192 characters per value, the same caps the server enforces.

When a HAR file holds several requests to the provider origin with different credentials, the operator has to pick one; requests that carry the same credentials are not ambiguous. The dialog shows cookie **names** only. A pasted text, the parsed cookies and the pairing secret are dropped from the page as soon as the operator submits or dismisses the dialog.

The dialog imports through the same two routes as the extension: it mints a pairing with `POST /api/providers/cookie-import/pairing` and posts the parsed cookies to `POST /api/providers/cookie-import` with the pairing secret. The server therefore applies the origin, cookie-name, chunk and size rules again before it stores anything.

## Supported providers

The dashboard and pairing API resolve the same registry metadata. A narrow
`cookieImport` profile takes precedence over `webLogin` and does not activate
in-page sign-in. The extension uses only its compiled capture allowlist.
`extensionCapture: false` in a pairing indicates that the dashboard can import
the credential from local input. Imports store the existing Cookie header
through the normal connection path.

| Provider | Import decision | Credential evidence |
| --- | --- | --- |
| ChatGPT Web | Extension and dashboard | Existing `chatgpt.com` profile. NextAuth session cookie or contiguous numbered chunks. |
| Perplexity Web | Extension and dashboard | Existing `www.perplexity.ai` profile. NextAuth session cookie or contiguous numbered chunks. |
| Grok Web | Extension and dashboard | Existing `grok.com` profile requires `sso`. |
| Muse Spark Web | Extension and dashboard, guarded runtime | Existing `www.meta.ai` profile requires `ecto_1_sess`. Import leaves guard-only dispatch in place. |
| ChatGPT Web Codex | Extension and dashboard | Same `chatgpt.com` profile as ChatGPT Web: NextAuth session cookie or contiguous numbered chunks. |
| Claude Web | Extension and dashboard | `claude.ai` profile requires `sessionKey`. |
| Gemini Web | Extension and dashboard | `gemini.google.com` profile requires `__Secure-1PSID` and `__Secure-1PSIDTS`, which Google sets on the parent `.google.com` domain; the contract accepts a parent domain of the origin host. |
| Doubao Web | Extension and dashboard | `www.dola.com` profile requires `sessionid` and `s_v_web_id`. A pasted header that carries `fp` instead of `s_v_web_id` still works through manual paste. |
| Z.ai Web | Extension and dashboard | `chat.z.ai` profile requires the `token` cookie. |
| MaxAI | Extension and dashboard | `www.maxai.co` profile requires `access_token`, `device_id` and `user_id` from the same browser session. |
| Arena | Extension and dashboard | `arena.ai` profile requires `arena-auth-prod-v1`; numbered `arena-auth-prod-v1.N` chunks must be contiguous. |
| ChatPlayground | Extension and dashboard | `app.chatplayground.ai` profile requires `__client` and `__session`. |
| DeepSeek Web | Manual token | The credential is the `userToken` from local storage, saved as an API-key credential; there is no cookie to capture. |
| Adapta Web | Dashboard only | `__client` is accepted as a Cookie header at the Clerk origin, `https://clerk.agent.adapta.one`. The chat site `agent.adapta.one` has a separate origin. cURL and HAR input must identify the Clerk origin. [Pinned comparison](../../../../internal/docs/adapta-t3-web-cookie-parity-2034.md) |
| Tencent Yuanbao Web | Extension and dashboard | The normal connection requires both `hy_user` and `hy_token` for `https://yuanbao.tencent.com`. The executor supplies `hy_source=web`. [Pinned comparison](../../../../internal/docs/yuanbao-web-signin-parity-2034.md) |
| T3 Chat Web | Manual header | The local parser requires `convex-session-id`, and the pinned source calls for the full session cookie set. A complete narrow allowlist is unverified. [Pinned comparison](../../../../internal/docs/t3-web-signin-parity-2034.md) |
| HuggingChat | Manual header or existing in-page sign-in, guarded runtime | The in-page flow needs a full header and a readiness probe. The pinned `hf-chat` name alone does not establish the complete access requirements. [Pinned comparison](../../../../internal/docs/huggingchat-signin-parity-2034.md) |
| Kimi Web | Manual token | The connection uses access and refresh tokens from local storage. [Pinned comparison](../../../../internal/docs/kimi-web-signin-parity-2034.md) |
| Copilot Web | Manual token | The connection uses an access token. [Pinned comparison](../../../../internal/docs/copilot-web-parity-2034.md) |
| Microsoft 365 Copilot Web | Manual token and path | The connection uses an access token and Chathub WebSocket path. [Registry](../../../../open-sse/providers/registry/copilot-m365-web.js) |
| ZenMux Free | Manual header | The pinned source requires `ctoken` and forwards the full header. [Pinned comparison](../../../../internal/docs/zenmux-free-signin-parity-2034.md) |
| Suno | Manual header | The session header and separate API host are documented, with no complete cookie-name allowlist. [Pinned comparison](../../../../internal/docs/suno-signin-parity-2034.md) |
| Udio | Manual header | The parity source forwards the supplied session header and does not specify an exact cookie set. [Pinned comparison](../../../../internal/docs/udio-signin-parity-2034.md) |

## Flow

1. **Pair.** The operator, in the dashboard, calls `POST /api/providers/cookie-import/pairing` with either
   `{ "provider", "action": "create", "name" }` or `{ "provider", "action": "update", "connectionId" }`.
   The action is explicit; the other action's fields are rejected. An update target must exist, belong to the provider and be a cookie connection. The response carries the secret once, plus the contract the extension should collect:
   `{ pairing: { token, expiresAt, ttlSeconds, header, provider, action, name | connectionId, importUrl, contract: { origin, cookieNames, cookiePrefixes, extensionCapture? } } }`.
2. **Import.** The extension reads the approved cookies for the provider origin and calls `POST /api/providers/cookie-import` with header `x-durindoor-pairing-token: <token>` and
   `{ "provider", "origin", "cookies": [{ "name", "value", "domain"?, "secure"?, "expirationDate"? }], "connectionId"? , "name"? }`.
   `connectionId` is required and must match for an update pairing, and must be absent for a create pairing. `name` may be repeated for a create pairing and must then match.
3. **Result.** `201` (create) or `200` (update) with `{ ok: true, action, connection: { id, provider, name } }`. Nothing else about the connection, and never a cookie, is returned.

## Authority

- Pairing issuance requires `canAccessManagementApi` **and** `isOperatorRequest` (dashboard session, CLI token or open local dashboard), a matching `Origin` when one is sent, and refuses the isolated web-login host. An application API key never qualifies.
- The import route is a public leaf in `src/dashboardGuard.js` (`PUBLIC_API_EXACT_PATHS`, exact path only) because the extension has no dashboard session. It then ignores `Authorization`, `x-api-key`, cookies and the CLI token entirely: the only thing it reads as authority is the pairing secret. The secret is accepted by no other route, so it is not a general API credential.
- A pairing binds provider, operator (`ownerBinding`, a SHA-256 of the issuing credential) and one target. At most three pairings per operator are pending; a new one supersedes the oldest. At most 200 are pending overall.

## Replay protection

The secret is `ddpair_` plus 256 random bits and lives 120 seconds. Only its SHA-256 is kept in memory. `consumePairing` reads and deletes the entry in one synchronous step, so of any number of concurrent presentations exactly one obtains it. The secret is spent as soon as it is accepted for processing: a provider, connection or name mismatch, a bad origin, bad cookies or a failed write all consume it, and the operator must pair again. Requests rejected earlier (transport, missing or malformed secret, content type, body size, invalid JSON) do not consume it. Unknown, expired and already-used secrets give the same `401`.

The store is per process (a `globalThis` map, like web-login sessions). A deployment running several server processes behind one address must pin extension traffic to one process.

## Validation

- **Transport:** HTTPS, or plain HTTP to `localhost`, `127.0.0.1` or `[::1]` for local development. The scheme is the transport's, unless the `Host` is the operator-configured `BASE_URL` / `NEXT_PUBLIC_BASE_URL` (a TLS terminator). Forwarded headers are not trusted.
- **Origin:** `origin` must equal the contract origin byte for byte. `http://`, a trailing slash, a port, a suffix or a sibling host are rejected.
- **Cookies:** names must be approved (above); chunked cookies must be contiguous from `.0`; the required cookies must be present (the same `hasRequiredCookies` rule the dashboard capture applies); no duplicates; at most 16 cookies and 8192 characters per value; values must be printable ASCII without `;` or edge whitespace; `domain`, when sent, must be the provider host or a parent of it (never a bare public suffix); `secure: false` and past `expirationDate` (seconds, as browsers report it) are rejected. Cookies outside the allowlist, such as `cf_clearance`, are rejected rather than dropped.
- **Header composition:** `composeCookieHeader` from web-login builds the stored value, required cookies first, chunks in index order.
- **Size:** the import body is at most 32 KiB and the pairing body 4 KiB, enforced on the declared length and again while streaming. Content type must be `application/json`.
- Validation is structural. No request is made to the provider.

## Persistence

Create goes through `createProvider`, which encrypts the cookie at rest. An import targeting a same-name cookie connection for the same provider causes a `409`, checked atomically with insertion; names may be reused across providers or credential types. Manual cookie creation retains its existing duplicate-name behavior. Update calls `updateProviderConnection` with `provider` pinned, so the repository refuses the write inside its transaction if the row's provider changed, and sets `testStatus: "active"`, which is the repository's marker for an explicit credential replacement and clears a pending reauthentication state. All other connection fields are kept.

## Secret handling

Responses are `Cache-Control: no-store` and error strings are fixed text that never contains a submitted name or value. The handlers log only an error code. The pairing header name ends in `token`, so the shared redactor in `src/lib/observability/redact.js` masks it.

## Status codes

| Code | Meaning |
| --- | --- |
| 201 / 200 | Created / updated. |
| 400 | Bad body, unsupported provider, origin not approved, cookie rejected. |
| 401 | Missing, malformed, unknown, expired or used pairing secret. |
| 403 | Not an operator (pairing route), isolated login host, or insecure transport. |
| 404 | Update target missing. |
| 409 | Pairing does not match the request, connection mismatch, or name already exists. |
| 413 / 415 | Body too large / not JSON. |
| 429 | Too many pending pairings (pairing route). |
| 500 | The connection could not be saved. |

Tests: `tests/unit/api/provider-cookie-import.test.js`, `tests/unit/provider-cookie-import-dashboard.test.js`, and the gate cases in `tests/unit/dashboard-guard.test.js`.
