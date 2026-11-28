# Conol Web cookie flow — #2034

Status: **unverified locally**. The focused integration test has been added but could not be run in this checkout: root, CLI and test dependencies are absent. It must pass the focused command below and the repository gate before its assertions can be treated as evidence. No live sign-in or provider request was performed.

The real registry descriptor at `open-sse/providers/registry/conol-web.js` describes `https://conol.ai` and the required `__Secure-better-auth.session_token` cookie. It declares no cookie chunk prefix, optional cookie, or localStorage key. The extension's fixed provider table has the same contract. The dashboard supports Cookie header, cURL and HAR parsing; cURL and HAR must identify the exact provider origin. A bare Cookie header cannot establish its origin. A numbered chunk or localStorage value is not an approved Conol credential here; the test checks server refusal rather than inventing support.

Existing `provider-cookie-capture-extension.test.js` and `api/provider-cookie-import.test.js` exercise generic extension and handler behavior, the latter with a synthetic registry. `conol-web-provider.test.js` covers the real descriptor and executor independently. The new test joins the unmodified registry, issued pairing, extension selection, import handler and encrypted SQLite connection, then passes that selected connection to the existing executor with synthetic network responses. It also covers parser inputs, provider-bound updates, rejection of foreign origin and expired cookie, and checks response/log redaction. Browser APIs, management guard authority and network are mocked; SQLite, repository operations, parser, registry and provider logic are real. The SQLite adapter is supplied through the driver boundary to isolate the database.

The executor is registered and has an active request path in this checkout; the test uses one chosen synthetic account and direct mocked fetch. It does not prove proxy selection, real browser permission behavior, provider acceptance, session lifetime, live authentication, or upstream protocol parity. It also does not establish that numbered cookies are impossible at the live service; they are unsupported by the current local contract. No product repair is asserted from this source-only inspection.

Evidence command, from the repository root after isolated dependencies are supplied (private `HOME`, `DATA_DIR`, `TMPDIR` and caches, no credentials):

```sh
env -i PATH="$PATH" LANG=C.UTF-8 CI=1 HOME="$RUN_HOME" DATA_DIR="$RUN_DATA" TMPDIR="$RUN_TMP" XDG_CACHE_HOME="$RUN_CACHE" timeout 300s node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-conol-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2
```

Not run here: dependencies are absent; the native gate must provide isolated dependencies. This is not a passing test receipt. No upstream source was inspected or ported for this unit; the local registry's existing attribution is not independently verified here.
