# Conol Web cookie flow — #2034

Status: **partial mocked evidence**. The focused integration test was run locally; the remaining acceptance gaps are listed below. No live sign-in or provider request was performed.

The real registry descriptor at `open-sse/providers/registry/conol-web.js` describes `https://conol.ai` and the required `__Secure-better-auth.session_token` cookie. It declares no cookie chunk prefix, optional cookie, or localStorage key. The extension's fixed provider table has the same contract. The dashboard supports Cookie header, cURL and HAR parsing; cURL and HAR must identify the exact provider origin. A bare Cookie header cannot establish its origin. A numbered chunk or localStorage value is not an approved Conol credential here; the test checks server refusal rather than inventing support.

Existing `provider-cookie-capture-extension.test.js` and `api/provider-cookie-import.test.js` exercise generic extension and handler behavior, the latter with a synthetic registry. `conol-web-provider.test.js` covers the real descriptor and executor independently. The new test joins the unmodified registry, issued pairing, extension selection, import handler and encrypted SQLite connection, then passes that selected connection to the existing executor with synthetic network responses. It also covers parser inputs, provider-bound updates, rejection of foreign origin and expired cookie, and checks response/log redaction. Browser APIs, management guard authority and network are mocked; SQLite, repository operations, parser, registry and provider logic are real. The SQLite adapter is supplied through the driver boundary to isolate the database.

The executor is registered and has an active request path in this checkout; the test uses one chosen synthetic account and direct mocked fetch. It does not prove proxy selection, real browser permission behavior, provider acceptance, session lifetime, live authentication, or upstream protocol parity. It also does not establish that numbered cookies are impossible at the live service; they are unsupported by the current local contract. No product repair is asserted from this source-only inspection.

Evidence command, from the repository root after isolated dependencies are supplied (private `HOME`, `DATA_DIR`, `TMPDIR` and caches, no credentials):

```sh
env -i PATH="$PATH" LANG=C.UTF-8 CI=1 HOME="$RUN_HOME" DATA_DIR="$RUN_DATA" TMPDIR="$RUN_TMP" XDG_CACHE_HOME="$RUN_CACHE" timeout 300s node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-conol-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2
```

No upstream source was inspected or ported for this unit; the local registry's existing attribution is not independently verified here.

## Public-route follow-up

The follow-up adds real public chat and messages route cases, each buffered and streamed. Two accounts are created through pairing and import, persisted in isolated SQLite, and bound to distinct strict proxy pools. Header, cURL and HAR parser candidates are imported and checked in storage before a pinned dispatch. Synthetic vendor responses are the only external network; each of the six requests is checked for the pinned account's cookie and dispatcher, and the response, connection listing and captured logs are checked for both account secrets. This is mocked evidence only, not a live-provider claim.

The shared fixture does not allow caller-supplied public-request headers or body fields: `dispatch` constructs the request internally and only accepts the connection pin. The orchestrator should extend `dispatch` to accept explicit additional headers (and, for ownership tests, an optional body override), without replacing public route, admission, storage or selection. Seed real client API keys with `db.createApiKey`, enable `requireApiKey`, and pass their bearer or x-api-key headers through that extension. This is needed to test authenticated public dispatch and foreign-owner rejection; management pairing already uses the synthetic operator boundary.

Remaining acceptance work: safe-refusal fallback versus no replay after partial or uncertain accepted work; quota, malformed/HTML, abort and body deadline failures and absence of a success terminal; authenticated caller and foreign-owner cases; and public-route error redaction. The existing update and invalid-origin/expiry tests use the older isolated adapter fixture, not this public-route fixture. The new positive cases do not establish these behaviors. No product defect is established by this follow-up.

The focused command above was run with isolated dependencies and private paths under `/var/tmp/conol2034-run-*`; its final result is recorded below. Root lint components were run separately with the same environment and 300-second ceilings. Full CI is outside this worker's scope.

Result: the focused command passed 9 tests (one file). Pinned vendor 401 refusal was also checked in buffered and streamed OpenAI requests: one vendor call, the selected cookie and proxy only, an error status, and no `[DONE]`. The separate root lint commands `node node_modules/eslint/bin/eslint.js src`, `node scripts/build-anti-slop-plugin.mjs`, and `node scripts/check-anti-slop.mjs` exited 0; ESLint reported 348 warnings and no errors, and anti-slop reported zero diagnostics. `git diff --check` passed. These checks do not satisfy the full acceptance gaps listed above.
