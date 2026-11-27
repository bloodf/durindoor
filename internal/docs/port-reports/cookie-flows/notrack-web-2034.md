# NoTrack Web cookie flow (#2034)

Status: **NOT VERIFIED**. The integration cases in `tests/unit/cookie-flow-notrack-web-2034.test.js` were added but could not be run in this checkout because its test dependencies are absent. No live sign-in or provider request was attempted. A passing isolated test run is required before treating the assertions below as evidence.

The actual registry descriptor specifies origin `https://notrack.ai`, required cookies `uid`, `si_usr_id`, and `si_ses_id`, optional `nt_session`, no chunk prefixes and no localStorage keys. It enables extension capture; the active executor posts to `/api/dispatch`. The new cases connect the issued pairing to the actual extension capture, import handler and SQLite repository, then pass the retrieved connection to the executor with a mocked fetch. They also exercise the real parser candidates for Cookie, cURL and HAR input, selected update ownership, refusal of foreign origin, expired cookies, unsupported chunks and localStorage, and response/log redaction. The generic handler suite uses synthetic descriptors; `notrack-optional-session-cookie.test.js` already covers the NoTrack parser, extension and executor separately. This addition targets their integration boundary.

The extension cookie store, management authority and network are mocked. SQLite is in-memory; the database driver and unrelated localDb lookups use the existing test fixture pattern. No proxy is configured in this case. These assertions cannot establish provider-side authentication, real browser permissions, a live sign-in, or proxy routing. The registry has no supported chunk or localStorage credential: those inputs should be refused, not interpreted as additional credentials. The existing optional-cookie suite covers omission of `nt_session`.

Exact intended focused command, with private directories and a credential-free environment (after separately supplying isolated dependencies):

```sh
env -i PATH="$PATH" LANG=C.UTF-8 CI=1 HOME="$run/home" DATA_DIR="$run/data" TMPDIR="$run/tmp" XDG_CACHE_HOME="$run/cache" npm_config_cache="$run/npm-cache" timeout 300s node tests/node_modules/vitest/vitest.mjs run tests/unit/cookie-flow-notrack-web-2034.test.js --config tests/vitest.config.js --maxWorkers=2
```

Here `run` must name a new private directory under `/var/tmp` with the listed subdirectories created first. Local execution: **not run**, because `tests/node_modules/vitest/vitest.mjs` is absent; no install was attempted. CodeGraph was unavailable (`CodeGraph 1.6.2 required`), so retrieval used bounded checkout searches. This report makes no new upstream-source claim; registry attribution already identifies OmniRoute release/v3.8.55, commit `4265bb2ad5477450a07d3a43ea33a62c6c874878`, `open-sse/config/providers/registry/notrack-web/index.ts`.
