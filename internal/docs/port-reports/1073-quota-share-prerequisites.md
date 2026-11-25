# #1073 row 98: quota-share prerequisites and port sequence

This plan maps the prerequisites that the [complete row 98 report](1073-nov24-row-98-complete.md) names (P1–P3) and its nine gap groups (G1–G9) onto DurinDoor. That report and the reports it cites ([partial row 98](1073-nov24-row-98.md), [ob00](1073-nov22-verify-ob00.md), [ob01](1073-nov22-verify-ob01.md), [ob02](1073-nov22-verify-ob02.md), [ob03](1073-nov22-verify-ob03.md), [ledger c](1073-nov21-open-ledger-c.md)) keep their dispositions. This file repeats none of their constituent work and changes none of them. It adds dependency, ownership, boundary and sequencing evidence only. It implements nothing and claims no port.

Checked on 2026-11-24. Local head `da0a51c6fe2de063447a1f5047b1549779ff6099`. Upstream objects used: row 98 merge `009d1a65472947c8bc25795c65aaaef14116bdf0`, first parent `d9db7fa004ba82ddb72fe0d19f5a7bcfbe549891`, merge base `eaf57c1cc11aaea9b6cee6de04308fdfc9d2fffb`, and the nine PR heads listed in the row 98 report. All were present in the `omniroute-upstream` partial clone; file contents came from `git archive 009d1a65`.

## Method

1. `git diff --name-status d9db7fa0 009d1a65` gave the 111 `src/` and `open-sse/` paths that row 98 adds or changes.
2. Every relative, `@/` and `@omniroute/open-sse/` import of those files was resolved against the upstream tree at `009d1a65`. An import is a **prerequisite** when its target exists upstream before row 98 and row 98 does not change it. Each prerequisite was matched to a local file by path stem (`.js`/`.ts`).
3. Prerequisites are split into **real dependencies** (behavior or data that the feature reads and that DurinDoor does not have) and **missing code** (infrastructure that DurinDoor already provides under another name or that a port replaces with a local helper).
4. `gh pr list -R bloodf/durindoor --state open` (12 open PRs) and `gh pr view <n> --json files` checked file overlap. Open issues and remote branches were checked for the UI rewrite and sign-in tracks.
5. `internal/docs`, `docs` and `AGENTS.md` were searched for recorded owner vetoes or owner decisions on these features.

## Prerequisite subsystems

| Id | Upstream files at `d9db7fa0` | Origin (examples) and recorded prior disposition | Local owner today | Real dependency for |
|---|---|---|---|---|
| P1 Quota Share pools | `src/lib/quota/**` (30 files: `QuotaStore`, `enforce`, `fairShare`, `planResolver`, `planRegistry`, `schedules`, `quotaCombos`, `quotaKey`, `connectionProvider`, `sqliteQuotaStore`, `redisQuotaStore`, `boundedMap`, …); `src/lib/db/quota{Pools,Groups,ModelCaps,Consumption,Schedules,Snapshots,ResetEvents,RecoveryTickets}.ts`; migrations `078`, `085`–`088`, `106`, `107`, `189`, `217`, `227`; `src/app/api/quota/**` (11 routes); dashboard `costs/quota-share/**` (18 files) | `07d6a176` quotaPools CRUD and `8a10b3ec` QuotaStore facade (2026-05-27); #3022 Pool Groups and #3032 Quota Share v2 are **unresolved** in [june1](1073-june1-row-dispositions.md); #2389 is **unresolved** in [may-recovered-2](1073-may-recovered-2-dispositions.md) | None for pools. Adjacent, not equivalent: provider quota snapshots (`src/lib/db/repos/quotaSnapshotsRepo.js`, migration `007`), dispatch reservations (`quotaReservationsRepo.js`, `008`), per-key limits (`src/lib/apiKeyLimits.js`), vocabulary (`src/shared/constants/quota.js`), dashboard `dashboard/quota` | G2 (pool view), G4, G6, G7, G8, G9; S1 consumer `saturationSignals` |
| P2 API-only bridge | `src/lib/apiBridgeServer.ts` (second listener that proxies an allow-list of API paths) and its imports `ipUtils`, `runtime/ports`, `trustProxyMode`, `runtimeTimeouts`, `httpClientAbortGuard` | `d0138a50` (2026-02-26) "enhance port configuration and API bridge support"; `1bc23eb0` (#15047) and `11386ca4` (#16745) later. No prior row records a disposition by these SHAs | None. DurinDoor serves dashboard and API from one Next.js server; `API_PORT` appears only as a fallback port read in `open-sse/config/providerPluginManifest{Client,Url}.js` | G1, G5, G8 |
| P3 route classifier, flags, self-service accounts | `src/server/authz/**` (20 files); `src/shared/constants/featureFlagDefinitions*.ts` and `featureFlagTypes.ts`; `src/shared/utils/featureFlags.ts`; `src/shared/constants/selfServiceScopes.ts` (`a15750d9`, #2908); `src/lib/usage/apiKeySelfService{,Accounts,Limits,ListPrice,Shared}.ts` | #14771 (`0a60ca93`) is **sensitive surface; high-level disposition only** in [november-recovered-1](1073-november-recovered-1-dispositions.md) and **unresolved** in [november-01-19](1073-november-01-19-row-dispositions.md) | Route auth: `src/dashboardGuard.js` (`PUBLIC_PREFIXES` includes `/api/v1`; `/api/usage/me` safe-method allowance), `src/proxy.js`. Key auth: `resolveClientApiKey` in `src/sse/services/auth.js`. Key metadata: `src/lib/db/repos/apiKeysRepo.js` (`policy` JSON, `isAdmin`; no `scopes`). Settings: `settingsRepo.js`. No feature-flag catalog. Self usage: `src/app/api/usage/me/route.js`, `src/app/api/v1/me/sessions/route.js` | G2–G5 gate; G4/G5 route classification |

P1–P3 dispositions stay where the earlier rows put them. This plan records only that the row 98 groups need them.

## Group dependencies

"Real" lists behavior or data that must exist first. "Missing code" lists upstream modules that a port maps to an existing local owner or a small local helper; they are not ordering constraints.

| Group | Real dependencies | Missing code (local replacement) | Local owner of the change | Security or data boundary | Upstream tests to port |
|---|---|---|---|---|---|
| G1 #20793 dot-segment refusal (`fa084e32`: 38 lines in `apiBridgeServer.ts` + `api-bridge-path-allowlist.test.ts`) | P2 | — | New only if P2 is adopted | Path allow-list on a second listener | `tests/unit/api-bridge-path-allowlist.test.ts` |
| G2 #20767 `GET /v1/me/quota/{provider}` | P1 (`buildQuotaSelfView` reads pools, schedules, plan windows); P3 self-service settings (`apiKeySelfServiceSettings.sharedQuotaProviders`) | flag (setting), `self:usage` scope (key policy), logger, `publicApiBaseUrl`/`publicOrigin` | `src/app/api/v1/me/`, `src/lib/quota/` (new) | Key holder reads pool names, schedule labels, account windows; must keep the S4/row 98 checks already in `/api/usage/me` (per-call key row, connection scoping) | `self-service-auth`, `api/v1-me-quota-route`, `api/v1-me-quota-e2e`, `api-key-self-service-accounts` |
| G3 #20787 `GET /v1/me/usage` | G2's auth gate only (`src/server/selfService/auth.ts`, flag, scope). **No P1 data**: the only P1 import is `boundedMap` (a bounded cache helper) | `usageAnalytics` + `apiKeyScope` source (local `usage_history.api_key_id`, migration `030`), `costCalculator`/`analyticsPricing` (local `pricingRepo`, `nativePricing`), retention setting (local `src/lib/dataRetention`), `numeric`, logger | `src/app/api/v1/me/usage/` (new), `src/lib/db/repos/usageRepo.js` | Per-key rows only (`6a2df0ba`, `52d5965b`); no connection, account, other key or request id on the wire; `Cache-Control: no-store` | `api-key-self-service-usage`, `api/v1-me-usage-route`, `self-service-auth` |
| G4 #20843 public `/quota/[provider]` page | G2, G3; P3 classification of a public, flag-gated page | `Icon`, `Checkbox`, `OmniRouteLogo`, `apiKeyMask`, chart colors (local UI kit) | `src/app/quota/` (new), `src/proxy.js`, `src/dashboardGuard.js` | Unauthenticated page; API key typed in browser and kept in session or device storage (`keyStore.ts`); must 404 when off (S5) | `quota-self-usage-rows` and page/component tests in the diff |
| G5 #20856 `QUOTA_PANEL_PORT`/`QUOTA_PANEL_HOST` listener | G4; P2 (`quotaPanelBridge.ts` reuses the bridge and `bridgeBoundedBody.ts`) | — | New listener | New network listener; default host `127.0.0.1`; bounded connections, header and body timeouts | panel bridge tests in the diff |
| G6 #20822 percent-plan ledger (#19904) | P1 (consumption, plan registry, store); S1 Claude usage read timestamp; S3 cleanup | migration format (local numbered `.js`), logger | `src/lib/quota/`, `src/lib/db/migrations/`, `src/lib/usageDb.js` reset, `src/app/api/usage/reset/route.js` | New per-key attribution tables; retention and purge must ship together (S3) | `serial/quota-percent-external-usage` and ledger tests in the diff |
| G7 #20855 consented lending | G2, G6, P1 | `compliance` audit, `rateLimiter`, `bodySizeGuard`, S6 `SegmentedControl` hint | `src/lib/quota/`, `src/app/api/v1/me/quota/`, dashboard quota-share UI | **Write path for a key holder**: consent changes how a pool shares capacity; needs audit, rate limit, body limit, idempotence | `api/v1-me-quota-lending` and lending tests in the diff |
| G8 #20873 lending relay on the panel port | G5, G7 | — | panel bridge | Relays a write through the panel listener | relay tests in the diff |
| G9 #20878 lending card | G4, G7, G8 | UI kit primitives | `src/app/quota/` | Consent UI | lending card tests in the diff |

S2 and S4 need no work (row 98 report). S1, S3, S5 and S6 move with G6, G6, G4 and G7.

## Open DurinDoor work that overlaps

- **UI rewrite (v5).** Tracked by #2305 (duplicate primitive sets, raw fetches), the `origin/v5/*` and `origin/orq/tornl2/v5-ui-integration` branches, draft #2430 (combos editor extraction) and #2483 (OmniRoute UI kit adoption intake, docs only). G4, G7's dashboard parts and G9 add pages and components on top of the primitive set that this work is replacing. They should wait for the UI kit disposition in #2483 and use whatever primitives v5 settles on. G3 and G2 are API-only and do not touch the UI.
- **Sign-in work.** #2034 (provider sign-in parity), #2495 (OAuth native ESM), #2492 (agy refresh spacing) and drafts #2486 and #2481 (both change `src/dashboardGuard.js` and `src/lib/oauth/**`). Provider OAuth does not overlap any group. The `dashboardGuard.js` changes in #2486/#2481 do overlap the S5 gate that G4 and G5 need; land those first or rebase on them. Issue #2271 (two `hasExactRequestOrigin` contracts, six overlapping path lists) owns route-auth consolidation, which is the local home for P3's classifier role.
- **Executor quota dispatch.** Issue #2308 (about 70 executors skip quota dispatch) affects whether P1 enforcement would see every request. It blocks P1 enforcement parity, not G3.
- No open PR touches `src/app/api/v1/me/`, `src/app/api/usage/me/`, `usageRepo.js`, `apiKeysRepo.js` or `settingsRepo.js`.

## Owner decisions

No owner veto is recorded for quota share, self-service quota or usage, lending, percent attribution, the API-only port or the quota panel port. The search in [Method](#method) found owner-decision records only for unrelated items (`02c66fe2` default-key provisioning, `strictChatHistory`, leaderboard sources). The following are **open design choices** for the implementing PRs, not vetoes:

1. Whether DurinDoor adopts a second listener at all (P2, and therefore G1, G5, G8). Without it those three groups have no local target.
2. How the self-service gate is configured locally (a setting, default off, as upstream's `QUOTA_SELF_PANEL` is) and whether `self:usage` becomes a key policy field. Upstream adds `self:usage` to every new key (`normalizeSelfServiceScopesForCreate`); local `/api/usage/me` and `/api/v1/me/sessions` already answer any stored key without a scope.

## Port sequence

Each step is a vertical slice with its own tests and docs.

1. **G3 with the G2 auth gate** — first unit, detailed below. Needs no P1–P3 port.
2. **P3 slice for G2**: local self-service settings (`sharedQuotaProviders`) on the key record. Small, data-only.
3. **P1 core**: pools, allocations and the store, with the `sqliteQuotaStore` path only, migrations rewritten in the local numbered format, management routes under `/api/quota/**`. Coordinate enforcement with #2308. This is the largest step; split it by store, routes and enforcement.
4. **G2** `GET /v1/me/quota/{provider}` on top of steps 1–3.
5. **G6** percent ledger with S1 and S3 (retention and purge together).
6. **G4** public page with S5, after the #2483 UI decision and after #2486/#2481 settle `dashboardGuard.js`.
7. **G7** lending (write path, audit, rate and body limits) with S6.
8. **G9** lending card.
9. **P2, then G1, G5, G8**, only if design choice 1 is accepted. G1 can follow P2 directly; G5 and G8 need G4 and G7.

This keeps the row 98 report's dependency order (G1, G2, G6, G3, G4, G5, G7, G8, G9) except that G3 moves first, because its only real dependency is the G2 auth gate, which it carries.

## First independently implementable unit

**Self-service usage report: `GET /api/v1/me/usage` (also `/v1/me/usage` through the existing `next.config` rewrite).** Upstream source: `src/server/selfService/{auth,usageHandler}.ts`, `src/lib/usage/apiKeySelfServiceUsage{,Cache}.ts`, `src/lib/db/usageAnalytics/apiKeyScope.ts`, `src/shared/schemas/selfUsage.ts`, `src/app/api/v1/me/usage/route.ts` at `009d1a65`, including fixes `6a2df0ba` and `52d5965b`.

Behavior:

- Gate order as upstream: feature setting (off → 404), header credential via `resolveClientApiKey(request, { required: true })`, key row re-read with `getApiKeyById` on every call (401 if missing), then the scope check from design choice 2 (403).
- Query `range` ∈ `1d|7d|30d|90d`, default `30d`; anything else 400.
- Response matches `selfUsageResponseSchema`: `range`, `generatedAt`, `coverage` (`from`, `to`, `retentionDays` from the local data-retention setting, `truncatedByRetention`), `summary`, `daily`, `dailyByModel`, `byModel` (top 50 provider/model pairs, `byModelTruncated`). `costUsd` is billed cost; `listPriceUsd` is local list price.
- Reads only `usage_history` rows whose `api_key_id` equals the caller's key id. It never reads daily summaries, which carry no key. Nothing about connections, accounts, other keys or request ids reaches the body.
- The final body is built from an explicit allow-list; every response has `Cache-Control: no-store`; failures return one fixed 500 message and log the cause server-side.
- Bounded per-key cache, as `apiKeySelfServiceUsageCache.ts` does with `boundedMap`.

Files (expected): `src/app/api/v1/me/usage/route.js` (new), a self-service gate helper next to `src/app/api/v1/me/` or in `src/lib/usage/`, a per-key range reader in `src/lib/db/repos/usageRepo.js`, the gate setting in `settingsRepo.js` defaults, and, if design choice 2 adds it, a policy field in `apiKeysRepo.js` normalization.

Tests: port the cases of upstream `tests/unit/api-key-self-service-usage.test.ts`, `tests/unit/api/v1-me-usage-route.test.ts` and `tests/unit/self-service-auth.test.ts` into `tests/unit/` (gate order, 404 when off, 401 for unknown or deleted keys, 403 without the scope, range validation, other keys' rows excluded, top-50 truncation, retention coverage, no-store header). Keep `tests/unit/usage-me-route.test.ts` passing unchanged.

Documentation: add the route to `docs/reference/api.mdx` (contract, gate, scope) and the gate setting to the matching settings reference; carry the upstream changelog fragment content into DurinDoor release notes, as the row 98 report says for `changelog.d/`.

## Summary

- P1 (Quota Share pools) is a real dependency of G2, G4, G6, G7, G8 and G9. P2 (API-only bridge) is a real dependency of G1, G5 and G8. P3 contributes the gate, scope and classification; locally those map to `dashboardGuard.js`, `resolveClientApiKey`, the key policy and settings.
- G3 has no real P1–P3 dependency beyond the G2 gate it carries, so it is the first independently implementable unit.
- Overlaps: v5 UI work (#2305, #2430, #2483) for G4/G7/G9; `dashboardGuard.js` in drafts #2486/#2481 for G4/G5; #2308 for P1 enforcement; #2271 for route-auth consolidation.
- No owner veto is recorded. Two design choices (second listener; local gate and scope) are left to the implementing PRs.
