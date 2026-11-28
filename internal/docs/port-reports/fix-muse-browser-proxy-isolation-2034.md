# Muse Spark Web browser refresh proxy isolation — #2034

**Verdict: FIXED for the mocked contracts.** The browser step of the token refresh now uses the selected connection's
egress route, or refuses before anything carrying the cookie is sent. Live proxy and browser behaviour is unverified.

Base: `e3658bc6836`. Defect report: `internal/docs/port-reports/cookie-flows/muse-spark-web-2034.md` ("the browser leg
ignores the connection proxy"). OmniRoute `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` (MIT) has the same gap. This is a
DurinDoor fix, not a port of upstream code.

## Changed files

| File | Change |
| --- | --- |
| `open-sse/executors/muse-spark-web/browser-route.js` | New. Route resolution, refusal type, bounded stage helper, per-key lock |
| `open-sse/executors/muse-spark-web/fresh-access-token.js` | Uses the route for the pool, the cache key and the pool key; bounds and cleanup |
| `tests/unit/fix-muse-browser-proxy-isolation-2034.test.js` | New regression suite, 19 cases |

No other product file changed. `muse-spark-web.js`, the browser pool, `proxyFetch.js`, providers, `src/**` and the
existing Muse suites are untouched.

## Behaviour after the fix

1. **One route, resolved first.** `resolveMetaBrowserRoute` uses the existing `resolveConnectProxyForRequest` for
   `https://www.meta.ai/` and `resolveProxyForRequest` for the GraphQL URL. It runs before the bootstrap fetch, the
   cookie placement and any page work. The resolved `proxyUrl` goes to `acquireBrowserContext`, which already turns it
   into the context's Playwright `proxy` option through `resolvePlaywrightProxy`.
2. **Refusals, all before any send.** These are refused: any HTTP relay, strict or not, because a browser cannot use
   it and the WebSocket leg refuses every relay anyway. Also refused: a strict route with no proxy, including a proxy
   bypassed by `noProxy`; a proxy scheme or URL the browser cannot apply; and a bootstrap route that would differ from
   the page route. Nothing falls back to direct.
3. **Engines.** `PROXY_CAPABLE_ENGINES` holds only `chromium`, the plain Playwright launch. If a proxy is required and
   the pool reports `obscura`, `cloakbrowser` or anything else, the refresh is refused after the context is created
   and before the cookie is placed or a page is opened. The context is then released. A direct route works on any
   engine. Operators whose pool picks Obscura will see proxied Muse refreshes refused until that engine is verified.
4. **Keys.** The token cache key and the pool key are a hash of connection id, cookie header and route id (source and
   proxy URL). A cookie rotation, a re-import, a proxy change, or a switch between proxy and direct cannot reuse an
   earlier token or context. Two accounts never share one. Proxy credentials and cookies do not appear in either key.
   The strict flag is not part of the key, because strict and non-strict use of the same proxy share one egress.
5. **Concurrency.** Refreshes with the same key run one at a time. The second waits, then takes the cached token. One
   request can no longer close the pooled context another request is still using. Different keys run independently.
6. **Bounds and cancellation.** These limits apply (`MUSE_REFRESH_LIMITS`): 45 s overall, 20 s browser launch, 10 s
   each for page open, cookie placement and routing, 30 s for navigation, 10 s for the page body, and an 8 MiB page
   body. A caller abort or an expired bound closes the page and releases the context. A context or page that arrives
   after the caller gave up is closed when it arrives. Its key stays locked until then, or for at most the overall
   bound. A pre-aborted call does no work. The refresh is not billable, and nothing is retried after the billable turn.
7. **Reporting.** A refusal returns `{ ok: false, status: 503, refused: true }`, which is neither an auth error nor a
   success. Error strings pass through `sanitizeErrorMessageWithSecrets` with the cookie and proxy URL as secrets.
   `muse-spark-web.js` was out of scope, and it maps that refusal to its existing 502 "Meta AI token bootstrap failed".
   So the client sees an upstream-style 502, not a message naming the local refusal.

The guard is unchanged. Without `enableSessionDispatch === true` the executor returns 501 and sends no cookie. Setup
GraphQL calls and the WebSocket keep their existing proxy behaviour.

## Evidence

All of it uses mocks. `playwright` and `obscura.js` are mocked; the real `browserPool.js` runs on top of them. Proxy
dispatchers are identity fakes. No browser, proxy, relay or Meta endpoint was contacted.

| Requirement | Test |
| --- | --- |
| Two accounts, two proxies: each context's `proxy` (server, username, password) matches the account whose cookie it receives; bootstrap uses the same proxy | `binds each account's proxy and credentials…` (real pool, chromium) |
| Direct route: context has no proxy | `gives a direct connection a context with no proxy` |
| Unsupported engine fails closed | `refuses a proxied refresh on Obscura…` (real pool, Obscura) |
| Strict relay, non-strict relay, strict with no route, bad scheme, `noProxy` bypass under strict: no fetch, no acquire | `routes refused before any send` |
| Cache and pool key change on proxy, direct, rotation and connection | `reuses a token only for the same connection, cookie and route` |
| Concurrent requests | `serializes concurrent refreshes of one key…` |
| Abort during navigation; late context after abort; launch bound; oversized body; navigation failure | `cancellation and bounds`, `closes the page and context when navigation fails` |
| Guard off: 501, no send, no browser | `keeps a guarded connection on 501…` |
| No cookie or proxy password in console output or error strings | `afterEach` console check plus per-case `error` checks |

Command, run under `env -i` with a private `HOME`, `DATA_DIR`, `TMPDIR` and pnpm store, and no credentials:

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/fix-muse-browser-proxy-isolation-2034.test.js --maxWorkers=2
```

Result: 19 passed. The existing Muse, web-session proxy, guard and browser-pool suites were run with it: 14 files,
204 tests, twice, all passing. `review-x-executor-send*.test.js` and `review-x-sse-final.test.js` also passed, 302
tests. The full suite, build and e2e checks were not run.

## Limits, not fixed here

### Exactgate3 retry (2026-11-28)

Carried the full `490e128679456faa46bc3acf2adc7f58c936c5c1` ancestry. The 19-case regression
file and all existing suites remain unchanged. Reused the project's `isString` helper for relay
and page-body validation; constructed refusal results and context options before conditionally
assigning fields. These are lint-only rewrites preserving the existing route/cache/guard contracts.
The actual anti-slop run exposed two additional diagnostics at context options and page-body
validation; both were addressed, without suppressions.

Retry evidence is in `/var/tmp/muse-exactgate3-check-pijc12kx`. Initial root lint timed out;
the required own suite and the explicit related/review suite attempts could not collect because
`tests/node_modules/vitest/vitest.mjs` was absent. No dependencies were installed or repaired by
this worker. The earlier 19/204/302 results above are carried evidence, not new retry passes.
The isolated native gate must supply setup and rerun the exact suites before qualification.
The full earlier exactgate3 output was not available in this checkout; the retry records actual
local diagnostics rather than claiming that earlier output was inspected.
The final real anti-slop check passed with zero diagnostics across 3,702 files. Both edited
modules passed `node --check`, and `git diff --check` passed.
The complete final `pnpm run lint` passed (exit 0): ESLint reported zero errors and 348
warnings; the bundled anti-slop gate reported zero diagnostics. Full output is retained in
`root-lint-final.log` in the retry evidence directory.

- **Unverified live behaviour.** Nothing here shows that a launched Chromium sends its traffic through the context
  proxy, that a SOCKS proxy with credentials works, or that Meta accepts the cookie. `cloakbrowser` and Obscura were
  not checked. They are refused for proxied refreshes rather than assumed safe.
- **Refused-route status.** The client sees 502 because of the executor's existing mapping (see point 7).
- **Context creation on a refused engine.** On an unverified engine, the context is created with the proxy option
  before the engine check. No cookie is placed and no page is opened. The pool cannot report its engine before launch.
- **Rotated cookie persistence** and **a bare value containing `=`** remain as described in the cookie-flow report.
  Neither changed here.
- `docs/providers/muse-spark-web.mdx` was not updated in this unit.
