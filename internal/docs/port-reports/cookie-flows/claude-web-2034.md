# claude-web cookie capture and import (#2034)

## Verdict: NOT PARITY

The required `sessionKey` credential works offline from capture or import through the stored row to the executor. Three behaviors do not:

1. Extension capture and cookie import drop `lastActiveOrg`, which the executor reads to pick the organization.
2. HAR import drops cookie expiry, so an expired HAR cookie is not refused at import.
3. **Test** cannot check a proxied connection under the default URL guard, and it records the connection as `error`.

No product code changed. Nothing here proves that claude.ai accepts a captured session.

`claude-web` is active, not guarded or staged: the registry descriptor has no gate, and `claude-web` and `cw` both dispatch to `ClaudeWebExecutor`. The `claude-web` row in [parity-web-1127.md](../../parity-web-1127.md) says "None identified". This report found the gaps above; that file was outside this unit.

## Contract from the shipped code

| Item | Value |
| --- | --- |
| Import profile | The registry `webLogin` block. There is no separate `cookieImport` block. |
| Origin | `https://claude.ai`, exact |
| Required cookie | `sessionKey` |
| Optional cookies, chunks, hashed names, localStorage, account email | None |
| Connection | `authType: cookie`, stored as `sessionKey=<value>` in the encrypted API-key field |
| Executor requests | `GET /api/organizations`, then `POST /api/organizations/<org>/chat_conversations/<uuid>/completion` |

## Coverage added

Before this unit:

- `provider-cookie-import-contracts.test.js` checked the real `claude-web` profile and its filtering with placeholder values.
- `api/provider-cookie-import.test.js` ran the routes against synthetic registry descriptors.
- `provider-cookie-capture-extension.test.js` exercised capture through other providers.
- `claude-web-provider.test.js`, `port-omniroute-claude-web-chat-org.test.js` and `web-session-redirects.test.js` gave the executor its credentials directly.

None of these carried one `claude-web` session from capture or input to an outbound request. `tests/unit/cookie-flow-claude-web-2034.test.js` does.

## Requirements proved offline

| Requirement | Evidence in the new suite |
| --- | --- |
| Real descriptor, names and origin | The import contract's config is the shipped `webLogin` object. The extension table matches it. No registry mock. |
| Bounded capture | One `cookies.get` for `sessionKey` in the confirmed tab's cookie store. No enumeration or page script. Only `cookies` and two origins are requested, then removed. One POST without ambient credentials or redirects. A second send and a replay are refused. |
| Authenticated import | Pairing is refused without operator authority, and import without a pairing secret. |
| Unexpected origin | Five near-miss tab URLs read no cookie and send nothing. An edited pairing origin is refused. A widened pairing still reads only `sessionKey`. The import route refuses a trailing slash, a sibling origin, and foreign or child cookie domains. |
| Expired cookie, extension and API path | A past `expirationDate` is refused with fixed text and nothing is stored. HAR is the exception, see gap 2. |
| Other refusals | Missing, empty, insecure, other-store and chunk-named cookies are not sent by the extension. The route refuses chunk names, extra cookies, duplicates, a `;` in a value and any localStorage item. |
| Header, cURL and HAR | A header, `curl -H` and `curl -b` keep only `sessionKey`, including `=` padding. Two HAR accounts are ambiguous, a look-alike origin is ignored, and only the chosen candidate is stored. |
| Update ownership | A swapped `connectionId` and another provider's row are refused with rows unchanged. A same-name create does not overwrite. An update changes the paired row, keeps its proxy and priority, and leaves the sibling row identical. |
| Stored credential reaches the executor | Through `handleChat`, account selection, the executor and `proxyAwareFetch`: JSON and stream requests carry only account A's cookie on proxy A. |
| Account isolation | An expired A fails over to B. Each cookie stays on its own proxy. After re-import, A answers again with the new value. |
| Redaction | Test values are absent from the checked responses, capture results and captured console output. The SQLite scan covers raw rows in every table after usage and request-detail rows are written, with no plaintext value. The list and single-connection reads omit the credential. |
| Local checks | Model discovery sends nothing. For a direct connection, **Validate** and **Test** each send one organization GET and no completion. |

## Unsupported input

These are refused with fixed text that does not repeat the input.

| Input to cookie import | Result |
| --- | --- |
| A bare `sessionKey` value without `=` padding | No `name=value` pair. The manual Add dialog is the path for a bare value; this suite does not test it. A bare value that contains `=` is read as another cookie name and is also refused, as `sessionKey` is missing. |
| `sessionKey.0`, `sessionKey.1` | No `sessionKey` cookie. This provider has no chunk contract. |
| A JSON cookie list from another browser extension | No `name=value` pair. |
| A cURL command for another origin, or with a cookie-jar file | Origin not approved, or no Cookie header. |
| A HAR with no `https://claude.ai` request | No request to the provider origin. |
| localStorage | The contract names no item. |

## Gaps and reproductions

The three tests below assert current behavior, so a repair must update them. The first two have `NOT PARITY` in their names. The third is named `LIMITATION`.

### 1. Import drops `lastActiveOrg`

`pickChatOrganizationId` in `open-sse/executors/claude-web.js` prefers the organization named by `lastActiveOrg`, then the first one with the `chat` capability. The import profile and the extension table list only `sessionKey`.

Reproduction: one synthetic account has two chat organizations, `org-first` and `org-last-active`, and the header names the second.

- Saved through the provider create route, as the manual Add dialog does, the completion goes to `org-last-active`.
- Imported, `lastActiveOrg` is listed as dropped and the completion goes to `org-first`.
- Sent straight to the import route, `lastActiveOrg` is refused with 400.
- The extension never reads it.

An account with one chat organization is not affected by this choice. With several, the imported connection can post to a different organization than the one the user last used. Both belong to the same synthetic account.

Minimum repair:

1. In `open-sse/providers/registry/claude-web.js`, add a `cookieImport` profile with the same origin, `cookieNames: ["sessionKey"]` and `optionalCookies: ["lastActiveOrg"]`. This leaves `webLogin` unchanged.
2. Add `optionalCookies: ["lastActiveOrg"]` to the `claude-web` entry in `extensions/provider-cookie-capture/providers.js`.
3. Update the Claude Web row in `src/lib/providers/cookieImport/README.md`, and the assertions here that expect the cookie to be dropped or refused.

Not verified: the live cookie's attributes. The extension forwards only secure cookies, so the repair owner must check that this one is secure.

### 2. HAR import drops cookie expiry

`parseHarDocument` in `src/shared/utils/cookieImportParser.js` keeps only `name` and `value`. `CookieImportModal.js` posts those candidates, so the server's `expirationDate` check has nothing to check.

Reproduction: a HAR request cookie with `expires: 2000-01-01` parses to `{ name, value }`. The same cookie given to `buildImportedCookieHeader` with `expirationDate` is refused as expired. The suite does not assert that a dead session imports as a success.

At use, a session that the synthetic claude.ai rejects with 401 gives the client a 401 without the cookie, and no completion is sent. That does not replace refusal at import.

Header and cURL input carry no expiry, so no import-time check is possible for them. The parser is shared by all providers; only `claude-web` was exercised here.

Minimum repair: have `parseHarDocument` turn a valid `request.cookies[].expires` into `expirationDate` and keep it when it merges the `Cookie` header for the same name and value. The existing server rule then applies. Not verified: which browsers fill `expires` on request cookies. A HAR without it will stay unchecked.

### 3. Test marks a proxied connection as errored

Under the default guard mode, `validateClaudeWebSession` calls `guardedProbeFetch`, which attaches a guarded dispatcher. `proxyAwareFetch` refuses that dispatcher on a proxy route, because a proxy would bypass the DNS check.

Reproduction: with a connection proxy, **Test** returns `Guarded provider probe cannot use an outbound proxy` and sends nothing, so the cookie does not leave directly. The row is saved with `testStatus: "error"` although the session was never checked. A following chat request still succeeds through the configured proxy.

The refusal is the safe part and should stay. Minimum repair: in `testSingleConnection` (`src/app/api/providers/[id]/test/testUtils.js`), report this proxy refusal as unverified without saving a credential error. Checking a proxied session would need a separate security design. The path is shared with other guarded validators; only `claude-web` was exercised here. Other guard modes and relay routes were not tested.

## Mocked or unproved

Replaced in the suite:

- Four management authority decisions in `@/dashboardGuard`: `canAccessManagementApi`, `canManageAccessConfig`, `isOperatorRequest` and `hasExactRequestOrigin`. The guard's own rules are not retested.
- The `chrome` namespace. `capture.js` is real; `popup.js`, the manifest permission prompt and a real cookie jar are not exercised.
- The machine ID, the proxy reachability check (`@/lib/network/proxyTest`), claude.ai's answers and the proxy dispatchers. `proxyAwareFetch` is real, so this proves which dispatcher it selects, not that a proxy tunnels traffic.

The routes are called as functions, without the HTTP server or its middleware. The React import dialog is not rendered. The test builds the same request body the dialog posts, from the real parser output. The in-page sign-in that `webLogin` also configures was not run.

Unproved: live claude.ai sign-in, real cookie names and attributes, acceptance of a captured `sessionKey`, any browser check claude.ai applies to non-browser clients, organization responses, completion payloads and streaming, and model availability. Static metadata and mocks do not establish any of these.

## Upstream reference

`open-sse/executors/claude-web.js` states that its flow is ported from OmniRoute (MIT) at `4265bb2ad5477450a07d3a43ea33a62c6c874878`. That revision was not reread here.

Read for this report from the local source cache, `cheaper-inference/OmniRoute` (MIT) at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`:

- The `claude-web` entry in `src/shared/providers/webSessionCredentials.ts` names `sessionKey` and sets `acceptsFullCookieHeader: true`.
- `getOrganizationId` in `open-sse/executors/claude-web.ts` takes the first organization. A search for `lastActiveOrg` in that file, `open-sse/executors/claude-web/`, `webSessionCredentials.ts` and `src/lib/providers/webCookieAuth.ts` found nothing.

So this revision does not establish the `lastActiveOrg` preference. DurinDoor's `port-omniroute-claude-web-chat-org.test.js` attributes it to OmniRoute #21120 (`149516b12d4d`). That commit is not in the cache and was not checked. Gap 1 rests on what DurinDoor's own executor reads.

## Evidence

Run from `tests/` after installing root and test dependencies as in `AGENTS.md`:

```bash
node node_modules/vitest/vitest.mjs run unit/cookie-flow-claude-web-2034.test.js --maxWorkers=2
```

Result with Node 24.22.3 and pnpm 12.18.0: 1 file, 43 tests passed.

With the neighboring suites:

```bash
node node_modules/vitest/vitest.mjs run unit/cookie-flow-claude-web-2034.test.js unit/provider-cookie-import-contracts.test.js \
  unit/claude-web-provider.test.js unit/port-omniroute-claude-web-chat-org.test.js unit/api/provider-cookie-import.test.js \
  unit/provider-cookie-capture-extension.test.js unit/provider-cookie-import-dashboard.test.js unit/web-session-redirects.test.js \
  --maxWorkers=2
```

Result: 8 files, 354 tests passed.

Both runs used `env -i` with a private HOME, DATA_DIR, TMPDIR and cache, and no credentials. Dependencies came from a frozen-lockfile install with a private store, with install scripts off and only `better-sqlite3` rebuilt. `node scripts/check-docs.mjs` also passed. The full `test:ci` gate, lint and build were not run. No browser, Docker, provider account or live request was used.
