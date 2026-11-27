# Review: OmniRoute #21384 (quota-meter roles)

**Verdict: partially inapplicable; one low-severity concrete gap, not ported.** The upstream diff cannot be ported file-for-file because six of its nine dashboard components do not exist in DurinDoor. The three remaining-quota bars that do exist still expose `role="progressbar"` where upstream moved the same kind of value to `meter`. Severity: low (accessibility role semantics; no functional, data or routing defect).

## Upstream PR (read-only, `gh api`)

- Repo: `cheaper-inference/OmniRoute`, PR [#21384](https://github.com/cheaper-inference/OmniRoute/pull/21384), title `fix(dashboard): announce the remaining quota bars as meters`.
- State at review: **open**, not draft, not merged. `updated_at` 2026-11-27T04:34:32Z.
- Base: `release/v3.8.55` at `c003c973a8d981439f151c158d057e44be18bf82`.
- Head: `fix/quota-bars-meter-role` at `01f78c7dc221705e9062c8bacbc87ef97b7b01b3` (cross-repo head is `cheaper-inference/OmniRoute`).
- Size: 14 files, +136/-37. Source changes: `Progress semantics="meter"` in `AntigravityQuotaGroups.tsx`, `HealthAccountTooltip.tsx`, `ProviderUsdCostModal.tsx`, `QuotaMiniBar.tsx`, `parts/KiloPassMeter.tsx`, and `role="progressbar"`→`"meter"` in `src/app/quota/[provider]/components/MemberBar.tsx`. Tests and one changelog entry.

## DurinDoor comparison

Compared against `origin/main` (`29490b783e`) and the frozen train HEAD (`d27f288cb5`). Paths below are identical in both (`git diff origin/main HEAD` empty for the ProviderLimits directory and the quota page).

**Upstream-only components (absent in both, so inapplicable as file ports):**

- `AntigravityQuotaGroups.tsx`, `HealthAccountTooltip.tsx`, `ProviderUsdCostModal.tsx`, `QuotaMiniBar.tsx`, `parts/KiloPassMeter.tsx`, `src/app/quota/[provider]/components/MemberBar.tsx`.
- Quota sharing is upstream-only, as already recorded in [1073-nov25-port-amprs-b.md](1073-nov25-port-amprs-b.md) (row for #21195, the sibling "shared quota bar as meter" change, marked Not applicable).

**Local remaining-quota bars still announcing `progressbar`:**

- [`QuotaProgressBar.js:49`](../../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaProgressBar.js) — `role="progressbar"`, `aria-label="${label} quota remaining"`, `aria-valuenow={remaining}`. Rendered by `ProviderLimitCard.js:33`.
- [`QuotaTable.js:99`](../../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js) — `role="progressbar"`, `aria-label="${quota.name} remaining"`, `aria-valuenow={quota.remaining}`. Used by `ProviderLimits/index.js:1620` and `:1669`.
- [`QuotaPage.jsx:35`](../../../src/shared/ui/pages/quota/QuotaPage.jsx) — local `ProgressBar`, `role="progressbar"`, `aria-label="${label} quota remaining"`.

**Internal inconsistency that makes this more than a pure port question:** [`UsagePage.jsx:568`](../../../src/shared/ui/pages/usage/UsagePage.jsx) already announces a percentage share as `role="meter"` with `aria-valuemin/max` and a name. The same codebase therefore uses both roles for the same class of value.

## Evidence for severity and limits

- Static evidence only: lines above are read from Git objects with `git show origin/main:<path>` and `git cat-file`, not from the integration checkout.
- The `progressbar` role is not wrong per se; ARIA defines `meter` for a scalar within a known range and `progressbar` for task progress. The upstream choice is a semantic refinement, which is why this is low, not a defect in the functional sense.
- Existing tests guard `progressbar` in some places (`tests/unit/claude-fable-provider-limits.test.js:82` asserts `queryByRole("progressbar")` is null for one row). A port of the three local bars would need that test reviewed; I did not run it.
- No tests were executed. No dependency install or product execution was performed, as the review is source-only.

## Overlap and claims

- Nothing in `internal/docs/port-reports` claims #21384 except [2026-11-27-full-parity-refresh.md:1698](2026-11-27-full-parity-refresh.md) (row O0030, "Unrecorded at this head; review required"). This report closes that row.
- Sync-lane items (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433) and 9router #5884/#5904 were checked only by number in the reports. I did not diff them, so overlap with those PRs' file sets is not verified. None are recorded as touching the paths above.
- No issue was created, no PR was edited or linked, and no DurinDoor PR was listed or watched.

## Recommended disposition

- Do not port #21384 as a file-level patch; six of its nine target components have no DurinDoor counterpart.
- If the semantic change is wanted, treat it as a separate small a11y item covering the three local bars above (switch the role to `meter`, keep the existing name and `aria-valuenow`), and update `claude-fable-provider-limits.test.js` in the same change. It is not a fix for any user-visible malfunction.
