# `src/shared/ui` — Durin DS

Component and page previews for the next DurinDoor dashboard. Every file in this
tree is DurinDoor-owned. The app already imports `tokens.css`; production
component/page migration remains pending.

## Run the preview

```bash
# From the repository root of your isolated worktree:
npm install --no-audit --no-fund
npm run storybook            # http://localhost:6006
```

The Theme toolbar (sun/moon, top of the canvas) flips between
**Dark — Moria stone** (default) and **Light — Parchment**.

## Directory map

| Path | Contents |
| --- | --- |
| `tokens.css` | Raw `--dd-*` custom properties + Tailwind v4 `@theme inline` mapping. Self-contained Tailwind root. |
| `components/` | 27 React primitives, each with matching `*.stories.jsx`. |
| `shell/` | `DashboardShell`, `Header`, `Sidebar`, `withDashboardShell` decorator, `index.js` re-exports. |
| `foundation/Palette.stories.jsx` | Token proof: swatches, shape/elevation, typography. |
| `pages/<slug>/` | One folder per mocked dashboard page; each has `<Slug>Page.jsx` and `<Slug>Page.stories.jsx`. |

## Conventions

- **Token-only styling.** No hex values in component sources. Use
  `*-dd-*` utilities (`bg-dd-surface`, `text-dd-muted`,
  `border-dd-border-subtle`, …) so every component flips with the Theme
  toolbar.
- **Literal class strings.** Tailwind v4 scans source text; do not
  interpolate class names. Branch on tone / size / density with lookup
  maps of full literals, then join at render time.
- **CSF3 stories.** `meta` declares `title` and `component`; `tags:
  ["autodocs"]` is opt-in, not required. Check neighboring story before
  adding it. `argTypes` controls are per-story where useful.
- **Page identity.** Every page mock renders `PageHeader` with `icon`,
  `title`, and `subtitle`; `withDashboardShell` supplies navigation chrome
  with `activePath` and optional actions. Decorator does not accept or render
  page identity values.

> **Campaign gate:** token text contrast needs foundation remediation before
> page ports. Source token pairs are not served-surface contrast proof, and
> Storybook build, screenshots, or axe alone cannot certify WCAG 2.2 AAA.
> Workers return diffs only; orchestrator owns approved integration and
> measured current-SHA runtime evidence.

## Full documentation

- [docs/development/durin-ds.md](../../../docs/development/durin-ds.md) —
  design principles, full token reference, component inventory, page mock
  index, authoring conventions, upstream-portability notes.
