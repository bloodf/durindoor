# ChatGPT Web cookie flow — #2034

## Verdict: NOT PARITY

An ordinary cookie connection works offline from capture or import to the outbound request. One path is broken: importing over a connection that has `providerSpecificData.storageState` reports success, but the browser transport keeps using the saved storage state. See [the defect](#defect-a-saved-storage-state-overrides-an-imported-cookie).

Nothing here proves live sign-in, that chatgpt.com accepts a request, or real Chrome behavior. No browser, real account, real proxy or provider request was used.

`chatgpt-web` is active. It has no session-dispatch opt-in or port-pending guard on this path: a saved connection dispatches to `ChatGptWebExecutor` without any activation step.

No code is ported and this report makes no new upstream claim. Earlier source comparisons are in [chatgpt-web-2034.md](../../chatgpt-web-2034.md).

## Contract under test

Read from the shipped `open-sse/providers/registry/chatgpt-web.js`. The import profile is the entry's `webLogin` block; the entry has no `cookieImport` override.

| Item | Value |
| --- | --- |
| Capture and import origin | `https://chatgpt.com` |
| Required cookie | `__Secure-next-auth.session-token`, or chunks `.0`, `.1`, … contiguous from `.0` |
| Optional cookies, hashed families | none |
| localStorage items, account email | none; both are refused |
| Stored credential | the encrypted `apiKey` of an `authType: "cookie"` connection, as an ordered Cookie header |

The entry also lists `auth.openai.com` in `allowedHosts` for sign-in. It is not a capture tab, an import origin or an accepted cookie domain.

## What existing coverage left open

| Existing suite | Covers | Not covered there |
| --- | --- | --- |
| `provider-cookie-capture-extension.test.js` | chunk probing and ceiling, table-to-registry parity, generic permissions and failures | The ChatGPT pairing is written by hand and `fetch` is a stub, so no capture reaches the import route |
| `provider-cookie-import-dashboard.test.js` | parser rules and the dialog | parsed ChatGPT input reaching storage and an executor |
| `api/provider-cookie-import.test.js` | pairing and route rules | replaces the registry with synthetic providers |
| `provider-cookie-import-validation-review.test.js`, `provider-cookie-import-contracts.test.js` | ChatGPT duplicate creates, unsafe values, contract and chunk composition | consumption of the stored credential |
| `provider-cookie-lifecycle-chatgpt-grok.test.js` | manually saved cookies: validation, discovery, fallback, browser rotation | import, extension capture, proxies |
| `chatgpt-web-signin-parity.test.js`, `chatgpt-cookie-rotation-race.test.js` | probe, browser lanes, rotation ownership | capture and import |

## Evidence

Suite: `tests/unit/cookie-flow-chatgpt-web-2034.test.js` (17 tests).

Real code: registry, `prepareCapture`/`describePlan`/`runCapture`, the dashboard parser and candidate builder, the pairing and import routes, the connection list, read and update routes, an isolated SQLite database, proxy pools, `handleChat` account and proxy selection, and both transports.

Mocked: the management guard's verdict, `chrome.*`, the extension's network hop (its request is handed to the real import route), the ChatGPT TLS client through its test override, the browser session through the executor's `deps` seam, global `fetch` (throws) and `node-machine-id`.

| Requirement | Proved offline | Still mocked or unproved |
| --- | --- | --- |
| Pairing from the real descriptor | exact contract in the response; either operator verdict set to false gives `403`; an account email is refused | real dashboard session, CLI token and `Origin` checks (the guard is mocked here) |
| Authenticated, bounded capture | the tab's cookie store only; reads of the base name, `.0`, `.1` and the first missing `.2`; enumeration and scripting throw; only `cookies` and two origins are requested, then removed; one POST with no credential but the pairing secret; replay gives `401` | Chrome's permission prompt, cookie API and activeTab behavior |
| Chunks and stale copy | unrelated cookies are never sent; a stale unchunked copy is not stored once chunks exist | real chunk sizes and real NextAuth rotation |
| Wrong origin | no cookie read on `auth.openai.com`, `chat.openai.com`, a lookalike host or plain HTTP; the route refuses foreign origins and sign-in-host cookie domains | — |
| Expired or incomplete | a past `expirationDate` is refused and the old row is unchanged; a signed-out tab sends nothing; a session without chunk `.0` and unapproved names are refused; an unaccepted stored session returns `401` before any conversation request | whether and when chatgpt.com expires a session |
| Input modes | extension, Cookie header, cURL (`-b`) and HAR; two accounts in one HAR need a choice | the dialog UI itself (see the dashboard suite); HAR exports from a real browser |
| Update ownership | only the paired row changes; name, priority, transport and proxy pool are kept; a swapped provider or connection id spends the pairing and writes nothing | — |
| Shared cookie with `chatgpt-web-codex` | neither an update pairing nor a changed request body crosses between the two providers | — |
| HTTP transport | every mocked call of a turn carries the chosen account's exact cookie and its proxy pool URL; `/backend-api/` calls carry that account's access token; the sibling gets its own cookie and no proxy | TLS fingerprint, a real proxy connection, Sentinel, Turnstile, proof of work (the mock asks for none), model acceptance |
| Browser transport | a new import has no transport setting, so `auto` picks the browser; the session receives exactly the two chunks, the connection id and the account's proxy | Playwright, Chromium, the page's own auth and the actual request on the wire |
| Redaction | the cookie and access token of the accounts under test are absent from import responses, extension results, connection reads, update responses, chat replies and captured console output; raw SQLite rows hold no plaintext | other log sinks, a production deployment |

The HTTP turns use `gpt-5-6`. The HTTP transport remains unvalidated for the GPT-6 lanes.

### Command

From `tests/`, after frozen installs of the root and `tests/` packages into a private store. `$B` is a fresh private directory under `/var/tmp`.

```bash
env -i PATH="$PATH" LANG=en_US.UTF-8 CI=true HOME=$B/home DATA_DIR=$B/data TMPDIR=$B/tmp XDG_CACHE_HOME=$B/cache \
  timeout 290 node node_modules/vitest/vitest.mjs run unit/cookie-flow-chatgpt-web-2034.test.js --maxWorkers=2
```

Result on Node 24.22.3: 1 file, 17 tests passed.

### Fault injection

To check that the assertions can fail, a temporary Vite transform changed one product module at a time in memory. No product file was edited and the temporary config was removed. It had to run before the config's `src/` JSX transform, which reformats the source.

| Injected fault | Failing tests |
| --- | --- |
| extension takes the first cookie store, not the tab's | 1 |
| import ignores the paired connection id | 1 |
| HTTP transport drops the connection proxy | 2 |
| browser transport drops the connection proxy | 1 |
| header composition keeps the stale unchunked cookie | 2 |
| import accepts an expired cookie | 1 |
| update overwrites the proxy pool binding | 1 |
| `storageState` is no longer redacted | 1 |

## Defect: a saved storage state overrides an imported cookie

- `handleCookieImport` replaces `apiKey` and keeps the rest of `providerSpecificData` (`src/lib/providers/cookieImport/handlers.js`).
- `readStorageState` uses `providerSpecificData.storageState ?? apiKey` (`open-sse/utils/chatgptWebExecutorAdapter.js`).

So an update import answers `200`, clears the old failure state and stores the new cookie, while browser turns still send the old session. `auto` is the default transport and starts with the browser. The HTTP transport uses the imported cookie, so the two transports can use different sessions on one connection, possibly different accounts if the new cookie came from another sign-in. The storage state still belongs to that one connection: no cross-connection leak was seen.

`docs/providers/chatgpt-web.mdx` says a storage state is used instead of the pasted cookie. The defect is that a replacement reports success without taking effect or saying so.

The suite asserts only behavior that stays correct after a repair: the target alone is written, the storage state is redacted, and HTTP uses the imported cookie. It does not assert the stale browser session.

### Reproduction

Save as `tests/unit/zz-repro-chatgpt-web-2034.test.js`, run it with the command above, then delete it. It states the correct behavior, so it fails today.

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: () => true, isOperatorRequest: () => true, hasExactRequestOrigin: () => true }));

it("a cookie import over a saved storageState reaches the browser transport", async () => {
  vi.stubEnv("DATA_DIR", fs.mkdtempSync(path.join(os.tmpdir(), "cgpt-repro-")));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", "https://dashboard.example");
  const db = await import("@/lib/db/index.js");
  const handlers = await import("@/lib/providers/cookieImport/handlers.js");
  const { ChatGptWebExecutor } = await import("../../open-sse/executors/chatgpt-web.js");
  const name = "__Secure-next-auth.session-token";
  const saved = { name, value: "synthetic-saved-state", domain: ".chatgpt.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" };
  const row = await db.createProviderConnection({ provider: "chatgpt-web", authType: "cookie", name: "repro", apiKey: `${name}=synthetic-old`, providerSpecificData: { storageState: { cookies: [saved], origins: [] } } });
  const post = (url, body, headers) => new NextRequest(`https://dashboard.example${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const { pairing } = await (await handlers.handleCookieImportPairing(post("/api/providers/cookie-import/pairing", { provider: "chatgpt-web", action: "update", connectionId: row.id }, { origin: "https://dashboard.example" }))).json();
  const imported = await handlers.handleCookieImport(post("/api/providers/cookie-import", { provider: "chatgpt-web", origin: "https://chatgpt.com", connectionId: row.id, cookies: [{ name, value: "synthetic-imported" }] }, { [pairing.header]: pairing.token }));
  expect(imported.status).toBe(200);
  const connection = await db.getProviderConnectionById(row.id);
  expect(connection.apiKey).toBe(`${name}=synthetic-imported`);
  const sent = [];
  const executor = new ChatGptWebExecutor({ browser: {
    createSession: async (input) => (sent.push(input.storageState.cookies.map((cookie) => cookie.value)), {}),
    runTurn: async () => ({ text: "ok", status: "finished_successfully", endTurn: true }),
    readSessionCookies: async () => [],
  } });
  await executor.execute({ model: "gpt-5-6", stream: false, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { ...connection, connectionId: row.id } });
  expect(sent).toEqual([["synthetic-imported"]]);
}, 120_000);
```

Observed failure:

```text
AssertionError: expected [ [ 'synthetic-saved-state' ] ] to deeply equal [ [ 'synthetic-imported' ] ]
```

### Minimum repair path

For one later single-owner repair unit, in the update branch of `handleCookieImport`:

```js
if (pairing.provider === "chatgpt-web" && existing.providerSpecificData?.storageState) {
  update.providerSpecificData = { storageState: null };
}
```

The repository merges `providerSpecificData`, so other settings stay, and `null` falls through to `apiKey`. Keep the condition: writing the key on every row would change connections that never had a storage state. With this change applied in memory only, the reproduction and the 17 tests passed (18 of 18). It is not applied to the product.

The repair unit needs its own test and a note in `docs/providers/chatgpt-web.mdx`. If the owner would rather keep the storage state, the alternative is to refuse the import with a fixed message. The unit should also check two paths this report did not run: re-pasting through **Edit** (`PUT /api/providers/[id]` also merges metadata, by source reading) and `chatgpt-web-codex`.

## Limits and other observations

- **Expiry metadata.** Only the extension sends `expirationDate`. Cookie headers and cURL commands carry none, and by source reading the HAR parser reads only names and values. A stale pasted session is therefore found at use, not at import.
- **Completeness.** Chunk checks require contiguity from `.0`. Nothing records the total, so a session missing its last chunk passes import. The lifecycle suite shows the read-only check rejecting such a session when the session endpoint returns `{}`.
- **Bare token.** The import dialog refuses a bare token value with a fixed message; the add-connection dialog accepts it. A Playwright storage-state JSON is not an import input either.
- **Other cookies.** Import stores only the session cookie. Manual paste also keeps cookies such as `cf_clearance`. Whether a live session needs them is unproved.
- **Not run.** In-page sign-in for this provider, a real extension load, live HTTP or browser requests, and the full `test:ci` inventory.
- **Docs mismatch, separate from the verdict.** `docs/providers/chatgpt-web.mdx` says rotation is not written back on the HTTP transport. A temporary executor-level check with a mocked `set-cookie` from `/api/auth/session` showed the HTTP transport calling `onCredentialsRefreshed` with the rotated cookie, and `src/sse/handlers/chat/singleModel/dispatch.js` supplies that callback. The database write on this path was not exercised, and that check is not part of the suite. The orchestrator should assign the doc or behavior correction.
