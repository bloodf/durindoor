# Veo AI Free cookie flow (#2034)

Status: **INCOMPLETE — public-route evidence added, with gaps below.** This is an offline contract check, not evidence of live sign-in or provider acceptance. The checkout did not contain the test dependencies; no install or browser run was performed.

The real `open-sse/providers/registry/veoaifree-web.js` describes an optional session at `https://veoaifree.com`: exactly one `wordpress_logged_in_` name followed by 32 lowercase hexadecimal characters. It defines no fixed cookie, chunk family, optional cookie, or localStorage field. The provider remains usable anonymously. Existing `tests/unit/veoaifree-cookie-name-contract.test.js` checks the real descriptor, single-member selection, refusal of chunks, ambiguity, bad origin and expired cookies, and Cookie header, cURL and HAR parsing. Its extension tests check a bounded URL/store enumeration and selection; `tests/unit/veoaifree-existing-session-picker.test.js` checks eligible dashboard update selection. Generic handler tests use synthetic descriptors.

The new focused test connects those previously separate layers: an operator-authorized pairing supplies the real contract to extension capture; its synthetic browser cookie is submitted to the real import handler and encrypted SQLite repository; the retrieved account is passed to the same video adapter implementation registered for this provider, with only HTTP mocked. It also checks a replacement is bound to the chosen account, leaves a sibling account intact, rejects mismatched targets, origin and expiry, and does not expose the synthetic secret in responses or captured console logs. The adapter instance has its polling delay shortened; the test does not exercise gateway account or proxy selection. It does not prove a proxy path, live authentication, actual browser permission behavior, or a live generation. The owner requirement for a selected account/proxy through the active gateway therefore remains unproved.

The extension and parser tests cited above already cover the supported input forms; no localStorage or chunk success is claimed. The imported credential is supplied directly from the repository to the adapter in the new test, so the gateway's credential selection and dispatch remain a separate coverage gap. No upstream source was consulted and no upstream behavioral claim is made.

Intended focused evidence command, from the repository root after isolated dependencies are supplied:

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/cookie-flow-veoaifree-web-2034.test.js --maxWorkers=2
```

This command was **not run** here: `tests/node_modules/vitest/vitest.mjs` and root `node_modules/better-sqlite3` were absent. A clean isolated run is required before relying on these assertions. CodeGraph was unavailable (`CodeGraph 1.6.2 required`); bounded checkout searches were used instead. No product defect was established by an executed reproduction.


## Public-route follow-up

The original account above describes the initial test and its original execution state. A later offline run adds the shared isolated `cookiePublicFlow2034` fixture and calls the real `/api/v1/video/generations` POST handler. Cookie header, cURL and HAR inputs are parsed with the dashboard parser, submitted through real pairings and import, persisted in SQLite, and each dispatched pinned to its stored connection and strict proxy. Mocked vendor frames cover a completed submit/poll/result, a quota response after submit, and an aborted uncertain submission. The tests check the selected cookie and dispatcher, the accepted-job marker for errors after submission, and response/list redaction. The initial two cases remain unchanged. These are synthetic results, not live provider evidence.

This does **not** complete the acceptance requirement. Public-route safe-refusal fallback, malformed/HTML responses, body deadline, explicit foreign-owner refusal without writes, and comprehensive log redaction remain unproved. The original tests cover replacement, wrong origin and expired metadata at the real import handler but do not establish every requested no-write invariant. Existing adapter-only tests cover several failure classes but are not gateway proof. No product defect was established; no product repair is proposed on this evidence. The helper currently exposes only chat dispatch: the test imports the real video route directly, which works with the helper's DB and network interception. A useful shared-helper extension would expose a video dispatch method accepting model, body, connection id and abort signal; it is not required to access the handler and was not made in this unit. The registered adapter polls after 20 seconds, so the success case uses the real delay.

Commands used with `env -i`, explicit PATH/LANG/CI and private HOME, DATA_DIR, TMPDIR and cache under `/var/tmp/veo2034-run`, each wrapped in `timeout 300`:

```sh
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-veoaifree-web-2034.test.js tests/unit/native-veoaifree-web-video.test.js tests/unit/veoaifree-cookie-name-contract.test.js --config tests/vitest.config.js --maxWorkers=2
node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-veoaifree-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2
node node_modules/eslint/bin/eslint.js src
node scripts/build-anti-slop-plugin.mjs
node scripts/check-anti-slop.mjs
```

The three-file run passed 41 tests before the interrupted-submit assertion was added; the final focused run passed all 3 tests with that assertion. ESLint exited 0 with 348 warnings, and both anti-slop commands exited 0. The first focused run failed because the test used the wrong accepted-job header name; it passed after correcting the test to the actual `x-durindoor-accepted-job` header. Full CI was outside this unit's scope.
