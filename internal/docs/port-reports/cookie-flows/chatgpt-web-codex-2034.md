# ChatGPT Web Codex cookie capture and import (#2034)

**Verdict: NOT PARITY.** Capture and import match the provider's declared contract offline. Using the imported credential does not: with the settings an import creates, five of the seven lanes answer HTTP 400 to a plain text request.

No product code changed. Nothing here was run against chatgpt.com or in a browser, so live sign-in is unproved.

## Contract under test

Source: `open-sse/providers/registry/chatgpt-web-codex.js`, the real registry entry. The provider is active: it is registered, has its own executor and has no dispatch opt-in.

| Item | Value |
| --- | --- |
| Origin | `https://chatgpt.com` |
| Required cookie | `__Secure-next-auth.session-token`, or contiguous `.0`, `.1`, ... chunks |
| Optional cookies, hashed families, localStorage, account email | None |
| Connection | `authType: cookie`; the Cookie header is stored as `apiKey`; no `transport` is set |

### Upstream record

OmniRoute (`cheaper-inference/OmniRoute`, MIT, Copyright (c) 2026 Cheaper Inference, created by Diego Souza), commit `4265bb2ad5477450a07d3a43ea33a62c6c874878`, read from the local source cache without fetching:

- `open-sse/config/providers/registry/chatgpt-web-codex/index.ts` lists the same seven lane ids and declares `authType: "apikey"`, `authHeader: "cookie"` and `format: "openai-responses"`. DurinDoor declares a `cookie` connection and `openai` format.
- `open-sse/executors/chatgpt-web-codex/storageState.ts` recognises the same session cookie family, `__Secure-next-auth.session-token` with an optional numeric suffix.

These show where the names came from. They do not show what chatgpt.com accepts today. This change ports no product logic.

## What the new test proves

File: `tests/unit/cookie-flow-chatgpt-web-codex-2034.test.js`.

| Requirement | Offline evidence |
| --- | --- |
| Names and origin | The real pairing handler returns exactly the contract above, and the real extension module accepts that response unchanged. |
| Chunked capture | Exact-name reads of the base name and `.0` to `.2`, only for `https://chatgpt.com/` in the tab's cookie store. No enumeration or script injection. A second store's account is never read. The stale unchunked cookie and unrelated cookies are not stored. Granted permissions are removed. |
| Authenticated, one-use | Pairing needs operator authority and the dashboard origin. Import needs the pairing secret. A replay is 401. |
| Origin and expiry refusal | `http`, `auth.openai.com`, a subdomain and a lookalike tab read and send nothing, even though `webLogin.allowedHosts` names `auth.openai.com`. Foreign-domain or insecure cookies send nothing. One expired chunk makes the server refuse the whole capture. |
| Dashboard inputs | A Cookie header, cURL with `-H`, cURL with `-b` and a HAR go through the real parsers and routes to the same ordered header. Parsing makes no outbound request. |
| Unsupported or foreign input | Refused with fixed text: bare token in the import dialog, foreign cURL or HAR origins, missing chunk `.0`, wrong body origin or cookie domain, insecure or expired cookie, extra cookie, localStorage value and account email. Two different HAR sessions are reported as ambiguous. |
| Create, update, ownership | The `chatgpt-web` sibling shares the origin and cookie names, yet neither provider can pair an update for the other's connection. A wrong `connectionId` or `provider` spends the pairing and writes nothing. A good update changes only the paired account, keeps its proxy and transport, and clears its lock. |
| Redaction | No synthetic cookie value, access token or pairing secret appears in the asserted outputs: dashboard-input import replies, identity-mismatch replies, the provider list, the extension result, the Test route reply, the 400 and 401 chat replies, the rotation chat reply and captured console output. |
| Consumption, `http` | All seven lanes build a conversation request with the expected model slug, thinking effort and Think hint. Each TLS call carries the chosen account's cookie, bearer token (when sent) and proxy, with same-origin redirects. Switching accounts runs a new session exchange. A rotated cookie updates only the sending account. An expired session is 401 after the session call alone. |
| Consumption, default `auto` | `luna` and `think` reach the browser seam with the imported cookies, proxy and connection id. If no browser can start, `luna` falls back to HTTP with the same cookie and proxy. |
| Stored-connection test | The Test route sends the stored header to `GET /api/auth/session` with manual redirects. This case sets no proxy. |

### Mocked or not proved

- **Mocked:** the operator decision (`canAccessManagementApi`, `isOperatorRequest`, `canManageAccessConfig`; origin checks stay real), `chrome.*`, the extension's `fetch` (delivered to the real import route), global `fetch`, the ChatGPT TLS client, and the browser session and turn. SQLite is a real file in a private temporary directory.
- **Not proved:** live sign-in, session lifetime, Sentinel, Cloudflare, plan or model access, whether each slug or picker position selects the named model, real Chromium extension behaviour, in-page sign-in (`webLogin`), the dashboard dialog's rendering, encryption at rest, and proxy use by the Test route.
- **Import limits:** import keeps only the session cookie, so `cf_clearance` and other cookies are dropped. Whether live requests need them is unknown. cURL and HAR input reaches the server without an expiry, so an old session imported that way is only found by Validate, Test or a request.
- **Covered elsewhere, not repeated:** the 16-cookie capture ceiling (`provider-cookie-capture-extension.test.js`); HTTPS transport, pairing supersession and body limits (`api/provider-cookie-import.test.js`).

## Coverage gap this closes

| Existing suite | What it covers for this provider | What it leaves open |
| --- | --- | --- |
| `provider-cookie-import-contracts.test.js` | Static contract row | No Codex capture or stored credential |
| `provider-registration-web-batch-a.test.js` | Registry, extension table, parsed cURL object, cookie-list composition, validation probe | No pairing, import route, capture run or update |
| `chatgpt-web-codex-provider.test.js` | Lane mapping with the HTTP executor replaced and `transport: "http"` | The real request builder and the default transport |
| `provider-registration-web-batch-a-routes.test.js` | One `think` route with a manually saved, unchunked cookie on `http` | Imported credentials, other lanes, `auto`, accounts, proxies |
| `provider-cookie-lifecycle-chatgpt-grok.test.js` | The `chatgpt-web` sibling | The Codex descriptor and lanes |

## Defect 1: the default transport refuses five lanes (blocks parity)

1. Import stores no `providerSpecificData.transport`, so the value resolves to `auto`.
2. `auto` sends a text request without tools to the browser transport.
3. `ChatGptWebCodexExecutor` maps `instant`, `medium`, `high`, `extra-high` and `pro` to `gpt-5.6-sol-instant`, `-medium`, `-high`, `-xhigh` and `-pro`.
4. `resolveSelection` in `open-sse/utils/chatgptWebExecutorAdapter.js` normalises these to `gpt-5-6-sol-*`. It knows `gpt-5-6-instant`, `gpt-5-6-sol`, `gpt-5-6-thinking` and `gpt-5-6-pro`, but none of the five.
5. It throws before a browser session exists. The error is not `BrowserUnavailableError`, so there is no HTTP fallback, even on a host without a browser.

The reply is 400 with `ChatGPT Web clean-room adapter received an unsupported model: <slug>`. The five `currently refuses the ... lane` cases pin the safe part: no browser session, no TLS or `fetch` call, no secret in the reply or logs, and an unchanged stored credential. They do not accept this as correct behaviour.

The HTTP transport knows these slugs (`open-sse/executors/chatgpt-web/models.js`), and the earlier Codex tests set `transport: "http"` or replace the transport.

**Operator workaround, offline evidence only:** send `PUT /api/providers/{id}` with `{"providerSpecificData":{"transport":"http"}}` under operator authority. A search of the dashboard source found no control for this setting. Requests with tools also use HTTP under `auto`, according to the source; this test does not exercise that.

**Minimum repair, one owner:** teach `resolveSelection` the five `gpt-5-6-sol-*` names. By the adapter's existing effort positions they would be `GPT-5.6 Sol` at 0 (instant), 1 (medium), 2 (high), 3 (xhigh) and 4 (pro). Each lane should keep its fixed position whatever the request's `reasoning_effort` says. Leave `MODEL_LANES` alone, because the HTTP model and effort maps depend on it. In the same change, replace the five refusal cases with one dispatch assertion per lane. The picker positions still need live confirmation. Until then, `docs/providers/chatgpt-web-codex.mdx` overstates support: step 4 offers all seven lanes after a normal import.

## Defect 2: extension capture can truncate a gapped jar (shared code)

`readApprovedCookies` in `extensions/provider-cookie-capture/capture.js` stops at the first missing chunk. With a jar that holds `.0` and `.2` but no `.1`, an offline run of the real extension and import route returned `ok: true` with one cookie and stored only `.0`. The server cannot see the omitted chunk. Dashboard parsing differs: it receives all pasted chunks and refuses a gap.

Reproduction, using this test file's helpers in a temporary case:

```js
const harness = fakeChrome({ "tab-profile": jarOf(
  jarCookie(`${SESSION}.0`, chunk("alpha", 0)),
  jarCookie(`${SESSION}.2`, chunk("alpha", 2)),
) });
const { result } = await captureWith(await mintPairing({ action: "create", name: "gap" }), harness);
// Observed: result.ok === true, result.cookieCount === 1; the stored header is chunk .0 only.
// Names read: the base name, .0 and .1.
```

The new suite does not assert this outcome. How often a real browser holds such a jar is unknown; no browser was run. An update capture from such a jar would replace a stored credential with the truncated one. The same code serves every chunked provider, including `chatgpt-web`.

**Minimum repair:** after the first missing index, keep making exact-name reads within the existing 16-cookie ceiling, and refuse the capture if a later chunk exists. That changes the bounded read list asserted here and needs a shared extension test.

## Evidence

Run from `tests/`, with Node 24.22.3, pnpm 12.18.0, frozen-lockfile installs, a credential-free `env -i` environment and private `/var/tmp` directories:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-chatgpt-web-codex-2034.test.js --maxWorkers=2
```

34 tests passed.

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-chatgpt-web-codex-2034.test.js unit/chatgpt-web-codex-provider.test.js unit/provider-cookie-import-contracts.test.js unit/provider-cookie-capture-extension.test.js unit/provider-registration-web-batch-a.test.js --maxWorkers=2
```

266 tests passed in five files.

The full CI suite, build, browser, Docker and live provider checks were not run.
