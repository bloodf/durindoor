# Muse Spark Web cookie capture and import — #2034

**Verdict: NOT PARITY.** Capture, import, storage and update are proved offline on the real registry descriptor.
Stored-credential dispatch reaches the executor, but one leg ignores the connection proxy: the browser step of the
token refresh gets the imported cookie in a context with no connection proxy. Live sign-in is unproved.

Base: `4819aba30dd2c3789f54bd3127ec0bcf1bfc2f6c`. This change adds this report and
`tests/unit/cookie-flow-muse-spark-web-2034.test.js`. It changes no product code.

## Contract, as the code declares it

| Item | Value |
| --- | --- |
| Provider and alias | `muse-spark-web`, `ms-web`; `category: webCookie`, `authType: cookie` |
| Import origin | `https://www.meta.ai` exactly. `auth.meta.com` is a sign-in navigation host, not a credential origin |
| Required cookie | `ecto_1_sess` |
| Chunks, optional cookies, hashed families | none |
| `localStorage`, account email | none |
| Stored credential | `apiKey = "ecto_1_sess=<value>"` after capture or import, encrypted at rest |
| Dispatch | guarded (501 `provider_port_pending`) unless the connection has `enableSessionDispatch === true` |

The descriptor is `webLogin` in `open-sse/providers/registry/muse-spark-web.js`. It has no `cookieImport` override.
These are static declarations. They do not show that Meta accepts this cookie today.

## Existing coverage compared

| Suite | What it already covers for this provider | Gap closed here |
| --- | --- | --- |
| `provider-cookie-import-contracts.test.js` | Origin, name and capture flag; candidate selection and header composition from pre-parsed objects | Raw header, cURL and HAR text through the real parsers into the real routes and database |
| `provider-cookie-capture-extension.test.js` | Table equality with the registry; capture flow using other providers | A Muse capture whose single POST reaches the real import route |
| `api/provider-cookie-import.test.js` | Pairing and import rules on a synthetic registry | Muse refusals and update ownership on the real registry |
| `provider-cookie-lifecycle-muse-yuanbao-hugging.test.js` | Direct create and re-paste; the closed guard at client entry points | Pairing import, then opt-in, then dispatch of the stored credential |
| `muse-spark-web-browser-dispatch.test.js` | Executor with hand-built credentials and no proxy | Database credential selection through `handleChat` with a per-account proxy |
| `muse-spark-web-guarded-dispatch.test.js` | Every non-boolean opt-in stays guarded | Not repeated; one case shows a fresh import starts guarded |

Pairing lifetime, concurrent replay, body limits, transport rules, the isolated login host and popup cancellation are
provider-independent. The generic suites own them, and they are not repeated here.

## Owner requirement

| Requirement | Result | Boundary |
| --- | --- | --- |
| Capture: one `cookies.get` for `ecto_1_sess` in the confirmed tab's store; no enumeration or scripting; exact permission grant, then removal | Proved | `chrome.*` is a fake |
| Wrong tab origin; missing, foreign-domain, insecure or empty cookie: no POST | Proved | `chrome.*` is a fake |
| A pairing cannot add cookie names, chunks or `localStorage`, or move the origin | Proved | |
| Expired cookie | Refused by the server. The extension does not filter expiry for fixed names: it POSTs once, the import answers 400 and the stored session is unchanged | Real browsers were not run |
| Pasted `Cookie` header, cURL `-H` and `-b`, HAR: only `ecto_1_sess` is stored, with `=` and `%3A` preserved | Proved | The test calls the parsers and shared selection the dialog uses, then posts its request shape. The React dialog is not rendered |
| Authenticated issuance, same-origin check, one-use refusal | Proved at the route | The management guard is mocked, so real sessions and CLI tokens are not exercised |
| Create, and update bound to one connection and provider; sibling and other provider unchanged; opt-in and proxy kept | Proved | Isolated SQLite |
| No cookie in import, list, update or chat responses; no pairing token in import responses; neither in capture results or console output; no plaintext cookie in the stored row | Proved for the exercised paths | Console spies only |
| Stored credential reaches the executor for the chosen account | Proved: three GraphQL sends use that account's proxy dispatcher, and the WebSocket gets an agent for the same proxy | Physical transport, browser pool, page token and WebSocket are fakes |
| That account's proxy covers **all** traffic that carries the credential | **Failed.** See the reproduction below | |
| Strict proxy whose bootstrap send fails | No direct retry, no browser, no WebSocket; 502 | Does not cover the browser leg after a successful bootstrap |
| Live sign-in, cookie validity, token extraction, protocol acceptance, models, quota | **Unproved** | No account, browser or provider was used |
| Remote web sign-in capture (`webLogin` browser session) | **Not covered** by this unit | |

## Unsupported input modes

The parser or the server refuses each of these without echoing the cookie value.

- A bare value in the import dialog. It needs `ecto_1_sess=<value>`.
- `localStorage` JSON or values, numbered `ecto_1_sess.N` chunks, or `abra_sess` alone.
- cURL for `https://meta.ai`, `https://auth.meta.com` or plain-HTTP `www.meta.ai`; a `-b` cookie-jar file.
- A HAR with no `https://www.meta.ai` request.
- A request-supplied account email, an extra cookie, or a sign-in host cookie domain.

A HAR with two different sessions is not refused. It yields two candidates, and the operator must choose one.

The paste parsers keep names and values only. The dialog therefore sends no expiry, and the server cannot refuse an
expired session from a header, cURL or HAR paste. Expiry then shows at dispatch: a redirected bootstrap returns 401
with a re-import message, before any browser or WebSocket use.

## Other limitations

- Capture and import do not set `enableSessionDispatch`. The operator must opt the connection in.
- The manual Add form stores a bare value as typed. The executor adds the cookie name. A bare value that contains `=`
  is read as a header with no `ecto_1_sess` and returns 401 with no traffic, although `authHint` invites a bare value.
  Whether real session values contain `=` is unverified.
- A `Set-Cookie` rotation from the bootstrap is used for that turn but is not written to the connection. Whether Meta
  then rejects the older value is unverified.

## Defect: the browser leg ignores the connection proxy

`fetchFreshAccessToken` in `open-sse/executors/muse-spark-web/fresh-access-token.js` passes `proxyOptions` to the
bootstrap `proxyAwareFetch`. Its `acquire(...)` call passes only `cookieDomain`, `blockServiceWorkers`, `warmupUrl`
and `userAgent`. `acquireBrowserContext` in `open-sse/services/browserPool.js` sets a context proxy only from
`options.proxyUrl`. The executor then adds `ecto_1_sess` to the context and navigates to `https://www.meta.ai/`.

Effects, from the code path and the reproduction:

- With a connection proxy, including a strict one, the browser context has no connection proxy. The pool requests
  none, so that navigation does not use the account's chosen egress.
- With an HTTP relay, including a strict one, the same navigation is attempted without the relay. The later relay
  refusal for WebSocket comes after the browser step.

The reproduction uses closed mocks and stops at `page.goto`. It does not observe packets, and it does not show how a
launched browser engine routes a context that has no proxy option.

Save the script as `repro.mjs` outside the checkout. Run it from the repository root with root dependencies installed,
using `node /path/to/repro.mjs` under a private `HOME` and `DATA_DIR`.

```js
const load = (file) => import(`${process.cwd()}/open-sse/${file}`);
const muse = await load("executors/muse-spark-web.js");
const transport = await load("utils/proxyFetch.js");
const { resolvePlaywrightProxy } = await load("services/browserPool.js");

globalThis.fetch = async () => { throw new Error("closed mock: no direct network"); };
const proxy = "http://proxy-a.invalid:8001";
const relay = "https://relay.invalid/";
const dispatcher = {};
transport.__setProxyDispatcherForTesting(proxy, dispatcher);

for (const [label, proxyOptions] of [
  ["strict proxy", { connectionProxyEnabled: true, connectionProxyUrl: proxy, strictProxy: true, disableEnvProxy: true }],
  ["strict relay", { vercelRelayUrl: relay, strictProxy: true, disableEnvProxy: true }],
]) {
  transport.__setOriginalFetchForTesting(async (url, init) => {
    console.log(`${label}: bootstrap fetch via ${init.dispatcher === dispatcher ? "connection proxy" : String(url)}`);
    return Response.json({});
  });
  muse.__setMuseSparkBrowserPoolForTesting({
    acquire: async (_key, options) => {
      console.log(`${label}: browser acquire options = ${Object.keys(options).join(",")}`);
      console.log(`${label}: browser context proxy = ${resolvePlaywrightProxy(options.proxyUrl)}`);
      return { context: { addCookies: async (c) => console.log(`${label}: cookie ${c[0].name} placed in that context`) } };
    },
    // Stop here: page.goto is where the real browser would send the cookie.
    openPage: async () => ({
      route: async () => {}, routeWebSocket: async () => {}, close: async () => {},
      goto: async (url) => console.log(`${label}: page.goto ${url}`), url: () => "https://www.meta.ai/", content: async () => "",
    }),
    release: async () => {},
  });
  const { response } = await new muse.MuseSparkWebExecutor().execute({
    model: "muse-spark", stream: false, proxyOptions, body: { messages: [{ role: "user", content: "hi" }] },
    credentials: { connectionId: label, apiKey: "ecto_1_sess=synthetic", providerSpecificData: { enableSessionDispatch: true } },
  });
  console.log(`${label}: executor status ${response.status}`);
}
```

Observed on the base commit with Node 24.22.3 (module-type warning omitted). The final 401 is expected, because the fake
page holds no token.

```text
strict proxy: bootstrap fetch via connection proxy
strict proxy: browser acquire options = cookieDomain,blockServiceWorkers,warmupUrl,userAgent
strict proxy: browser context proxy = undefined
strict proxy: cookie ecto_1_sess placed in that context
strict proxy: page.goto https://www.meta.ai/
strict proxy: executor status 401
strict relay: bootstrap fetch via https://relay.invalid/
strict relay: browser acquire options = cookieDomain,blockServiceWorkers,warmupUrl,userAgent
strict relay: browser context proxy = undefined
strict relay: cookie ecto_1_sess placed in that context
strict relay: page.goto https://www.meta.ai/
strict relay: executor status 401
```

The suite asserts no part of this behaviour as correct. Its browser fake records only the pool key and the cookie.

### Minimum repair, for one later single-owner unit

1. In `fresh-access-token.js`, resolve the browser route for `https://www.meta.ai/` before any send that carries the
   cookie. `resolveConnectProxyForRequest` in `open-sse/utils/proxyFetch.js` is the existing helper. Pass its
   `proxyUrl` to `acquire`.
2. Fail closed when the route cannot be honoured. The helper returns direct for a non-strict relay, and the WebSocket
   path rejects every relay, so refuse a relay before the bootstrap. `resolvePlaywrightProxy` returns no proxy for an
   unparseable URL, so that case must also refuse when a proxy was selected.
3. Include the resolved route in the browser pool key and the token cache key, so a proxy change cannot reuse either.
4. Verify that each engine the pool can choose applies a context proxy. This unit did not check that.
5. Add tests for proxy, strict-proxy and relay routes to `muse-spark-web-browser-dispatch.test.js`, and update
   `docs/providers/muse-spark-web.mdx`.

No registry, extension or import-route change is needed for this repair.

## Upstream reading

These are source observations from read-only caches. None is evidence of live behaviour.

- OmniRoute (`cheaper-inference/OmniRoute`, MIT) at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`:
  - `open-sse/executors/muse-spark-web/fresh-access-token.ts` also passes no proxy to its browser acquire call, and
    its bootstrap uses plain `fetch`.
  - `src/shared/providers/webSessionCredentials.ts` describes `ecto_1_sess` plus an `ecto1:` WebSocket token and
    lists `abra_sess` among its storage keys.
  - `open-sse/executors/muse-spark-web.ts` reads a supplied token, then prefers a freshly fetched one. DurinDoor
    requires only `ecto_1_sess`; the header-paste test shows that an appended `ecto1:` fragment is dropped.
- CLIProxyAPI at `dbe641f286a489ecb39e3c041c554371e6add864` and EasyCLIProxyAPI at
  `29567ead8164a00724dfdc2087f02a23895636ee`: a text search of each cached worktree for `ecto_1_sess`,
  `muse-spark-web`, `muse_spark_web` and `meta.ai/api/graphql` found no match.

## Evidence command

Run from the repository root with root and `tests/` dependencies installed, under a private `HOME`, `DATA_DIR` and
`TMPDIR` with no credentials in the environment.

```bash
node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js \
  tests/unit/cookie-flow-muse-spark-web-2034.test.js \
  tests/unit/muse-spark-web-browser-dispatch.test.js \
  tests/unit/muse-spark-web-guarded-dispatch.test.js \
  tests/unit/provider-cookie-import-contracts.test.js \
  tests/unit/provider-cookie-capture-extension.test.js \
  tests/unit/api/provider-cookie-import.test.js \
  tests/unit/provider-cookie-import-dashboard.test.js \
  tests/unit/provider-cookie-lifecycle-muse-yuanbao-hugging.test.js \
  --maxWorkers=2
```

The full suite, build and e2e checks were not run for this unit.
