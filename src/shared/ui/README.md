# `src/shared/ui` — Durin DS

Preview-only design system for the next DurinDoor dashboard. Every file
in this tree is DurinDoor-owned; nothing in here is wired to production
yet.

## Run the preview

```bash
cd .omc/wt-durin-ds
npm install --no-audit --no-fund
npm run storybook            # http://localhost:6006
```

The Theme toolbar (sun/moon, top of the canvas) flips between
**Dark — Moria stone** (default) and **Light — Parchment**.

## Directory map

| Path | Contents |
| --- | --- |
| `tokens.css` | Raw `--dd-*` custom properties + Tailwind v4 `@theme inline` mapping. Self-contained Tailwind root. |
| `components/` | 25 React primitives, each with a matching `*.stories.jsx`. |
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
- **CSF3 stories.** `meta` declares `title`, `component`,
  `tags: ["autodocs"]`, and per-arg `argTypes` controls.
- **Page identity.** Every page renders `PageHeader` with `icon`, `title`, and
  `subtitle`; `withDashboardShell` supplies navigation chrome and optional
  actions without duplicating page identity in the persistent shell bar.

## Full documentation

- [docs/development/durin-ds.md](../../../docs/development/durin-ds.md) —
  design principles, full token reference, component inventory, page mock
  index, authoring conventions, upstream-portability notes.
