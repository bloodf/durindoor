# Verification: OmniRoute #21384 (quota meter semantics)

**Verdict: confirmed with scope limits; low severity.** The concrete local gap is that two live provider quota views and one quota demo surface expose remaining-quota measurements as ARIA `progressbar`. The same local UI already exposes a bounded usage share as `meter`. This is a semantic inconsistency for assistive technology, not evidence of incorrect quota data, routing behavior, or live-provider acceptance. The six OmniRoute-only component targets have no same-path counterpart in either pinned tree and are absent as filenames in the frozen train.

## Pinned trees and source proposal

The comparison used the user-specified object IDs directly:

- Current main: `29490b783e83176d4d6a4162f76ee3dc79db66ea`.
- Frozen train: `32a783d76d45d90bf0517015442f43fadd96106c`.

The report's source was read with:

```sh
git show d61b0055c2:internal/docs/port-reports/review-omni-21384-quota-meters.md
```

It records OmniRoute #21384 as an open proposal at head `01f78c7dc221705e9062c8bacbc87ef97b7b01b3`, based on `c003c973a8d981439f151c158d057e44be18bf82`. Read-only GitHub API file metadata confirms its change is to use meter semantics for remaining quota: `Progress semantics="meter"` in AntigravityQuotaGroups, HealthAccountTooltip, ProviderUsdCostModal, QuotaMiniBar, KiloPassMeter; and `role="progressbar"` to `role="meter"` in MemberBar. This verifies the proposal's scope, not whether any live provider accepts requests.

## Exact local comparison

The relevant local files are byte-identical between current main and the frozen train. Command:

```sh
git diff --quiet 29490b783e83176d4d6a4162f76ee3dc79db66ea 32a783d76d45d90bf0517015442f43fadd96106c -- 'src/app/(dashboard)/dashboard/usage/components/ProviderLimits' 'src/shared/ui/pages/quota/QuotaPage.jsx' 'src/shared/ui/pages/usage/UsagePage.jsx' tests/unit/claude-fable-provider-limits.test.js
```

Output: `focused_tree_diff_exit=0`.

At both trees:

- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaProgressBar.js:49` sets `role="progressbar"`, accessible name `${label} quota remaining`, min/max 0/100 and `aria-valuenow={remaining}`. `ProviderLimitCard.js` maps loaded quota rows into `QuotaProgressBar` (frozen train lines 25–40).
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js:99` uses `role="progressbar"`, accessible name `${quota.name} remaining`, min/max 0/100 and current remaining value for rows with a quota window. `ProviderLimits/index.js` renders this table both for a connection and merged-account quota rows (frozen train lines 1614–1625 and 1664–1674).
- `src/shared/ui/pages/quota/QuotaPage.jsx:35–39` assigns `progressbar` plus name and bounded current value in its `ProgressBar`. This is a separate quota-page UI surface; the inspected caller and report identify it as demo/mock data, so it is not counted as a live provider quota defect.
- `src/shared/ui/pages/usage/UsagePage.jsx:568–573` already uses `role="meter"`, a name, and min/max 0/100 for a provider usage-share value.

The same three progressbar implementations are present in current main. The frozen train has no files named `AntigravityQuotaGroups.tsx`, `HealthAccountTooltip.tsx`, `ProviderUsdCostModal.tsx`, `QuotaMiniBar.tsx`, `KiloPassMeter.tsx`, or `MemberBar.tsx` (`git ls-tree -r --name-only <train> | rg ...` returned no matches). These are absent upstream features/surfaces, not local regressions to fix.

## Reproduction and downstream effects

No executable test was necessary: this finding is directly observable in the rendered DOM role attributes and confirmed through the callers above. An offline DOM assertion for the live quota bars would find `progressbar` where the proposed semantic is `meter`; this is not a failure of current app functionality because `progressbar` remains a valid role and reports the same bounded value/name. The roles communicate different kinds of scalar: task completion versus a measurement in a known range. Changing the two live bars would change screen-reader role announcements, not quota calculations or provider requests.

An existing regression test asserts that an unreported Fable row has no `progressbar` (`tests/unit/claude-fable-provider-limits.test.js:82`). It does not assert the role for rows that do report quota. If a follow-up adopts this semantic refinement, extend coverage to assert `meter` for a reported row and preserve the absent-role assertion for unreported rows.

No live provider, gateway, credentials, secrets, or services were used. No provider acceptance is inferred.

## Issue and lane ownership check

Read-only repository issue search found no existing DurinDoor issue matching `21384`, quota meter/progressbar, or dashboard quota semantics. Search results for general “quota” are unrelated quota coordination/auth items. The known auth ownership of #2266/#2289 concerns combo/compression and provider auth; it does not cover these dashboard role attributes. The sync lane owns current usage/shared-refresh files; the two live target files are dashboard presentation components, not the shared usage-refresh implementation. No lane overlap is indicated by the inspected issue/report records. The parity ledger row O0030 in `2026-11-27-full-parity-refresh.md` is the source tracking entry closed by this verification.

## Disposition

- **Confirmed, low:** two live local remaining-quota bars use `progressbar` while representing bounded measurements; the same project already uses `meter` for a bounded usage percentage.
- **Confirmed, demo only:** `QuotaPage.jsx` has the same role choice but is a mock/demo surface.
- **Dropped as inapplicable:** six changed upstream components have no counterpart in the frozen train.
- **Uncertain / not claimed:** screen-reader impact has not been user-tested; actual assistive-technology announcement behavior varies by platform. No runtime or live-provider behavior was tested.
- **No product change recommended in this verification:** an optional low-priority accessibility refinement can change the two live roles to `meter`, retain their names and values, and add role coverage. The demo role can be considered separately.

## Commands and observed outputs

```sh
git cat-file -t 29490b783e83176d4d6a4162f76ee3dc79db66ea
git cat-file -t 32a783d76d45d90bf0517015442f43fadd96106c
```

Both returned `commit`.

```sh
git diff --name-status 29490b783e83176d4d6a4162f76ee3dc79db66ea 32a783d76d45d90bf0517015442f43fadd96106c -- 'src/app/(dashboard)/dashboard/usage/components/ProviderLimits' 'src/shared/ui/pages/quota/QuotaPage.jsx' 'src/shared/ui/pages/usage/UsagePage.jsx' tests/unit/claude-fable-provider-limits.test.js
```

Output: empty (no path changes).

```sh
git show 32a783d76d45d90bf0517015442f43fadd96106c:'src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaProgressBar.js' | rg -n 'progressbar|aria-value|function QuotaProgressBar'
```

Output: `34` function declaration; `49` `role="progressbar"` with accessible name, min/max and current value.

```sh
git show 32a783d76d45d90bf0517015442f43fadd96106c:'src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js' | rg -n 'progressbar|aria-value'
```

Output: line `99`, `role="progressbar"` with accessible name, min/max and current value.

```sh
git show 32a783d76d45d90bf0517015442f43fadd96106c:src/shared/ui/pages/quota/QuotaPage.jsx | rg -n 'ProgressBar|progressbar|aria-value'
```

Output: lines `32`, `35`, `37–39` show `ProgressBar` with `role="progressbar"` and bounded current value.

```sh
git show 32a783d76d45d90bf0517015442f43fadd96106c:src/shared/ui/pages/usage/UsagePage.jsx | rg -n -C 3 'role="meter"'
```

Output: lines `565–573` show bounded provider share as `role="meter"`.

```sh
git show 32a783d76d45d90bf0517015442f43fadd96106c:tests/unit/claude-fable-provider-limits.test.js | sed -n '72,88p'
```

Output includes line `82`: `expect(within(rowB).queryByRole("progressbar")).toBeNull();` for an unreported quota row.

No tests were run; this was a static source trace. No dependency installation was needed.
