# Register cookie repairs (#2034)

Base: `bcd70c75541967c7220d9b924ec9640cf8aea3eb`. Sources frozen at 2026-11-27T23:49:25.752045Z; no later head was read.

This unit wires the shared-path repairs for the gaps reproduced in the cookie-flow reports [grok-web](cookie-flows/grok-web-2034.md) (`8365dd918d4`), [claude-web](cookie-flows/claude-web-2034.md) (`b9dacf69321`), [chatgpt-web](cookie-flows/chatgpt-web-2034.md) (`dda3e22ac0c`) and [chatplayground](cookie-flows/chatplayground-2034.md) (`5c1f610ae83`), plus the [ChatPlayground session handoff](fix-chatplayground-session-contract-2034.md). Two of the requested repairs were stopped by the owner because they conflict with suites outside this unit's edit list; see [Not repaired](#not-repaired).

Nothing here shows that a provider accepts a request, that live sign-in works, or what attributes the live cookies carry. Every result below uses mocks and synthetic values.

## Status

| Item | Result |
| --- | --- |
| Grok Web `sso-rw` optional | Repaired |
| Claude Web `lastActiveOrg` optional | Repaired |
| Test Connection: guarded-probe proxy refusal | Repaired, shared path |
| ChatGPT Web and Codex: stale saved browser state after a cookie replacement | Repaired, import and Edit |
| ChatPlayground: stored Cookie sent as a Bearer token by the live catalog lookups | Repaired |
| ChatPlayground: Test, Validate and discovery through `inspectChatPlaygroundConnection` | **Not repaired** (owner decision) |
| Arena: `GET /api/me/pulse` probe | **Not repaired** (owner decision) |
| HAR expiry, chunk gaps (`capture.js`, `cookieImportParser.js`) | Not this unit; owned by the chunk/HAR repair |

## Repairs

### Grok Web: `sso` required, `sso-rw` optional

`open-sse/providers/registry/grok-web.js` gains a `cookieImport` profile: origin `https://grok.com`, `cookieNames: ["sso"]`, `optionalCookies: ["sso-rw"]`. The extension table (`extensions/provider-cookie-capture/providers.js`) gets the same optional name. `webLogin` is unchanged, so in-page sign-in still requires `sso` only.

Source: OmniRoute (MIT, Copyright (c) 2026 Cheaper Inference) at `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`, read from the read-only source cache with `GIT_NO_LAZY_FETCH=1`:

- `src/shared/providers/webSessionCredentials.ts` names the `grok-web` credential `sso + sso-rw`.
- `src/lib/providers/webCookieAuth.ts`, `buildGrokCookieHeader`, forwards `sso-rw` when present.

No code was ported; only the cookie name was adopted. The DurinDoor executor already forwards a stored header whole, so an imported `sso=…; sso-rw=…` reaches grok.com unchanged. `cf_clearance` and `__cf_bm` stay refused: the same source says `cf_clearance` is bound to the browser's IP, User-Agent and TLS fingerprint, and adding it would not show that it works.

Whether grok.com needs `sso-rw` is the source's comment (its #3063), not reproduced here.

### Claude Web: `sessionKey` required, `lastActiveOrg` optional

`open-sse/providers/registry/claude-web.js` gains a `cookieImport` profile: origin `https://claude.ai`, `cookieNames: ["sessionKey"]`, `optionalCookies: ["lastActiveOrg"]`; the extension table matches. The evidence is DurinDoor's own executor: `pickChatOrganizationId` in `open-sse/executors/claude-web.js` reads `lastActiveOrg`. The claude-web report found no such read in the OmniRoute revision above, so no source claim is made. No other cookie name or permission is added.

Imported accounts with two chat organizations now post to the same organization as the same header pasted in **Add**. Without the cookie, the executor's first-chat-organization fallback applies. The cookie's live `Secure` attribute is unverified; the extension forwards only secure cookies, and the import route refuses `secure: false`.

### Test Connection: the guarded probe's proxy refusal

`proxyAwareFetch` refuses a guarded probe dispatcher on a proxy route before any byte is sent, because the proxy would bypass the guard's DNS check. `testSingleConnection` used to save that refusal as `testStatus: "error"`.

In `src/app/api/providers/[id]/test/testUtils.js`, the exact refusal (`OUTBOUND_URL_GUARD_BLOCKED` with the message `Guarded provider probe cannot use an outbound proxy`, returned as a blocked probe result or thrown) becomes `{ valid: false, skipped: true, unverified: true }`. `testSingleConnection` returns an unverified result without writing the row, as it already does for an outage. The route answers `skipped: true`, which the dashboard shows as "Skipped".

Kept: the guard and the refusal itself (nothing is sent, and there is no direct fallback); a real 401 or 403 from a direct connection still saves `error`; every other blocked result, outage and probe outcome is unchanged. Validation (`/api/providers/validate`) has no connection proxy and is unchanged.

### ChatGPT Web and Codex: a replaced cookie drops the saved browser state

The browser transport reads `providerSpecificData.storageState` before the stored cookie. An import or Edit that replaced the cookie left that state in place, so the browser kept the old session.

`src/lib/providers/browserStateInvalidation.js` decides, for `chatgpt-web` and `chatgpt-web-codex` cookie rows only, whether a write replaces the cookie of a row that holds a saved state. If so, the write also sets `storageState: null` and carries a compare-and-swap guard (`shouldCommitConnection`) that applies it only while the row still holds the cookie read before. Callers:

- `handleCookieImport` update branch (`src/lib/providers/cookieImport/handlers.js`): a lost race answers `409` and writes nothing.
- `PUT /api/providers/[id]` (`src/app/api/providers/[id]/route.js`): same, unless the request sets `storageState` itself.

Kept: the same cookie again, any other edit, other providers and every other `providerSpecificData` field (proxy, transport, user agent, locale). The existing pairing, provider-identity and refresh-context checks are unchanged. A cookie rotation captured from the old session carries the old `apiKey` and `storageState` in its refresh context, so the existing CAS in `updateProviderCredentials` refuses it; the suite checks that it cannot write the row back.

### ChatPlayground: no Cookie as Bearer

Both generic live catalog lookups (`warmRequestModelLimits` in `src/sse/handlers/chat/singleModel/providerHooks.js` and the OpenAI-style resolver in `src/shared/models/modelListCore.js`) now skip registry entries whose `authType` is `cookie`. ChatPlayground is the only cookie entry with an OpenAI-type `modelsFetcher`, so no other provider changes. The registry entry itself is unchanged.

Effect: chat and `/v1/models` no longer send `Authorization: Bearer __client=…` to `/api/models`. `/v1/models` lists no live ChatPlayground models until discovery is wired through the session helper (below). Dashboard discovery is unchanged; it still uses the raw-Cookie path the report describes.

## Not repaired

The owner chose to stop these two after the conflict below was raised. Neither is partially wired.

### ChatPlayground Test, Validate and discovery

Routing these through `inspectChatPlaygroundConnection` changes assertions in suites outside this unit: `cookie-flow-chatplayground-2034.test.js` (the "fails closed … skip the executor's Clerk mint" case and the discovery half of "dispatches chat and discovery …") and `provider-registration-apikey-batch-b.test.js` (the raw-Cookie probe and discovery cases). Their mocks answer `/me` with `{ user: {} }`, which the helper maps to `unsupported_me_identity_shape`. The helper's own handoff says that result must be classified unverified, never invalid or healthy, and that the `/me.id` guard is not source-backed.

Defects 2 and 3 of the ChatPlayground report remain. The next owner needs permission to update those cases, a classification of `unsupported_me_identity_shape` as unverified on the Test and Validate routes, and the discovery call from `fetchConnectionModels.js`, whose custom-resolver lines are owned by SyncQwenCloud21443.

### Arena session probe

The pinned source does establish a probe: OmniRoute `b15b2ee6`, `src/lib/providers/validation/webCookie.ts`, uses `GET https://arena.ai/api/me/pulse` and states 200 with a live cookie and 401 without one (its own live claim). The body of a 200 is not specified.

Wiring it in `src/lib/providerProbe.js` (which also serves the health monitor) makes `tests/unit/lmarena-provider.test.js` fail: it asserts that `probeRegistryProvider("lmarena", …)` treats an HTTP 405 as valid. `cookie-flow-lmarena-2034.test.js` has no 405 assertion. The unsafe one lives only in `lmarena-provider.test.js`, which this unit may not edit. So any cookie still passes Validate, Test and the health probe when arena.ai answers 405. `cookie-flow-lmarena-2034.test.js` is unchanged.

## Residual behaviour, not owned here

- **An optional cookie alone is still sent.** `runCapture` in `capture.js` only refuses an empty cookie list. A tab with `sso-rw` but no usable `sso`, or `lastActiveOrg` but no `sessionKey`, sends that optional cookie alone to the paired import URL. The server refuses it with "Required session cookie is missing or incomplete", stores nothing and spends the pairing. NoTrack's `nt_session` already behaved this way. The Grok and Claude suites now assert this. The fix belongs in `capture.js`, which the chunk/HAR repair owns.
- **HAR expiry.** The Claude suite's HAR-expiry case is untouched. The chunk/HAR repair owns it and is changing the parser. The orchestrator asked that this unit not finalise its Claude-suite edits until that result is integrated. This unit's Claude-suite edits do not touch that case, but they must be rebased onto that result.

## Tests

`tests/unit/register-cookie-repairs-2034.test.js`, 15 tests. It covers:

- Grok: capture, import, storage and executor for two accounts on two proxies, one account with both values and one without `sso-rw`; header import with and without `sso-rw`; route refusal of `cf_clearance` and `__cf_bm`.
- Claude: two imported accounts on two proxies. With `lastActiveOrg`, the imported account picks the same organization as a manual-paste control; without it, the first organization.
- Proxy refusal: proxied Test is unverified, sends nothing, has no direct fallback and leaves the row byte-identical; direct 401 and 403 still save `error`.
- ChatGPT: import update for both providers, then the browser and HTTP transports use the imported cookie through the row's proxy. Also: sibling unchanged, same-cookie re-import kept, Edit cases, another provider untouched, the CAS refusal on real SQLite and a stale rotation refused.
- ChatPlayground: neither Bearer lookup receives the connection; an API-key provider (`deepinfra`) still does. The live-catalog functions are recording stubs, so nothing is sent.

Changed source-flow suites. Only cases that asserted a proven gap now assert the repaired behaviour; every case is kept. The older cases run with the optional cookie absent, which stays valid, so their assertions are unchanged. New cases marked "gap 1 repaired" cover the cookie when present.

- `cookie-flow-grok-web-2034.test.js` (47 → 56 tests, 16 lines removed): the contract, plan and read assertions now expect `sso-rw`. The "sso-rw beside sso" refusal row is now an acceptance test. Refusal rows are added for `sso-rw` without `sso`, a duplicate, an insecure value and `__cf_bm`. The browser fixture holds `sso-rw` only when a case adds it. The dashboard inputs no longer carry `sso-rw`; new cases import it from a header, cURL and HAR and send both values. A new case shows a signed-out tab holding `sso-rw` (see residual). The removed lines are the gap assertions, the gap comment, the fixture's unconditional `sso-rw` and one table label.
- `cookie-flow-claude-web-2034.test.js` (43 → 48 tests, 19 lines removed): the descriptor and pairing assertions expect `lastActiveOrg`. The capture case's organization cookie now sits in another profile's store. The "organization cookie" refusal row is now an acceptance test. Refusal rows are added for no session, an insecure value and an injected `;`. The `LIMITATION` case expects unverified with the row unchanged. The `lastActiveOrg` `NOT PARITY` case expects the manual organization. New cases show capture with the cookie present and with only that cookie.
- `cookie-flow-chatgpt-web-2034.test.js` and `cookie-flow-lmarena-2034.test.js` had no gap assertion to replace and are unchanged.

### Fault injection

Each of the eight changed product files was reverted to the base, one at a time, in the private copy, and the own suite was run:

| Reverted | Failing own tests |
| --- | --- |
| `cookieImport/handlers.js` | 4 |
| `providers/[id]/route.js` | 1 |
| `test/testUtils.js` | 1 |
| `providerHooks.js` | 1 |
| `modelListCore.js` | 1 |
| `registry/grok-web.js` | 3 |
| `registry/claude-web.js` | 2 |
| extension `providers.js` | 4 |

### Commands and results

The runs used a private copy of the worktree under `/var/tmp` with `env -i`, an explicit `PATH`, `LANG` and `CI`, and private `HOME`, `DATA_DIR`, `TMPDIR` and `XDG_CACHE_HOME`. No credentials were set and each command had a 300 second ceiling. Dependencies were read-only links into an existing private install with the same lockfiles (root `e1d0bd42f8`, tests `beb0b904f4`). The copy has its own `node_modules` directory of links, so caches stay in the copy. Nothing was installed and the borrowed tree was not modified.

From `tests/`:

```sh
node node_modules/vitest/vitest.mjs run unit/register-cookie-repairs-2034.test.js unit/cookie-flow-grok-web-2034.test.js \
  unit/cookie-flow-claude-web-2034.test.js unit/cookie-flow-chatgpt-web-2034.test.js unit/cookie-flow-lmarena-2034.test.js --maxWorkers=2
```

Result: 5 files, 166 tests passed. With `unit/qoder-quota-112-disable.test.js`: 6 files, 182 tests passed.

Related suites, one run with `--maxWorkers=2`: `api/provider-cookie-import-local-storage`, `api/provider-cookie-import`, `chatgpt-cookie-rotation-race`, `chatplayground-provider`, `claude-web-provider`, `cookie-flow-chatgpt-web-codex-2034`, `cookie-flow-chatplayground-2034`, `fix-chatplayground-session-contract-2034`, `grok-web-empty-sso`, `grok-web-signin-parity`, `lmarena-provider`, `port-omni-20375-chatplayground-unified-api`, `port-omniroute-claude-web-chat-org`, `provider-cookie-capture-extension`, `provider-cookie-import-contracts`, `provider-cookie-import-dashboard`, `provider-cookie-import-validation-review`, the six `provider-cookie-lifecycle-*` suites, `provider-registration-apikey-batch-b-routes`, `provider-registration-apikey-batch-b` and `review-x-chatplayground`. Result: 26 files, 673 tests passed.

From the root: `eslint src` reported 0 errors and 348 warnings, and none of the warnings is in a changed file. The anti-slop gate reported 0 diagnostics across 3702 files. `scripts/check-docs.mjs` passed, and `gen-registry-index.mjs --check` reported the index up to date (no registry file was added, so it was not regenerated).

The `checks.sh unit` selection for this unit's actual changed files (`scripts/checks-select.mjs` over the 17 changed paths) was run in batches of 40 with `--maxWorkers=2` and a 295 second ceiling each. It selected 784 files with 12715 tests, and 2 failed. Both are in `omniroute-provider-audit.test.js`, which expects `git rev-parse --show-toplevel` to name the checkout. The private copy has no `.git`, so it returns an empty string. That is environmental and unrelated to this change.

Not run: the full `test:ci` inventory, build, any browser, Docker or live provider.

### Gate correction

The first gate run failed `unit/qoder-quota-112-disable.test.js`. The PUT route passed a third `undefined` argument to `updateProviderConnection`, and that test checks the exact arguments. The route now calls it with two arguments unless browser state is being invalidated. The gate also flagged removed lines. In `testUtils.js`, the original outage comment is restored verbatim. Both source-flow suites were rebuilt from the base with the minimal diff described above.

## Docs

- `docs/providers/web-cookie.mdx`: the Grok Web and Claude Web rows, plus one paragraph on proxied Test results.
- `docs/providers/claude-web.mdx`: the organization choice and proxied Test.
- `docs/providers/chatgpt-web.mdx`: the `storageState` row.
- `src/lib/providers/cookieImport/README.md`: the Grok and Claude rows, the optional-cookie list and the update-persistence rule.
