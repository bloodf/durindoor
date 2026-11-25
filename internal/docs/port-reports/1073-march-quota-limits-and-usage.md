# #1073 — March 2026 OmniRoute quota limits and usage dispositions

## Scope and verification

Four OmniRoute pull requests from the March 2026 window were compared against the current DurinDoor tree. Source metadata was recovered from `/var/tmp/durindoor-omni-early-metadata.gnjcuh68/2026-03.json` (287 records, all `MERGED`, complete `files` pages). For all four rows the recovered `headRefOid` and `mergeCommit.oid` matched the pins assigned to this unit, and `files.totalCount` equalled the number of `files.nodes` with `hasNextPage=false`, so the changed-path sets below are complete.

Each upstream patch was read as the exact merged diff, taken between the first parent of the merge commit and the merge commit itself in the upstream OmniRoute history (all four merge commits have exactly two parents — base plus head):

- `#301`: `git diff 542eb0e7195c814c0ca59eddec6a392fae11036c be6c769192d061c4b3b77f44b8be98a0ef71b1ea`
- `#309`: `git diff f494a8531b23f6e48d524983ec00d53c703df686 82f7a12a465baf7848bbc194efbcae4f4644301d`
- `#445`: `git diff 8359293dcd2bf410555c44664a29345f03f36e97 64797158e281cb9364a297952031ade7faa62205`
- `#495`: `git diff 38266bf2fff13e5cf6e683843e2b8f18d7d0a620 c496ebdef9347d3d917632cd9712f18dc0c829d2`

The upstream source tree was used as data only. The local comparison was static: each changed upstream path was matched to the DurinDoor path that carries the same behaviour, and the matched local file was read at its current revision on the assigned branch `orq/tornf6/audit-omni-march-quota-limits-and-usage-a1-l2`. Path names were never treated as evidence of parity — every disposition below cites the local line that carries, or fails to carry, the upstream behaviour. No network service was contacted, no credential was read or written, and no paid API, browser, Docker, e2e or full test suite was run.

DurinDoor is a JavaScript/JSX fork: upstream `.ts` paths have no literal local counterpart, so the mapping is by behaviour, and the local paths named in the table are the ones that actually own that behaviour.

| PR | Merged UTC | Head SHA / merge SHA | Upstream changed paths (complete) | Disposition |
| --- | --- | --- | --- | --- |
| [#301](https://github.com/cheaper-inference/OmniRoute/pull/301) | 2026-03-11T03:20:14Z | `a4276444b59d29cd860da6018251ca96535a8075` / `be6c769192d061c4b3b77f44b8be98a0ef71b1ea` | `open-sse/services/rateLimitManager.ts` | Already covered by local mechanism — no port required |
| [#309](https://github.com/cheaper-inference/OmniRoute/pull/309) | 2026-03-11T11:45:06Z | `46cff2200d37c96625d87e36780e319ecaf715b0` / `82f7a12a465baf7848bbc194efbcae4f4644301d` | `open-sse/services/usage.ts` | Already ported — parity confirmed |
| [#445](https://github.com/cheaper-inference/OmniRoute/pull/445) | 2026-03-18T15:06:59Z | `5a777bd59842497de65ff3ccbd378e7fee0c8791` / `64797158e281cb9364a297952031ade7faa62205` | `open-sse/services/usage.ts`; `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.tsx`; `tests/unit/copilot-usage.test.mjs` | Confirmed gap — existing runtime fix |
| [#495](https://github.com/cheaper-inference/OmniRoute/pull/495) | 2026-03-20T15:53:31Z | `c009c4060629700a99e8554376b63ff1643bea63` / `c496ebdef9347d3d917632cd9712f18dc0c829d2` | `open-sse/services/rateLimitManager.ts` | Not applicable — upstream mechanism absent locally |

## Classification

### Existing runtime fixes

One row carries a runtime fix on an existing provider that is not present locally: **#445**.

### New providers, features, and authentication flows

None of the four rows. No row adds a provider, a registry entry, a credential path, an OAuth or sign-in route, or an account-authorization flow, and none touches the provider registry (`open-sse/providers/registry/` locally), `src/app/api/oauth/**`, `src/lib/oauth/**` or `src/shared/components/OAuthModal.js`. All four rows therefore stay out of the Provider Sign-in lane.

## Existing runtime fixes — confirmed gap

### #445 — GitHub Copilot account-type quota limits and plan labelling

Upstream merged patch (three paths):

- `open-sse/services/usage.ts` rewrites `getGitHubUsage`. It adds `toRecord`-style normalization and `getFieldValue` snake/camel key lookup, replaces the fixed three-bucket `quotas` object with a conditionally populated map, adds `clampPercentage`, rewrites `formatGitHubQuotaSnapshot` to accept a `resetAt` argument and to derive `total`/`remaining`/`used`/`remainingPercentage` from `entitlement`, `total`, `remaining`, `used` or `percent_remaining`, and adds `inferGitHubPlanName` (with `toDisplayLabel`) so the plan resolves to `Copilot Pro+`, `Copilot Enterprise`, `Copilot Business`, `Copilot Student`, `Copilot Pro` or `Copilot Free` instead of echoing the raw `copilot_plan` / `access_type_sku` string. Buckets flagged unlimited with no total are dropped rather than reported as a zero-total row, the limited-plan branch gains `premium_interactions` plus `remaining`/`remainingPercentage` and clamps `used` to `total`.
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.tsx` skips unlimited buckets with `total <= 0` in the `github` case of `parseQuotaData`, carries `remainingPercentage` into the normalized row, adds a `Pro+` tier and a `Student` tier to `normalizePlanTier`, and stops mapping `INDIVIDUAL` onto the free tier.
- `tests/unit/copilot-usage.test.mjs` is added, covering a Business seat that hides unlimited buckets, and an `individual` paid plan that no longer normalizes as free.

DurinDoor comparison — the affected behaviour lives in three local places, and none of them carries the upstream change:

1. `open-sse/services/usage/github.js` is still at the pre-#445 shape. `getGitHubUsage` reads `data.quota_snapshots` directly with no record normalization and no snake/camel key lookup (`open-sse/services/usage/github.js:45`, `:48`, `:59`, `:62`), and the paid branch always emits the three fixed buckets `chat`, `completions` and `premium_interactions` with no unlimited-bucket filter (`open-sse/services/usage/github.js:53-57`). The limited-plan branch emits only `chat` and `completions` — `premium_interactions` is absent — and sets `used` from `limited_user_quotas` without clamping and without any `remaining` or `remainingPercentage` (`open-sse/services/usage/github.js:68-81`). `formatGitHubQuotaSnapshot` still derives `used` as `quota.entitlement - quota.remaining` with no `resetAt` parameter, no `total`/`used`/`percent_remaining` variants and no `remainingPercentage` (`open-sse/services/usage/github.js:91-99`). The plan is still the raw provider string (`open-sse/services/usage/github.js:51`, `:66`); there is no `inferGitHubPlanName`, `toDisplayLabel` or `clampPercentage` anywhere in the local tree, and no local `safePercentage` helper exists (`grep -rn "safePercentage" src/ open-sse/` returns nothing).
2. `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js` — the `github` case of `parseQuotaData` still pushes every bucket with no unlimited filter and drops `remainingPercentage` on the floor (`src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js:688-698`).
3. No local counterpart of `normalizePlanTier` exists. The upstream function is consumed by upstream's `ProviderLimits/index.tsx` (`normalizePlanTier(quotaData[conn.id]?.plan)`); the local dashboard instead renders the raw plan string through a fixed tone map `{ free, pro, ultra, enterprise }` (`src/app/(dashboard)/dashboard/usage/components/ProviderLimits/ProviderLimitCard.js:12`, `:22`, `:27`), so `Pro+` and `Student` have no tier and an `individual` paid plan has no tier.

The local `open-sse/services/quota/providers/github.js` is a separate admission-quota subsystem, not the dashboard path. It already normalizes `entitlement`/`total`/`used`/`remaining`/`percent_remaining`, keeps unlimited buckets as `limitKind: "unlimited"` rows, and treats `limited_user_quotas` values as remaining rather than used (`open-sse/services/quota/providers/github.js:31-111`). It does not infer a plan label (`open-sse/services/quota/providers/github.js:116-118`), it keeps unlimited buckets as rows rather than hiding them, and it is not consumed by the dashboard `parseQuotaData`. It therefore does not close the #445 gap, though it fixes the vocabulary a port must agree with.

Local extension that a port must preserve: `open-sse/services/usage/github.js:101-109` adds `creditsUsed` from GitHub's `credits_used` field, which upstream does not have.

Missing local evidence: there is no offline fixture for the affected dashboard path. `grep -rln "getGitHubUsage|quota_snapshots" tests/` and `grep -rln "parseQuotaData" tests/` return no test that exercises `getGitHubUsage` from `open-sse/services/usage/github.js` or `parseQuotaData("github", …)`. The upstream fixture `tests/unit/copilot-usage.test.mjs` has no local counterpart. The GitHub fixtures that do exist — `tests/unit/provider-quota-normalizers.test.js` and `tests/unit/provider-quota-fetchers.test.js` — cover only the `open-sse/services/quota/` admission subsystem.

### Focused implementation unit

Port upstream #445's GitHub Copilot quota normalization into the DurinDoor dashboard path:

- `open-sse/services/usage/github.js`: normalize the provider payload defensively, derive `total`/`remaining`/`used`/`remainingPercentage` from the `entitlement`, `total`, `remaining`, `used` and `percent_remaining` snapshot variants, clamp percentages to 0–100, hide unlimited buckets that carry no total, add `premium_interactions` and `remaining`/`remainingPercentage` to the limited-plan branch, resolve the plan label to a Copilot tier, and keep the local `creditsUsed` field intact.
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js`: in the `github` case of `parseQuotaData`, skip unlimited buckets with no total and carry `remainingPercentage` into the normalized row; give the plan badge the `Pro+` and `Student` tiers and stop mapping `individual` onto free.
- Add the missing offline fixture for this path (no local equivalent of `tests/unit/copilot-usage.test.mjs`), covering a Business seat that hides unlimited buckets and an individual paid plan that no longer reads as free.

Scope note: the unit touches the dashboard usage path only. It does not change the `open-sse/services/quota/` admission subsystem, and it must not change the sign-in or credential surface.

## Rows with no portable delta

### #301 — bounded queue wait for the rate-limit limiter

Upstream merged patch (`open-sse/services/rateLimitManager.ts`): adds `MAX_WAIT_MS = parseInt(process.env.RATE_LIMIT_MAX_WAIT_MS || "120000", 10)`, a `maxWait` entry in `DEFAULT_SETTINGS`, and `maxWait: MAX_WAIT_MS` on every limiter instance the manager creates, so a job cannot sit in the rate-limit queue indefinitely once all providers are exhausted after a 429.

DurinDoor comparison — the upstream mechanism does not exist locally, and the outcome it protects against is already produced by a different local design:

- There is no `bottleneck` dependency in `package.json` or `pnpm-lock.yaml`, no `open-sse/services/rateLimitManager.ts`, and no `getLimiter` / `withRateLimit` / `initializeRateLimits` / `updateFromHeaders` API. `open-sse/services/rateLimitManager/` contains exactly one file, `requestCap.js`, whose header records it as a port of upstream's `rateLimitManager/requestCap.ts` (`open-sse/services/rateLimitManager/requestCap.js:10`).
- DurinDoor does not queue behind a rate limit. Per-connection sliding-window caps are enforced by exclusion at selection time: `src/sse/services/rpmLimiter.js:54` (`isOverLimit`) and `src/sse/services/rpdLimiter.js:39` are consumed by `src/sse/services/auth.js:809`, `:877` and `:895` to drop over-cap connections from the candidate set, and `src/sse/services/auth.js:663` supports excluding a connection to retry with the next account. A request that arrives at an exhausted provider therefore fails fast rather than waiting for a reservoir to refill.
- The one queue that does hold waiting requests is the per-provider concurrency gate, and it already carries the hard wait ceiling upstream #301 introduces, at the same default: `open-sse/services/concurrencyGate.js:27-30` reads `CONCURRENCY_GATE_TIMEOUT_MS` and falls back to `120_000`, and the per-waiter timer at `open-sse/services/concurrencyGate.js:100-106` rejects with `ConcurrencyGateTimeoutError` when the ceiling is reached. The global payload-admission queue reuses the same ceiling (`open-sse/services/payloadAdmission.js:78-94`). Both are documented: `docs/reference/environment.mdx:128` and `docs/operations/payload-admission.md:14-15`.

Disposition: already covered by local mechanism; no upstream code to port. The upstream env name `RATE_LIMIT_MAX_WAIT_MS` has no local counterpart and is not needed, because the local ceiling is `CONCURRENCY_GATE_TIMEOUT_MS` and the rate-limit path it would bound does not queue.

### #309 — Claude quota utilization direction

Upstream merged patch (`open-sse/services/usage.ts`): in `getClaudeUsage`, `utilization` is reinterpreted as the percentage **used** rather than the percentage **remaining** — `used = safePercentage(window.utilization)`, `remaining = Math.max(0, 100 - used)` — reversing the previous `remaining = utilization` / `used = 100 - remaining` assignment.

DurinDoor comparison: parity confirmed. `open-sse/services/usage/claude.js:226-241` implements exactly the post-#309 semantics, with the same `Math.max(0, 100 - used)` clamp and the same `remainingPercentage: remaining` projection, and it carries the same rationale in its comment. The local `claude` handler is reached through `open-sse/services/usage.js:48` (`claude: (c) => getClaudeUsage(...)`).

Offline fixture: `tests/unit/claude-usage.test.js:28-29` feeds `five_hour: { utilization: 15 }` and `seven_day: { utilization: 42 }`, and `tests/unit/claude-usage.test.js:54-64` asserts `used: 15` / `remainingPercentage: 85` and `used: 42` / `remainingPercentage: 58` — the direction that #309 introduced. A reversed mapping would fail this fixture.

Disposition: already ported; no action.

### #495 — drop queued jobs on 429

Upstream merged patch (`open-sse/services/rateLimitManager.ts`): the 429 branch of `updateFromHeaders` no longer calls `limiter.updateSettings({ reservoir: 0, ... })`. It instead calls `limiter.stop({ dropWaitingJobs: true })` and deletes the limiter from the limiter `Map`, so queued requests fail immediately instead of hanging until the reservoir refreshes — which, for providers with long rate-limit windows, could be hours — and the caller can fall back to another provider.

DurinDoor comparison — the upstream failure mode is structurally absent, because there is no rate-limit reservoir and no rate-limit queue to hang in:

- No limiter `Map`, no `reservoir`, and no `stop({ dropWaitingJobs: true })` equivalent exist locally. The only Bottleneck-free limiters are the counting limiters `src/sse/services/rpmLimiter.js` and `src/sse/services/rpdLimiter.js`, which have no wait path at all.
- The fail-fast outcome upstream wanted is present through a different route. On a 429, `open-sse/handlers/chatCore.js:1722-1727` derives a cooldown or reset deadline, `open-sse/services/accountFallback.js` benches the account with exponential backoff, and the connection is excluded from the next selection so the request rotates to another account (`src/sse/services/auth.js:663`, `:809`). The client receives a 429 with `Retry-After` rather than a hung request.

Residual local observation, recorded for completeness and not claimed as a port gap: the concurrency-gate queue is not purged when a peer request receives a 429. `open-sse/services/concurrencyGate.js:132-150` hands the freed slot straight to the next queued waiter, which then dispatches into the provider that just returned 429. The gate exposes no public queue-purge API — the only queue-clearing function is `_resetGates()`, documented "for testing" and not wired to any 429 path (`open-sse/services/concurrencyGate.js:165-177`). This is a different mechanism from upstream's rate-limit limiter queue, and upstream #495 has no counterpart target in the DurinDoor tree, so it is recorded as an observation rather than as a porting gap.

Disposition: not applicable — upstream mechanism absent locally; the fail-fast-to-another-provider outcome is already provided.

## Evidence index

| Evidence | Location |
| --- | --- |
| Recovered metadata rows, changed-path sets, merge timestamps | `/var/tmp/durindoor-omni-early-metadata.gnjcuh68/2026-03.json` |
| Upstream merged patches read from upstream OmniRoute history | `open-sse/services/rateLimitManager.ts`, `open-sse/services/usage.ts`, `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.tsx`, `tests/unit/copilot-usage.test.mjs` at the merge pins above |
| Local rate-limit and admission mechanisms | `open-sse/services/concurrencyGate.js:27-30`, `:100-106`, `:132-150`, `:165-177`; `open-sse/services/payloadAdmission.js:78-94`; `src/sse/services/rpmLimiter.js:54`; `src/sse/services/rpdLimiter.js:39`; `src/sse/services/auth.js:663`, `:809`, `:877`, `:895`; `open-sse/handlers/chatCore.js:1722-1727`; `open-sse/services/accountFallback.js`; `open-sse/services/rateLimitManager/requestCap.js:10`; `docs/reference/environment.mdx:128`; `docs/operations/payload-admission.md:14-15` |
| Local Claude quota semantics and fixture | `open-sse/services/usage/claude.js:226-241`; `open-sse/services/usage.js:48`; `tests/unit/claude-usage.test.js:28-29`, `:54-64` |
| Local GitHub dashboard quota path (gap) | `open-sse/services/usage/github.js:45`, `:51`, `:53-57`, `:66`, `:68-81`, `:91-99`, `:101-109`; `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js:688-698`; `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/ProviderLimitCard.js:12`, `:22`, `:27` |
| Separate local admission-quota subsystem (not the dashboard path) | `open-sse/services/quota/providers/github.js:31-111`, `:116-118`; `tests/unit/provider-quota-normalizers.test.js`; `tests/unit/provider-quota-fetchers.test.js` |
| Local provider registry and OAuth surfaces, checked for sign-in scope | `open-sse/providers/registry/` (the local provider registry; there is no local `open-sse/config/providerRegistry.ts`); `src/app/api/oauth/[provider]/[action]/route.js`; `src/lib/oauth/`; `src/shared/components/OAuthModal.js` — none reached by any of the four upstream patches |

## Constraints observed

No provider was contacted, no credential or API key was read, written or rotated, and no paid API call was made. No browser, Docker, e2e or full test suite was run, and no network fetch was performed; the only external read was the already-present upstream history in the local OmniRoute source clone. No vulnerability detail, exploit path or evasion technique is reproduced here. This report is a disposition ledger for four rows and contains no selection list. No pull request was created, updated, watched, closed or merged, and nothing was pushed.
