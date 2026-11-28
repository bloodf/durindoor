# Review: OmniRoute #21405 combo email masking (fix(dashboard): hide unmaskable short emails in combo account labels)

Reviewed 2026-11-27. Read-only static review; no code, issue, PR, watch or live-provider action was taken.

## Upstream identity

| Item | Value |
|---|---|
| PR | [cheaper-inference/OmniRoute#21405](https://github.com/cheaper-inference/OmniRoute/pull/21405), state `open`, not draft, not merged |
| Base | `release/v3.8.55` @ `9671192011beb2d7f83979f40be488c5da8772b9` |
| Head | `fix/combo-short-email-account-labels` @ `865cf4ca70f620d6ad6671ad0f0ab84c26246d43`, 1 commit |
| Last updated | 2026-11-27T13:19:55Z |
| Changed files | 5: `src/app/(dashboard)/dashboard/combos/comboAccountLabel.ts` (new), `.../combos/page.tsx` (modified), `tests/unit/combo-account-label.test.ts` (new), `tests/unit/ui/combo-searchable-selectors.test.tsx` (modified), `changelog.d/fixes/combo-short-email-account-labels.md` (new) |

Upstream behaviour being corrected: `pickDisplayValue` (`src/shared/utils/maskEmail.ts`) returns the raw value when it cannot mask a short email such as `abc@x.com`, which leaked the address while emails were hidden. The PR drops such a label (returns `null`) and falls back to `acct <id>`. Upstream visibility is default-hidden (`src/store/emailPrivacyStore.ts`, `emailsVisible: false`).

## DurinDoor comparison

Compared against `origin/main` `29490b783e` and the frozen train head `d27f288cb5` (HEAD of this worktree; `origin/main` is its ancestor). Both were read via git objects (`git grep`/`git ls-tree`), not the integration checkout.

- No email-visibility feature exists at either ref. `git grep` for `emailPrivacy`, `maskEmail`, `pickDisplayValue`, `emailsVisible` and `comboAccountLabel` returns nothing in `src`, `open-sse` or `tests`.
- The files this PR edits have no local counterpart. Local combo files are `page.js`, `components/ComboFormModal.jsx`, `ComboAllowListEditor.jsx`, `ConnectionGroupsPanel.jsx` and `error.js`. `ComboStepSelectors.js` (where the upstream selector and its short-email masking live) is absent.
- The only local email labels in combos are `connection.name || connection.email` at `src/app/(dashboard)/dashboard/combos/ComboAllowListEditor.jsx:28` and `src/app/(dashboard)/dashboard/combos/ConnectionGroupsPanel.jsx:24`. Neither calls a mask helper and neither has a hidden mode.
- Prior dispositions already cover this family. [1073-nov26-pm2.md](1073-nov26-pm2.md) row 6 (#21243, whose later commit `de0e7eba89cd` added the short-email masking inside the searchable selector) is **Not applicable**, and [2026-11-27-full-parity-refresh.md](2026-11-27-full-parity-refresh.md) line 204 (C113) repeats that. The same census row for #21405 (line 1684, O0016) reads "Unrecorded at this head; review required". This report is that review.

## Verdict

**Inapplicable.** The defect #21405 fixes (raw short emails shown while emails are hidden) needs an email-visibility mode that DurinDoor does not have. The upstream code it edits (`combos/page.tsx` lines around 840 and 2282–2340, `comboAccountLabel.ts`, `maskEmail.ts`, `emailPrivacyStore.ts`) has no local counterpart to patch. Porting only the helper would add dead code. Severity: none for this candidate.

Hand trace of the PR logic (not executed): `hideUnmaskableEmailLabel("abc@x.com", false)`: `pickDisplayValue` returns the unchanged email (username length 3 ≤ 3), so the function returns `null`. `"hello@example.com"` masks to `hel**@********com`, matching the PR's test. The PR's own logic looks correct for upstream.

## Adjacent note (not a defect of #21405)

Upstream defaults all dashboard emails to masked. DurinDoor has no such setting, so `ComboAllowListEditor.jsx:28` and `ConnectionGroupsPanel.jsx:24` always render `connection.email` in plain text. Whether DurinDoor should port the email-privacy feature is not recorded in any local report. That is a separate product decision and not part of this review; it should not be claimed as a bug from this PR.

## Overlap and claims

- None of the sync-lane numbers (#21435, #21432, #21426, #21412, #21425, #21427, #21349, #21433, 9router #5884/#5904) is #21405. I did not read their bodies, so content overlap with them is unverified. No local report claims #21405.
- Open DurinDoor issue search for "21405 email" and "combo email" returned no matching issue. Issue #2034 (provider sign-in parity) is unrelated.

## Uncertainty

- The upstream PR's own tests were not run. Only the PR patch and base files were read via read-only `gh api`.
- Upstream base line numbers come from the PR diff hunk headers and may be off by a few lines.
- I did not verify the upstream release/v3.8.55 test suite; the verdict depends only on the absence of the feature locally.
