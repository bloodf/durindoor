# Z.ai Web (`zai-web`) cookie flow, #2034

**Historical reproduction below; see “Executor repair after acaef33ca45” for the current private change and pending validation.**

## Verdict: NOT PARITY

DurinDoor's own capture, import, storage and consumption path for a `token` cookie works against mocked boundaries. It does not match the provider contract in the pinned upstream source in two places:

1. **Where the session lives.** Upstream extracts the Local Storage item `token`. DurinDoor's extension reads only a cookie named `token`.
2. **What a completion needs.** Upstream uses the direct signed API only when it has a CAPTCHA proof, and otherwise drives a browser. DurinDoor calls the signed API with no proof and has no browser transport.

Nothing here contacted chat.z.ai. Live sign-in, whether the site sets a `token` cookie, and whether it accepts DurinDoor's completion are all **unverified**. Do not read the passing tests as evidence of any of them.

Base: `4819aba30dd2c3789f54bd3127ec0bcf1bfc2f6c`. `zai-web` is registered and dispatchable on that base, not guarded or staged. This unit adds one test file and this report; product code is unchanged.

## Upstream sources read

Project: OmniRoute (`cheaper-inference/OmniRoute`), MIT, Copyright (c) 2026 Cheaper Inference, created by Diego Souza. DurinDoor's registry header names commit `4265bb2ad5477450a07d3a43ea33a62c6c874878` as its port source. The read-only cache has `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` (`release/v3.8.55`) checked out. For the files below, `git rev-parse <commit>:<path>` returns the same blob at both commits, so these statements hold at the port pin.

| File | Blob (both commits) | What it says |
| --- | --- | --- |
| `open-sse/services/tokenExtractionConfig.ts` | `d91c9cdb413b8fbc16c06d5bf506173c303235e7` | The only `zai-web` source is `{ type: "localStorage", key: "token" }`. |
| `open-sse/executors/zai-web.ts` | `236943166d94eb43c6e14c863272659ccc4d69a6` | The header says the frontend keeps a Bearer JWT in Local Storage and requires a browser-issued CAPTCHA proof. `useSignedApi` is `Boolean(captchaVerifyParam) && imageUrls.length === 0`; every other request goes through the browser transport. |
| `open-sse/executors/zai-web/protocol.ts` | `511e5d3aa9937ef537712b8163ad6b997878a9f7` | The signed completion body carries `captcha_verify_param`. The proof is read from the request body, `providerSpecificData` or the credential. `token=` input is described as legacy. |

`open-sse/executors/zai-web/browserAutomation.ts` (`2077eeb3acf797ec93a2414cd811ce408c6648db`, also identical) holds the browser page setup that the executor's browser transport uses. Only its blob identity was checked.

At `b15b2ee6` only, `src/shared/providers/webSessionCredentials.ts` also tells the operator to copy the Local Storage value and not a Cookie header. That file differs at the port pin, and its pinned content was not read.

These are statements about upstream's code, not observations of the live site.

## Contract on the real registry entry

| Item | Value |
| --- | --- |
| Origin | `https://chat.z.ai` |
| Required cookie | `token` |
| Chunk prefixes, optional cookies, hashed families | none |
| Local Storage keys | none |
| Extension capture, dashboard import | both enabled |
| Stored credential | `apiKey = token=<value>`, `authType: cookie`, encrypted at rest |
| Executor use | the value is sent as `Authorization: Bearer`, and in the completion URL's `token` query parameter; no `Cookie` header |

## Coverage gap this closes

Existing suites already assert the descriptor, parser filtering and header composition for `zai-web` from a parameter table (`provider-cookie-import-contracts.test.js`); a connection added by hand through chat, quota and expiry (`zai-web-provider.test.js`); separation from the API-key `zai` provider (`fleet-provider-zai-web-acceptance.test.js`); and redirect refusal (`web-session-redirects.test.js`). The extension and import route suites use other providers or generic fixtures.

None of them connects `zai-web` from extension capture through the import route and SQLite to the executor. `tests/unit/cookie-flow-zai-web-2034.test.js` does.

## Owner requirement: proved and not proved

Real in the new suite: registry entry, extension `capture.js`, dashboard import parsers, pairing and import routes, SQLite repository with credential encryption, account selection, proxy pool resolution, chat handler and executor. Mocked: the three management guard functions, the `chrome` namespace and `proxyAwareFetch`. The global fetch is replaced with a refusal before any import. Mocked chat.z.ai replies are invented fixtures.

| Requirement | Result |
| --- | --- |
| Capture is bounded | One `cookies.get` for `token` in the active tab's cookie store; no enumeration or script injection. Permissions cover `cookies` and two origins, and are returned. One POST. |
| Unexpected origin refused | Extension: wrong tab, edited pairing origin, cookie from another host, insecure or empty cookie. Server: other body origin, `api.z.ai` cookie domain. Parsers: cURL or HAR for another host, a lookalike host or plain HTTP. |
| Expired cookie refused | An `expirationDate` in the past is rejected, from the extension too; the saved account is unchanged. See the limits below. |
| Cookie header, cURL, HAR import | Supported. Only `token` survives. Two different sessions in one HAR require a choice. |
| Chunks, extra cookies, Local Storage payload | Refused with a fixed reason; nothing written; the pairing is spent. |
| Bare Local Storage value | The import dialog parser refuses it. **Add Connection** accepts it and the executor consumes it. |
| Authenticated create and update | Pairing refused if any guard check fails or over non-loopback HTTP. A forged secret and an oversized body are refused. |
| Update ownership | An update pairing cannot write another connection and is spent by the attempt. A native `zai` row cannot be targeted. A duplicate create name returns 409. |
| Account and proxy isolation | Pinned requests use that account's token and proxy for both upstream calls. Fallback keeps each token on its own proxy. A pinned rejection does not rotate. |
| Re-import | An extension update replaces only the target's token, keeps its proxy binding and clears the recorded 401 state. |
| No secret in responses, logs or database | Console output and every SQLite table are scanned for synthetic tokens and pairing secrets, with positive controls on the happy path and the transport-error path. The list route and import replies are checked. |
| Non-SSE 200 reply | The gateway returns 502, or for a stream an in-band error with no stop chunk, and marks the account unavailable. |
| Live sign-in, real cookie or storage layout, live chat | **Not proved.** |
| Real Chrome, real proxy transport, rendered import dialog, in-page web login | **Not exercised.** The test posts the same body shape the dialog sends. |

## Gap 1: capture reads a cookie, upstream reads Local Storage

Reproduction (offline): test `NOT PARITY: a session held only in Local Storage is not captured…`. With an empty cookie jar and a page whose Local Storage has `token`, `runCapture` returns `no_cookies`. It requests no `scripting` permission, runs no script and sends nothing. A pairing edited to add `localStorageKeys: ["token"]` is narrowed back by the extension's compiled table.

Current behaviour is a safe refusal. If the live site sets no `token` cookie, extension capture and the documented Cookie, cURL and HAR routes cannot yield a session, leaving only **Add Connection** with a pasted value. Whether it sets one is unverified.

## Gap 2: no CAPTCHA proof and no browser transport

Reproduction (offline): test `NOT PARITY: sends no CAPTCHA proof even when one is supplied…`. A proof is placed both in `providerSpecificData.captcha_verify_param` and in the chat request body. The completion that `open-sse/executors/zai-web.js` sends has neither, in body or query. When the mocked stream returns an error frame, the gateway reports a failure.

By the upstream source, a completion without a proof is not a supported path. The live refusal, if any, was not observed, and the test's error frame is invented. `docs/providers/zai-web.mdx` says the flow may require CAPTCHA proof, but DurinDoor has no way to supply one.

## Minimum repair path (one later single-owner unit)

Dispatch:

1. In `open-sse/executors/zai-web.js`, resolve a proof as upstream does and send `captcha_verify_param`. Without one, return a clear local error before creating the chat. This is the smallest safe change, but it does not by itself make a stored account usable: upstream calls the proof short-lived.
2. Usable stored accounts need upstream's browser transport (`zai-web.ts` and `zai-web/browserAutomation.ts`) or another verified way to get a proof per request. It must keep each account's proxy binding, and it needs MIT attribution.

Capture, after an authorized live check of where the session lives:

1. Give the registry entry a `cookieImport` profile with `localStorageKeys: ["token"]` and no cookie names, and make the matching change to the `zai-web` entry in `extensions/provider-cookie-capture/providers.js`.
2. Make the value reach the executor. That profile alone is not enough: the import stores Local Storage values in `providerSpecificData`, while the executor reads `apiKey` or `accessToken`. Create would also fail with `Cookie value is required`, because `createProvider` wants an `apiKey` for a `cookie` provider, and update would set `apiKey` to null.
3. Keep existing `token=<value>` rows working, and update the contract assertions and the user docs.

## Other limits found

- **Import does not check the token.** Any printable `token` value is stored; no JWT shape, `id` claim or `exp` check runs. A value without an `id` claim is refused at dispatch with 401 and no outbound request (tested). The executor does not read `exp`.
- **Expiry is conditional.** It is enforced only when the submitted cookie has `expirationDate`. The Cookie header and cURL parsers produce none, and the HAR parser drops HAR's `expires` field, so a stale paste is stored. From code reading; only the `expirationDate` path is tested.
- **A Cookie header names no origin.** It is imported as `https://chat.z.ai`.
- **Parent domain.** `cookieDomainAllowed` accepts a submitted `.z.ai` domain, following cookie domain rules. From code reading.
- **Token in the URL.** The completion URL carries the token as a query parameter, as upstream's does. The suite shows a transport error quoting that URL does not leak it into the reply, console or database. What a configured relay or proxy records was not examined.
- **Direct executor use.** `ZaiWebExecutor` returns HTTP 200 with empty content for a 200 reply that has no SSE frames. The gateway turns that into a failure (table above), so `/v1` clients do not see a false success. The dispatch repair should also fail inside the executor. Reproduction, from the repository root with dependencies installed, saved outside the tree and run as `node <file>`:

  ```js
  globalThis.fetch = async (url) => String(url).endsWith("/api/v1/chats/new")
    ? Response.json({ id: "synthetic-chat" })
    : Response.json({ detail: "synthetic refusal" });
  const { ZaiWebExecutor } = await import(`${process.cwd()}/open-sse/executors/zai-web.js`);
  const token = `h.${Buffer.from(JSON.stringify({ id: "synthetic-user" })).toString("base64url")}.s`;
  const { response } = await new ZaiWebExecutor().execute({
    model: "glm-5.3", stream: false, credentials: { apiKey: `token=${token}` },
    body: { model: "glm-5.3", messages: [{ role: "user", content: "synthetic" }] },
  });
  console.log(response.status, await response.text()); // 200, "content":""
  process.exit(0);
  ```

- **Docs wording.** `docs/providers/zai-web.mdx` lists a bare Local Storage value next to the cookie formats. Only **Add Connection** accepts it, not **Import cookies**.

## Evidence

Node 24.22.3 and pnpm 12.18.0, with root and `tests/` dependencies installed using `--frozen-lockfile` into a private store. Each command ran under `env -i` with only `PATH`, `LANG`, `CI`, private `HOME`, `DATA_DIR`, `TMPDIR` and cache paths. No browser run.

```bash
cd tests
node node_modules/vitest/vitest.mjs run unit/cookie-flow-zai-web-2034.test.js --maxWorkers=2
node node_modules/vitest/vitest.mjs run unit/cookie-flow-zai-web-2034.test.js unit/zai-web-provider.test.js \
  unit/provider-cookie-import-contracts.test.js unit/provider-cookie-capture-extension.test.js \
  unit/provider-cookie-import-validation-review.test.js --maxWorkers=2
cd .. && node node_modules/eslint/bin/eslint.js tests/unit/cookie-flow-zai-web-2034.test.js
```

The full `test:ci` inventory and the build were not run by this unit.

The suite uses no `it.fails`, `skip` or `todo`. The two `NOT PARITY` tests assert today's safe behaviour. A repair that closes either gap should change them on purpose.

## Executor repair after acaef33ca45 — private #2034 follow-up

The preceding sections record the original reproduction, not the repaired
executor's current behavior. This follow-up changes only the executor, narrow
helpers, a new regression file and this private report/handoff. Public capture,
registry, import activation and existing suites are unchanged. Verdict remains
**NOT FULL PARITY**; no live origin or token-location claim is made.

### Source reproduction and attribution

Re-read `acaef33ca45:internal/docs/port-reports/cookie-flows/zai-web-2034.md` and
the current executor. The old executor ignores both request and stored proofs
and accepts a non-SSE 200 as an empty completion; this is reproducible directly
from its `readCompletion` and payload construction. The existing executable
reproductions were not rerun here because test dependencies are absent.

Only existing pins before the freeze (2026-11-27T23:49:25.752045Z) were read.
Read-only Git commands used `GIT_NO_LAZY_FETCH=1 GIT_OPTIONAL_LOCKS=0` in
`/tmp/omni-2034` for `4265bb2ad5477450a07d3a43ea33a62c6c874878` and
`/tmp/omniroute-2034-d3f06` for
`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. The four source blobs in the original
table were rechecked and are identical at those pins. Protocol and executor
contents were read at the port pin, including `buildZaiBrowserChatOptions`,
`useSignedApi` and proof extraction. No source fetch or later pin was used.

Proof extraction in `open-sse/executors/zai-web/session.js` is adapted from
OmniRoute `open-sse/executors/zai-web/protocol.ts`, blob
`511e5d3aa9937ef537712b8163ad6b997878a9f7`, MIT, Copyright (c) 2026 Cheaper
Inference, created by Diego Souza. Source terminal envelope shapes were checked
against `open-sse/executors/zai-web/stream.ts` at the same port pin.

### Current private contract

- Canonical explicit Local Storage credential: `credentials.providerSpecificData.token`.
  This matches the shared import handler's existing named-item storage rule;
  it is consumed by exported `resolveZaiWebSession(credentials, extractZaiWebToken)`.
  Legacy `apiKey` / `accessToken` accept manual `token=<value>` and bare/Bearer
  values; source JSON credential wrappers are accepted too. An explicitly
  malformed storage value or differing credential values refuses dispatch.
  No global credential, page, proof or account cache is introduced.
- Source proof precedence is body, credential `providerSpecificData`, `apiKey`,
  then `accessToken`. The three source aliases and credential JSON/cookie
  envelope forms are preserved. The opaque string goes unchanged after source
  whitespace trimming into completion JSON `captcha_verify_param`, never into
  an invented query/header or a solver. Audit body copies redact its aliases.
- A missing/blank proof or image request produces local HTTP 400
  `zai_proof_required` before **either** POST. Normal text/proof dispatch sends
  setup and one completion to fixed `https://chat.z.ai`, with the selected
  account's token and the exact selected proxy options on both requests.
  Redirects are manual and rejected; a Location is never followed.
- Non-SSE, HTML, malformed JSON data frames, explicit errors, nonzero codes,
  incomplete streams and contentless terminals produce a local failure rather
  than an empty success. Valid source `done` / `finish` / completion-finish,
  OpenAI finish reasons and `[DONE]` terminals are recognized. The executor
  still buffers before constructing its OpenAI response/stream, so an upstream
  failure cannot emit a success stop or usage frame first.
- Failures after setup carry the existing internal `claudeRequestScoped` flag.
  Despite its historical name, `chatCore`, single-model `postProcess`, combo
  and transient-retry code use it as a request terminal. This avoids account,
  model, credential-refresh or uncertain-work replay without shared changes.
  No new retry loop is added. Caller cancellation settles dispatch and throws.
- Body reads have local 120-second and 16-MiB bounds, cancel their reader on
  failure, and honor caller cancellation. These are local safety bounds,
  **not** a provider proof TTL. Error messages never include provider response
  text or thrown transport messages, which can contain token URLs or proofs.

### Precise limits and shared-owner handoff

The source proof is opaque. It defines no expiry timestamp, challenge identifier,
account-binding verifier or refresh API. Therefore this unit cannot locally
prove that any supplied string is valid, unexpired or issued for this challenge
and account. It passes the selected request's proof once and treats provider
expiry/challenge rejection as terminal. Synthetic proofs prove forwarding and
isolation only. No local TTL, guessed verifier or proof bypass is implemented.

The pinned no-proof branch drives a normal headed browser using `browserBackedChat`,
a token-keyed pool, Local Storage on the fixed origin, page controls and
`reuseContext: true`. DurinDoor has no corresponding browser-backed chat service
or Z.ai browser pool that can preserve selected account session **and** selected
proxy binding. The upstream options read here do not establish proxy binding.
Porting only DOM automation would not establish that property. Browser parity is
therefore unsupported and guarded by the actionable local refusal. No browser,
page script, origin permission, third-party solver or paid service was added or run.

`zai-web-2034-handoff.json` is the pure JSON private handoff with exact proposed
registry/import profile, payload and stored field names, helper exports and
remaining activation work. The shared cookie batch owner must implement and
verify capture/create/update activation; changing the profile alone still does
not fix create validation. Existing manual cookie credentials remain consumable
with a caller-supplied proof. Public capture still cannot read Local Storage.
No live sign-in, site token location, actual proof validity or completion was
verified. This unit does not advertise a usable browser branch or full parity.

### Immutable assertion conflicts requiring stricter owner migration

No existing Z.ai Web or cookie-flow test was edited. In particular the protected
`tests/unit/cookie-flow-zai-web-2034.test.js:669` reproduction currently asserts
at lines 683–684 that the completion has **no** `captcha_verify_param` and contains
neither supplied proof. The stricter replacement must assert the selected
request proof is present in the body, absent from URL/audit output, and provider
rejection remains terminal. Its line 681 expects provider-controlled refusal
text, now deliberately replaced by a fixed redacted failure message.

The same protected file's line 428 (and analogous proofless happy-path cases),
`zai-web-provider.test.js` proofless chat successes, and other cookie integration
fixtures require owner migration to an explicit synthetic proof or an assertion
of pre-dispatch `zai_proof_required`. Do not weaken the proof gate to retain those
unsafe successes. The Local Storage capture refusal at lines 386–399 remains
correct until the shared owner activates capture. None of these conflicts is
hidden in a baseline, skip, todo or expected-failure row.

### Validation status

Node v24.22.3. Essential checks ran under `env -i` with explicit PATH, LANG and CI,
private unique `/var/tmp/zai-2034-check-*` HOME, DATA_DIR, TMPDIR, caches/store,
no inherited credentials and a 300-second command ceiling. No install, borrowed
dependency mutation or live provider request occurred.

- PASS: dependency-free assertions for session conflict refusal, canonical
  storage consumption, proof precedence/redaction, body reading, cancellation
  and local read deadline.
- PASS: Node syntax checks for the executor, both helpers and the new regression
  file; `git diff --check`.
- NOT RUN: new real-executor/actual-transport-boundary and OpenAI/Anthropic
  client-format regressions in `tests/unit/zai-web-source-contract-2034.test.js`.
  Focused Vitest collection failed before execution with `MODULE_NOT_FOUND`
  for `tests/node_modules/vitest/vitest.mjs`. The native gate must provide its
  isolated dependency setup and run this file with `--maxWorkers=2`, then
  reconcile immutable owner-test conflicts above. Tests are authored evidence,
  not a passing result.
- NOT RUN: lint, full inventory, build or independent review. CodeGraph status
  reports `CodeGraph 1.6.2 required`; bounded source reads were used instead.

The new regressions cover opaque proof precedence, separate account/proxy/route
bindings, credential conflicts, unsupported browser refusal, malformed/HTML/
nonstream/nonzero and synthetic expiry/challenge failures, valid stream,
redirect refusal, redaction, cancellation/deadline and one completion send per
turn. The real handler matrix covers buffered/streamed OpenAI and Anthropic
failure terminals, no success usage and no credential refresh. They still need
execution before any readiness claim.
