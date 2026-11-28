# Poe Web cookie flow (#2034)

Status: **NOT PARITY — verification incomplete**. The focused test is present but has not been executed in this checkout because root, CLI and test dependencies are absent. The native gate must run it with isolated dependencies before treating its assertions as evidence. In particular, the test has not established a chosen proxy route, and the parser cases do not yet carry each parsed candidate through persistence. No live sign-in, real account, browser, or provider network was exercised.

The actual registry entry specifies `https://www.poe.com` and the single required cookie `p-b`; it specifies no chunk prefixes, optional cookies, localStorage keys or web-login profile. The extension is intended to read only that name in the active tab's cookie store. The executor parses the stored header and sends `p-b` to `/api/gql_POST`. These are local implementation contracts, not evidence of the current live Poe protocol or successful sign-in. The provider is active, not staged.

Existing `provider-cookie-import-contracts.test.js` checks the descriptor, `provider-cookie-capture-extension.test.js` exercises generic extension behavior, `api/provider-cookie-import.test.js` uses synthetic registry entries and SQLite, and `poe-web-provider.test.js` tests the executor with directly supplied credentials. The new test joins the real descriptor, pairing, extension selection, import and encrypted repository to the executor using synthetic values and mocked browser/network boundaries. It also covers update selection, rejection of a mismatched target, origin, expired cookie and invented chunk, and parser filtering for Cookie, cURL and HAR. The dashboard Cookie-header format cannot independently establish an origin; cURL and HAR include request origins. Cookie chunks and localStorage are not supported by this descriptor; the test asserts no localStorage read and rejects a fabricated chunk. Pairing authority is mocked, so the test does not prove the guard implementation itself.

The intended evidence command, from `tests/` with isolated, pre-provisioned dependencies and a private environment, is:

```sh
timeout 300s node node_modules/vitest/vitest.mjs run unit/cookie-flow-poe-web-2034.test.js --maxWorkers=2
```

Local result: **not run** (no `node_modules` in root, `cli/`, or `tests/`). No upstream source was consulted for this report; no upstream protocol claim is made. Remaining work: execute and repair the focused test if necessary, verify a chosen proxy through the actual dispatch boundary, and carry each supported parser result through the authenticated import path. These gaps are verification work, not a demonstrated product defect.

## Public-route follow-up

Status: **NOT PARITY: positive flows proved offline, never-replay defects reproduced.** The section above describes the original test and its original execution state. The three original cases are unchanged. A new `describe` block uses `tests/unit/helpers/cookiePublicFlow2034.js` (real SQLite, pairing, import, encrypted storage, registry, account selection, the public `/api/v1/chat/completions` and `/api/v1/messages` handlers, and a distinct strict proxy dispatcher per account). Only operator authority and the external network are replaced. Vendor frames are synthetic Poe GraphQL JSON. These are mocked results, not live Poe evidence.

Proved by the committed test (31 cases, all passing):

- Two imported accounts, each pinned with `x-connection-id`, in OpenAI and Anthropic shapes, buffered and streamed. Each request makes exactly one vendor call to `https://www.poe.com/api/gql_POST` with only the chosen `p-b` cookie, the chosen account's proxy dispatcher, `redirect: "error"` and the expected bot/query variables. The other account's secret is absent from the response, the connection list and captured logs.
- Each supported input format (Cookie header, cURL, HAR) is parsed with the issued pairing's real contract, submitted through the authenticated import endpoint, persisted, read back, bound to a proxy and dispatched through the public route, with mixed modes. The descriptor declares no localStorage or chunk family; both are refused.
- An update changes only the paired connection. A mismatched target (409) and a foreign operator token (403) leave both rows byte-identical. Wrong origin, expired metadata, an invented `p-b.0` chunk and a localStorage-only payload are refused with 400, no write, no vendor call and no secret in the response.
- Pinned HTTP 401 and 429 refusals in all four route modes: one call, no rotation, no success terminal (`[DONE]`, `finish_reason: stop`, `message_stop`, `end_turn`), no fixture text.
- Unpinned selection falls back to the second account (and its proxy) only after an explicit 401, for both route shapes.
- A caller abort during dispatch makes one call and no success terminal.

### Reproduced defect (not committed as failing tests)

The committed suite must exit 0, and `skip`, `it.fails` and asserting the unsafe call counts are all ruled out. So the failing cases are kept here as a bounded reproduction instead. They were run in this checkout against the current product code by appending this block to the new `describe` (it uses the same `accounts`/`dispatch` helpers):

```js
it.each([502])("does not rotate a pinned account on HTTP %s", async (status) => {
  const { a } = await accounts();
  flow.network.mockImplementation(() => Response.json({ error: "synthetic refusal" }, { status }));
  await (await dispatch({ stream: true, id: a.id })).text();
  expect(flow.network).toHaveBeenCalledTimes(1);
});
it.each([["malformed", "{broken"], ["HTML", "<html>sign in</html>"], ["incomplete", JSON.stringify({ data: { chatWithBot: { text: "partial fixture", state: "pending" } } })]])("does not replay an accepted %s response", async (_label, payload) => {
  await accounts();
  flow.network.mockImplementation(() => new Response(payload, { headers: { "content-type": "application/json" } }));
  await (await dispatch({ stream: true })).text();
  expect(flow.network).toHaveBeenCalledTimes(1);
});
it.each(["reset", "partial body", "deadline"])("does not replay after %s", async (kind) => {
  await accounts();
  flow.network.mockImplementation(async () => {
    if (kind === "reset") throw new TypeError("synthetic reset after dispatch");
    let sent = false;
    return new Response(new ReadableStream({ pull(stream) {
      if (kind === "deadline") return new Promise(() => {});
      if (!sent) { sent = true; stream.enqueue(new TextEncoder().encode('{"data":{"chatWithBot":{"text":"partial')); }
      else stream.error(new TypeError("synthetic body failure"));
    } }), { headers: { "content-type": "application/json" } });
  });
  await (await dispatch({ stream: true })).text();
  expect(flow.network).toHaveBeenCalledTimes(1);
});
```

Observed: pinned HTTP 502 makes **3** vendor calls (outer transient retry). With unpinned selection, a 200 carrying malformed JSON, HTML, an incomplete `state`, a post-send network reset, or a body that breaks mid-read each make **2** calls (one per account). The returned errors carried no success terminal. A 200 body that never finishes did not settle within Vitest's 30 s timeout, although the fixture sets `RESPONSE_BODY_TIMEOUT_MS` and `PROVIDER_BODY_TIMEOUT_MS` to 100 ms. The fixture cannot know whether Poe accepted the work, so each of these is an uncertain outcome, and the gateway replays it against another account.

Minimal repair path for the orchestrator (product files outside this unit):

1. `open-sse/executors/poe-web.js`: read the vendor body with `readBodyWithTimeout(upstream, { signal, maxBytes: MAX_PROVIDER_BODY_BYTES, timeoutMs: RESPONSE_BODY_TIMEOUT_MS })` from `open-sse/utils/bodyTimeout.js` (as `t3-chat-web.js` does) and `JSON.parse` the text, rethrowing caller aborts. Return an error with code `upstream_outcome_unknown` for: a post-send non-abort network error, HTTP 5xx, a body read failure or deadline, and an unparsable or incomplete 2xx body. Keep 401/403/3xx as `session_expired` and 429/other 4xx as explicit refusals so the passing fallback case stays green.
2. `src/sse/handlers/chat/singleModel/postProcess.js`: add `"poe-web"` to `OUTCOME_UNKNOWN_CODE_PROVIDERS`, so that code is terminal (no sibling account, no outer transient retry, no cooldown), as it already is for `tencent-aistudio-web` and `maxai`.
3. Then add the block above to this test file as ordinary assertions (one call, no success terminal, status >= 400). It should pass without other changes.

This is a repair direction based on the executor's observed generic 502 errors and the existing outcome-unknown handling, not a tested fix. No shared-helper extension was needed.

### Commands and results

Every command ran under `env -i` with an explicit PATH, `LANG=C.UTF-8`, `CI=1`, and a private HOME, DATA_DIR, TMPDIR and cache under `/var/tmp/poe2034-a3l2.*`, wrapped in `timeout 300`. Root, `cli/` and `tests/` dependencies were installed into this checkout with `pnpm install --frozen-lockfile` and a private store. From `tests/`:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-poe-web-2034.test.js --maxWorkers=2
node node_modules/vitest/vitest.mjs run unit/provider-cookie-import-contracts.test.js unit/provider-cookie-capture-extension.test.js unit/api/provider-cookie-import.test.js unit/poe-web-provider.test.js --maxWorkers=2
```

From the repository root: `node node_modules/eslint/bin/eslint.js src`, `node scripts/build-anti-slop-plugin.mjs`, `node scripts/check-anti-slop.mjs`.

Results: focused file **31 passed**; related files **236 passed**; ESLint exit 0 (0 errors, 348 warnings); anti-slop build and check exit 0 (0 diagnostics). The reproduction block above failed 7 cases as described when run with the same command. The generated anti-slop bundle was unchanged.

Remaining uncertainty: the permission guard itself is mocked by the shared fixture. A Cookie header alone cannot prove origin (origin comes from the pairing). Nothing shows how live Poe behaves, whether it accepts work after a 5xx or broken body, or whether the GraphQL operation is current. Full CI and independent review are later qualification work.
