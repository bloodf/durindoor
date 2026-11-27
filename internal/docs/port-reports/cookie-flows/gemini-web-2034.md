# Gemini Web cookie capture and import proof (#2034)

Provider: `gemini-web` (alias `gweb`). Base: `4819aba30dd`. Suite: [`tests/unit/cookie-flow-gemini-web-2034.test.js`](../../../../tests/unit/cookie-flow-gemini-web-2034.test.js). Port sources for the provider itself: [`gemini-web-2034.md`](../../gemini-web-2034.md).

## Verdict

- **Activation:** not guarded or staged. The provider is registered, importable and dispatched by `GeminiWebExecutor`.
- **Offline contract:** capture, import and stored-credential use pass for the supported modes below. No product code defect blocked a required positive case.
- **Live parity: not established.** No Google account, real cookie, browser or network was used. Nothing here shows that a live sign-in works.
- **Documentation defect:** the public guide overstates what the import paths accept. See [Documentation defect](#documentation-defect).

## Contract under test

The test uses the production registry entry. The import contract is its `webLogin` block; the entry has no `cookieImport` profile. The exported `geminiWebCookieProfile` is not imported by any file under `src/`, `open-sse/`, `extensions/` or `scripts/`, so none of the evidence rests on it.

| Item | Value |
| --- | --- |
| Origin | `https://gemini.google.com` |
| Required cookies | `__Secure-1PSID`, `__Secure-1PSIDTS` |
| Cookie domain | `.google.com`, a parent of the origin host |
| Chunks, hashed families, optional cookies | None |
| localStorage, account email | None. The routes refuse both |
| Stored form | `apiKey` = `__Secure-1PSID=…; __Secure-1PSIDTS=…`, connection `authType: cookie` |

## What the earlier suites did not cover

- `provider-cookie-capture-extension.test.js` does reach gemini-web through two table-wide cases: the extension table matches the registry contract, and a capture uses exact-name reads only. That capture uses a pairing the test writes, cookies on `gemini.google.com` instead of `.google.com` and a mocked reply instead of the import route.
- `api/provider-cookie-import.test.js` replaces the registry with synthetic descriptors.
- `provider-cookie-import-contracts.test.js` checks the gemini-web row of the contract table.
- `gemini-web-provider.test.js` calls `buildImportedCookieHeader` and the executor with hand-built credentials. Its rotation case stops at the `onCredentialsRefreshed` callback.
- `provider-registration-web-batch-a-routes.test.js` saves a connection through manual add and chats with one account.

None of them joined a gemini-web capture or local input to the real routes, the database and a later request.

## Proved offline

| Requirement | Evidence (describe block: case) |
| --- | --- |
| One contract for registry, pairing and extension | real descriptor: resolves one contract |
| No localStorage or account email | real descriptor: takes no localStorage value |
| Pairing needs operator authority and the exact origin; import needs a pairing secret | real descriptor: issues no pairing |
| Capture reads exactly two names from the confirmed tab's cookie store, never enumerates or runs a script, sends one POST and returns the permissions it asked for | extension capture: creates a connection |
| Another store, the `accounts.google.com` host, non-Secure and unapproved cookies are not sent | extension capture: sends nothing when |
| Wrong, lookalike or plain-HTTP tab, or leaving Gemini during the permission prompt, reads no cookie | extension capture: reads and sends nothing; reads nothing when the tab leaves |
| Expired capture, or either cookie missing, leaves the stored credential unchanged | extension capture: keeps the stored credential |
| A tampered pairing cannot change the origin, drop a cookie or widen the allowlist | extension capture: refuses a pairing |
| Wrong origin or domain, insecure, expired, `__Secure-1PSIDCC`, duplicate, injected, oversized or other-provider bodies are refused, the pairing is spent and the row is unchanged | import route refusals: `it.each` table |
| Update ownership, expired pairing, duplicate create name | import route refusals: the last two cases |
| Cookie header, cURL `-H` and `-b`: only the two cookies are stored | dashboard input: imports |
| HAR: other origins ignored, two Gemini sessions are ambiguous, the chosen one replaces the paired row | dashboard input: offers each Gemini account |
| Create and update select only the intended row; priority and proxy survive an update | extension capture: replaces only the paired connection |
| Cookie encrypted at rest; absent from the connection list, import replies, extension results and console output | extension capture: creates a connection, plus log scans in other cases |
| Chat route gives the browser only the pinned account's cookies and its own proxy | consumption: gives the chat route |
| Connection test sends the stored cookie with that connection's proxy; a signed-out page fails it | consumption: tests a stored import |
| A rotation is saved to the account that ran the turn and sent on the next one | consumption: stores a rotation |
| A re-import made during a turn is not overwritten by that turn's rotation | consumption: does not let an in-flight turn's rotation |
| A pinned dead session returns 401 and uses no other account | consumption: keeps a pinned dead session |
| An unpinned dead session records 401 and fails over; after re-import the account serves again with its proxy | consumption: fails over from a dead session |
| A bare PSID or a Cookie-Editor export saved with manual add reaches the browser | consumption: serves … saved through manual add |

## Mocked boundaries and what stays unproved

| Boundary | Replacement | Unproved |
| --- | --- | --- |
| `chrome.*` | In-memory tabs, permissions and cookie stores | Real `chrome.cookies` behaviour. In particular, that the `https://gemini.google.com/*` optional host permission lets Chrome return cookies whose domain is `.google.com`. The mock does not model host permissions. |
| Playwright | Scripted launch, context and page | Chromium startup, Gemini's DOM and mode selectors, the real `StreamGenerate` body, redirect interception through CDP, real proxy egress, whether Google accepts a session seeded with only these cookies, and Google's own rotation |
| Management authority | `canAccessManagementApi` and `isOperatorRequest` read a synthetic header. `hasExactRequestOrigin` stays real | Real operator sessions, CLI tokens and the proxy middleware. Other suites own those |
| Proxy reachability | `testProxyUrl` returns success | A real proxy check |
| Connection-test transport | `__setProviderTestFetchForTesting` replaces `fetchWithConnectionProxy` | The proxy-aware fetch itself. The test shows which proxy settings reach it |
| Global `fetch` | Throws on any call | — |
| `node-machine-id` | Fixed synthetic id | — |

Also not exercised here: the popup UI and the `CookieImportModal` component (the test calls the capture and parser functions they call), PostgreSQL, and streaming or Anthropic Messages responses (covered by the earlier provider suites).

## Current limits (safe behaviour, asserted or read from source)

| Input or case | Behaviour |
| --- | --- |
| Bare PSID value in **Import cookies** | Refused: no `name=value` pair. Manual add accepts it |
| Browser-export JSON in **Import cookies** | Refused. `reviewPaste` in `CookieImportModal.js` sends text starting with `{` to the HAR parser, and other text without a cURL prefix to the header parser. The test calls those parsers directly. Manual add accepts a Cookie-Editor export |
| Only `__Secure-1PSID` | Both import paths refuse it. Manual add accepts it |
| `__Secure-1PSIDCC` | Extension never reads it, the dashboard parser drops it and the import route rejects it. A rotation during a turn can add it to the stored header afterwards |
| cURL or HAR in **Add Connection** | No parser there: only `CookieImportModal.js` imports `parseCurlCommand` and `parseHarDocument` |
| Expiry in pasted, cURL or HAR input | The dialog submits names and values only, so the import cannot refuse an expired session. Only extension capture sends `expirationDate`. A dead session fails the connection test or answers 401 at chat time, as far as the scripted pages show |
| Pinned request (`x-connection-id`) that gets 401 | The failure is returned without account cooldown or error state. This is the general gateway rule for pins (`processAttemptResult`) |

### Difference from the pinned upstream hint

OmniRoute (MIT) at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` labels the credential `__Secure-1PSID (optional: __Secure-1PSIDTS)` in `src/shared/providers/webSessionCredentials.ts` lines 90-92, and its hint in `src/shared/constants/providers/web-cookie.ts` line 63 asks for `__Secure-1PSIDTS` and `__Secure-1PSIDCC` "when available". DurinDoor's import contract requires `__Secure-1PSIDTS`. Only that text was compared; upstream runtime behaviour was not tested. Whether accounts without that cookie exist is unverified, so this report records the difference and does not call it a defect.

## Documentation defect

[`docs/providers/gemini-web.mdx`](../../../../docs/providers/gemini-web.mdx) is outside this unit's file scope and was not changed.

1. "Dashboard import" lists a Cookie header, cURL, HAR, a bare PSID and two JSON export shapes as inputs of one add flow. cURL and HAR work only in **Import cookies**. A bare PSID and the export shapes are manual add inputs.
2. The cookie table says `__Secure-1PSIDCC` is "kept if you include it". Neither import path keeps it.

Reproduction, offline: the case "refuses unsupported or incomplete input" shows the import parsers refusing a bare PSID and JSON; "imports a Cookie header" shows `__Secure-1PSIDCC` in the dropped list; the import route table shows its 400.

Minimum repair, for a single-owner docs unit: split that section into **Import cookies** (Cookie header, cURL, HAR; both cookies required) and **Add Connection** (Cookie header, bare PSID, JSON export), and limit the `__Secure-1PSIDCC` note to manual add and rotation. Product code needs no change for this.

## Evidence

Node 24.22.3, pnpm 12.18.0. Dependencies were installed with `--frozen-lockfile` in this worktree (root, `tests/`, `cli/`) with a private store, under `env -i` with only `PATH`, `LANG`, `CI`, private `HOME`, `DATA_DIR`, `TMPDIR` and cache paths, and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. Run from `tests/` in that environment:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-gemini-web-2034.test.js --maxWorkers=2
```

Result: 1 file, 45 tests passed.

With the related suites:

```sh
node node_modules/vitest/vitest.mjs run \
  unit/cookie-flow-gemini-web-2034.test.js unit/gemini-web-provider.test.js \
  unit/provider-cookie-capture-extension.test.js unit/provider-cookie-import-contracts.test.js \
  unit/api/provider-cookie-import.test.js unit/provider-cookie-import-dashboard.test.js \
  unit/provider-registration-web-batch-a-routes.test.js unit/web-session-redirects.test.js \
  --maxWorkers=2
```

Result: 8 files, 406 tests passed. ESLint on the new test file exits 0. The full CI gate was not run in this unit. CodeGraph 1.6.2 was not installed, so ownership was traced with bounded `rg` in this checkout.
