# `src/shared/ui` — Durin DS

This directory contains production UI primitives alongside Storybook previews.
The components under `src/shared/ui/components/` are production primitives used
by about 156 importers. The pages under `src/shared/ui/pages/` and the shell
under `src/shared/ui/shell/` are Storybook previews; they are not the shipped
dashboard pages or shell. The shipped shell is implemented by
`src/shared/components/Sidebar.js` and `src/shared/components/Header.js`, which
have their own Storybook stories.

## Run the previews

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
| `components/` | Production React primitives, each with matching `*.stories.jsx` files. |
| `shell/` | Storybook preview shell, header and sidebar; these preview the UI and are not the shipped shell. |
| `foundation/Palette.stories.jsx` | Token proof: swatches, shape/elevation, typography. |
| `pages/<slug>/` | Mocked dashboard page previews; each has `<Slug>Page.jsx` and `<Slug>Page.stories.jsx`. |

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
  `title`, and `subtitle`; `withDashboardShell` supplies preview navigation
  chrome with `activePath` and optional actions. Decorator does not accept or
  render page identity values.

> **Campaign gate:** token text contrast needs foundation remediation before
> page ports. Source token pairs are not served-surface contrast proof, and
> Storybook build, screenshots, or axe alone cannot certify WCAG 2.2 AAA.
> Workers return diffs only; orchestrator owns approved integration and
> measured current-SHA runtime evidence.

## Full documentation

- [internal/docs/design-system.mdx](../../../internal/docs/design-system.mdx)
  tokens, primitives, Storybook, and authoring rules
