# v0-vercel-web cookie flow (#2034)

Status: **NOT PARITY**. The integration cases below are written but have not run in this checkout; they cannot establish a passing end-to-end contract until the native gate supplies isolated dependencies. No live sign-in, real provider request, browser, or upstream service was exercised. No upstream claim is made here; the evidence is this checkout's implementation.

The real registry entry declares `https://v0.dev` and the required `__vercel_session` cookie. It declares no chunk prefixes, optional cookies, or localStorage keys. The extension table agrees. The executor accepts that named cookie and posts to `https://v0.dev/api/chat`; this is an active provider, not a staged provider. Registry metadata is not evidence that a live v0 session or protocol currently works.

Existing `provider-cookie-import-contracts.test.js` checks the registry contract, `provider-cookie-capture-extension.test.js` and `api/provider-cookie-import.test.js` cover generic capture/import with fixtures, and `v0-vercel-web-provider.test.js` covers the executor with a mocked sender. The new suite joins the real registry, extension capture, pairing/import handlers and encrypted SQLite repository, then passes the retrieved credential and selected proxy options into the real executor with its network boundary mocked. It also exercises Cookie, cURL and HAR parser candidates, including distinct account selection, foreign origin and unsupported chunk refusal; it checks update binding, expiration, redaction and capture confirmation. Header input has no known origin, as the parser explicitly reports. Chunks and localStorage are not supported by this descriptor; their absence must not be treated as a proven upstream limitation.

The tests use synthetic credentials, a mocked management authority and browser APIs, and a mocked provider transport. They do not prove browser permissions, a real proxy connection, upstream acceptance, or live authentication. The generic authority and replay suite remains responsible for broader pairing security cases. The new suite requires a passing run before these assertions can be reported as evidence. No product defect was reproduced in this source-only pass.

Evidence attempted from the checkout, with `PATH`, `LANG=C`, `CI=1`, and unique private `/var/tmp` HOME, DATA_DIR, TMPDIR and XDG_CACHE_HOME under `env -i`:

```sh
timeout 300s node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-v0-vercel-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2
```

Result: not run; `tests/node_modules/vitest/vitest.mjs` is absent. `node --check tests/unit/cookie-flow-v0-vercel-web-2034.test.js` passed. CodeGraph query `v0-vercel-web` was unavailable because the required CodeGraph 1.6.2 installation was absent; bounded checkout searches were used instead. No dependencies were installed or modified. A later isolated gate must run the focused suite and full required checks, and resolve any failures before parity can be assessed.
