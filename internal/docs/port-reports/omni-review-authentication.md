# OmniRoute provider sign-in, credentials and account connection flows parity census

Static parity comparison of OmniRoute sign-in, credential, and account-connection flows against DurinDoor at `origin/main` commit `a24152ee1` (`sync: Nov 26 pm4 upstream ports and provider epic reconcile (#2634)`).

Upstream state came from `gh api` only. No live provider endpoints were called. Changed files, PR patches, and commit lists were read from GitHub. Local evidence was re-checked against `a24152ee1` with `git grep`, because the worktree HEAD is 53 commits past the baseline. Only `src/sse/services/auth/accountErrors.js` and `open-sse/handlers/chatCore.js` among the files cited below differ from the baseline, and no cited claim depends on them.

| Source | State / Pin | Description |
|---|---|---|
| OmniRoute default branch | `release/v3.8.55` @ [`c003c973a8d9`](https://github.com/cheaper-inference/OmniRoute/commit/c003c973a8d981439f151c158d057e44be18bf82) (2026-11-26T18:30Z) | 121 commits ahead of `4de5c9b65f4c`, the prior census baseline ([omni-review-catalog.md](omni-review-catalog.md) and [1073-nov26-pm4-prs.md](1073-nov26-pm4-prs.md)) |
| OmniRoute open pull requests | 608 open PRs | 127 titles matched auth, credential, sign-in, session, or connection terms; 40 were dispositioned here |
| DurinDoor baseline | `origin/main` @ [`a24152ee1`](https://github.com/bloodf/durindoor/commit/a24152ee18a62f0e606bcc13048289956c3af118) | Verified against `src/lib/auth/`, `src/app/api/auth/`, `src/dashboardGuard.js`, `src/lib/oauth/`, `src/sse/services/`, `src/lib/db/repos/connectionsRepo.js`, `open-sse/services/`, `open-sse/executors/` |

Note on pins. Several existing ledger rows point at older PR heads (for example #21365 is recorded at `e658152889` while the current head is `936155426288`, and #20796 at `b3982c341839` while the current head is `ca9b63f8c667`). This report uses current heads. Full 40-character SHAs are given for open PRs. Merged commits are given as the 12-character prefix shown by the commit list.

## Census summary

| Classification | Count | Items |
|---|---:|---|
| **Verified candidate gaps (applicable, absent locally)** | 8 | #21247 / #19385 keyless readiness; #20796 SOCKS fail-closed and authenticated-SOCKS bridge; #21365 Devin CLI binary gate; #20328 Claude login-end metadata; #20352 opt-in dashboard session lifetime; #21131 `connection.auth_failed`; #21231 Chromium detection and rotated session (residual); #21350 NUL-equivalence hardening (residual) |
| **Held / owner decision (absent, high risk)** | 4 | #20296 OIDC inference tokens; #18587 Devin Auth password login; #18820 InfCode OAuth; #15153 Google / GitHub dashboard login |
| **Already present** | 11 | #21226, #21356, #21350 (default-password gate), #20692 (operator-control merge), #20798, #20368, #20062, #18737 (device flow, partial), #21190, #20525, #20993 (ledger only) |
| **Inapplicable** | 7 | #20239, #20809, #20537, #20562, #20287, #21314, #21037 |
| **Out of scope** | 10 | #21364, #19800, #19261, #18325, #21138, #20403, #20407, #21317, #21036, #21299 |
| **Total dispositioned** | 40 | |

Ledger rows that conflict with the evidence are corrected in section 3.

---

## 1. Verified candidate gaps

### 1.1 Keyless auto-routing readiness gate (merged)

- **Upstream:** OmniRoute PR #21247 (`fix(sse): require readiness for keyless auto routing (#19385)`), merged as `8255219c9406`. Readiness commits `e461e4115ed1` and `13f72b11ac00`. Changed paths include `open-sse/services/autoCombo/noAuthReadiness.ts`, `src/lib/providers/noAuthAutoRoutingReadiness.ts`, `src/shared/components/NoAuthAccountCard.tsx`.
- **Local targets:** [autoComboScope.js](../../../src/sse/services/autoComboScope.js), [autoComboResolver.js](../../../open-sse/services/autoComboResolver.js), [autoComboFamilies.js](../../../open-sse/services/autoComboFamilies.js), with the existing probe [keylessAvailability.js](../../../src/sse/services/keylessAvailability.js).
- **Evidence:** The local auto pool still includes public no-auth credentials. `autoComboScope.js:5-8` says so directly ("a scoped key never gets a public no-auth credential"). `isKeylessProviderWorking` (`keylessAvailability.js:101`) has exactly one consumer, `mediaRoutes.js:6,66`. `autoComboResolver.js` and `autoComboFamilies.js` contain no keyless, no-auth, or readiness check. Upstream gates keyless auto-routing on readiness, so a dead keyless provider can still be selected by an auto combo.
- **Correction to the ledger:** Existing rows call this "not applicable because `open-sse/services/autoCombo` is absent". That is a path argument. The behavior is implemented in `autoComboResolver.js` and `autoComboScope.js`, so the path does not settle applicability.
- **Porting scope:** Gate keyless candidates in the auto pool on the existing `isKeylessProviderWorking` probe. Add a unit test under `tests/unit/` for a dead keyless provider being excluded from `auto/` routing.

### 1.2 Authenticated SOCKS5 for gemini-web, plus fail-closed scheme handling

- **Upstream:** OmniRoute PR #20796 (`feat(gemini-web): bridge authenticated SOCKS5 proxies through a loopback listener`), current head `ca9b63f8c667ed015e73958cc163731ca2688424`. Adds `open-sse/utils/socksBridge.ts` (+353), `open-sse/utils/playwrightProxy.ts`, `open-sse/executors/gemini-web/proxyContext.ts`, and `open-sse/utils/executorProxy.ts`. The newer head also rejects unknown proxy types (ledger row 799).
- **Local targets:** [browserPool.js](../../../open-sse/services/browserPool.js) (`PLAYWRIGHT_PROXY_SCHEMES`, `resolvePlaywrightProxy`), [gemini-web.js](../../../open-sse/executors/gemini-web.js) (`resolveGeminiWebBrowserProxy`).
- **Evidence:** `browserPool.js:158-159` maps `socks4a:` and `socks4:` to `socks4` and forwards `username`/`password` from any SOCKS URL to Playwright (`resolvePlaywrightProxy`, lines 163-190). No loopback bridge exists: no `socksBridge` source file is present, and the only `socksBridge` string match is in a staged JSON file. Chromium does not perform SOCKS5 username/password authentication, so an authenticated SOCKS5 proxy for gemini-web is not usable as configured. This is a known Chromium limitation. It was not reproduced here.
- **Severity:** Medium for operators running gemini-web through authenticated SOCKS5.
- **Porting scope:** Port the fail-closed part first, which is the smaller change: reject unsupported schemes and authenticated SOCKS5 for browser proxies instead of forwarding them. Port the loopback bridge only if the owner wants authenticated SOCKS for browser providers. Test both.

### 1.3 Devin CLI binary gate in the auto pool

- **Upstream:** OmniRoute PR #21365 (`fix(auto-combo): skip unavailable credentialed Devin CLI`), current head `93615542628872496157d185686d19d3da884b5a`. Adds `open-sse/executors/devinCliBinary.ts`, which extracts `resolveDevinBin` and an advisory `isDevinBinAvailable()`. It filters the pool in `open-sse/services/autoCombo/virtualFactory.ts` (`if (providerId === "devin-cli" && !isDevinBinAvailable()) return false;`).
- **Local targets:** [devin-cli.js](../../../open-sse/executors/devin-cli.js), [autoComboResolver.js](../../../open-sse/services/autoComboResolver.js).
- **Evidence:** The only missing-binary handling in `devin-cli.js` is at line 227. It maps `ENOENT` to an error at call time, after a request has been routed. No pre-selection check exists in the auto pool. The same path-based caveat as 1.1 applies, so the ledger's "candidate only" status stands.
- **Severity:** Low to medium. A credentialed Devin CLI connection with no binary is selected, fails, and falls through.
- **Porting scope:** Add a cached availability probe for the Devin CLI binary and filter `devin-cli` candidates in the auto pool. Test with the binary absent.

### 1.4 Claude login-end metadata (`refresh_token_expires_in`)

- **Upstream:** OmniRoute commit `711fadde23d00e9a81302f7518dc4495a1f76beb` (PR #20328, `feat(oauth): keep when a Claude login ends (refresh_token_expires_in)`). Adds `refreshTokenExpiresAt` to `providerSpecificData` from `tokens.refresh_token_expires_in`, guarded against values outside `Date` range. Changed path: `src/lib/oauth/providers/claude.ts`.
- **Local target:** [providers.js](../../../src/lib/oauth/providers.js) (Claude `mapTokens`, lines 179-191).
- **Evidence:** `mapTokens` reads only `expires_in` and `refresh_token`. `git grep` for `refresh_token_expires|refreshTokenExpiresAt` over `src` and `open-sse` at `a24152ee1` returns nothing.
- **Correction to the ledger:** The ledger has this row as "not applicable (new metadata field)". That reason is not a valid exclusion. The field is absent, and its absence means owners cannot see when a Claude login ends before requests start failing.
- **Severity:** Low. Informational, with no behavior change in routing.
- **Porting scope:** Add the optional `refreshTokenExpiresAt` mapping in Claude `mapTokens`, plus a unit test in `tests/unit/` with the upstream value of 3 days.

### 1.5 Opt-in shorter dashboard session lifetime

- **Upstream:** OmniRoute commit `c250f8e35a14` (PR #20352, `feat(auth): opt-in shorter dashboard session lifetime via DASHBOARD_SESSION_MAX_AGE_HOURS`). Changed paths include `src/shared/utils/dashboardSessionToken.ts`, `src/app/api/auth/login/route.ts`, `src/server/auth/mfaRouteSupport.ts`, `src/app/api/settings/route.ts`.
- **Local target:** [dashboardSession.js](../../../src/lib/auth/dashboardSession.js) (`SESSION_MAX_AGE_SEC`, line 24).
- **Evidence:** The session lifetime is fixed at 24 hours (`SESSION_MAX_AGE_SEC = 24 * 60 * 60`). No env override exists.
- **What is already present:** The revocation half of PR #18054 (persist revocation across refresh and concurrent logout) is covered. `src/app/api/auth/logout/route.js` calls `rotateDashboardSessionEpoch` on a same-origin logout with a valid token, which invalidates every session. See section 4.
- **Severity:** Low. Hardening only.
- **Porting scope:** Add an opt-in lifetime setting bounded by the 24-hour default. Document it in `docs/`, and add a test that shows a shorter `exp` is honored.

### 1.6 `connection.auth_failed` webhook event

- **Upstream:** OmniRoute commit `aad491dac34c` (PR #21131, `feat(webhooks): connection.auth_failed names the account that failed auth`). Adds `src/lib/webhooks/connectionAuthFailed.ts` and a new event in `eventDescriptions.ts`. Changes `src/sse/services/auth.ts`.
- **Local target:** [webhooks/index.js](../../../src/lib/webhooks/index.js) (`WEBHOOK_EVENTS`, lines 28-34).
- **Evidence:** `WEBHOOK_EVENTS` contains `account.cooldown`, `account.reauth_required`, `quota.exhausted`, `provider.unavailable`, and `test.ping`. `git grep` for `connection.auth_failed` at `a24152ee1` returns nothing. `account.reauth_required` overlaps in meaning but does not name the failing auth event.
- **Severity:** Low.
- **Porting scope:** Add `connection.auth_failed` to `WEBHOOK_EVENTS` and emit it from the existing auth-failure path in `src/sse/services/auth.js`. Add a test that the payload names the account.

### 1.7 Chromium detection and rotated session for chatgpt-web-codex (residual)

- **Upstream:** OmniRoute PR #21231 (`fix(chatgpt-web-codex): detect Playwright Chromium, accept rotated session`), current head `7b37af76fe1f30f099632be6d17298e91146f635`. Changes `open-sse/executors/chatgpt-web-codex.ts` (+28/-5) and `open-sse/vendor/codex-chatgpt-web/persistent-cdp-context.ts`.
- **Local target:** [chatgpt-web-codex.js](../../../open-sse/executors/chatgpt-web-codex.js).
- **Evidence:** The vendored file does not exist locally, so the ledger's "not applicable (vendor absent)" is correct for the port as written. The behavior is a different question. `chatgpt-web-codex.js` contains no Chromium detection and no rotated-session acceptance (`grep` for `chromium|rotat` returns nothing). Whether the executor currently fails on a rotated session was not reproduced.
- **Severity:** Low. Residual, unverified.
- **Porting scope:** Read the upstream behavior, then decide whether the rotated-session acceptance belongs in the local executor. Do not port the vendor file.

### 1.8 Bcrypt NUL-equivalence hardening (residual)

- **Upstream:** OmniRoute PR #21350 (`fix(auth): refuse the default management password off-host by its stored hash`), head `985aee07b937c191bdda5038ce87234b378b2ff8`. Its main effect is already present (section 4). Its changelog and tests say bcryptjs appends a NUL and reads the key cyclically, so `CHANGEME\0CHANGEME` verifies as `CHANGEME`. The fix refuses NUL in inputs.
- **Local target:** [login/route.js](../../../src/app/api/auth/login/route.js) (`bcrypt.compare`, line 74 at `a24152ee1`). The package is `bcryptjs@^3.0.3` (`package.json:49`).
- **Evidence:** The NUL cycling claim comes from upstream's own tests. It was not reproduced locally. Local login would accept the same equivalent input for any password, not only the default. The attacker must already know the password, so the impact is limited to multiplicity of accepted strings. No escalation was found.
- **Severity:** Low. Hardening.
- **Porting scope:** Reject inputs containing `\0` before `bcrypt.compare` in the login path and in the CLI pairing route. Add a test with a NUL-containing equivalent input.

---

## 2. Held / owner decision (verified absent, high risk)

These are applicable and absent locally. Each needs an owner decision before porting because of credential handling, product scope, or licensing.

| PR | Head | Summary | Local evidence | Disposition |
|---|---|---|---|---|
| [#20296](https://github.com/cheaper-inference/OmniRoute/pull/20296) | `f5515666c4f8cf9c545a96881c3b95ba8ee4e643` | Accept OIDC access tokens for the inference API (`+2514/-87`, new `src/server/authz/oidcInference/*`) | No inference-side OIDC path. [oidc.js](../../../src/lib/auth/oidc.js) serves dashboard login only. | **Held, design first.** Upstream lists it as related to open #1113. Do not land a second token path in parallel. |
| [#18587](https://github.com/cheaper-inference/OmniRoute/pull/18587) | `ce43a725ca9e43375f7bd44dcd5fa9568cf58e9c` | Devin Auth email and password sign-in for devin-desktop (`+2240/-80`) | No email or password login. Checked `src/lib/oauth/providers.js` and [devin-desktop.js](../../../open-sse/executors/devin-desktop.js). | **Owner decision.** Password capture for a third-party account is high risk. |
| [#18820](https://github.com/cheaper-inference/OmniRoute/pull/18820) | `b1700ebf8d5baa0f3711b47eea5dfaeb65dd2cae` | InfCode OAuth provider (`+2427/-8`) | No `infCode` or `inf-code` symbol in `src` or `open-sse`. | **Held.** Needs an icon license and a live OAuth check (ledger). |
| [#15153](https://github.com/cheaper-inference/OmniRoute/pull/15153) | `f1694f9b4141b088f052b5816d22cae8d29e3645` | Native Google and GitHub OAuth login for the dashboard (`+3082/-25`) | `src/app/api/auth/` contains only `login`, `oidc`, `mfa`, and related routes. No Google or GitHub login route. | **Owner decision.** Changes the operator sign-in surface, so it needs a product and security review. |

---

## 3. Ledger dispositions to correct

Each row below conflicts with the evidence in this report. This report does not edit the earlier ledgers.

| PR | Ledger says | Evidence says | Corrected disposition |
|---|---|---|---|
| #20328 | "not applicable" and "pending" in different rows | Field absent at baseline | **Candidate gap** (section 1.4) |
| #20796 | "not applicable" (no `socksBridge`) and "port candidate" (row 799) | Scheme map forwards creds; no bridge | **Candidate gap**, fail-closed part first (section 1.2) |
| #20809 | "port candidate" and "not applicable" | `refreshSerializer.js` has no `Promise.race` lane timeout (`git grep` at baseline) | **Not applicable.** The "port candidate" row is stale. |
| #20798 | "port candidate" | `open-sse/utils/socksCredential.js:29-30` already refuses credentials over 255 bytes | **Already present** |
| #21247 | "Ported earlier", "Port candidate", and "Not applicable" in three rows | Path-based argument; behavior in `autoComboResolver.js` and `autoComboScope.js` | **Candidate gap** (section 1.1) |
| #21365 | Candidate only, head `e658152889` | Current head is `936155426288`; no binary gate in the auto pool | **Candidate gap** (section 1.3), current head |
| #20368 | "pending" | `src/app/(dashboard)/dashboard/providers/[id]/BulkImportGrokCliModal.js` `normalizeAccounts` (line 22) | **Already present** |
| #20062 | "pending" in one row, "ported in this change" in row 970 | `open-sse/executors/websession-utils.js:186` `isValidHttpHeaderName`; `windsurf.js:16,440` | **Already present** (row 970 is correct) |
| #21231 | "not applicable" (vendor absent) and "pending" | Behavior residual in `chatgpt-web-codex.js` | **Residual** (section 1.7) |
| #21037 | "deferred" (ledger head `96685174bbb7`; current `50080e49cbe1`) | `REQUIRE_API_KEY` absent from `src` and `open-sse` at baseline. Runtime guard is DB-backed. | **Inapplicable** to the environment default |
| #20537 | Batch "deferred upstream merge readiness" | `src/sse/services/auth.js:378` queries only the canonical `providerId` | **Not applicable** (section 4) |

---

## 4. Already present (one-line dispositions)

- **#21226** (`baf9d3a67091`): Already present. Permanent Codex refresh failures map to `unrecoverable_refresh_error` (`open-sse/services/tokenRefresh/providers.js:140,296,505`) and are pinned as `reauth_required` on the request and background paths (`src/sse/services/tokenRefresh.js`, around lines 253-292). Matches the ledger.
- **#21356** (`c7eb5ff042a0`): Already present, by a different mechanism. Foreign `Origin` is rejected (`src/dashboardGuard.js:105,343,378`). The open-dashboard fallback in `canAccessManagementApi` requires a loopback `Host` and `Origin` pair, so cross-site and DNS-rebinding pages are refused.
- **#21350** (`985aee07b937`): Already present for the default-password gate. `src/app/api/auth/login/route.js:86` calls `isUsingDefaultPassword(settings)`, and a remote caller receives 403 with no session. The gate is state-based, not input-based. The NUL residual is section 1.8.
- **#20692** (`f33e43c9df7f`): Operator-control preservation is already present. `src/lib/db/helpers/mergeProviderMetadata.js:12-18,34-35` merges `providerSpecificData` additively on re-login. The `cliUserID` part is inapplicable (section 5).
- **#20798** (`76c446addbee`): Already present. The 255-byte check is at `open-sse/utils/socksCredential.js:29-30`.
- **#20368** (`d6cf6205430093`): Already present. Bulk Grok CLI import exists as `BulkImportGrokCliModal.js`.
- **#20062** (`9d17eedd7980`): Already present. Token-name validation is at `open-sse/executors/websession-utils.js:186`, applied in `windsurf.js:440`. This report did not re-verify the write-side check in `src/lib/db/models/compat`.
- **#18737** (`68cf0df31246`): Partially present. The native device-token flow is in `src/lib/oauth/services/qoder.js:11-15`, and the Cantus fallback is in `open-sse/services/qoderModels.js:133`. The "Sonus" fallback named in the PR title was not found in the returned patch. This residual is unverified.
- **#21190** (`cd67384a3caa`): Already present. `src/dashboardGuard.js` `canAccessLocalOnlyRoute` keeps spawn-capable routes loopback-only and requires auth in open mode (ledger row agrees).
- **#20525** (`8d31012faf4d`): Already present. `open-sse/services/usage/codexCredentialBinding.js` and the refresh path in `src/sse/services/tokenRefresh.js` guard account identity.
- **#20993** (`83bb57a00243`): Ledger disposition retained (split; real outcomes already reach the connection). Not re-verified in this census.

---

## 5. Inapplicable

- **#20239** (`7b633a62f79f`): No Claude `cliUserID` or OAuth identity cache exists at baseline. `git grep` for `cliUserID` over `src` and `open-sse` returns nothing, and `open-sse/executors/base.js` has no identity cache.
- **#20692, `cliUserID` part** (`f33e43c9df7f`): Same reason. Operator-control preservation is covered in section 4.
- **#20809** (`7fce34363182`): No lane-timeout `Promise.race` in `open-sse/services/refreshSerializer.js`. The upstream race it fixes does not exist locally.
- **#20537** (`20bc820dee7a`): `src/sse/services/auth.js:378` queries only the canonical resolved provider id. The alias-pool concatenation that the PR reorders does not exist.
- **#20562** (`e87d3cceb57f`): No `open-sse/mcp-server` directory exists at baseline. The MCP HTTP caller-identity path is absent.
- **#20287** (`8179d4b74037`): No `CREDENTIAL_GATE_AUTH_DIAGNOSES_ONLY` flag and no credential-gate module exist (`git grep` at baseline). Ledger agrees.
- **#21037** (`50080e49cbe1`): The env-default `REQUIRE_API_KEY` guard does not apply. The variable is absent from `src` and `open-sse`, and the runtime guard reads a DB-backed setting. Ledger disposition "deferred" is superseded.
- **#21314** (merged `28e95dd7c9c2`): The k8s `REQUIRE_API_KEY` default does not apply. `REQUIRE_API_KEY` is absent from `src` and `open-sse`, and `deploy/kubernetes/deployment.yaml` sets no such variable. Ledger agrees.

---

## 6. Out of scope (one-line dispositions)

- **#21364** (`91b54071eeec`), **#19800** (`ab57cc955c63`), **#19261** (`5f1dd348f829`): API-key provider catalog additions. Owned by [omni-review-catalog.md](omni-review-catalog.md).
- **#18325** (`c58554da587c`): Google Flow Web media provider with a web-session component. Catalog and media scope.
- **#21138** (`47755e06d07a`): Argon eligibility per account is quota eligibility. Ledger carried port candidate.
- **#20403** (`56db790bda86`), **#20407** (`046ef3c12b55`): Quota readers. Quota scope.
- **#21317** (`04ed7c844f31`): Prompt-cache affinity scoped to sessions. Cache scope.
- **#21036** (`23a068f0b61b`), **#21299** (`8748084742e6`): CI and lockfile hardening. CI scope.
- Merged default-branch CI and dependency commits in the window (`25b80c153535`, the test-only `#21297`): out of scope.

---

## 7. Method and limits

- Upstream reads used `gh api` only. Commands: branch head, `pulls?state=open` pagination, `compare/4de5c9b65f4c...c003c973a8d9` for the 121-commit window, `pulls/N/files`, and `contents` for one file.
- Local evidence was re-checked against `a24152ee1` with `git grep`. Working-tree reads at HEAD were used only where the baseline and HEAD agree on the cited file.
- `.env.example` was not read. Access to that path was denied by the sandbox. Claims about environment defaults rely on runtime code and `deploy/kubernetes/`.
- The bcryptjs NUL behavior (section 1.8) and the Chromium SOCKS5 authentication limitation (section 1.2) are upstream or known-platform claims. They were not reproduced in this census.
- No production code, issues, dependencies, or services were touched.
