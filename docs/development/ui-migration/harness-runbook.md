# Harness runbook

> How the AI harness (Hermes cron agent, OMP subagents, Codex) executes
> the migration campaign. One worktree per phase, one branch per page
> PR. Invariant: migration PRs do not change behavior.

## 1. Worktree + branch discipline

Per [`AGENTS.md` §6.2](../../../AGENTS.md#62-worktree-discipline):

- One worktree per task. Path follows `.omc/wt-<short-name>/` (e.g.
  `.omc/wt-ds-foundation/`, `.omc/wt-ds-shell/`, `.omc/wt-ds-health/`,
  …).
- Each worktree branches from `origin/main`. For Phase 2 page PRs,
  branch from `origin/main` (not from another page branch) so each PR
  is a clean rebase target.
- Force-push only on the branch being amended.
- Do not delete another agent's `.omc/wt-*` worktree.

### Worktrees used by this campaign

| Worktree | Branch | Phase | Owned files |
| --- | --- | --- | --- |
| `.omc/wt-ds-foundation/` | `feat/ds-foundation` | 0 | `src/app/layout.js`, all of `src/shared/components/*` (props preserved) |
| `.omc/wt-ds-shell/` | `feat/ds-shell` | 1 | `src/shared/components/Sidebar.js`, `Header.js`, `layouts/DashboardLayout.js`; keep these runtime adapters and their public contracts |
| `.omc/wt-ds-<slug>/` | `feat/ds-migrate-<slug>` | 2 (one per page cluster) | Assigned route directory including required production-page/widget stories, unique route e2e spec and focused unit file; shared manifests remain integration-owned |
| `.omc/wt-ds-cleanup/` | `chore/ds-cleanup` | 3 | `src/shared/components/index.js` (drop deletes), `scripts/check-anti-slop.mjs` (new guardrails). `src/app/globals.css` is forbidden in every campaign phase. |

## 2. Branch naming

`feat/ds-migrate-<page>` for every page PR. The `<page>` slug is the
last segment of the route path (e.g. `health`, `cli-tools`,
`media-providers-kind`, `settings-pricing`). `feat/ds-foundation` and
`feat/ds-shell` are the two exception names; everything else follows
the page slug.

## 3. Commit + PR title format

Per [`AGENTS.md` §6.3](../../../AGENTS.md#63-commit-and-pr-title-format):

- Commit subject: `feat(ui): migrate <page> to Durin DS` (commitlint
  ≤ 100 chars, type `feat`, scope `ui`).
- For Phase 0/1/3, use the matching type:
  - Phase 0: `feat(ui): repoint shared primitives to dd-* tokens` and
    foundation token-remediation/accessibility gate changes. Verify existing
    token import; do not create a token-load source PR.
  - Phase 1: `feat(ui): swap sidebar to durin ds shell`,
    `feat(ui): swap header to durin ds shell`,
    `feat(ui): swap dashboard layout to durin ds shell`.
  - Phase 3: `chore(ui): …`.
- PR title mirrors the commit subject for single-commit PRs; for
  multi-commit PRs pick the most descriptive type+scope from the
  commits.
- Workers do not commit, push, open PRs, or run commitlint. Return a complete
  diff for orchestrator formatting, gates, and runtime proof. Independent and
  human reviewers then review the complete diff. Orchestrator publishes only
  after explicit human complete-diff approval.
- Orchestrator may run documented commitlint commands during local validation;
  human approval is required only before push/PR:

  ```bash
  npx commitlint --from=origin/main --to=HEAD
  echo "<pr-title>" | npx commitlint
  ```

## 4. PR body template

````markdown
## Scope

<one-line: which route, which mock>

## Mock link

`src/shared/ui/pages/<slug>/<Slug>Page.jsx`

## Behavior invariants

- [ ] API calls unchanged: <list endpoints, methods, request shapes>
- [ ] Route path unchanged: <route>
- [ ] localStorage keys unchanged: <list or "none">
- [ ] i18n keys unchanged: <list or "none">
- [ ] Server-fn inputs unchanged: <list or "n/a">
- [ ] Loading / empty / error states render the same data

## Orchestrator gate output

Only orchestrator runs union formatting and gates before independent and human
complete-diff review. Workers must skip tests, builds, lint, formatters, and
all gates; their deliverable is the diff plus preserved-contract notes.
Existing gate commands remain orchestrator-only:

```bash
$ npm run lint                    # full repo gate (eslint + anti-slop)
<output>                          # exit 0
$ npm run storybook:build
<output>                          # exit 0
$ cd tests && npm run test:ci
<output>                          # exit 0
$ npx commitlint --from=origin/main --to=HEAD
<output>                          # exit 0
$ git diff tests/__baseline__/known-fails.txt
<empty>
```

No Storybook build, screenshot, or axe result certifies WCAG 2.2 AAA.
Every page/component/widget requires working CSF3 coverage as specified in
[`plans/002-storybook-coverage.md`](../../../plans/002-storybook-coverage.md).
Orchestrator verifies every built story ID, meaningful state and play assertion,
then actual app behavior. Reference mocks alone never satisfy production proof.
Required G0 package-script additions `check:storybook-coverage` and
`test:storybook` must pass for each affected PR after bootstrap, alongside
actual-app Playwright checks. Their proposed status never waives page acceptance.
Orchestrator records applicable AAA criteria with measured evidence.

## Runtime proof checklist

- [ ] Dark + light, both palettes
- [ ] Empty / loading / error states
- [ ] Modal / Drawer / Prompt / Confirm open/close
- [ ] Keyboard tab + Esc
- [ ] Native select / window.prompt / window.confirm count in this
      page's files: 0 (or justified in diff)
- [ ] Hex literal count in this page's files: 0 (or justified)
- [ ] Sidebar collapse is session-local `useState`, never persisted to
      storage or another persistence layer.
````

## 5. Invariant checks — what migration PRs must NOT change

Verify by inspection during independent and human complete-diff review, after
orchestrator formatting, gates, and runtime proof and before publication:

1. **API calls.** Same HTTP method, URL, query, headers, and request body
   shape. Do not add, remove, or make optional any request contract.
2. **Route paths.** Page URL segment, dynamic params, and search params
   remain byte-identical. Do not rename or restructure.
3. **localStorage keys and semantics.** Every read/write key and storage
   behavior remains byte-identical. Do not add keys, alter defaults, or
   change persistence scope.
4. **i18n keys.** Do not rename. Keys consumed by page `translate()` calls
   stay verbatim.
5. **Server-fn inputs.** TanStack / Next server-fn calls pass identical
   payloads. Do not add, remove, or make fields optional.
6. **State, effects, fetch cadence.** Polling intervals, retry logic, and
   `useEffect` deps stay verbatim. Do not improve polling or retries.
7. **Error handling.** Same error maps to same user-facing message. Only
   visual treatment changes.
8. **Accessibility wiring.** Preserve existing `aria-*`, focus order, and
   keyboard handlers. Scoped accessibility repairs are allowed only when
   they correct an identified defect without changing application behavior.

## 6. Merge conflicts with concurrent upstream ports

Per [`AGENTS.md` §5A](../../../AGENTS.md#5a-ui--durin-ds-design-system) and
[`porting-upstream-ui.md` §1](../porting-upstream-ui.md):

- The migration PR owns `src/app/(dashboard)/<route>/**`. The
  upstream port that touches the same page owns its own logic in the
  same file. The merge rule is: take the upstream logic verbatim, keep
  the migration's class strings and JSX. Concretely, when a
  `feat(ui): migrate <page>` PR conflicts with `port(upstream): #N`
  touching the same file:
  1. Orchestrator rebases migration branch onto latest `origin/main` (which
     includes upstream port). Local rebase needs no human approval.
  2. Re-apply migration diff by hand. New upstream logic is substrate;
     migration class strings and JSX are skin.
  3. `*-dd-*` utilities remain after rebase. If upstream port added section,
     re-migrate it.
  4. Orchestrator runs union formatting, gates, and runtime proof. Workers do
     not run gates or visual checks. Independent and human full-diff review
     follows before publication.
- The reverse (upstream port lands on top of a migration PR) follows
  the same rule: take upstream logic, keep the migration's class
  strings.
- When the same file is touched by three or more streams (e.g.
  upstream port + migration + format-only cleanup), coordinate through
  the parent branch and consider landing each in sequence rather than
  stacked.

## 7. Definition of done — per page

A page is eligible for integration only when all of following are true:

- [ ] Worker returned complete diff; orchestrator formatting, gates, and
      current-SHA runtime proof passed; independent and human reviewers
      approved complete diff before publication.
- [ ] No new hex literals in page files (justify exception in review).
- [ ] No `window.prompt` / `window.confirm` in page files.
- [ ] No native `<select>` in page files (the `Pagination` exception lives
      in `src/shared/ui/components/Pagination.jsx`, not page).
- [ ] All behavior invariants (§5) hold.
- [ ] No new files under `src/shared/components/` (DS components live under
      `src/shared/ui/components/`).
- [ ] No edits to `src/app/globals.css`.
- [ ] Runtime shell adapters remain; never mount preview `DashboardShell`
      directly in production.

Orchestrator completion additionally requires explicit human approval before
push/PR, union gate output, and current-SHA runtime proof. Redirect rows are
verified, not migrated, and never require a merge. Only after merge and proof
may orchestrator flip a non-redirect page-map row to `migrated`; worker report
never does.

## 8. Per-page PR — execution order within the harness

1. Read [`page-map.md`](./page-map.md) row → route, mock, risk, special
   notes.
2. Read [`playbook.md`](./playbook.md) end to end.
3. Create worktree (`git worktree add .omc/wt-ds-<slug>/ -b
   feat/ds-migrate-<slug> origin/main`).
4. Open real page file and mock; confirm import map in
   [`playbook.md`](./playbook.md) §3 (grep both sides).
5. Apply recipe: preserve behavior, swap imports, rewrite classes per golden
   rules, and adapt presentation only. Never mount preview `DashboardShell`;
   retain runtime shell adapters.
6. Return complete diff and preserved-contract notes. Do not run tests,
   builds, lint, formatters, gates, dev server, commitlint, commit, push, or
   open PR.
7. Orchestrator rebases, formats, gates, commits locally, and obtains
   current-SHA runtime proof.
8. Independent review, then human full-diff review. Explicit human approval is
   required only for push/PR; local validation, rebase, and commit need none.
9. Orchestrator publishes only after that approval.

## 9. Phase 0 / 1 / 3 specifics

- Phase 0 retokens shared internals only; it does not migrate pages. Verify
  existing token import; no token-load source PR is needed. Foundation token
  remediation, retokening, and accessibility gates must land before Phase 1
  opens its first PR.
- Phase 1 has two independent lanes:
  1. `feat(ui): swap sidebar to durin ds shell` plus
     `feat(ui): swap dashboard layout to durin ds shell` land atomically in
     one shell change. Layout owns session-local `useState` collapse state and
     passes `collapsed` and `onToggleCollapse` through sidebar adapter props.
     Do not write/read it from storage or another persistence layer.
  2. `feat(ui): swap header to durin ds shell` is independent and may run in
     parallel with shell lane.
- Phase 3 begins only after every Phase 2 PR has merged.
- Within Phase 2, page PRs are independent and may be worked in parallel by
  separate worktrees / subagents. Order is wave order in
  [`phases.md`](./phases.md) §2; merge order may differ. Redirect rows are
  verified, not migrated, and never require a merge. Campaign is done only
  after every non-redirect row has merged and received current-SHA runtime
  proof, and every redirect row is verified; only then may orchestrator mark
  non-redirect rows `migrated` and redirect rows `verified`.
