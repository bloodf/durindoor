# UI migration campaign — Durin DS

> Operational playbook for the migration of the 9Router-inherited dashboard
> UI to the Durin DS design system. Audience: AI harness / agents
> (Hermes cron agent, OMP subagents, Codex) that execute the per-page PRs.
> Not for humans. Imperative, checklist-driven.

## Goal

Replace every visual surface in `src/app/(dashboard)/**` and the legacy
`src/shared/components/*` primitives that those pages consume with the
Durin DS primitives in `src/shared/ui/components/`, the shell in
`src/shared/ui/shell/`, and the tokens in `src/shared/ui/tokens.css`. End
state: the live dashboard matches the 22 page mocks in
`src/shared/ui/pages/<slug>/<Slug>Page.jsx` (rendered today only in
Storybook), and the legacy coral/green/gold palette tokens in
`src/app/globals.css` are gone.

## Strategy

- **Diverge in skin, converge in skeleton.** All logic stays upstream-shaped
  (state, effects, data fetching, error handling, a11y wiring) — only the
  class strings and JSX structure change to match the Durin DS rules. The
  page-mock visuals are the spec; the real page file is the substrate.
- **One route group per PR.** Each migration PR owns exactly one real
  route (or one tightly coupled route cluster such as
  `media-providers/[kind]`). The page map in
  [`page-map.md`](./page-map.md) lists every PR.
- **Upstream ports keep applying during migration.** The
  `src/shared/ui/**` and `.storybook/**` trees are DurinDoor-owned, but
  `src/app/(dashboard)/**` and `src/shared/components/**` remain
  upstream-tracking. Migration PRs edit only the per-page surface; an
  upstream port that touches a different page merges independently. When
  both touch the same file, follow the merge rule in
  [`porting-upstream-ui.md` §1](../porting-upstream-ui.md) — keep upstream
  logic verbatim, apply Durin DS styling.
- **Adapters first, then pages.** A page can only render with Durin DS
  styling once the foundation (tokens loaded) and the behavior-preserving
  shell adapters (Sidebar / Header / DashboardLayout) are in place.
  Phase 0 (tokens) and Phase 1 (adapter re-skin) must land before the
  first Phase 2 page PR merges. The `src/shared/ui/shell/` modules are
  the visual reference for the adapters — they are not mounted
  directly.
- **Mock is source of truth for visuals.** For every page, the matching
  `src/shared/ui/pages/<slug>/<Slug>Page.jsx` is the visual spec. The
  playbook in [`playbook.md`](./playbook.md) walks the per-page recipe.
  When a route has no mock, port the pattern from the closest mock and
  record the deviation in the PR body.
- **No behavior change.** Migration PRs must not change API calls, route
  paths, localStorage keys, server fn inputs, i18n keys, or any
  fetch/error/loading observable. The harness enforces this on every PR
  (see [`harness-runbook.md`](./harness-runbook.md)).

## Phase plan

| Phase | Scope | Pre-req | Exit gate |
| --- | --- | --- | --- |
| 0 | Foundation adoption: tokens loaded in app, legacy primitives repointed to `*-dd-*` tokens | none | `npm run storybook:build` green; app launches in dev with new token layer; no page content changed |
| 1 | Shell re-skin: `Sidebar`, `Header`, `DashboardLayout` adopt the Durin DS visual design through behavior-preserving adapters; do not re-export or mount `src/shared/ui/shell/` directly | Phase 0 | App launches; nav order matches regrouped `NAV_GROUPS`; mobile menu, auth/logout, version banner, toast rail, and collapse toggle all preserved; no page content changed; no localStorage key added |
| 2 | Page-by-page migration, one route per PR, ordered by risk (see [`phases.md`](./phases.md) §2) | Phase 1 | All "leaf" routes green, then "management", then "analytics", then "playground"; per-page gates (lint + storybook build + test:ci + commitlint + visual) |
| 3 | Cleanup: delete replaced primitives, drop grid overlay, retire legacy `globals.css` tokens, add anti-slop guardrails | Phase 2 fully merged | `grep -rE "bg-brand-|text-brand-|bg-gold-|--color-brand-" src/app` empty; `tests/__baseline__/known-fails.txt` unchanged; lint + storybook:build + test:ci all green |

Full per-phase entry/exit criteria, ordered page list, and verification
commands in [`phases.md`](./phases.md).

## Hard gates every migration PR must pass

These run before `git push`; a PR is not ready until all five are green
locally (and on CI, or with the local-output fallback in
[`AGENTS.md` §6.4](../../../AGENTS.md#64-ci-gates)).

1. **Storybook build** — catches broken prop signatures, missing imports,
   classic-JSX-runtime regressions, and orphaned mocks.

   ```bash
   npm run storybook:build
   ```

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

5. **Visual check** — when a DS primitive or the shell changed, toggle the
   Theme toolbar in `npm run storybook` and confirm both palettes render.
   For page PRs, exercise the route in dev (`npm run dev`) in dark + light
   plus the page's empty / loading / modal states.

## Related references

- [`AGENTS.md` §5A](../../../AGENTS.md#5a-ui--durin-ds-design-system) — ownership, golden rules, anti-patterns.
- [`docs/development/durin-ds.md`](../durin-ds.md) — token reference, component inventory, shell, page mocks.
- [`docs/development/porting-upstream-ui.md`](../porting-upstream-ui.md) — upstream-portability rules and the per-port checklist.
- [`phases.md`](./phases.md) — phased rollout with verification commands.
- [`page-map.md`](./page-map.md) — every real route, its mock, the DS components it consumes, and risk level.
- [`playbook.md`](./playbook.md) — per-page migration recipe, fully worked example on `/dashboard/health`.
- [`harness-runbook.md`](./harness-runbook.md) — how the AI harness executes the campaign.
