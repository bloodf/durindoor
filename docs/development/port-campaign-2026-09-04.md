# Port campaign 2026-09-04

Execution plan for parent scan #735, child issues #737–#769, and Astra defaults, from `6505912f5b9b91c21309479f037f3b271b5fb599`. No authenticated live calls, credential inspection, deployment, or service restart. Main checkout remains untouched. Subagents edit only assigned worktrees and skip gates, tests, lint, and formatters.

## Scope and order

1. Read each child contract and full candidate diff. Ledger every child as complete, incomplete, or blocked with source evidence. #735 is reconciliation-only: its 734 rows include selected child rows mapped into delivery work; remaining rows are unselected, not done.
2. Complete policy, Astra, existing candidate ports, then migration branches in this order: #760 migration 014, #748 migration 015, #761 migration 016, #747 migration 017. Each branch rebases to current merged base and completes required gates before its PR; no later migration branch is current-base ready before predecessors merge.
3. Complete #769's runtime triage of all 59 exact-id misses in isolated Storybook/dashboard rendering. Preserve two dimensions: raw exact rendering is 1 resolves-via-alias (`mimocode`), 10 no-mark-applicable, and 48 genuinely missing rendering; among 48, canonical lookup found 16 existing reusable assets requiring only an alias fix and 32 absent reusable vendor marks. Canonical assets do not make raw aliases rendered. This is live campaign work, not deferred bulk-asset work.
4. Keep #755, #758, #762, and #765 concretely blocked where their contract requires fresh authenticated live verification. #762 must not land its disputed Anthropic Messages transport or overwrite its recorded unauthorized finding. Do not replace this evidence with fixtures, mocks, static catalogs, GitHub Actions, or upstream claims.
5. Serially gate, push, create, review, merge, and remove each worktree. Publish issue/provider/scan disposition ledger after final merged-tree gate. Cap: ≤10 live children total at any moment (implementers, advisors, reviewers, policy agents). Idle peers re-pool before spawning new ones.

## Worktree and branch map

- Gate checkout: `/home/cortexos/Developer/durindoor-campaign-gate-20260904`; orchestrator-only.
- Policy: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-campaign-policy` on `docs/campaign-20260904-policy`.
- Astra: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-astra-defaults` on `feat/gpt-6-astra-defaults`.
- #744: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-campaign-744` on `port/campaign-744`.
- #747: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-campaign-747` on `port/campaign-747`.
- #748: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-campaign-748` on `port/campaign-748`.
- #760: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-campaign-760` on `port/campaign-760`.
- #761: `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-campaign-761` on `port/campaign-761`.
- Existing candidate ports use `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/wt-737` through `wt-766` on their existing `port/upstream-*` branches; #765 remains blocked.
- All branches start from campaign base; PRs target `bloodf/durindoor:main` and squash-merge. Shared source files have one integration owner at a time.

## Review and verification

- Independent contract review precedes each PR. Security-sensitive changes require `security-reviewer` review; user waived issue-requested human review gates, so no separate human pause is required.
- Rebase to current `origin/main` before final validation. Resolve every review thread, including outdated threads, before merge.
- Orchestrator runs Node 20.20.2/npm 10.8.2: `npm run lint`, `npm run build`, `npm run check:docs`, `npm run check:agent-index`, registry-index check, `npm run catalog:diff`, focused regressions, `cd tests && npm run test:ci`, and `npx commitlint --from=origin/main --to=HEAD`. Run `npm run gen:registry-index` before the registry-index check only when a new registry file is added; do not generate for every catalog edit. `lint:anti-slop` is not a separate gate after `lint`.
- Each changed runtime surface also needs isolated app/browser proof or local fake-upstream smoke, as applicable. GitHub Actions is CI evidence only, never runtime proof. Merge only with green current-base CI plus local gates.
- Final merged-tree verification repeats required build, docs, agent-index, registry-index, catalog-diff, focused regressions, test suite, and commitlint gates.

## Worktree removal

Remove each campaign implementation worktree, including policy, after all conditions hold: final commit exists, worktree is clean, pushed remote tip SHA equals local final commit, and PR is created. Do not wait for CI or merge. Preserve branch until merge. Never remove pglite or unrelated worktrees; create a new absolute-path repair worktree when needed.

## Brand assets and blockers

- Apply `docs/development/provider-brand-assets.md` to provider marks. It records repository handling policy, provenance, unchanged marks, no endorsement, third-party ownership, and removal path; it does not make permission or legal-determination claims.
- #769 triage decides rendering classification only. Any genuinely missing vendor mark needs its own provenance record; no bulk asset port follows automatically.
- Existing candidate ports are not accepted merely because committed. Full issue contract and diff review remains required.
