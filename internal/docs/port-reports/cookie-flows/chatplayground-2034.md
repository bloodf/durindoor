# ChatPlayground cookie flow (#2034)

## Verdict: NOT PARITY

With a closed mock, capture, dashboard import, encrypted storage and executor dispatch work with the real `chatplayground` descriptor. Three product defects remain (below), and **live sign-in is not established**. Registry metadata, source comparison and mocks cannot show that ChatPlayground or Clerk accepts any of these requests.

ChatPlayground is an active provider, not guarded or staged: it is not hidden and `chatplayground` and `cpl` resolve to `ChatPlaygroundExecutor`. No product code changed in this unit.

## Evidence command

From `tests/`, with dependencies installed:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-chatplayground-2034.test.js --maxWorkers=2
```

Result on base `4819aba30dd`: 38 of 38 passed. The run used `env -i` with a private HOME, DATA_DIR, TMPDIR and cache under `/var/tmp`, Node 24.22.3 and a 290 second limit. No browser ran.

## What is real and what is mocked

| Real | Mocked |
| --- | --- |
| Registry descriptor and import profile | Operator authority (`canAccessManagementApi`, `isOperatorRequest`, `canManageAccessConfig`, exact-origin check) |
| Extension `parsePairing`, `prepareCapture`, `runCapture` and compiled table | `chrome.*`: tabs, permissions, cookie stores and a domain-scoped cookie jar |
| Dashboard parsers and candidate selection | Every outbound byte: `proxyAwareFetch`, with global `fetch` closed (the validate case sends it to the same mock) |
| Pairing, import, provider list/read/update, discovery, test, validate and `/v1/models` routes; chat handler | Proxy reachability ping (`testProxyUrl`) |
| Private SQLite database, credential encryption, proxy pools, account selection and fallback | Machine id |
| `ChatPlaygroundExecutor` and its request sender | All cookies, JWTs, minted tokens, accounts and proxy hosts |

The mocked upstream follows DurinDoor's own executor contract: Clerk mints from `__client` and the `sid` inside `__session`, and `/api/me` and `/api/chat` take the minted Bearer token. It is a model, not observed provider behaviour.

The extension's `fetch` is bridged to the real import route. The dashboard cases use the real parsers, then post the chosen candidate with the same fields as `CookieImportModal`; the dialog itself is not rendered here.

## Coverage added

Existing suites check this provider's static profile and extension table (`provider-cookie-import-contracts`), executor wire shapes, streaming, limits and redirects (`chatplayground-provider`, `port-omni-20375-chatplayground-unified-api`, `web-session-redirects`) and gateway routes with a manually saved cookie (`provider-registration-apikey-batch-b-routes`). Import handler tests replace the registry with synthetic providers. The extension suite's per-provider loop does capture ChatPlayground, but from a hand-built pairing into a fake `fetch`, and checks only the success result and exact-name reads. The new suite connects capture to a real pairing, the import route, storage and dispatch.

| Owner requirement | Proved here (mock boundary) |
| --- | --- |
| Names and origin | `__client` and `__session`, both required, from `https://web.chatplayground.ai` only. No chunks, optional cookies or localStorage. |
| Bounded capture | Two exact-name reads in the tab's cookie store; no `getAll`, no script injection; asks for `cookies` and two origins, then returns them; one POST. An edited pairing cannot widen it. |
| Wrong origin | Clerk, legacy `app.`, plain HTTP and look-alike tabs are refused before any read. Clerk and `app.` origins are refused by the API; a Clerk-host cookie domain is refused. |
| Expiry | A past `expirationDate` is refused by the real import route, on create and on update, and the pairing is spent. A session refused by the mint at use time is covered under fallback. |
| Dashboard modes | Cookie header, cURL `-H`, cURL `-b` and HAR store only the two cookies. Two accounts in one HAR need an operator choice. Cookies are never merged across HAR requests. |
| Authentication | No operator authority means no pairing. An operator CLI token without a pairing secret cannot import. |
| Update ownership | Another provider's connection cannot be paired; a pairing for one connection cannot update a sibling. |
| Storage and redaction | Cookie connection, exact header, no plaintext in the raw rows. The asserted import, update, list, read, discovery, chat, test, validate and `/v1/models` response bodies and captured console output carry no synthetic secret. |
| Consumption | Mint (`__client` only), `/me`, `/models` and `/chat` all use the preferred account and its strict proxy. Dashboard discovery sends that account's header through the same proxy. |
| Isolation and recovery | A refused mint falls back to the sibling with the sibling's cookie and proxy. Re-capture changes only the failed row, keeps its priority and proxy pool, and the next chat uses the new session. |

## Unsupported input, refused safely

- **Chunks.** The profile has no chunk prefix. The extension never reads `__session.0` or `__client.0`; dashboard parsers drop them and report the missing base name; the API rejects them.
- **localStorage.** None is accepted. The API answers 400 to any value, and a pairing cannot add a key.
- **Other cookies.** `__client_uat`, suffixed `__session_*` names and `cf_clearance` are never captured. Dashboard parsers drop them; the API rejects them.
- **Bare Clerk JWT.** The executor accepts one on a manually added connection, but cookie import refuses it. A `__session` cookie alone is refused too.
- **Expiry on dashboard input.** The parsers read only cookie names and values, so a pasted header, cURL or HAR cannot show that a session has expired. It fails at use time.
- **Origin of a pasted header.** A header names no origin and is imported as the web origin.
- **Partial capture.** If only one required cookie is readable, the extension still sends it. The server rejects it, stores nothing and spends the pairing.

## Product defects

Findings 1 and 3 are not accepted behaviour. The suite does not require or approve either one. To reproduce, add the quoted assertion temporarily; each failed on `4819aba30dd` and was removed again.

### 1. The stored Cookie header is sent as a Bearer token

The descriptor declares `modelsFetcher.type: "openai"` (`open-sse/providers/registry/chatplayground.js:45`). Both generic live-catalog paths then treat the stored credential as an API key:

- every chat: `warmRequestModelLimits` (`src/sse/handlers/chat/singleModel/providerHooks.js:128`);
- `/v1/models`: `openAIStyleLiveResolver` (`src/shared/models/modelListCore.js:685`).

`resolveLiveOpenAIModels` (`open-sse/services/liveModelLimits.js:79` and `:106`) sends `Authorization: Bearer __client=…; __session=…` to `https://web.chatplayground.ai/api/models`. That puts the long-lived `__client` value in a malformed header. The executor sends no credential on that route (`open-sse/executors/chatplayground.js:133`). The result is cached for five minutes per credential.

Observed containment, asserted by the suite: exact web origin, `GET`, no redirect following, one account per request and that account's proxy. These assertions do not need the request to exist.

Reproduction, after a 100 ms wait in the chat case or the `/v1/models` case:

```js
expect(sent.filter(isCatalogLookup).map((call) => `${call.url} ${call.headers.get("authorization").slice(0, 38)}`)).toEqual([]);
```

Both cases received `https://web.chatplayground.ai/api/models Bearer __client=synthetic-client-bravo`.

Minimum repair: keep session-cookie providers out of both generic Bearer resolvers (at the two call sites, or by changing this descriptor's `modelsFetcher.type`). ChatPlayground has no static models, so the repair must check the model picker and `/v1/models` listing; this unit tested neither effect.

### 2. Connection test and key validation skip the Clerk mint

Both routes use the generic registry probe: one `GET /api/me` with the raw `Cookie` header and no mint. The executor mints first and calls the same route with a Bearer token. `validateChatPlaygroundCookie` does that too, but no route calls it.

Under the executor's contract, a credential that has just chatted successfully tests as `valid: false`, and the connection is saved with `testStatus: "error"`. This fails closed: no false success and no secret in the response. Whether the live `/api/me` also accepts a raw Cookie is unknown. If it does, the probe still would not show that chat can mint a token.

Reproduction: the case `fails closed when connection test and validate skip the executor's Clerk mint` asserts the current result. Changing its test-route expectation to `{ valid: true }` fails with `valid: false`. Its control calls `validateChatPlaygroundCookie` with the same credential and mock, and gets `valid: true`.

Minimum repair: route both probes for `chatplayground` through `validateChatPlaygroundCookie`, passing the proxy-bound fetcher, then update that case. Existing probe expectations in `chatplayground-provider` and `provider-registration-apikey-batch-b` assume the raw-Cookie probe and would need the same change.

### 3. Dashboard model discovery does not refuse redirects

The `chatplayground` entry in `modelsConfig.js` (line 501) sends `Cookie` but sets no `redirect` mode, and `fetchConnectionModels.js:340` copies one only when set. The existing redirect test covers `discoverChatPlaygroundModels`, which no production code under `src` or `open-sse` calls.

Reproduction, after the discovery request in the chat case:

```js
expect(executorCalls()[0].redirect).toBe("manual");
```

It received `undefined`. This shows the request option only. No redirect was followed here, and what each proxy transport forwards on a redirect was not tested.

Minimum repair: add `redirect: "manual"` to that entry, report a 3xx as a rejected session, and cover the dashboard route.

Findings 1 to 3 need one later single-owner repair unit; they share the descriptor and its credential consumers.

## Source comparison

Read-only comparison with [OmniRoute](https://github.com/cheaper-inference/OmniRoute) (MIT) at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. No code was ported into this unit.

- `docs/providers/CHATPLAYGROUND.md` (last changed in `bd73f3e169f9cce728e70a9cda893801a7b03289`) states that `__client` and `__session` can both be read from `web.chatplayground.ai`, which matches DurinDoor's single-origin profile. It is that project's statement, not evidence gathered here.
- The same document says API requests need a minted Bearer JWT, and separately calls its `/api/models` catalog unauthenticated. `open-sse/services/chatplaygroundAuth.ts` (same commit) mints from `__client` and the `sid` in `__session`.
- At that revision the upstream chat executor and catalog still use `app.chatplayground.ai` with per-endpoint chat routes. This revision therefore does **not** corroborate DurinDoor's unified `web.chatplayground.ai/api` routes, which cite OmniRoute #20375.

## Still unproved

- Live sign-in, minting, catalog, chat, session lifetime or any provider response.
- Where the live site scopes `__client`. If it is visible only to `clerk.chatplayground.ai`, extension capture and web-origin cURL/HAR import cannot obtain it. The suite shows that this case stores nothing, not that it does or does not happen. A repair unit should not widen origins without live evidence.
- The extension in a real browser, real permission prompts and the rendered import dialog.
- Real proxy transport. The suite asserts the proxy options handed to `proxyAwareFetch`.
- Redaction in logs or fields other than those listed above, including persisted request-detail records.
