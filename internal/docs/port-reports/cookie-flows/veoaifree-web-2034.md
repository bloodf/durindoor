# Veo AI Free cookie flow (#2034)

Status: **NOT PARITY — local integration test has not been executed.** This is an offline contract check, not evidence of live sign-in or provider acceptance. The checkout did not contain the test dependencies; no install or browser run was performed.

The real `open-sse/providers/registry/veoaifree-web.js` describes an optional session at `https://veoaifree.com`: exactly one `wordpress_logged_in_` name followed by 32 lowercase hexadecimal characters. It defines no fixed cookie, chunk family, optional cookie, or localStorage field. The provider remains usable anonymously. Existing `tests/unit/veoaifree-cookie-name-contract.test.js` checks the real descriptor, single-member selection, refusal of chunks, ambiguity, bad origin and expired cookies, and Cookie header, cURL and HAR parsing. Its extension tests check a bounded URL/store enumeration and selection; `tests/unit/veoaifree-existing-session-picker.test.js` checks eligible dashboard update selection. Generic handler tests use synthetic descriptors.

The new focused test connects those previously separate layers: an operator-authorized pairing supplies the real contract to extension capture; its synthetic browser cookie is submitted to the real import handler and encrypted SQLite repository; the retrieved account is passed to the same video adapter implementation registered for this provider, with only HTTP mocked. It also checks a replacement is bound to the chosen account, leaves a sibling account intact, rejects mismatched targets, origin and expiry, and does not expose the synthetic secret in responses or captured console logs. The adapter instance has its polling delay shortened; the test does not exercise gateway account or proxy selection. It does not prove a proxy path, live authentication, actual browser permission behavior, or a live generation. The owner requirement for a selected account/proxy through the active gateway therefore remains unproved.

The extension and parser tests cited above already cover the supported input forms; no localStorage or chunk success is claimed. The imported credential is supplied directly from the repository to the adapter in the new test, so the gateway's credential selection and dispatch remain a separate coverage gap. No upstream source was consulted and no upstream behavioral claim is made.

Intended focused evidence command, from the repository root after isolated dependencies are supplied:

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/cookie-flow-veoaifree-web-2034.test.js --maxWorkers=2
```

This command was **not run** here: `tests/node_modules/vitest/vitest.mjs` and root `node_modules/better-sqlite3` were absent. A clean isolated run is required before relying on these assertions. CodeGraph was unavailable (`CodeGraph 1.6.2 required`); bounded checkout searches were used instead. No product defect was established by an executed reproduction.
