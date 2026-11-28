# Verification: OmniRoute #21408 search failover (candidate from 69b48757c9)

**Verdict: DROPPED as an existing defect.** The described behavior is an absent optional upstream feature (cross-provider `searchProviderOrder` for hosted search), not a regression or a broken contract in this tree. The candidate report's "concrete missing behavior (medium)" label is not supported. Upstream PR #21408 itself was not inspected in this pass; all statements below are about the two local snapshots.

## Scope and snapshots

- Candidate report: `git show 69b48757c9:internal/docs/port-reports/review-omni-21408-search-failover-citations.md` (7 lines, docs only).
- `origin/main` snapshot: `29490b783e83176d4d6a4162f76ee3dc79db66ea` (`fix(usage): reconcile observed quotas and cache creation aliases (#2690)`), tree `ba241eb7e1ff2a3840359ad583320c5645090c69`.
- Frozen train snapshot: `32a783d76d45d90bf0517015442f43fadd96106c` (`merge: include #2683 in train/2`), tree `fd449b3cefa538d912c3b51dee0ed774ede580e6`.
- Worktree HEAD at review time: `c8a757e8c0`, branch `orq/tp3r51/verify-omni-21408-a1`, clean.
- Both trees were compared as objects; no branch labels were relied on.

## Checks and results

### 1. Search-path source identical between main and train: CONFIRMED

```
git show 29490b78…:open-sse/handlers/search/index.js > main-index.js
git show 32a783d7…:open-sse/handlers/search/index.js > train-index.js
cmp main-index.js train-index.js        -> SAME_INDEX
git diff --stat 29490b78… 32a783d7… -- open-sse/handlers/search src/sse/handlers/search.js \
    open-sse/translator/concerns/search.js src/lib
 -> 3 files changed (src/lib/modelAutoSync/catalog.js, src/lib/usage/geminiApiKeyQuotaAdapter.js,
    src/lib/usage/xaiQuotaAdapter.js); no search-path file differs.
```

### 2. Same-provider-only retry in `handleSearchCore`: CONFIRMED (behavior as described)

`open-sse/handlers/search/index.js`, main snapshot:

- `:26-27` `GLOBAL_TIMEOUT_MS = 15000`, `NON_RETRIABLE = {400,401,403,404}`.
- `:277` `handleSearchCore({ body, provider, providerConfig, credentials, log, onRequestSuccess })`. It takes a single `provider`. No provider list is accepted or iterated.
- `:284-305` one attempt: dedicated `tryDedicatedProvider` if `providerConfig`, else `handleChatSearch` for the same provider.
- `:318-335` on retriable failure, it calls `handleChatSearch` again with the same `provider.id` and `model: provider.searchViaChat.defaultModel`. This is the only retry.
- `:340` returns the error.

Callers, checked with `git grep -n handleSearchCore 29490b78…`: only `src/sse/handlers/search.js:230` and `:280`. No other module (including any chat/hosted-tool translator) dispatches to dedicated search providers. Hosted web search in chat requests is translated and sent to native model providers (`open-sse/translator/concerns/search.js`, `open-sse/translator/response/responses-to-claude.js`), not through this core.

### 3. `searchProviderOrder` / hosted-search provider preference absent: CONFIRMED (absent)

```
git grep -n -i -E 'searchProviderOrder|preferredSearch|search_provider_order|searchPreferred|executeWebSearch' 29490b78… -- ':!docs' ':!internal/docs'   -> no output
same against 32a783d7…                                                                              -> no output
git ls-tree -r --name-only 29490b78… -- src/lib/search   -> empty
git ls-tree -r --name-only 32a783d7… -- src/lib/search   -> empty
```

So the upstream `src/lib/search/executeWebSearch.ts` and `searchProviderOrder` setting do not exist in either snapshot. This is an absent optional feature, not a broken existing one.

### 4. The report's `/v1/search` citation `src/sse/handlers/search.js:230-238`: PARTLY ACCURATE, INCOMPLETE

- `:229-238` is the **no-auth** branch only (`resolvedProvider.noAuth`). It calls the core once and returns `result.response`.
- The authenticated path is `runMediaAccounts` at `:245-296`. `runAttempt` (`:274-294`) calls `handleSearchCore` at `:280`, and `selectCredentials` (`:255`) rotates **accounts of the same provider** on failure (`onFallback` at `:295`). The candidate report does not mention this account-level failover.

### 5. Existing cross-provider ordered fallback: CONTRADICTS "no ordered cross-provider attempt list" as a general statement

- Default route (no provider given): `src/sse/handlers/search.js:76-88`. `resolveMediaRoute("webSearch")` (`src/sse/services/mediaRoutes.js:127-131`) feeds `handleComboChat`, with `defaultRouteComboOptions("webSearch")` (`mediaRoutes.js:134-142`): `comboStrategy: "fallback"`, `autoSwitch: false`, "strict order, no rotation". This is an operator-ordered cross-provider fallback.
- Named combos: `src/sse/handlers/search.js:107-142`, `handleComboChat` with `comboStrategy` from `settings.comboStrategies` / `settings.comboStrategy` (default `"fallback"`), `comboRouting` (`getComboRoutingPolicy`).
- UI: `src/app/(dashboard)/dashboard/media-providers/web/page.js:127,158` exposes a "Web Search" section with `searchCombos` and `onCreateCombo("webSearch")`, so operators already configure ordered provider lists for web search.

The candidate's remark that "the local route's existing combo fallback remains separate behavior" is correct, but the headline claim that hosted search cannot honor an operator preference across providers is only true for the new `searchProviderOrder` setting, which does not exist here.

### 6. Is a direct, single-provider request expected to fail over to other providers? NO contract found

A request naming `provider` X is routed by `handleSingleProviderSearch` (`src/sse/handlers/search.js:146-297`) to X only. The code and existing tests treat a named provider as the explicit choice (`tests/unit/glm-web-search.test.js`, `tests/unit/combo-connection-allow-list.test.js`, `tests/unit/media-routes-handlers.test.js` mock or exercise single-provider behavior). A grep of `tests/` on main for search fallback/failover (`git grep -n -i -E 'search.*(fallback|failover)|(fallback|failover).*search' 29490b78… -- tests`, excluding combo matches) found no test asserting cross-provider failover for a named provider. Search tests that mention fallback cover normalization, the OpenAI-fallback guard, and per-connection fallback state. So the "transient first-provider failure" scenario is not a defect in existing behavior.

### 7. Issues and lane ownership

- `gh issue view 2266 --json number,title,state,labels` -> OPEN, `[low] Combo routing: 2348-line combo.js, inconsistent runtime-state convention, O(n) affinity prune per request`, labels `review`, `architecture`.
- `gh issue view 2289 --json number,title,state,labels` -> OPEN, `[medium] Compression split across three stages and config sources; headroom stack engine always assumes OpenAI; dead compact.js`, labels `review`, `architecture`.
- **Discrepancy:** the brief describes #2266/#2289 as auth-owned. Their titles are combo-routing and compression findings. Ownership should be checked by the lane owner; neither issue concerns search or auth as titled.
- `gh issue list --state open --search "search failover in:title,body" --limit 10` -> `[]`. No open search-failover issue exists.
- Existing port reports touching search on main (`internal/docs/port-reports/`): `1072-*-search-*`, `1073-search-credential-destination.md`, `1073-march-existing-media-and-search.md`. None covers #21408. The candidate report exists only on the review commit.
- Sync-lane files (current usage / shared refresh: `src/lib/usage/*`) were not modified and are not in this search path. The only shared touch point is `clearAccountError`/`recordApiKeyUsageForResponse`, which are unchanged.

### 8. Runtime reproduction: NOT COMPLETED (source-only, by brief)

- An isolated import of `open-sse/handlers/search/index.js` from a `git archive` of `29490b78…` (`/var/tmp/verify-omni-21408/snap.*`, env stripped, fresh HOME/DATA_DIR/TMPDIR) failed immediately:
  `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'undici' imported from .../open-sse/utils/outboundUrlGuard.js`.
- The search path also imports `uuid`, `socks-proxy-agent`, and `@/lib/usageDb.js` (alias). The worktree has no `node_modules`. I did not install dependencies, since the brief said source-only review needs none. No runtime result is claimed.
- The verdict therefore rests on the code trace in sections 2–6, which is decisive because the claim is about the absence of a feature, and the single-provider signature makes that absence structural.
- Upstream PR #21408 (head `fb5a98cca7…`, base `release/v3.8.55`) was not fetched or read. The PR-level claims are unverified here.

## Severity

- Existing behavior defect: **none found**.
- Absent optional upstream feature (cross-provider hosted-search ordering `searchProviderOrder`): a feature-port candidate, not a bug. Parity severity **low**, and it should be scoped against the existing webSearch combo and media-route ordering rather than treated as a gap in the current search core.

## Recommended handling

- Do not file this as a defect. If the feature is wanted, route it as a port candidate and first reconcile it with the existing `webSearch` media-route and combo ordering (sections 5 and "UI" above).
- Correct the candidate report's `src/sse/handlers/search.js:230-238` citation to cover the authenticated `runMediaAccounts` path at `:245-296`, and note the account-level failover.
- Confirm the owner of #2266/#2289 with the lane owner; the brief's auth assignment does not match the issue titles.

## Commands run (all read-only)

- `git show 69b48757c9 --stat`, `git show 69b48757c9:internal/docs/port-reports/review-omni-21408-search-failover-citations.md`
- `git rev-parse 29490b78…^{tree} 32a783d7…^{tree}`; `git cat-file -t` on both commits
- `git show <snap>:open-sse/handlers/search/index.js` (both) + `cmp`; `git diff --stat` on search paths
- `git grep -n handleSearchCore <snap>`; `git grep -n -i -E 'searchProviderOrder|…' <snap>`; `git ls-tree -r --name-only <snap> -- src/lib/search`
- `git show <main>:src/sse/handlers/search.js` and `…/mediaRoutes.js`
- `gh issue view 2266|2289 --json …`; `gh issue list --state open --search "search failover in:title,body" …`
- Scratch extraction and import probe under `/var/tmp/verify-omni-21408/` (failed on `undici`; no dependency install).
