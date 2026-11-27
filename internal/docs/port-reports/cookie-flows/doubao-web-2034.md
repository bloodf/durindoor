# Doubao Web (Dola) cookie flow, #2034

## Verdict: NOT PARITY

Capture, import, storage, update ownership and request dispatch work offline against the real
`doubao-web` descriptor. The provider does not meet the "no secret-bearing response or log" rule on
error paths, and it can report a failed Dola stream as a successful answer. Live sign-in and live
`dola.com` acceptance are not proved.

The provider is registered and active. It is not guarded or staged.

## Contract in this tree

Sources: `open-sse/providers/registry/doubao-web.js`, `open-sse/executors/doubao-web.js`,
`extensions/provider-cookie-capture/providers.js`.

| Item | Value |
| --- | --- |
| Origin | `https://www.dola.com`, exact match |
| Required cookies | `sessionid`, `s_v_web_id` |
| Optional cookies, chunk prefixes, hashed families | none |
| localStorage, account email | none |
| Import modes | Extension capture, Cookie header, cURL (`-H` and `-b`), HAR |
| Stored form | `apiKey = "sessionid=…; s_v_web_id=…"`, `authType: cookie` |
| Request | `POST /chat/completion`, stored value as `Cookie`, `s_v_web_id` repeated as query `fp` and body `ext.fp` |
| Probe | none; Validate and Test skip it because the only endpoint opens a conversation |

## What the new suite proves

`tests/unit/cookie-flow-doubao-web-2034.test.js` has 31 cases. Real code: registry descriptor,
import contract, extension capture, dashboard parsers, pairing and import routes, same-origin check,
provider routes, an isolated SQLite database, `handleChat`, account fallback, proxy selection and the
executor. Mocks: `canAccessManagementApi`, `canManageAccessConfig` and `isOperatorRequest`; the
`chrome.*` API; and the transport under `proxyAwareFetch`. All credentials are synthetic.

| Owner requirement | Offline result |
| --- | --- |
| Exact names and origin from the real descriptor | Proved from the pairing response through the extension table. A pairing that drops a name or moves the origin is refused. |
| Authenticated, bounded capture | Proved: no pairing without guard authority or the dashboard origin, and no import without the pairing secret. The extension makes two exact-name reads in the tab's cookie store, with no enumeration or page scripting. It requests and releases `cookies` plus two origins. Other cookies in the mock jar are not read. |
| Chunks, optional cookies, localStorage | None are declared. Chunked `sessionid`, `ttwid`, `fp`, localStorage and an account email are refused or dropped. |
| Missing, expired, foreign or unexpected-origin input | Proved: nothing is saved and the pairing is spent. A wrong tab origin reads no cookie and sends nothing. |
| Cookie header, cURL, HAR | Proved with the real parsers, then the real import route. Two accounts in one HAR are ambiguous. The dashboard component itself is not rendered here. |
| Create, update ownership, account isolation | Proved: an update pairing cannot be redirected to a sibling or issued for another provider's row. An update keeps the name and proxy settings and leaves the sibling row unchanged. |
| Stored credential reaches the executor with one account and proxy | Proved for JSON, stream, `dola-speed` and `dola-pro`. The proxied account uses a `ProxyAgent` dispatcher and the direct account does not. No request carries the other account's values. The test does not read the proxy URL back from the dispatcher. |
| Rejected session | An upstream 401 locks that account, the sibling serves with its own cookie and proxy, and a re-import clears the lock. |
| HTTP 200 that is not a reply | HTML or JSON bodies become a gateway 502 (JSON) or an in-band error (stream). |
| Redaction | Proved for pairing refusals, import responses, extension results, the provider list, successful chat, and an echo of the whole `Cookie` header in the client error and `lastError`. **Not met for logs and bare echoes: see D1 and D2.** |

The log assertions cover successful capture, import and chat, capture refusals, and the session value
during one generic 401. No passing assertion accepts a leaked value or a false success. There is no
`it.fails`, skip or todo.

## Not proved

- A live Dola sign-in, or that `dola.com` accepts this request.
- Whether the real `s_v_web_id` cookie has the `Secure` flag. The extension drops it otherwise, and
  the import then fails with "Required session cookie is missing or incomplete".
- Whether two cookies are enough. Import removes `ttwid`; the local registry comment says it is not
  required. Nothing offline can confirm that.
- A real browser run, a real proxy connection, and real cookie expiry.
- Whether stored request diagnostics keep `ext.fp`. This was not checked.

## Limitations

- The executor accepts an `fp` cookie as a fingerprint fallback. The extension, dashboard parsers and
  import route do not: they require `s_v_web_id`. The suite asserts that refusal.
- The executor reads the whole upstream body before it returns a stream, so replies are not
  incremental. This comes from reading the code; no test times it.

## Existing coverage

| Existing suite | Covers for this provider | Gap closed here |
| --- | --- | --- |
| `doubao-web-provider` | Executor with an injected fetch | Imported rows, gateway, proxy, fallback |
| `provider-cookie-import-contracts`, `provider-registration-web-batch-a` | Pure contract filtering, registration, probe skip | Raw parser text, routes, SQLite |
| `provider-registration-web-batch-a-routes` | Gateway chat routes | Credentials that came from import |
| `provider-cookie-capture-extension` | Generic capture behavior with other providers, table agreement | Doubao capture into the real import route |
| `provider-cookie-import-validation-review` | Handler behavior with ChatGPT fixtures | Doubao create and update |
| `web-session-redirects`, `review-w-websession-proxy` | Redirect refusal and direct executor proxy use | Per-account proxy chosen from stored rows |

## Defects

All were reproduced offline with synthetic values.

- **D1, fingerprint in logs and saved errors.** The executor URL carries `fp=<s_v_web_id>`.
  `maskSensitiveUrl` does not mask `fp`, so the `chatCore` error line prints it. A temporary probe saw
  it for upstream 401, 500, 302 and a thrown transport error. When the transport error text contained
  the URL, `lastError` kept the value too.
- **D2, upstream error body is copied.** The executor builds `Dola error: <upstream body>`. A bare
  `sessionid` echo reaches the client error, `lastError` and the log. A whole-`Cookie` echo is redacted
  in the client error and `lastError`, but the log line still prints it.
- **D3, `STREAM_ERROR` is ignored.** Partial text followed by `event: STREAM_ERROR` returns HTTP 200.
  The JSON reply has `finish_reason: "stop"`; the stream forwards the text and no error.
- **D4, executor only.** A 200 HTML body produces an empty successful completion from the executor.
  The gateway's empty-reply check rejects it, so clients are protected. The account error says
  "empty", not that the session needs a new sign-in.

### Reproduction: executor and sanitizer

Run from the repository root with dependencies installed. It makes no network request.

```sh
node --input-type=module <<'EOF'
const load = (path) => import(`${process.cwd()}/open-sse/${path}`);
const { DoubaoWebExecutor } = await load("executors/doubao-web.js");
const { maskSensitiveUrl } = await load("utils/requestLogger.js");
const { sanitizeErrorMessage } = await load("utils/error.js");
const credentials = { apiKey: "sessionid=synthetic-session; s_v_web_id=verify_synthetic" };
const run = (reply) => new DoubaoWebExecutor({ fetch: async () => reply() })
  .execute({ credentials, model: "dola-speed", body: { messages: [] }, stream: false });

const failed = await run(() => new Response("sessionid=synthetic-session rejected", { status: 500 }));
console.log("D1", maskSensitiveUrl(failed.url).includes("fp=verify_synthetic"));
console.log("D2", await failed.response.text(), sanitizeErrorMessage("sessionid=synthetic-session rejected"));
const cut = await run(() => new Response(
  'data: {"content":{"content_block":[{"content":{"text_block":{"text":"partial"}}}]}}\n\n' +
  'event: STREAM_ERROR\ndata: {"message":"session expired"}\n\n', { headers: { "content-type": "text/event-stream" } }));
console.log("D3", cut.response.status, await cut.response.text());
const html = await run(() => new Response("<html>sign in</html>", { headers: { "content-type": "text/html" } }));
console.log("D4", html.response.status, await html.response.text());
EOF
```

Observed: D1 prints `true`. D2 returns and keeps `sessionid=synthetic-session`. D3 returns 200 with
`partial` and `finish_reason: "stop"`. D4 returns 200 with empty content.

### Reproduction: gateway

Copy the new suite to `tests/unit/zz-doubao-repro.test.js`, append this case, run it with
`-t REPRO`, then delete the copy. Do not commit it.

```js
it("REPRO doubao gateway leaks", async () => {
  await addAccount("only", A, 1);
  reply = () => new Response(`sessionid=${A.sessionid} rejected`, { status: 500 });
  const res = await chat();
  const log = logs.join("\n");
  const saved = String((await rows())[0].lastError);
  process.stdout.write(`REPRO ${JSON.stringify({ status: res.status, clientHasSession: res.text.includes(A.sessionid),
    lastErrorHasSession: saved.includes(A.sessionid), logHasSession: log.includes(A.sessionid),
    logHasFingerprint: log.includes(A.s_v_web_id) })}\n`);
});
```

Observed: status 500 and all four flags `true`. Changing the body to
`` `rejected ${headerOf(A)}` `` with status 401 gave `clientHasSession: false` and a log that still
contained the session. Feeding the D3 body through `chat()` returned 200 in both modes.

## Minimum repair path

One later repair unit should own these changes:

1. In `open-sse/executors/doubao-web.js`, replace the upstream body and the transport `e.message` with
   fixed messages that keep the status. This closes D2 and the saved-error part of D1.
2. Redact `fp` in the logged URL for this provider. The URL comes back to `chatCore`, which calls
   `maskSensitiveUrl` in `open-sse/utils/requestLogger.js`. That helper is shared, so the owner must
   check other providers before adding `fp` to its pattern. This closes the rest of D1.
3. In the executor, turn `STREAM_ERROR` into an error in both JSON and stream modes (D3). Optionally
   refuse a non-SSE 200 there as well (D4).
4. Add cases to this suite that assert no `fp` or echoed value in logs, errors or saved rows, and no
   successful completion after `STREAM_ERROR`.

The same shared log line prints whatever error text it receives. The owner should check whether other
executors copy upstream bodies into it. This unit did not check them.

Parity also needs evidence from an authorized live account for the two-cookie set and the `Secure`
flag. Offline tests cannot supply it.

## Upstream reference

Read from the local source cache: [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute)
(MIT) at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. This describes that source, not live Dola.

- `open-sse/executors/doubao-web.ts` refuses a non-SSE 200 with 502. Its stream path handles
  `STREAM_ERROR`; its non-stream collector does not. It also accepts a fingerprint from `fp` or from
  provider-specific data, and copies the upstream body into HTTP error messages. Its shared error
  sanitizer was not reviewed.
- `open-sse/services/tokenExtractionConfig.ts` lists `sessionid`, `ttwid` and `s_v_web_id` on
  `.dola.com`. `src/shared/providers/webSessionCredentials.ts` asks for the same three and mentions the
  `fp` fallback.

## Evidence

From `tests/`, with a private credential-free `env -i` environment (`HOME`, `DATA_DIR`, `TMPDIR`,
cache and pnpm store under `/var/tmp`) on Node 24.22.3 and pnpm 12.18.0:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-doubao-web-2034.test.js --maxWorkers=2
```

Result: 31 of 31 passed. A focused run of this file with `doubao-web-provider`,
`provider-cookie-import-contracts`, `provider-cookie-capture-extension`,
`provider-registration-web-batch-a`, `provider-cookie-import-validation-review`,
`web-session-redirects` and `review-w-websession-proxy` passed 329 of 329. ESLint passed on the new
test file. The full CI suite and a browser run were not run. The CodeGraph CLI was not installed, so
source lookup used bounded searches of this checkout.
