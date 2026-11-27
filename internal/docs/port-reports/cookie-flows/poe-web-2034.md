# Poe Web cookie flow (#2034)

Status: **NOT PARITY — verification incomplete**. The focused test is present but has not been executed in this checkout because root, CLI and test dependencies are absent. The native gate must run it with isolated dependencies before treating its assertions as evidence. In particular, the test has not established a chosen proxy route, and the parser cases do not yet carry each parsed candidate through persistence. No live sign-in, real account, browser, or provider network was exercised.

The actual registry entry specifies `https://www.poe.com` and the single required cookie `p-b`; it specifies no chunk prefixes, optional cookies, localStorage keys or web-login profile. The extension is intended to read only that name in the active tab's cookie store. The executor parses the stored header and sends `p-b` to `/api/gql_POST`. These are local implementation contracts, not evidence of the current live Poe protocol or successful sign-in. The provider is active, not staged.

Existing `provider-cookie-import-contracts.test.js` checks the descriptor, `provider-cookie-capture-extension.test.js` exercises generic extension behavior, `api/provider-cookie-import.test.js` uses synthetic registry entries and SQLite, and `poe-web-provider.test.js` tests the executor with directly supplied credentials. The new test joins the real descriptor, pairing, extension selection, import and encrypted repository to the executor using synthetic values and mocked browser/network boundaries. It also covers update selection, rejection of a mismatched target, origin, expired cookie and invented chunk, and parser filtering for Cookie, cURL and HAR. The dashboard Cookie-header format cannot independently establish an origin; cURL and HAR include request origins. Cookie chunks and localStorage are not supported by this descriptor; the test asserts no localStorage read and rejects a fabricated chunk. Pairing authority is mocked, so the test does not prove the guard implementation itself.

The intended evidence command, from `tests/` with isolated, pre-provisioned dependencies and a private environment, is:

```sh
timeout 300s node node_modules/vitest/vitest.mjs run unit/cookie-flow-poe-web-2034.test.js --maxWorkers=2
```

Local result: **not run** (no `node_modules` in root, `cli/`, or `tests/`). No upstream source was consulted for this report; no upstream protocol claim is made. Remaining work: execute and repair the focused test if necessary, verify a chosen proxy through the actual dispatch boundary, and carry each supported parser result through the authenticated import path. These gaps are verification work, not a demonstrated product defect.
