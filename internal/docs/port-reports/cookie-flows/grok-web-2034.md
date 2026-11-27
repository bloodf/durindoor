# Grok Web web-cookie flow (#2034)

**Verdict: NOT PARITY.** The DurinDoor path from capture or import to the upstream request works offline for the one credential its contract approves, `sso`. Two gaps remain (below), and no live grok.com sign-in or request was made. `grok-web` is an active provider, so no staging or activation boundary applies.

Product code, the registry, the extension, other tests and the baseline are unchanged. No upstream code was ported.

## Contract under test

Source: `open-sse/providers/registry/grok-web.js`. It has no `cookieImport` block, so import and capture derive from `webLogin`.

| Item | Value |
| --- | --- |
| Origin | `https://grok.com` |
| Required cookie | `sso` |
| Chunks, optional cookies, localStorage, hashed names | none |
| `webLogin.allowedHosts` (`accounts.x.ai`) | sign-in redirect host only; does not widen capture or import |
| Stored credential from capture or import | `apiKey = sso=<value>`, `authType = cookie` |
| Upstream request | `POST https://grok.com/rest/app-chat/conversations/new` |

## What existing suites already covered

| Suite | grok-web coverage |
| --- | --- |
| `provider-cookie-import-contracts` | contract shape; cURL and HAR parsing and header composition with generated cookies |
| `provider-cookie-import-validation-review` | create through the real pairing and import handlers; unsafe values |
| `provider-cookie-capture-extension` | extension behaviour, mostly with a hand-written grok-web pairing and a canned import response |
| `provider-cookie-lifecycle-chatgpt-grok` | accounts saved through `POST /api/providers`; dispatch, formats, 401 fallback, PUT re-paste; no import or proxy |
| `grok-web-empty-sso`, `grok-web-signin-parity` | executor cookie building and response handling |

The gap this unit closes: no suite fed a pairing minted by the real handler into the extension, sent the extension's request to the real import route, and then followed the stored row through account selection and a bound proxy to the upstream request.

## Evidence

`tests/unit/cookie-flow-grok-web-2034.test.js`, 47 tests. Dependencies were installed with `pnpm install --frozen-lockfile` (root and `tests/`). Run from `tests/`, with a private `HOME`, `DATA_DIR` and `TMPDIR` and no credentials in the environment:

```sh
node node_modules/vitest/vitest.mjs run unit/cookie-flow-grok-web-2034.test.js --maxWorkers=2
```

Mocked: four `dashboardGuard` answers (`canAccessManagementApi`, `canManageAccessConfig`, `isOperatorRequest`, `hasExactRequestOrigin`), the `chrome` namespace, `node-machine-id`, the final network call under `proxyAwareFetch`, and the proxy dispatcher objects. Console output is captured. SQLite is a fresh on-disk database per test.

Two temporary product edits, reverted afterwards, checked that the assertions can fail. Passing `null` instead of `proxyOptions` in the executor failed 3 tests. Making the extension read the first cookie store instead of the tab's store failed 10.

### Shown offline

- **Capture.** One exact-name read of `sso` from the tab's own cookie store. No chunk probing, cookie enumeration or page script. Only the `cookies` permission and the two origins are requested, then returned. One POST with the pairing header and `credentials: "omit"`.
- **Capture refusals.** `accounts.x.ai`, `x.ai`, a grok.com subdomain, a lookalike host and plain HTTP are refused before any cookie read. A missing, empty, insecure or `.x.ai`-scoped `sso` sends nothing. A captured cookie with a past `expirationDate` is refused by the server and the saved row is unchanged.
- **Dashboard import.** Cookie header, cURL and HAR input each create, update and dispatch, keeping `sso` alone. With two different HAR sessions, only the chosen one is stored. The test calls the parser the way `CookieImportModal` does; it does not render the modal.
- **Server refusals.** Wrong origin or cookie domain, an extra or chunked cookie name, duplicate, insecure or expired cookies and localStorage input return static 400 errors without writing.
- **Authority and ownership.** Three denied guard answers and the isolated login host mint no pairing. Update pairings cannot target another provider's, another auth type's or a missing connection. A redirected, converted or cross-provider import is refused and spends the pairing. A used pairing cannot be replayed.
- **Update isolation.** Only the paired row changes. Its id, name, priority and proxy binding stay, and its model lock clears. The sibling row is unchanged.
- **Stored credential to request.** `handleChat` sends the chosen account's cookie through that account's strict proxy pool dispatcher, with `redirect: "error"`. With both proxies broken, no attempt goes direct or pairs one account's cookie with the other's proxy. An upstream 401 is reported without the cookie.
- **Redaction.** The checked import responses, extension results, provider list and detail reads, chat responses and captured console output contain no synthetic cookie value; where a pairing is in play they are also checked for its token. This is not a scan of every log sink or database table.

### Unsupported input, refused safely

| Input | Result |
| --- | --- |
| Bare `sso` value, or `sso=` with no value, in dashboard import | "No cookie name=value pair" |
| Header without `sso` | "The input has no sso cookie." |
| localStorage JSON | refused by the paste reader; the server refuses a `localStorage` field |
| cURL for any other origin, or `-b <jar file>` | refused |
| HAR without a grok.com request | refused |

Manual **Add** and **Edit** still accept a bare value or a full header. The lifecycle suite covers that separate path.

## Gap 1: `sso-rw` is not captured or imported

DurinDoor's extension never reads `sso-rw`. Dashboard import drops `sso-rw`, `cf_clearance` and `__cf_bm`, and the import route refuses them if submitted. A captured or imported account therefore sends `sso` only. A manually pasted full header that contains `sso` is forwarded whole.

Upstream, OmniRoute (MIT) at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`, from the read-only source cache:

- `src/shared/providers/webSessionCredentials.ts` names the `grok-web` credential `sso + sso-rw`.
- `src/lib/providers/webCookieAuth.ts`, `buildGrokCookieHeader`, forwards `sso-rw`, `cf_clearance` and `__cf_bm` when present. Its comment says Grok's anti-bot rejects `sso` without `sso-rw` (error code 7, their #3063). `open-sse/executors/grok-web.ts` uses this builder.

That rejection is an upstream source comment. It was not reproduced here, so whether a captured `sso`-only account works live is **unknown**. A case-insensitive search for `grok-web` and `sso-rw` found no match in CLIProxyAPI `dbe641f286a489ecb39e3c041c554371e6add864` (whole checkout) or in `src/` of EasyCLIProxyAPI `29567ead8164a00724dfdc2087f02a23895636ee`. The earlier comparison in `internal/docs/grok-web-signin-parity-2034.md` used older pins.

**Minimum repair (one owner):**

1. Give `open-sse/providers/registry/grok-web.js` a `cookieImport` profile: same origin, required `sso`, `optionalCookies: ["sso-rw"]`.
2. Mirror `optionalCookies` in `extensions/provider-cookie-capture/providers.js`.
3. Update the grok-web rows in `provider-cookie-import-contracts.test.js`, the affected extension fixtures, this unit's allowlist assertions (marked "gap 1") and `docs/providers/web-cookie.mdx`.

Decide on `cf_clearance` and `__cf_bm` separately. OmniRoute's credential hint says `cf_clearance` is tied to the browser's IP, User-Agent and TLS fingerprint, and the DurinDoor executor sends a fixed User-Agent. Adding the cookie alone would not show that it works.

## Gap 2: HAR import ignores cookie expiry

`parseHarDocument` in `src/shared/utils/cookieImportParser.js` keeps only each cookie's name and value. An `expires` value on a HAR request cookie is discarded, so the modal cannot send `expirationDate` and the server's expiry check never runs. From the code, importing an old HAR as an update can replace a working saved cookie with an expired one. The next request would then fail upstream. The overwrite itself was not run, and the test file deliberately contains no assertion that accepts such an import. Whether a given browser fills this field in its HAR export was not checked.

Bounded reproduction of the parser behaviour, from the repository root. It uses no network or database and writes two files to a new temporary directory:

```sh
d=$(mktemp -d)
cat > "$d/hook.mjs" <<'EOF'
import { registerHooks } from "node:module";
registerHooks({ resolve(s, c, next) { try { return next(s, c); } catch (e) { if (s.startsWith(".")) return next(`${s}.js`, c); throw e; } } });
EOF
cat > "$d/probe.mjs" <<'EOF'
const { parseHarDocument, buildImportCandidates } = await import(`${process.argv[2]}/src/shared/utils/cookieImportParser.js`);
const contract = { origin: "https://grok.com", cookieNames: ["sso"], cookiePrefixes: [] };
const har = { log: { entries: [{ request: { url: "https://grok.com/rest/app-chat/conversations", headers: [],
  cookies: [{ name: "sso", value: "synthetic-stale", expires: "2001-01-01T00:00:00.000Z" }] } }] } };
console.log(JSON.stringify(buildImportCandidates({ kind: "har", parsed: parseHarDocument(JSON.stringify(har)) }, contract).candidates[0].cookies));
EOF
node --import "$d/hook.mjs" "$d/probe.mjs" "$PWD"
```

Observed (Node 24.22.3): `[{"name":"sso","value":"synthetic-stale"}]`. The 2001 expiry is gone.

**Minimum repair (one owner):** in `cookieImportParser.js`, keep a parseable HAR `expires` as `expirationDate`, including when the `Cookie` header repeats that cookie, and refuse a candidate whose required cookie has expired. The parser is shared by every cookie provider, so add the regression test at that level.

A pasted Cookie header or cURL command carries no expiry, so import cannot detect a stale session from either. It surfaces as the upstream 401.

## Not proved

- grok.com accepting the captured `sso`, the request headers, the generated `x-statsig-id` or the payload.
- Any real browser: extension install, permission prompts, real cookie flags and domains, or a real HAR export.
- Real dashboard authentication. The four guard answers are mocked.
- Real proxy connections. The dispatchers are inert objects.
- The server-side web sign-in capture path, cookie rotation and remote quota.
- Streaming, Messages and Responses output for an imported row. The lifecycle suite covers those for manually saved rows.
