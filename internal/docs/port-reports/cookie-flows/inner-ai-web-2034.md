# Inner.ai Web cookie flow (#2034)

**Status: NOT PARITY — evidence pending execution.** The checkout used for this work has no root, CLI, or test dependencies installed. The test below is an unverified integration proposal, not evidence of a passing flow. No browser, provider account, or live network was used. The owner should run it in the native isolated dependency gate and correct any failures before treating the requirement as proved.

The existing `provider-cookie-capture-extension.test.js` exercises Inner.ai with constructed pairings; `provider-cookie-import.test.js` substitutes synthetic registry entries; `inner-ai-web-provider.test.js` exercises the registered executor with synthetic credentials. The new test connects the real registry descriptor, issued pairing, extension functions, import handlers and SQLite connection repository, then passes the selected stored credential and proxy to the existing executor with mocked upstream responses. It also covers Cookie, cURL and HAR candidate parsing, origin and expired-cookie refusal, update target binding, email binding and response/log redaction. These are assertions awaiting execution, not verified results.

The checked-in descriptor specifies `https://app.innerai.com` and the single required `token` cookie. It has no chunk prefixes, optional cookies or localStorage keys. The optional email is supplied by the operator and bound to the server-side pairing; the extension does not read it from a cookie. The executor can obtain an email from the profile response and has further fallbacks. A Clerk-origin request is not the approved app origin. A pasted Cookie header has no independently verifiable origin, while cURL and HAR candidates carry request origins. These statements describe this repository's contract, not a live sign-in or an independent upstream verification.

The provider is registered and active in this checkout; this report does not activate a staged provider. Mocked catalog, profile and chat responses cannot establish that a real session works, that the upstream service still accepts the contract, or that a real proxy routes traffic. The test directly supplies the selected connection to the executor; it does not prove gateway account or proxy selection. No upstream source was consulted, and no upstream claim or ported implementation is made here.

Intended focused command from `tests/`, with dependencies supplied privately by the gate and a unique private HOME, DATA_DIR, TMPDIR and cache directories:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-inner-ai-web-2034.test.js --maxWorkers=2
```

Local evidence: dependency directories `node_modules`, `tests/node_modules`, and `cli/node_modules` were absent. No install was attempted. The required focused test, full CI, and independent review remain outstanding. No product defect was established by this unexecuted test.
