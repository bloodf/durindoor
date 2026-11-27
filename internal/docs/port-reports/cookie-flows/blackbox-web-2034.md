# Blackbox Web cookie flow (#2034)

Status: **verification pending**. The integration tests in this unit have not been run in this checkout because root and test dependencies are absent. They must pass in the isolated native gate before treating the assertions below as evidence. No live sign-in or provider request was made.

The production registry profile declares `https://app.blackbox.ai` and the single required `next-auth.session-token` cookie. It declares no chunk prefix, optional cookie, or localStorage credential; chunk-only input is refused. The dashboard parser accepts Cookie headers, cURL, and HAR, subject to the actual contract and origin checks. A raw header has no independently known origin. HAR can contain multiple matching accounts, requiring selection. The extension reads the exact name from the confirmed tab's cookie store and does not enumerate cookies or read localStorage for this provider.

Existing `provider-cookie-import-contracts.test.js` and `blackbox-web-provider.test.js` cover the registry contract and executor separately; the generic extension and import suites use other providers or synthetic descriptors. The new test connects the real pairing to extension capture, isolated SQLite import, and the executor with a selected synthetic account and mocked proxy transport. It also exercises parser candidates through import, update ownership, foreign origin, expired cookie, unexpected localStorage, management authorization, and redaction. The network and browser are mocked, and the management authority and database adapter boundary are fixtures; the registry, parser, handlers, connection repository, and executor are production code. It does not establish a real browser session, real proxy connectivity, provider acceptance, or live sign-in parity.

Evidence command, to run with the task's private credential-free environment and installed isolated dependencies:

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/cookie-flow-blackbox-web-2034.test.js --maxWorkers=2
```

Local source-only checks: `node --check tests/unit/cookie-flow-blackbox-web-2034.test.js` and `git diff --check` passed. CodeGraph query was unavailable because the required 1.6.2 executable was not installed. No upstream source was consulted and no upstream behavior is asserted here. No product repair is proposed on the basis of these unexecuted tests.
