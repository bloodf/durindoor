# Arena (lmarena) cookie capture and import, 2026-11-27

Issue: #2034. Suite: `tests/unit/cookie-flow-lmarena-2034.test.js`. No product file changed.

## Result: NOT PARITY

The local path works offline: Arena is active (not guarded or staged), and a captured, pasted or HAR-imported session is stored and then sent by `LmarenaExecutor` for the chosen account and proxy. It is not at parity with the pinned source (gaps 1 to 3 below), and paste and HAR import cannot refuse an expired cookie (gap 4). No live sign-in, live chat or browser run was performed. Registry metadata and mocks do not show that arena.ai accepts any of these requests.

## Contract in the registry

`open-sse/providers/registry/lmarena.js`:

| Item | Value |
| --- | --- |
| Origin | `https://arena.ai` (exact) |
| Required cookie | `arena-auth-prod-v1`, or contiguous chunks `arena-auth-prod-v1.0`, `.1`, … |
| Optional cookies, hashed families, `localStorage`, account email | none |
| Dashboard import modes | `Cookie` header, cURL (`-H` or `-b`), HAR, extension pairing |
| Runtime | `LmarenaExecutor`, `POST /nextjs-api/stream/create-evaluation` |

## Coverage added

Existing suites already cover the following, which the new suite does not repeat as stand-alone checks:

- `provider-cookie-import-contracts.test.js`: the Arena origin, name and prefix, cross-origin filtering with synthetic cookie lists.
- `provider-cookie-capture-extension.test.js`: the extension table matches the registry; capture mechanics with other providers.
- `api/provider-cookie-import*.test.js` and `provider-cookie-import-validation-review.test.js`: pairing, transport and body-size rules with other providers.
- `lmarena-provider.test.js`, `review-b-lmarena-stream.test.js`, `review-x-executor-*.test.js`, `web-session-*redirects.test.js`: executor translation, status mapping, strict proxy and redirects, with hand-built credentials. `lmarena-provider.test.js` also replaces executor lookup with a mock.

None of them takes an Arena session from capture or paste through storage to dispatch. The new suite does.

Real in the new suite: the registry entry, extension `prepareCapture` and `runCapture`, the dashboard parser, both import routes, the SQLite repository, the provider list and detail routes, `handleChat`, account selection, executor lookup, `LmarenaExecutor`, and the TLS wrapper's proxy resolution. Mocked: three `dashboardGuard` decisions, `chrome.*`, the extension's `fetch` (bridged to the import route), the native TLS client, and global `fetch` (any call throws).

| Requirement | Offline evidence | Still unproved |
| --- | --- | --- |
| Exact names, origin, chunks | The pairing contract is compared in full. The extension reads the base name, then `.0`, `.1`, and stops at the first missing index, in the tab's cookie store. Two long synthetic chunks keep every byte, including `=`. The stale unchunked copy is dropped. | The cookie names, sizes and attributes a signed-in arena.ai browser holds today. |
| Optional fields, `localStorage` | The contract has none. The server refuses a `localStorage` value and an account email. The extension mock throws on page storage and cookie enumeration. | Not applicable. |
| Header, cURL, HAR | Each mode is parsed, imported and dispatched. `cf_clearance` is listed as dropped. A HAR with two accounts needs a choice. Missing cookie, missing chunk 0, old domain, plain HTTP and subdomain inputs are refused with fixed text. | The modal UI itself. The test posts the body `CookieImportModal.js` builds. |
| Authenticated create and update | Pairing is refused when either guard decision is false. Import without a pairing, or with a used one, is 401. Update pairings are refused for another provider's connection and for an API-key `lmarena` connection. A changed `connectionId` is 409, spends the pairing and writes nothing. A valid update keeps the proxy and the saved reCAPTCHA token and leaves the other account's row identical. | The real guard's authentication (mocked here; `dashboard-guard.test.js` owns it). |
| Origin and expiry refusal | The extension reads nothing on `lmarena.ai`, `www.arena.ai`, plain HTTP or a lookalike host. The server refuses wrong origins and domains, non-secure cookies, an expired `expirationDate`, bad names, gaps and duplicates. | Expiry for paste and HAR (gap 4). |
| Stored credential to executor | URL, exact header set, model UUID and body fields are checked at the TLS boundary. A pinned JSON or stream request uses only that account's cookie and proxy. Unpinned 401 failover keeps each cookie with its own proxy. A pinned 401 uses no other account. A captured update replaces two chunks with one cookie, clears the cooldown and is what the next request sends. | The native TLS handshake, the real proxy tunnel, proxy pools and relays, and arena.ai's response format. |
| No secret in output | Import responses, extension results, provider list and detail, failover and expired-session responses, and `console.*` contain no synthetic cookie or pairing token. | Request-detail tables, file logs, proxy traces and encryption at rest. |

Temporarily changing product code made the suite fail, so these checks are live: passing `null` proxy options in the executor failed 2 tests, and removing the registry chunk prefix failed 17. Both files were restored.

## Gaps and minimum repairs

These belong to one later repair unit. Several touch shared registry, extension or parser files.

### 1. Chunked sessions go out in a different shape from the pinned source

DurinDoor sends `arena-auth-prod-v1.0=A; arena-auth-prod-v1.1=B`. The source's `readLMArenaCookie` joins the chunks and sends `arena-auth-prod-v1=AB`, keeping other cookies. A non-empty unchunked cookie is left unchanged. The source's credential hint says the single cookie is now empty after Arena moved to chunked Supabase cookies. DurinDoor's guide says chunks are "reconstructed in order", but the code only orders them.

Which shape arena.ai accepts today is **unverified**. Separate chunks are what a browser holding those cookies would send, so this is a confirmed divergence, not a confirmed live failure. The suite pins the current shape.

Repair: first confirm with an authorized live session. If joining is required, port the join into `cookieOf` in `open-sse/executors/lmarena.js`, which serves both chat and validation. Stored values need no change. Update the header expectations in the new suite and the guide.

### 2. Validate and Test Connection cannot detect a dead session

`validateLmarenaSession` sends `GET` to the chat route and returns valid for 405. DurinDoor's own comment says chat is the real session check. A 405 is a method refusal, and nothing in this check shows that the cookie was read. The pinned source instead probes `GET /api/me/pulse`. Its comment reports 200 for a live session and 401 without one, "verified live 2026-10". That is the source's claim and was not rechecked here.

Reproduction (R1 below): the text `not-even-a-cookie` is reported valid when the upstream answers 405. `lmarena-provider.test.js` already asserts the 405 verdict, so the new suite does not repeat or endorse it. `docs/providers/web-cookie.mdx` says a passing probe means the site accepted the cookie; for Arena that is not established.

Repair: probe `/api/me/pulse` (200 valid, 401 or 403 expired, anything else unavailable). Change `validateLmarenaSession`, the registry `validationProbe`, the existing 405 assertion and both guides. By code reading, not reproduced: Validate and Test Connection use ordinary `fetch`, not the TLS client chat uses, so a Cloudflare 403 would be reported as an expired session.

### 3. Import and capture discard `cf_clearance`

The Arena profile approves no extra cookie. Paste, cURL and HAR drop `cf_clearance`, the server refuses it, and the extension never reads it. The source keeps other cookies, and its hint says to include `cf_clearance` "preferably". By code reading, **Add Connection** stores a pasted header unfiltered. Whether Cloudflare accepts a copied clearance cookie from the gateway's address is unverified.

Repair: add `optionalCookies: ["cf_clearance"]` to the registry profile and the extension table, then update the exact-contract expectations.

### 4. Paste and HAR import cannot refuse an expired cookie

Only the extension sends `expirationDate`. A `Cookie` header carries no expiry. HAR request cookies can carry `expires`, but `parseHarDocument` discards it, so the server never sees it (R2 below: an expiry in 2000 is accepted). The new suite asserts refusal only where expiry reaches the server.

Repair for HAR: in `src/shared/utils/cookieImportParser.js`, keep a valid `expires` as `expirationDate`, including when the `Cookie` header overrides the same value. The existing server check then applies. Header and cURL input need a documented limit.

## Other limits

- A missing **last** chunk cannot be detected: a lone `.0` from a two-chunk session is accepted (R3 below). The contract does not state a chunk count.
- Cookie import cannot supply `recaptchaV3Token`. The executor reads it from the connection's `providerSpecificData`, and import update preserves it. A new import sends no token. Token lifetime and whether arena.ai requires it are unverified. The source also reads the name `recaptchaToken` and has an operator-supplied `cx` field; DurinDoor reads neither.
- Outside this unit, by code reading and not reproduced: the executor's `openAIStream` splits each network read into lines without buffering a partial line. A JSON line split across two reads may be emitted as text.

## Reproductions

A temporary Vitest file called the real functions with synthetic input and no network, then was deleted. The calls were:

```js
const only405 = async () => new Response("", { status: 405 });
// R1: both returned {"valid":true,"status":405}; each sent one GET to the chat route
await validateLmarenaSession({ apiKey: "not-even-a-cookie" }, only405);
await probeRegistryProvider("lmarena", "arena-auth-prod-v1=expired-or-garbage", only405);

// R2: the candidate lost `expires`; buildImportedCookieHeader returned
// {"ok":true,"header":"arena-auth-prod-v1=synthetic"}
const har = JSON.stringify({ log: { entries: [{ request: { url: "https://arena.ai/x", headers: [],
  cookies: [{ name: "arena-auth-prod-v1", value: "synthetic", expires: "2000-01-01T00:00:00.000Z" }] } }] } });
const built = buildImportCandidates({ kind: "har", parsed: parseHarDocument(har) }, getCookieImportContract("lmarena"));
buildImportedCookieHeader(getCookieImportContract("lmarena"), built.candidates[0].cookies);

// R3: ok === true
buildImportCandidates({ kind: "header", parsed: parseCookieHeaderValue("arena-auth-prod-v1.0=first-half-only") },
  getCookieImportContract("lmarena"));
```

## Source

[OmniRoute](https://github.com/cheaper-inference/OmniRoute) (MIT, Copyright (c) 2026 Cheaper Inference), read from the local source cache at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`. DurinDoor's port names `4265bb2ad5477450a07d3a43ea33a62c6c874878`.

| File | Used for | Same blob at both commits |
| --- | --- | --- |
| `open-sse/executors/lmarena/cookie.ts` | gaps 1 and 3 | yes (`c1e62529a369`) |
| `open-sse/executors/lmarena.ts` | cookie use, reCAPTCHA, `cx` | yes (`4260f964bed9`) |
| `src/lib/providers/validation/webCookie.ts` | gap 2 | yes (`a9e2b2938b80`) |
| `src/shared/providers/webSessionCredentials.ts` | chunk and `cf_clearance` hints | no; read at `b15b2ee6` only |

## Evidence

Node 24.22.3 and pnpm 12.18.0. Dependencies came from `pnpm install --frozen-lockfile` at the root and in `tests/`, with a private store. From `tests/`, where `$R` is a new private directory under `/var/tmp`:

```bash
env -i PATH="$PATH" LANG=C.UTF-8 CI=1 HOME=$R/home DATA_DIR=$R/data TMPDIR=$R/tmp XDG_CACHE_HOME=$R/cache \
  timeout 300 node node_modules/vitest/vitest.mjs run unit/cookie-flow-lmarena-2034.test.js --maxWorkers=2
```

The new suite has 30 tests, all passing. In one run with `lmarena-provider`, `review-b-lmarena-stream`, `provider-cookie-import-contracts` and `provider-cookie-capture-extension`, all 218 tests passed. `node scripts/check-docs.mjs` passed. Root ESLint reports nothing for the new test file. The anti-slop configuration does not lint `tests/`. The full `test:ci` gate, root lint and build were not run for this unit.
