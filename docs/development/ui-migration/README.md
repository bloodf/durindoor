# UI migration campaign — Durin DS

> Operational playbook for the migration of the 9Router-inherited dashboard
> UI to the Durin DS design system. Audience: AI harness / agents
> (Hermes cron agent, OMP subagents, Codex) that execute the per-page PRs.
> Not for humans. Imperative, checklist-driven.

## Goal

Replace visual surfaces under this all-page gauntlet contract. This
dashboard-only inventory is subordinate to that contract: it is not proof
that every application surface has been found or migrated. The
machine-counted route inventory has 37 rows: 35 actionable visual surfaces
(32 dashboard rows plus `/login`, `/landing`, `/callback`) plus 2 redirect
verification rows (`/` and `/dashboard`; verified, not visually migrated).
There is no `/setup` route. Inventory login, setup, public, detail, and
error surfaces before scheduling page work. The current DS reference has
21 page mocks in `src/shared/ui/pages/<slug>/<Slug>Page.jsx` (rendered
today only in Storybook). `src/app/globals.css` remains unchanged
throughout this campaign; new DS token work belongs in
`src/shared/ui/tokens.css`, while overlays belong in token-owned or
shell-owned surfaces.
Campaign rewrites real web interface, not dashboard-only Storybook gallery:
actual page/client code, shared and domain widgets, navigation, layouts, public,
auth and error surfaces adopt Durin DS. Preserve backend/API/auth/storage contracts
and working behavior. Mocks serve visual reference only; they cannot replace real
data, rendering or workflows. Storybook coverage remains mandatory additional
proof for each actual migrated production view, never route-migration or
project-completion proof by itself.

## Strategy

- **Diverge in skin, converge in skeleton.** All logic stays upstream-shaped
  (state, effects, data fetching, error handling, a11y wiring) — only the
  class strings and JSX structure change to match the Durin DS rules. The
  page-mock visuals are the spec; the real page file is the substrate.
- **Inventory is broader than this page map.** [`page-map.md`](./page-map.md)
  is subordinate to this all-page gauntlet contract. Before scheduling page
  work, inventory login, setup, public, detail, and error surfaces; document
  absent custom surfaces as findings. This guide does not mark any page
  migrated.
- **One route group per PR.** Each migration PR owns one real route or one
  tightly coupled route cluster (e.g. `media-providers/[kind]`); route count
  is not PR count. The page map in [`page-map.md`](./page-map.md) lists
  every route row, not every PR.
- **Upstream ports keep applying during migration.** The
  `src/shared/ui/**` and `.storybook/**` trees are DurinDoor-owned, but
  `src/app/(dashboard)/**` and `src/shared/components/**` remain
  upstream-tracking. Migration PRs edit only the per-page surface; an
  upstream port that touches a different page merges independently. When
  both touch the same file, follow the merge rule in
  [`porting-upstream-ui.md` §1](../porting-upstream-ui.md) — keep upstream
  logic verbatim, apply Durin DS styling.
- **Foundation internals first, then pages.** `src/app/layout.js` already
  loads Durin DS tokens before `globals.css`; retain that shipped import
  order, without adding or reordering imports. Phase 0 retokens existing
  `src/shared/components` primitive internals while preserving exported props
  and page imports. Phase 2 owns consumer import/JSX swaps and page
  migration. The behavior-preserving shell adapters (`Sidebar`, `Header`,
  `DashboardLayout`) remain live; `src/shared/ui/shell/` modules are visual
  reference only and are not mounted directly.
- **Foundation behavior prerequisite.** Before Phase 2 adoption, repair
  `Select` keyboard/focus behavior; `Modal`/`Drawer` focus, inert, Escape,
  and nesting behavior; `Button`/`IconButton` own 44×44 geometry; root layout
  + i18n own `lang`/`dir` RTL support for `ar`, `he`, `fa`, and `ur` using the
  current locale cookie and existing locale configuration, with no second
  registry. Unit regressions and orchestrator Playwright keyboard/target-size
  plus desktop/mobile, both-theme RTL assertions are required before human
  review.
- **Mock is source of truth for visuals.** For every page, the matching
  `src/shared/ui/pages/<slug>/<Slug>Page.jsx` is the visual reference. Follow
  [`playbook.md`](./playbook.md); where no exact mock exists, reuse the closest
  DS pattern and record the deviation. Accessibility requirements supersede
  inaccessible mock geometry or colors; preserve complete real page behavior.
- **Production app is acceptance surface.** On final candidate, every production
  visual surface adopts Durin DS and actual workflows pass, including all 35
  visual pages and two redirect checks; Storybook adds required evidence and
  cannot accept remaining legacy production content.
- **No behavior change.** Migration PRs must not change API calls, route
  paths, localStorage keys, server fn inputs, i18n keys, or any
  fetch/error/loading observable. The harness enforces this on every PR
  (see [`harness-runbook.md`](./harness-runbook.md)).

## Phase plan

| Phase | Scope | Pre-req | Exit gate |
| --- | --- | --- | --- |
| 0 | Foundation adoption: verify existing token load, remediate token contrast in both served themes, then retoken existing primitive internals to `*-dd-*` while preserving props, exports, and page imports | all-page gauntlet inventory started | measured contrast and keyboard-blocker evidence; app launches with token layer; no page content changed |
| 1 | Shell re-skin: `Sidebar`, `Header`, `DashboardLayout` stay behavior-preserving runtime adapters while adopting Durin DS visuals; do not re-export or mount `src/shared/ui/shell/` directly | Phase 0 | App launches; nav order matches regrouped `NAV_GROUPS`; mobile menu, auth/logout, version banner, toast rail, and collapse toggle all preserved; no page content changed; no localStorage key added |
| 2 | Page-by-page migration for dashboard route rows and other gauntlet-discovered surfaces, one route or same-client/route cluster per PR, ordered by risk (see [`phases.md`](./phases.md) §2) | Phase 1 | Consumer/render proof for every applicable gauntlet row; page-map rows remain pending until proof and merge |
| 3 | Cleanup: remove only proven-unused generic primitives, move any needed overlay treatment to DS tokens or shell-owned surfaces, add anti-slop guardrails | Phase 2 proof complete | zero consumers for every deletion; preserved functionality proved; `tests/__baseline__/known-fails.txt` unchanged; gates green |

Full per-phase entry/exit criteria, ordered page list, and verification
commands in [`phases.md`](./phases.md).

## Hard gates every migration PR must pass

Workers edit only. Migration orchestrator runs every gate and collects
evidence before human complete-diff review; workers do not run gates as a
substitute for that ownership. A PR is not ready until all five are green
locally (and on CI, or with the local-output fallback in
[`AGENTS.md` §6.4](../../../AGENTS.md#64-ci-gates)).

1. **Storybook build and runtime** — build catches compilation/import failures;
   actual iframe traversal and play assertions catch runtime failures. Every
   component/page/widget requires coverage under the mandatory
   [Storybook subplan](../../../plans/002-storybook-coverage.md), not only the
   original 21 reference page mocks.

   ```bash
   npm run storybook:build
   ```

   G0 must implement and wire planned package scripts `check:storybook-coverage`
   and `test:storybook` from subplan 002 before page dispatch. Both become
   mandatory per-PR gates, alongside actual-app Playwright proof; they are
   proposed commands until G0 lands, never optional omissions.

2. **ESLint** — scope to what you touched; full gate is `npm run lint`.

   ```bash
   npx eslint src/shared/ui                # DS-only port
   npx eslint src                         # app-side port
   npm run lint                            # full repo gate (includes anti-slop)
   ```

3. **Test suite** — `tests/__baseline__/known-fails.txt` must not grow.

   ```bash
   cd tests && npm run test:ci
   git diff tests/__baseline__/known-fails.txt   # must be empty
   ```

4. **Commitlint** — pre-push check from `AGENTS.md` §6.3.

   ```bash
   npx commitlint --from=origin/main --to=HEAD
   echo "<pr-title>" | npx commitlint
   ```

5. **Runtime and accessibility evidence** — when a DS primitive or shell
   changes, exercise it in both served themes. For pages, exercise dark +
   light plus empty/loading/error and modal states. Screenshots and axe alone
   do not certify WCAG 2.2 AAA: record measured applicable criteria, keyboard
   path/focus behavior, focus appearance, and target-size evaluation.

### Accessibility evidence baseline

Before page ports, remediate token contrast in `src/shared/ui/tokens.css` for
both served themes while preserving emerald/gold semantic roles. Measure at
least 7:1 for normal text, 4.5:1 for large text, and 3:1 for essential
controls and graphics. Treat missing visible keyboard focus, keyboard traps,
unreachable controls, and inaccessible dialogs as blockers. Evaluate applicable
WCAG 2.2 AAA focus-appearance and target-size requirements with recorded
measurements; do not make a blanket AAA claim from screenshots or automated
scans. This is foundation work, not a completed page migration.

## Related references

- [`AGENTS.md` §5A](../../../AGENTS.md#5a-ui--durin-ds-design-system) — ownership, golden rules, anti-patterns.
- [`docs/development/durin-ds.md`](../durin-ds.md) — token reference, component inventory, shell, page mocks.
- [`docs/development/porting-upstream-ui.md`](../porting-upstream-ui.md) — upstream-portability rules and the per-port checklist.
- [`phases.md`](./phases.md) — phased rollout with verification commands.
- [`page-map.md`](./page-map.md) — every real route, its mock, the DS components it consumes, and risk level.
- [`playbook.md`](./playbook.md) — per-page migration recipe, fully worked example on `/dashboard/health`.
- [`plans/README.md`](../../../plans/README.md) — all-page gauntlet
  execution contract; this README's dashboard inventory is subordinate to
  it, not a separate plan artifact.
