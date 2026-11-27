# DeepSeek Web cookie flow (#2034)

## Verdict: NOT PARITY

| Layer | Result |
| --- | --- |
| Capture, import, storage, account selection, outbound request routing | Holds in an offline test against the real descriptor |
| Provider execution contract | **NOT PARITY** with the cited source: three gaps, reproduced below |
| Live sign-in, live token format, live completion | Not tested |

`deepseek-web` is active: the descriptor has no hidden or guard flag, so nothing here is a staging boundary.
The execution gaps are product defects that this unit does not repair.

## Pins

- Base: `4819aba30dd`.
- Source: [cheaper-inference/OmniRoute](https://github.com/cheaper-inference/OmniRoute) (MIT). The registry and
  [the earlier note](../../deepseek-web-2034.md) cite `4265bb2ad5477450a07d3a43ea33a62c6c874878`. The read-only cache was at
  `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. `git diff` between the two is empty for
  `open-sse/executors/deepseek-web.ts`, `open-sse/executors/deepseek-web/pow.ts` and `open-sse/lib/deepseek-pow.ts`.
- Claims about upstream describe that source's code, not observed DeepSeek behavior.

## Provider contract

| Item | Value |
| --- | --- |
| Origin | `https://chat.deepseek.com`, exact |
| Credential | localStorage `userToken`, bare or `{"value":"…","__version":"0"}` |
| Cookies, chunks, hashed names, optional fields, account email | None |
| Stored value format | Printable ASCII without spaces, at least 8 characters (`credentialPattern`), at most 8192 |
| Connection | `authType: "apikey"`, `providerSpecificData.userToken`, no API key |
| Precedence | A pasted API key wins over the imported value; an import update clears the key |

## Existing coverage and what this adds

| Existing suite | Already proves | Not repeated here |
| --- | --- | --- |
| `deepseek-web-capture.test.js` | Extension table, capture from a hand-written pairing with mocked `fetch`, reader origin check, create and update from hand-written bodies, direct executor calls, validation probe | Its origin near-miss list, wrapper handling, pasted-key precedence, missing-token 401, probe |
| `deepseek-web-provider.test.js` | Registration, local decoder, per-call token separation, completion 401 and 429 mapping | Decoder and status mapping |
| `provider-cookie-import-contracts.test.js` | Origin and key row for the provider | The row itself |

`tests/unit/cookie-flow-deepseek-web-2034.test.js` joins those pieces and adds:

- The server's own pairing text goes into `prepareCapture` and `runCapture`; the extension's actual POST reaches the real import route.
- Real SQLite under a private `DATA_DIR`, with no database or `localDb` mock.
- Only `userToken` is read, even beside `userToken.0` and `userToken.1` decoys; the cookie API is never touched; granted permissions are returned.
- A sibling origin such as `platform.deepseek.com` stops at review, before a permission prompt.
- Values with a space or newline, or over the length bound, are never sent. A too-short value gets the fixed server rejection.
- Dashboard parser refusals for Cookie header, cURL and HAR. Import route refusals for raw header, cURL, HAR, bearer and chunk fields.
- Extra `apiKey` and `providerSpecificData` fields in an import body are not stored.
- The management list and single-connection reads omit the imported token, for operator and non-operator callers.
- Both management denials, import without a pairing, body bound, replay, and pairing expiry in the extension and on the server.
- An update pairing cannot target the sibling `deepseek` provider (same auth type) or move between accounts. A same-name create returns a conflict and leaves the row unchanged.
- Two imported accounts on two strict proxy pools: replacing B leaves A unchanged and keeps B's pool. `getProviderCredentials` picks the preferred row,
  and the executor's three requests go through the real `proxyFetch` with only that account's token and dispatcher.
- A failing strict proxy produces one attempt and no direct send.
- An expired or refused session at `users/current` (401, 403, 200 envelope, redirect) stops after one request and leaves both rows unchanged.

## Unsupported input modes

| Input | Behavior |
| --- | --- |
| Cookie header, cURL (dashboard parser) | `The input has no cookie this provider approves.` |
| HAR (dashboard parser) | `The HAR file has no request to https://chat.deepseek.com.` |
| Raw header, cURL, HAR or `apiKey` fields at the import route | 400 `localStorage values are required` |
| `userToken.<n>` item names at the import route | 400 `localStorage key is not approved for this provider` |
| Account email at pairing | 400 `This provider takes no account email` |

The dialog offers only **Paste value** and **Browser extension** for a localStorage-only profile (read from `CookieImportModal.js`; not rendered here).
No input mode reads a token out of an `Authorization` header in cURL or HAR.
The HAR message is a wording limitation: the test file does contain a request to that origin, but no approved cookie.

## What stays mocked or unproved

- Management guard authority is mocked. Real dashboard session and CLI token checks are not exercised.
- `chrome`, page `localStorage` and `location` are fakes. No browser or packaged extension ran.
- The outbound socket and proxy dispatchers are fakes. No `CONNECT` tunnel or relay was exercised.
- The executor test derives proxy options with the exported `resolveCredentialProxyOptions`. `chatCore.js` builds them with its private
  `buildChatProxyOptions`, and neither it nor `/v1` routing ran.
- Completion is answered with 429 in the routing test, so it says nothing about reply decoding.
- The dashboard modal and `/api/providers/client` were not exercised. Other connection read or export paths were not audited.
- localStorage has no expiry metadata, so an expired token is only detectable from DeepSeek's reply.
- No evidence here shows the live site still stores `userToken` in this form or accepts these requests.

## Execution gaps

Each gap compares `open-sse/executors/deepseek-web.js` with `open-sse/executors/deepseek-web.ts` at the cited pin.
The test asserts no expected result for these cases, so it neither accepts nor locks in the current output.

1. **No proof of work.** The source posts `{"target_path":"/api/v0/chat/completion"}` to `/api/v0/chat/create_pow_challenge`, solves it,
   and sends `X-Ds-Pow-Response` on every completion attempt. The local executor does neither. Whether the live endpoint rejects a request without it was not tested.
2. **A 200 error envelope becomes a successful reply.** The source treats an `application/json` 200 with a non-zero `code` as an error
   (40003 to 401, 40002 to 429, otherwise 502). The local executor returns 200 with empty content. This is unsafe whatever upstream does:
   a rejected completion reads as success.
3. **Fragment frames decode to nothing.** The source reads `v.response.fragments`, `response/fragments` and bare string `v` frames,
   and fails unless `response/status` reaches `FINISHED`. The local decoder returns 200 with empty content for such a stream and does not check for `FINISHED`.

### Bounded reproduction

Run from the repository root after `pnpm install --frozen-lockfile`. It runs the real executor with a replaced `fetch`; no request leaves the process.

```bash
env -i PATH="$PATH" LANG=C.UTF-8 CI=true HOME="$(mktemp -d)" DATA_DIR="$(mktemp -d)" node --input-type=module <<'EOF'
const { default: Executor } = await import(`${process.cwd()}/open-sse/executors/deepseek-web.js`);
const json = (v) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
const sse = (frames) => new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
const replies = {
  "200 error envelope": () => json({ code: 40003, msg: "synthetic rejection", data: null }),
  "fragment frames": () => sse([
    { v: { response: { thinking_enabled: false, fragments: [{ type: "RESPONSE", content: "synthetic " }] } } },
    { v: "answer" },
    { p: "response/status", v: "FINISHED" },
  ]),
};
for (const [label, completion] of Object.entries(replies)) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ path: new URL(url).pathname, pow: Object.keys(init.headers).some((h) => h.toLowerCase() === "x-ds-pow-response") });
    if (url.endsWith("/users/current")) return json({ data: { biz_data: { token: "synthetic-access" } } });
    if (url.endsWith("/chat_session/create")) return json({ data: { biz_data: { chat_session: { id: "synthetic-session" } } } });
    return completion();
  };
  const { response } = await new Executor().execute({ model: "deepseek-chat", stream: false, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { providerSpecificData: { userToken: "synthetic-user-token" } } });
  const out = await response.json();
  console.log(label, JSON.stringify({ status: response.status, content: out.choices?.[0]?.message?.content, error: out.error?.message, calls }));
}
EOF
```

Observed at the base above (Node may also print a module-type warning):

```text
200 error envelope {"status":200,"content":"","calls":[{"path":"/api/v0/users/current","pow":false},{"path":"/api/v0/chat_session/create","pow":false},{"path":"/api/v0/chat/completion","pow":false}]}
fragment frames {"status":200,"content":"","calls":[{"path":"/api/v0/users/current","pow":false},{"path":"/api/v0/chat_session/create","pow":false},{"path":"/api/v0/chat/completion","pow":false}]}
```

The current mocks in `deepseek-web-capture.test.js` and `deepseek-web-provider.test.js` answer completion in shapes the local decoder reads.
Their passing says nothing about these gaps.

## Minimum repair path

One single-owner unit over `open-sse/executors/deepseek-web.js`, new proof-of-work modules, their tests and the DeepSeek Web docs.
No registry, import, pairing, storage or extension change is needed for these gaps.

1. Port the challenge request and solver, with MIT attribution: `open-sse/executors/deepseek-web/pow.ts`, `open-sse/lib/deepseek-pow.ts`,
   `deepseek-pow-hash.js` and `deepseek-pow-worker.mjs`. The solver uses a worker thread, so check that the worker file ships in the packaged build.
   Send the challenge on the same proxy route, with manual redirects and no quota charge; keep a bound on difficulty and solve time.
2. Map a non-zero `code` in a JSON 200 to 401, 429 or 502 with fixed error text, so an upstream `msg` cannot echo a credential. Keep the quota ticket on that result.
   Never turn an unrecognized or empty body into a successful reply.
3. Decode the fragment frames, including the reasoning path, and fail a stream that ends before `FINISHED`.
4. Add regression tests for all three. Replace any existing mock that depends on a shape the repaired decoder no longer accepts.
5. Get live confirmation, with owner authorization and a disposable account, before claiming parity.

## Documentation drift (not edited here)

`src/lib/providers/cookieImport/README.md` still lists DeepSeek Web as "Manual token" with "there is no cookie to capture".
The extension and dashboard both import the localStorage item, as [the user guide](../../../../docs/providers/deepseek-web.mdx) says.
The repair unit or orchestrator should correct that row.

## Evidence command

Dependencies installed with `pnpm install --frozen-lockfile` at the root and in `tests/`. From `tests/`, in a credential-free environment with private `HOME` and `TMPDIR`:

```bash
node node_modules/vitest/vitest.mjs run unit/cookie-flow-deepseek-web-2034.test.js --maxWorkers=2
```

Mutation checks, each applied temporarily and restored from git:

| Temporary change | Failing tests |
| --- | --- |
| Remove `token` from the secret-key pattern in `providerRouteHandlers.js` | 1 (management redaction) |
| Drop proxy options from the executor's setup requests | 7 (routing, strict proxy, session refusal) |
| Drop the provider check from update pairing | 1 (sibling `deepseek` retarget) |
