# Harness runbook

> How the AI harness (Hermes cron agent, OMP subagents, Codex) executes
> the migration campaign. One worktree per phase, one branch per page
> PR. Invariant: migration PRs do not change behavior.

## 1. Worktree + branch discipline

Per [`AGENTS.md` §6.2](../../AGENTS.md#62-worktree-discipline):

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
| `.omc/wt-ds-shell/` | `feat/ds-shell` | 1 | `src/shared/components/Sidebar.js`, `Header.js`, `layouts/DashboardLayout.js` |
| `.omc/wt-ds-<slug>/` | `feat/ds-migrate-<slug>` | 2 (one per page) | `src/app/(dashboard)/dashboard/<route>/**` and the mock page file if a new story is added |
| `.omc/wt-ds-cleanup/` | `chore/ds-cleanup` | 3 | `src/shared/components/index.js` (drop deletes), `src/app/globals.css` (retire tokens), `scripts/check-anti-slop.mjs` (new guardrails) |

## 2. Branch naming

`feat/ds-migrate-<page>` for every page PR. The `<page>` slug is the
last segment of the route path (e.g. `health`, `cli-tools`,
`media-providers-kind`, `settings-pricing`). `feat/ds-foundation` and
`feat/ds-shell` are the two exception names; everything else follows
the page slug.

## 3. Commit + PR title format

Per [`AGENTS.md` §6.3](../../AGENTS.md#63-commit-and-pr-title-format):

- Commit subject: `feat(ui): migrate <page> to Durin DS` (commitlint
  ≤ 100 chars, type `feat`, scope `ui`).
- For Phase 0/1/3, use the matching type:
  - Phase 0: `feat(ui): load durin ds tokens in app layout` and
    `feat(ui): repoint shared primitives to dd-* tokens`.
  - Phase 1: `feat(ui): swap sidebar to durin ds shell`,
    `feat(ui): swap header to durin ds shell`,
    `feat(ui): swap dashboard layout to durin ds shell`.
  - Phase 3: `chore(ui): …`.
- PR title mirrors the commit subject for single-commit PRs; for
  multi-commit PRs pick the most descriptive type+scope from the
  commits.
- Pre-push check (mandatory):

  ```bash
  npx commitlint --from=origin/main --to=HEAD
  ```

  Must exit 0. If it fails, rewrite the violating commits before
  pushing.

- PR title check (mandatory — squash-merge uses it as the commit
  subject):

  ```bash
  echo "<pr-title>" | npx commitlint
  ```

## 4. PR body template

```markdown
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

## Gate output

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

## Visual check

- [ ] Dark + light, both palettes
- [ ] Empty / loading / error states
- [ ] Modal / Drawer / Prompt / Confirm open/close
- [ ] Keyboard tab + esc
- [ ] Native select / window.prompt / window.confirm count in this
      page's files: 0 (or justified in the diff)
- [ ] Hex literal count in this page's files: 0 (or justified)
```

## 5. Invariant checks — what migration PRs must NOT change

Verify by inspection of the diff before pushing:

1. **API calls.** Same HTTP method, URL, headers, and request body
   shape. New optional query params are fine; removing fields is not.
2. **Route paths.** The page's URL segment, dynamic params, and search
   params must match the upstream. Do not rename, do not restructure.
3. **localStorage keys.** If the page reads or writes a key, the key
   string must be byte-identical. New read-only keys are fine.
4. **i18n keys.** Do not rename. The keys consumed by the page's
   `translate()` calls stay verbatim.
5. **Server-fn inputs.** TanStack / Next server-fn calls pass the same
   payload. New optional fields are fine.
6. **State, effects, fetch cadence.** Polling intervals, retry logic,
   and `useEffect` deps stay verbatim. Do not "improve" a polling
   cadence or error retry loop during a migration PR.
7. **Error handling.** Same error → user-facing message mapping. The
   only rendering change is the visual treatment.
8. **Accessibility wiring.** Same `aria-*` attributes, focus order, and
   keyboard handlers. DS primitives add their own; the page does not
   remove any.

## 6. Merge conflicts with concurrent upstream ports

Per [`AGENTS.md` §5A](../../AGENTS.md#5a-ui--durin-ds-design-system) and
[`porting-upstream-ui.md` §1](../porting-upstream-ui.md):

- The migration PR owns `src/app/(dashboard)/<route>/**`. The
  upstream port that touches the same page owns its own logic in the
  same file. The merge rule is: take the upstream logic verbatim, keep
  the migration's class strings and JSX. Concretely, when a
  `feat(ui): migrate <page>` PR conflicts with `port(upstream): #N`
  touching the same file:
  1. Rebase the migration PR onto the latest `origin/main` (which
     includes the upstream port).
  2. Re-apply the migration diff by hand. The new logic from upstream
     is the substrate; the migration's class strings and JSX are the
     skin.
  3. The `*-dd-*` utilities must remain in the file even after the
     rebase. If the upstream port added a new section, re-migrate it.
  4. Re-run the five gates. Visual check the section the upstream port
     touched.
- The reverse (upstream port lands on top of a migration PR) follows
  the same rule: take upstream logic, keep the migration's class
  strings.
- When the same file is touched by three or more streams (e.g.
  upstream port + migration + format-only cleanup), coordinate through
  the parent branch and consider landing each in sequence rather than
  stacked.

## 7. Definition of done — per page

A page PR is complete when **all** of the following are true:

- [ ] PR title passes commitlint; commit subject passes commitlint.
- [ ] All five hard gates green locally (or on CI) — paste output in
      the PR body.
- [ ] `tests/__baseline__/known-fails.txt` diff is empty.
- [ ] No new hex literals in the page's files (justify any
      exception in the PR body — e.g. Recharts `stroke` can use
      `var(--dd-accent)` directly; no hex needed).
- [ ] No `window.prompt` / `window.confirm` in the page's files.
- [ ] No native `<select>` in the page's files (the `Pagination`
      exception is in `src/shared/ui/components/Pagination.jsx`, not in
      the page).
- [ ] All behavior invariants (§5) hold.
- [ ] Visual check completed in both palettes.
- [ ] No new files under `src/shared/components/` (DS components live
      under `src/shared/ui/components/`).
- [ ] No edits to `src/app/globals.css`.
- [ ] Storybook story for the page mock (if the mock was updated to
      match a new DS primitive usage) still builds and renders.
- [ ] PR body has Scope, Mock link, Behavior invariants, Gate output,
      and Visual check sections filled in.
- [ ] Status column in [`page-map.md`](./page-map.md) flipped to
      `migrated` (a one-line edit in the same PR).

## 8. Per-page PR — execution order within the harness

For each page PR:

1. Read [`page-map.md`](./page-map.md) row → route, mock, risk,
   special notes.
2. Read [`playbook.md`](./playbook.md) end to end.
3. Create the worktree (`git worktree add .omc/wt-ds-<slug>/ -b
   feat/ds-migrate-<slug> origin/main`).
4. Open the real page file and the mock; confirm the import map in
   [`playbook.md`](./playbook.md) §3 (grep both sides).
5. Apply the recipe: keep behavior, swap imports, rewrite classes per
   the golden rules, swap `<table>` for `DataTable`, swap native
   `<select>` for `Select`, swap `window.prompt` for `PromptDialog`.
6. Run the five gates locally. Paste output in the PR body.
7. Visual check: `npm run dev`, click through the page in dark + light,
   exercise empty/loading/error states and any modals.
8. Update `page-map.md` status to `migrated`.
9. Commit. Pre-push commitlint. Push. Open PR.
10. Watch for AI review comments (`AGENTS.md` §6.5). Verify the
    commenter is a real bot (`[bot]` suffix), judge each comment on
    technical merit, resolve every thread before declaring ready.

## 9. Phase 0 / 1 / 3 specifics

- Phase 0 must land before Phase 1. The `feat(ui): load durin ds
  tokens in app layout` PR and the `feat(ui): repoint shared
  primitives to dd-* tokens` PR can land in either order, but both
  must be merged before Phase 1 opens its first PR.
- Phase 1 PRs are **not** independent — the order is fixed by the
  contract the layout PR needs from the sidebar PR:
  1. `feat(ui): swap sidebar to durin ds shell` — must merge first;
     the sidebar PR adds the `collapsed` and `onToggleCollapse`
     props on the adapter's external surface.
  2. `feat(ui): swap dashboard layout to durin ds shell` — merges
     second; passes the layout-owned `useState` collapse value
     into the sidebar adapter's new props.
  3. `feat(ui): swap header to durin ds shell` — merges last;
     independent of the layout/sidebar dependency, but landing it
     after the chrome is stable reduces review churn.
  Alternative: combine the sidebar + layout PRs into one commit
  on the same branch when the harness is short on time, so the
  `collapsed` prop lands atomically with its consumer. The header
  PR stays separate.
- Phase 3 begins only after every Phase 2 PR has merged.
- Within Phase 2, page PRs are independent and may be worked in
  parallel by separate worktrees / subagents. Order is the wave order
  in [`phases.md`](./phases.md) §2; merging out of order is allowed
  but the campaign is not "done" until every row in
  [`page-map.md`](./page-map.md) is `migrated`.
