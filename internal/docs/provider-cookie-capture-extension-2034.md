# Provider cookie capture extension (#2034)

Status: implemented and covered by closed-mock unit tests. It has not been run in a real browser, against a live dashboard or against a provider.

## Source attribution

No code is ported. The extension is an original implementation against DurinDoor's own server contract:

- Contract source: `src/lib/providers/cookieImport/` (`README.md`, `contract.js`, `handlers.js`, `pairing.js`), added by commit `1a5f5d3ebf` and the `#2113` import.
- Cookie names and origins: the registry `webLogin` block through `getCookieImportContract`.
- OmniRoute #13127 ("Feat/session sync extension", `contrib/session-sync/`, `docs/guides/SESSION-SYNC-EXTENSION.md`) appears in the [row dispositions](./port-reports/1073-october-07-15-row-dispositions.md) as a docs/test/CI-only row. It was not inspected for this change and no file, text or layout was taken from it. A session-sync design is a different product from a one-shot, user-confirmed capture.

## Call path

1. Operator: `POST /api/providers/cookie-import/pairing` returns `{ pairing }` (token, expiry, `importUrl`, contract).
2. Popup (`popup.js`) → `prepareCapture` (`capture.js`): `parsePairing` binds the pairing to the compiled-in table in `providers.js`, then `tabs.query` checks the active tab's origin. No cookie is read.
3. Confirmation: the user ticks a checkbox naming provider site and dashboard. `runCapture` requires `confirmed` to equal `confirmationFor(plan)`.
4. `prepareCapture` checks existing `cookies` and origin grants during Review; `runCapture` invokes `permissions.request` for missing grants directly from the confirmed Send gesture → `tabs.get` re-check → `cookies.getAllCookieStores` (tab's store) → `cookies.get` per approved name → one `fetch` POST to `importUrl` → `permissions.remove` of what the run was granted.
5. Server: `handleCookieImport` consumes the pairing and validates the body. The extension keeps its own filters (secure, host-bound domain, approved names) so it never sends what the server would reject.

## Decisions

- **Compiled-in provider table.** A pasted pairing is untrusted text. If the extension trusted its contract block, a forged pairing could ask for cookies of any site the user granted. The table fixes provider, origin and names; a pairing can only narrow them. `tests/unit/provider-cookie-capture-extension.test.js` compares the table with the registry-derived contract so the two cannot drift silently.
- **Optional permissions only.** `permissions` is `activeTab`; `cookies` and hosts are optional and requested on the Send click. `activeTab` is enough to read the tab's URL for the origin check without `tabs`.
- **Dashboard host permission.** The import route sends no CORS headers, so an extension page needs host permission for the dashboard origin. Its address is not known at build time, hence the optional `https://*/*` and loopback patterns. Only the paired host is ever requested and it is removed afterwards. Chrome host patterns ignore ports, so the grant covers the host. Adding CORS to the route was rejected: it would widen a public leaf for every site.
- **No background context.** No service worker, so no background collection and nothing that can be triggered by another extension or page.
- **No retry.** The secret is spent as soon as the server accepts the request for processing, so a retry would fail anyway and could hide a failure. A denied prompt is also final until the user clicks again.
- **Per-name `cookies.get`.** `cookies.getAll` would load unrelated cookies into memory. Chunks are probed `.0`, `.1`… until the first gap, at most 16 cookies, matching the server.
- **Fixed messages.** Results map HTTP status to static text; server bodies are never displayed.
- **STORE zip.** Compression output depends on the zlib version; STORE keeps the package byte-identical across machines.

## Inner.ai Web and Venice Web (1127)

Both are one exact-origin, one-cookie entries in `providers.js`, with one optional host permission each in `manifest.json` (`https://app.innerai.com/*`, `https://clerk.venice.ai/*`). No wildcard permission, localStorage read or cross-origin capture was added; `prepareCapture` keeps its exact equality between the active tab origin and the compiled origin.

- **Inner.ai account email.** The executor accepts `token=<jwt> <email>` (`open-sse/executors/inner-ai-web/credential.js`). The registry profile sets `accountEmail: "optional"`, which `resolveCookieImportContract` accepts only next to exactly one required cookie. The pairing route takes an optional `accountEmail`, validates it with `normalizeAccountEmail` (`src/shared/utils/cookieImportContract.js`, the executor's email grammar, at most 254 characters) and stores it in the server-side pairing entry only; the pairing response never carries it. `handleCookieImport` refuses any body with an `accountEmail` key (after the pairing is spent) and appends the paired email to the composed header. A blank or absent email stores the token alone, so a replacement never carries an earlier email forward. The extension reads no email and makes no account or profile call.
- **Venice Clerk origin.** The credential origin and the capture tab are both `https://clerk.venice.ai`. The user signs in at `venice.ai` and then opens the Clerk origin in the active tab; the extension refuses a `venice.ai` tab.

Tests: `tests/unit/provider-cookie-capture-extension.test.js` (Inner.ai Web and Venice Web block), `tests/unit/provider-session-registration-1127.test.js` (account email and Venice capture block), `tests/unit/provider-cookie-import-dashboard.test.js` (optional account email). Mocked only; no live capture was run.

## Rejected alternatives

`chrome.storage` for the pairing or last result (persists credentials); `cookies.getAll` with client-side filtering; permanent `host_permissions`; a background sync loop; native messaging; reading the dashboard session; auto-capture on page load.

## Verification and limits

Covered with mocked `chrome.*` and `fetch`: manifest shape, table/contract parity, pairing validation, tab and destination binding, confirmation, permission request and cleanup (denied, already held, revoked on every exit), cookie filtering and session binding, request shape, status mapping, expiry, cancellation (before start, during the prompt, in flight), popup behavior under happy-dom, and package reproducibility.

Not verified: real Chrome behavior (permission prompt text, whether `http://[::1]/*` is accepted as an optional pattern, activeTab visibility after navigation), a live dashboard, and any provider. The pairing store is per server process.

Tests: `tests/unit/provider-cookie-capture-extension.test.js`. Public instructions: [Web cookie providers](../../docs/providers/web-cookie.mdx#import-from-a-browser-extension). Extension reference: [`extensions/provider-cookie-capture/README.md`](../../extensions/provider-cookie-capture/README.md).
