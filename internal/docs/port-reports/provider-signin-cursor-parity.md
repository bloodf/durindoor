# Cursor sign-in and request parity (#2034)

Comparison date: 2026-11-27. No live provider request was made. Every contract below comes from pinned source code, not from Cursor documentation.

## Pinned sources

| Project | Commit | Cursor source |
| --- | --- | --- |
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | `dbe641f286a489ecb39e3c041c554371e6add864` | None. `git ls-files` has no Cursor-named path, and `git grep -i 'cursor\.sh\|cursor\.com'` finds no match. |
| [EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI) | `29567ead8164a00724dfdc2087f02a23895636ee` | None, by the same two checks. |
| [OmniRoute](https://github.com/cheaper-inference/OmniRoute) (MIT) | `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` | Files listed per row below. |

Neither CLIProxyAPI project supplies a Cursor contract, so all parity work here is against OmniRoute.

## Behavior comparison

| Behavior | OmniRoute source | DurinDoor production |
| --- | --- | --- |
| Browser sign-in URL | `src/lib/oauth/services/cursorLogin.ts` `generateCursorAuthParams`, `CURSOR_CONFIG.loginUrl` in `src/lib/oauth/constants/oauth.ts` | Equivalent. `src/lib/oauth/services/cursorLogin.js` builds `https://cursor.com/loginDeepControl?challenge&uuid&mode=login&redirectTarget=cli` with an S256 challenge. The verifier stays on the server. |
| Poll | `pollCursorAuthOnce`, `src/app/api/oauth/cursor/login/poll/route.ts` | Equivalent wire contract: `GET https://api2.cursor.sh/auth/poll?uuid&verifier`, where 404 means pending and 200 returns `{accessToken, refreshToken}`. DurinDoor also serializes overlapping polls, so accepted tokens are stored once. It refuses redirects and limits the response body. A caller abort, added in this unit, leaves the session usable. OmniRoute polls in parallel without a guard. |
| Session lifetime | `SESSION_TTL_MS` | Equivalent: a 15-minute session, deleted on success or cancel. Both keep sessions in process memory, so multiple replicas need sticky routing. |
| Account identity | `credentialsFromCursorTokens`, `src/lib/oauth/services/persistCursorConnection.ts` | Equivalent match on the JWT `sub`, stored as `accountId`/`userId`. The poll route updates the matching OAuth connection with `replacesCredential` and keeps its proxy settings. Otherwise it creates a connection with `createOnly`. OmniRoute subtracts five minutes from `exp`. DurinDoor stores the real `exp` and leaves the lead time to the shared refresh policy. |
| Refresh | `open-sse/services/tokenRefresh/providers/cursor.ts` | Equivalent contract: `POST https://api2.cursor.sh/auth/exchange_user_api_key` with `Authorization: Bearer <refresh>` and body `{}`. The old refresh token is kept when the response has none. 401/403 is unrecoverable, and 429/5xx is retried three times with backoff. DurinDoor (`open-sse/services/tokenRefresh/cursor.js`) honors the connection's proxy, which OmniRoute ignores (`_proxyConfig`), and deduplicates concurrent refreshes. With no refresh token, DurinDoor returns `null` and OmniRoute returns `no_refresh_token`. |
| Token import | `src/app/api/oauth/cursor/import/route.ts`, `src/lib/oauth/services/cursor.ts` | Partial. **Corrected in this unit:** `validateImportToken` now records the JWT `exp` (`resolveCursorTokenTtlSeconds`, 24-hour estimate for opaque tokens) and rejects an expired JWT before storage. **Still missing (staged):** OmniRoute accepts an optional `refreshToken` on import and upserts by account ID. DurinDoor always stores `refreshToken: null`. |
| Local store | `src/lib/cursor/tokenExtractor.ts` | DurinDoor reads the access token, machine ID and cached email (`cursorLocalStore.js`). OmniRoute also reads `cursorAuth/refreshToken`; that read is staged here. |
| Encrypted or keychain store | `tryAgentAuth` comment in `tokenExtractor.ts` | Neither project decrypts. OmniRoute documents keychain-held CLI tokens as unsupported. DurinDoor returns null fields for a store that is non-SQLite, encrypted or has no token rows, and it does not echo the file's contents. |
| `cursor-agent` CLI `auth.json` | `tryAgentAuth` | Not ported. The file holds an access token without a machine ID. DurinDoor's checksum header requires a machine ID, and `import/route.js` rejects an import without one before any network call. |
| Linux install probe | `verifyLinuxCursorInstalled` | Not ported in this unit. It belongs to the auto-import route, which is outside the scope of this unit. |
| Profile email lookup | `CursorService.fetchUserInfo` (`https://cursor.com/api/auth/me` with a session cookie built from the token) | Not ported. It sends the bearer token to a second host. DurinDoor uses the JWT `email` or the store's `cachedEmail`. |
| Dashboard refresh route, background renewal | `src/app/api/providers/[id]/refresh-cursor/route.ts`, `src/lib/cursor/renewal.ts` | Not ported. DurinDoor refreshes through its shared credential lifecycle. |
| Request headers | `CursorService.buildHeaders` | `CursorService.buildHeaders` in `src/lib/oauth/services/cursor.js` is not called by production code. Requests use the executor's headers (`open-sse/executors/cursor.js`), which are outside this unit. The checksum algorithm is identical. OmniRoute's additional `User-Agent`/`x-cursor-user-agent` were not added to this unused path. |
| Model discovery | `src/lib/providerModels/cursorAvailableModels.ts` | Unchanged. See `internal/docs/cursor-signin-parity.md`. `resolveCursorModels` returns `null` before network when the account lacks a token or machine ID. |
| Request and stream translation | `open-sse/executors/cursor.ts`, `open-sse/translator/**` | Unchanged and out of scope. Existing coverage: `tests/unit/cursor-agent-*.test.js`, `port9r-cursor-*.test.js`. |

## Production status

These work in production today, through `src/app/api/oauth/cursor/login/{start,poll,cancel}` and `import`:

- deep-control sign-in
- refresh of signed-in accounts
- access-token import with a real expiry

The dashboard offers import only. The sign-in routes are callable directly.

These are staged but not wired:

- import with a refresh token
- the exact-key refresh-token read from `state.vscdb`
- account-ID upsert on import

They are staged in `src/lib/oauth/providerParity/cursor/`:

- `index.js` is pure and web-safe. Its exports are `CURSOR_REFRESH_TOKEN_KEYS`, `normalizeCursorImportRefreshToken`, `readCursorRefreshTokenFromDb`, `findCursorAccountConnection`, `cursorImportConnectionValues` and `CURSOR_IMPORT_REFRESH_FIELD`.
- `registration.json` lists the integration slots: the import route's POST and GET, the shape of `readCursorLocalAuthSync`, the auto-import response, and the dashboard modal. These slots belong to the ordered auth batches.

Risk to record before wiring: refreshing a token copied from the IDE may rotate it and sign the IDE out. OmniRoute accepts that.

## User steps

- **Sign in (direct API):** `POST /api/oauth/cursor/login/start` returns `loginUrl` and `sessionId`. Open `loginUrl` and approve. Then `POST /api/oauth/cursor/login/poll {sessionId}` until `status: "ok"`. A 410 response means the session expired; start again.
- **Import:** in Cursor IDE, sign in, then use the dashboard import, which auto-detects the token. Alternatively, paste `cursorAuth/accessToken` and `storage.serviceMachineId` from `state.vscdb`. An imported connection cannot refresh. Re-import when it expires, or use sign-in.

## Evidence

`tests/unit/provider-signin-cursor-parity.test.js` runs the real services and routes against a stubbed `fetch` and a mocked `proxyAwareFetch` transport. Its storage is in memory, and HOME and DATA_DIR are private. It covers:

- PKCE challenge and verifier binding
- overlapping polls producing a single submission
- fake-clock expiry
- caller aborts
- two concurrent accounts keeping their own tokens, identities and proxy routes
- re-sign-in replacing a credential instead of duplicating it
- admin guards checked before network
- refresh rotation, rejection and bounded retry
- expired-import rejection
- encrypted and keychain store fixtures
- no token or upstream body in responses or logs

The staging-only assertions are isolated in the final `describe` block.

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/provider-signin-cursor-parity.test.js --maxWorkers=2
```
