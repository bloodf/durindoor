# Durin DS — design system

> Preview-only design system for the next DurinDoor dashboard. Lives entirely
> in Storybook; no app code is wired to it yet.

## Overview

Durin DS is the replacement visual language for DurinDoor's dashboard. The
current dashboard still looks like a 9Router copy; Durin DS introduces a warm
"Moria stone" dark surface and a "Parchment" light surface, **emerald
(`#10E882` dark / `#059669` light) as the primary interactive accent** —
matching the DurinDoor logo — and a token-backed component library
previewed in Storybook before any production wiring. Gold
(`--dd-accent-2`, `#D4AF37` dark / `#A8851B` light) is retained for
secondary highlights (callouts, hover accents) and as the second series
in dual-axis charts; it is no longer the single interactive accent.

The work is concentrated in one tree so upstream 9Router PRs remain
mechanically portable:

| Path | Purpose |
| --- | --- |
| `src/shared/ui/tokens.css` | Raw `--dd-*` custom properties (light + dark) mapped to Tailwind v4 utilities via `@theme inline`. Self-contained Tailwind root. |
| `src/shared/ui/components/` | 27 React primitives (incl. `ProviderLogo`, `RangeSelector`), each with a CSF3 story. |
| `src/shared/ui/shell/` | `DashboardShell`, `Header`, `Sidebar`, `withDashboardShell` decorator. |
| `src/shared/ui/foundation/Palette.stories.jsx` | Token proof stories: swatches, shape/elevation, typography. |
| `src/shared/ui/pages/` | 22 mocked dashboard pages (one per route), each rendered inside the shell. |
| `.storybook/` | `@storybook/react-vite` config; Theme toolbar toggles `.dark` on `<html>`. |

### Run the preview

```bash
cd .omc/wt-durin-ds
npm install --no-audit --no-fund
npm run storybook           # http://localhost:6006
```

The Theme toolbar (sun/moon icon, top of the canvas) flips between
**Dark — Moria stone** (default) and **Light — Parchment**; the canvas
background follows the active theme automatically.

## Design principles

### Color roles

- **Accent (`--dd-accent`, emerald)** is the **primary** interactive
  accent. It marks the primary action (`Button variant="primary"`), the
  active tab indicator in `Tabs`, the current page in `Pagination`, the
  ON track of `Toggle`, the selected state of `Chip`, and the
  focus-derived `select` border on `Input` / `Textarea`. Emerald never
  decorates a passive surface.
- **Accent-2 (`--dd-accent-2`, gold)** is the **secondary** accent. It
  shows up on the second series of dual-axis charts (Usage page
  cost-vs-tokens line), as a soft highlight on secondary CTAs, and on
  the `aria-current` indicator strip in `Sidebar` when both colors
  would otherwise collide. Never the primary action.
- **Semantic (`--dd-success` / `--dd-warning` / `--dd-danger` / `--dd-info`)**
  are reserved for meaning: provider health, quota pressure, validation
  errors, beta/info banners. `StatusDot`, `Badge`, `StatCard` deltas, and
  the `Field` error line all draw from these tokens.
- **Neutral** (`--dd-text`, `--dd-text-muted`, `--dd-text-subtle`,
  `--dd-border`, `--dd-border-subtle`) carries the structural information
  hierarchy.
- Red is destructive-only: `Button variant="danger"` and
  `ConfirmDialog tone="danger"` are the only places red is an action color.

### Surface hierarchy

Three layered surfaces keep the dashboard readable on warm dark and warm
light palettes:

```
--dd-bg           page canvas (warmest / darkest)
  --dd-bg-alt     page-level grouping
    --dd-surface       card / panel
      --dd-surface-2   inset (table header, ghost-button hover)
        --dd-surface-3  deeper inset (selected segment, tabs)
```

Borders (`--dd-border` for structural, `--dd-border-subtle` for insets)
separate the layers; a soft warm `--dd-shadow-elevated` is reserved for
popovers (`Select`, `Tooltip`, `Drawer`, `Modal`).

### Typography & density

Inter is the system font. Components default to 13px body text (`text-[13px]`)
on 36px (md) and 28px (sm) control heights. The `.dd-tnum` helper enables
tabular figures on every metric (`StatCard` value, `Pagination` numbers,
`KeyValue` mono values, `DataTable` mono columns) so columns and counters do
not reflow as numbers change.

Density scale:

| Token | Height | Use |
| --- | --- | --- |
| `sm` | 28px (h-7) | Dense toolbars, table rows |
| `md` | 36px (h-9) | Default for forms, buttons |

### Iconography

Material Symbols Outlined, set by ligature. The font is loaded by
`globals.css`; the Storybook preview reveals the ligatures via
`.fonts-loaded` (same mechanism as the app's `src/app/layout.js`).
Icons are always `aria-hidden="true"`; the accessible name comes from
the surrounding text or the `label` prop (`IconButton`).

### Focus states

Every interactive primitive uses `outline-none focus-visible:shadow-dd-focus`
— a 3px emerald ring at 35% alpha that flips with the active theme
(`rgba(5, 150, 105, 0.35)` light, `rgba(16, 232, 130, 0.35)` dark).
Inputs add `focus:border-dd-accent`. Disabled controls collapse to
`opacity-50` and `pointer-events-none`.

### Brand mark

The Sidebar brand block renders the real app icon at
`/icons/icon-512.png` (served from `public/icons/`). A 9×9 rounded
`bg-dd-surface-3` tile holds the 28×28 image; collapsed mode hides the
wordmark but keeps the icon.

## Token reference

All tokens are defined in `src/shared/ui/tokens.css` and exposed as
Tailwind v4 utilities via `@theme inline`. The mapping is
`var(--dd-*)` → `var(--color-dd-*)` so utilities resolve at runtime and
follow the active theme.

### Color tokens

| Token | Light ("Parchment") | Dark ("Moria stone") | Generated utilities |
| --- | --- | --- | --- |
| `--dd-bg` | `#FAF6EC` | `#0E0D0B` | `bg-dd-bg`, `text-dd-bg` |
| `--dd-bg-alt` | `#F3EEDF` | `#14120F` | `bg-dd-bg-alt` |
| `--dd-surface` | `#FFFFFF` | `#1A1815` | `bg-dd-surface`, `border-dd-surface` |
| `--dd-surface-2` | `#F5F0E2` | `#22201C` | `bg-dd-surface-2` |
| `--dd-surface-3` | `#EAE3D0` | `#2C2924` | `bg-dd-surface-3` |
| `--dd-border` | `#E4DCC8` | `#332F29` | `border-dd-border` |
| `--dd-border-subtle` | `#EEE8D8` | `#26231F` | `border-dd-border-subtle` |
| `--dd-text` | `#1C1913` | `#EDE6D8` | `text-dd-text` |
| `--dd-text-muted` | `#6B6353` | `#A89F8D` | `text-dd-muted` |
| `--dd-text-subtle` | `#9A917D` | `#6E675A` | `text-dd-subtle` |
| `--dd-accent` (emerald) | `#059669` | `#10E882` | `bg-dd-accent`, `text-dd-accent`, `border-dd-accent` |
| `--dd-accent-hover` | `#047857` | `#3CF09A` | `hover:bg-dd-accent-hover` |
| `--dd-accent-soft` | `rgba(5,150,105,0.12)` | `rgba(16,232,130,0.14)` | `bg-dd-accent-soft` |
| `--dd-on-accent` | `#FFFFFF` | `#032A1A` | `text-dd-on-accent` |
| `--dd-accent-2` (gold) | `#A8851B` | `#D4AF37` | `bg-dd-accent-2`, `text-dd-accent-2` |
| `--dd-accent-2-hover` | `#8F7014` | `#E3C15A` | `hover:bg-dd-accent-2-hover` |
| `--dd-accent-2-soft` | `rgba(168,133,27,0.12)` | `rgba(212,175,55,0.14)` | `bg-dd-accent-2-soft` |
| `--dd-on-danger` | `#FFFFFF` | `#FFFFFF` | `text-dd-on-danger` |
| `--dd-backdrop` | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.6)` | `bg-dd-backdrop` |
| `--dd-success` | `#2E7D32` | `#4ADE80` | `bg-dd-success`, `text-dd-success` |
| `--dd-warning` | `#B45309` | `#FBBF24` | `bg-dd-warning`, `text-dd-warning` |
| `--dd-danger` | `#B91C1C` | `#EF4444` | `bg-dd-danger`, `text-dd-danger` |
| `--dd-info` | `#1D4ED8` | `#60A5FA` | `bg-dd-info`, `text-dd-info` |

> Naming note: the raw properties are `--dd-text-muted` and
> `--dd-text-subtle`; the generated utilities are `text-dd-muted` and
> `text-dd-subtle` (the `text-` prefix is dropped in the mapping). The
> border utility for the subtle border is `border-dd-border-subtle` —
> not `border-dd-subtle` (which resolves to the text-subtle color).

### Shape, radius, shadow

| Token | Value | Utility |
| --- | --- | --- |
| `--dd-radius` | `8px` | `rounded-dd` |
| `--dd-radius-lg` | `12px` | `rounded-dd-lg` |
| `--dd-focus` | `0 0 0 3px rgba(emerald, 0.35)` | `shadow-dd-focus` |
| `--dd-shadow-elevated` | warm multi-stop (theme-dependent) | `shadow-dd-elevated` |

Radii are theme-independent; focus ring and elevated shadow re-tint per
theme.

### Helper

| Class | Effect |
| --- | --- |
| `.dd-tnum` | `font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1` |

## Component inventory

All 27 primitives live in `src/shared/ui/components/`. Every component has
a `*.stories.jsx` next to it; group titles come from the storybook title
prefix.

### Actions

| Component | File | One-line description | Story |
| --- | --- | --- | --- |
| `Button` | `components/Button.jsx` | Four-variant action button (`primary` is the only emerald fill; `danger` is destructive only). Supports leading/trailing Material Symbols icon, `sm`/`md` size, `loading`. | `Durin DS/Actions/Button` |
| `IconButton` | `components/IconButton.jsx` | Icon-only action with required `label` (aria-label). `ghost` for toolbars, `secondary` for visible boundary. `sm`/`md`. | `Durin DS/Actions/IconButton` |

### Choice

| Component | File | One-line description | Story |
| --- | --- | --- | --- |
| `SegmentedControl` | `components/SegmentedControl.jsx` | Single-select radiogroup; arrow/Home/End keys move; selected segment is a raised neutral chip (no emerald — accent stays reserved for primary actions). | `Durin DS/Choice/SegmentedControl` |
| `Tabs` | `components/Tabs.jsx` | Underline tablist with roving tabindex. Active tab uses emerald text + 2px accent indicator (interactive = emerald). Optional neutral `count` pill. | `Durin DS/Choice/Tabs` |
| `Toggle` | `components/Toggle.jsx` | Controlled switch on `<button role="switch">`. ON track is emerald; OFF track is neutral. `sm`/`md`. With `label`/`description` it renders a settings-style row. | `Durin DS/Choice/Toggle` |

### Data

| Component | File | One-line description | Story |
| --- | --- | --- | --- |
| `DataTable` | `components/DataTable.jsx` | Token-backed `<table>` with `filterBar`, `emptyState`, `pagination` slots, density (`comfortable`/`compact`), `mono`/`align` column options, and skeleton `loading` state. Forwards a full `pagination` props object to `Pagination` — the parent owns slicing and resets `page` to 1 on `onRowsPerPageChange`. | `Durin DS/Data/DataTable` |
| `EmptyState` | `components/EmptyState.jsx` | Centered placeholder with neutral icon tile, title, message, optional primary action. | `Durin DS/Data/EmptyState` |
| `KeyValue` | `components/KeyValue.jsx` | Dense `<dl>` meta row for detail panels; entries separated by hairline dividers; `mono` values use mono stack with `.dd-tnum`. | `Durin DS/Data/KeyValue` |
| `PageHeader` | `components/PageHeader.jsx` | Top-of-page identity row: emerald icon tile, title, optional subtitle, right-aligned `actions`. Wraps on narrow viewports. | `Durin DS/Data/PageHeader` |
| `Pagination` | `components/Pagination.jsx` | Compact pager with optional rows-per-page select (10/25/50/100/`"all"`), prev/next chevrons, current page as emerald square, ellipsis gaps, and a left-side summary line. | `Durin DS/Data/Pagination` |
| `RangeSelector` | `components/RangeSelector.jsx` | Controlled date-range preset picker: `1D` / `7D` / `15D` / `1M` / `3M` / `6M` / `12M` / `All` segmented presets + a Custom button that opens a `From`/`To` date popover. Preset changes emit `{ preset }`; custom ranges emit `{ preset: "custom", from, to }` only after validation. Exports a `rangeLabel(value)` helper for human-readable labels. | `Durin DS/Data/RangeSelector` |
| `StatCard` | `components/StatCard.jsx` | Metric card: uppercase label, large tabular value, optional trend delta + hint. `tone` colors the value only; the icon stays neutral. | `Durin DS/Data/StatCard` |

### Forms

| Component | File | One-line description | Story |
| --- | --- | --- | --- |
| `Checkbox` | `components/Checkbox.jsx` | Custom 18px box driven by a hidden `<input type="checkbox" class="peer sr-only">`. Emerald fill + `check` ligature when checked; `peer-aria-invalid:` turns the box red. | `Durin DS/Forms/Checkbox` |
| `Field` | `components/Field.jsx` | Label + control + hint/error wrapper; injects `aria-invalid` / `aria-describedby` into a single child. Error line has `role="alert"`. | `Durin DS/Forms/Field` |
| `Input` | `components/Input.jsx` | Text input with optional leading icon; auto-wraps in `Field` when `label`/`hint`/`error` is set. `sm`/`md`. | `Durin DS/Forms/Input` |
| `Select` | `components/Select.jsx` | Custom dropdown (NOT native `<select>`) so the face and overlay follow DS tokens. Listbox semantics; `placement="top"` for footer toolbars. | `Durin DS/Forms/Select` |
| `Textarea` | `components/Textarea.jsx` | Multi-line text input; same API as `Input` minus the leading icon. `min-h-[96px]`, vertically resizable. | `Durin DS/Forms/Textarea` |

### Overlays

| Component | File | One-line description | Story |
| --- | --- | --- | --- |
| `ConfirmDialog` | `components/ConfirmDialog.jsx` | `Modal`-based `window.confirm` replacement. `tone="danger"` (default) is the only case red is an action color; `tone="primary"` uses emerald. | `Durin DS/Overlays/ConfirmDialog` |
| `Drawer` | `components/Drawer.jsx` | Right-edge panel sliding in over the same backdrop as `Modal`. `width` in px (default 420), `max-w-full` clamp. | `Durin DS/Overlays/Drawer` |
| `Modal` | `components/Modal.jsx` | Centered dialog, dimmed + blurred backdrop, `sm`/`md`/`lg` sizes. Esc and backdrop click close; body scroll locks. | `Durin DS/Overlays/Modal` |
| `PromptDialog` | `components/PromptDialog.jsx` | `Modal`-based `window.prompt` replacement; remounts the form on every open so `defaultValue` always starts fresh. Enter submits. | `Durin DS/Overlays/PromptDialog` |
| `Tooltip` | `components/Tooltip.jsx` | Pure-CSS bubble on `group-hover` / `group-focus-within` (no portals, no JS state). Four `side`s with a matching arrow. | `Durin DS/Overlays/Tooltip` |

### Surfaces

| Component | File | One-line description | Story |
| --- | --- | --- | --- |
| `Badge` | `components/Badge.jsx` | Small pill for metadata and semantic status. `accent`/`success`/`warning`/`danger`/`info`/`neutral` tones; `sm`/`md` sizes; optional leading icon. | `Durin DS/Surfaces/Badge` |
| `Card` | `components/Card.jsx` | Bordered `rounded-dd-lg` shell with optional `CardHeader` / `CardContent` / `CardFooter` for structured layouts. | `Durin DS/Surfaces/Card` |
| `Chip` | `components/Chip.jsx` | Compact tag for models/providers/filters. Supports `icon`, `onClick`, `onRemove`; selected state uses emerald border + `accent-soft` background. | `Durin DS/Surfaces/Chip` |
| `ProviderLogo` | `components/ProviderLogo.jsx` | Real provider logo from `public/providers/<id>.svg\|png` with an alias map (`cc` → `claude`, `cx` → `codex`, `ollama` → `ollama-local`, …) and a token-styled letter-tile fallback when no asset exists. Props: `provider` (id or alias, case-insensitive), `size` (px box, default 28), `className`. | `Durin DS/Surfaces/ProviderLogo` |
| `StatusDot` | `components/StatusDot.jsx` | 8px dot for provider/connection/job states, optional `pulse` ring for live states, optional muted label. Five tones. | `Durin DS/Surfaces/StatusDot` |

## Shell

| File | Exports | Story |
| --- | --- | --- |
| `shell/DashboardShell.jsx` | `DashboardShell` — full-viewport shell (Sidebar + Header + scrollable main). | `Durin DS/Shell/FullDashboardShell` |
| `shell/Header.jsx` | `Header` — persistent top bar with optional page identity (`icon`/`title`/`subtitle`) and `actions`. Includes the light/dark theme toggle, language, and apps menu icon buttons. | `Durin DS/Shell/HeaderBare`, `HeaderWithPageTitle`, `HeaderWithActions` |
| `shell/Sidebar.jsx` | `Sidebar`, `NAV_GROUPS`, `flattenNav` — collapsible nav grouped by `OBSERVE` / `ROUTE` / `OPTIMIZE` / `MEDIA` / `SYSTEM` / `HELP`. Brand block renders `/icons/icon-512.png`; a bottom-pinned **Collapse** control toggles collapsed/expanded (no close X — collapse is the only way to compress the rail). | `Durin DS/Shell/SidebarDefault`, `SidebarProvidersActive`, `SidebarCollapsed`, `SidebarTokenSaverExpanded` |
| `shell/withDashboardShell.jsx` | `withDashboardShell({...})` — Storybook decorator that wraps a page story in `DashboardShell`. | n/a (used by every page story) |
| `shell/index.js` | Re-exports for `@/shared/ui/shell`. | n/a |

`NAV_GROUPS` is the canonical dashboard navigation. The current order
(top to bottom) is: OBSERVE → ROUTE → OPTIMIZE → MEDIA → SYSTEM → HELP;
the `flattenNav` helper exposes every leaf for the command palette.

## Page mock inventory

Every page mock under `src/shared/ui/pages/<slug>/<Slug>Page.jsx` has a
matching `<Slug>Page.stories.jsx` that wraps it in `DashboardShell` via
`withDashboardShell({ activePath, title, subtitle, icon })` so it renders
in fullscreen. The story title mirrors the page name; routes below come
straight from each story's `activePath` (read with `grep` — no inference).

| Page story title | `activePath` | Mock path |
| --- | --- | --- |
| `Durin DS/Pages/API Docs` | `/dashboard/api-docs` | `pages/api-docs/ApiDocsPage.jsx` |
| `Durin DS/Pages/CLI Tools` | `/dashboard/cli-tools` | `pages/cli-tools/CliToolsPage.jsx` |
| `Durin DS/Pages/Combos` | `/dashboard/combos` | `pages/combos/CombosPage.jsx` |
| `Durin DS/Pages/Console Log` | `/dashboard/console-log` | `pages/console-log/ConsoleLogPage.jsx` |
| `Durin DS/Pages/Endpoint & Key` | `/dashboard/endpoint` | `pages/endpoint/EndpointPage.jsx` |
| `Durin DS/Pages/Headroom` | `/dashboard/headroom` | `pages/headroom/HeadroomPage.jsx` |
| `Durin DS/Pages/Health` | `/dashboard/health` | `pages/health/HealthPage.jsx` |
| `Durin DS/Pages/MCP Gateway` | `/dashboard/mcp-gateway` | `pages/mcp-gateway/McpGatewayPage.jsx` |
| `Durin DS/Pages/MCP Help` | `/dashboard/mcp-help` | `pages/mcp-help/McpHelpPage.jsx` |
| `Durin DS/Pages/Media Providers` | `/dashboard/media-providers/embedding` | `pages/media-providers/MediaProvidersPage.jsx` |
| `Durin DS/Pages/Playground` | `/dashboard/playground` | `pages/playground/PlaygroundPage.jsx` |
| `Durin DS/Pages/Providers` | `/dashboard/providers` | `pages/providers/ProvidersPage.jsx` |
| `Durin DS/Pages/Proxy Pools` | `/dashboard/proxy-pools` | `pages/proxy-pools/ProxyPoolsPage.jsx` |
| `Durin DS/Pages/Quota Tracker` | `/dashboard/quota` | `pages/quota/QuotaPage.jsx` |
| `Durin DS/Pages/Settings` | `/dashboard/profile` | `pages/settings/SettingsPage.jsx` |
| `Durin DS/Pages/Skills` | `/dashboard/skills` | `pages/skills/SkillsPage.jsx` |
| `Durin DS/Pages/Test Savers` | `/dashboard/compression-studio` | `pages/test-savers/TestSaversPage.jsx` |
| `Durin DS/Pages/Timeline` | `/dashboard/timeline` | `pages/timeline/TimelinePage.jsx` |
| `Durin DS/Pages/Token Saver Settings` | `/dashboard/token-saver/settings` | `pages/token-saver-settings/SettingsPage.jsx` |
| `Durin DS/Pages/Token Saver Statistics` | `/dashboard/token-saver` | `pages/token-saver/TokenSaverStatsPage.jsx` |
| `Durin DS/Pages/Usage & Analytics` | `/dashboard/usage` | `pages/usage/UsagePage.jsx` |

Each `<Slug>Page.jsx` imports from `@/shared/ui/components/*` and
`@/shared/ui/shell/withDashboardShell.jsx` for its story; page bodies
consume only token utilities and never set hex colors.

### Recent page redesigns

The redesigned pages now exercise the full DS primitive set:

- **Usage & Analytics** — `RangeSelector` (presets + custom From/To) drives a combined **tokens + cost** dual-axis `LineChart` (primary = `--dd-accent`, second = `--dd-accent-2`). Below the chart: `StatCard` row → "Usage by API key" table with per-key expandable per-model breakdown → "Usage by provider" table → "Recent requests" table, all of which use `DataTable` with the new `pagination` prop (rows-per-page selector + summary line).
- **Timeline** — Provider / status / model filters (`Select`) + a live `Toggle` (Updates the area chart). The graphs row recomputes from the filtered `rows` (`useMemo`) and reacts to filter changes; `ReferenceDot` highlights the latest event. A `Drawer` opens for row details via `KeyValue`.
- **Console Log** — `Tabs` switches between **Log** (rolling buffer with level chips, search, pause, clear) and **Timeline** (60-min volume, level distribution, source activity) views. The `StatusDot` `pulse` ring marks live updates.
- **Playground** — Model picker renders `ProviderLogo` in both the trigger and the option list, and as a small badge next to each model in the suggestion chips. The composer feeds the local OpenAI-compatible endpoint.
- **Skills** — `Select` for endpoint, `Select` for API key, a custom-endpoint `Input`, and a **Preview & copy** composer that builds a copy-ready `curl` snippet and writes it to the clipboard via a `Button` with copy-state feedback.
- **Providers** — `ProviderLogo` on every card; a status `Select` filter (All / Active only / Deactivated / Not configured) + search `Input`; a `Toggle` per provider, a `StatusDot` / `Badge` for connection state, and a per-section "Test All" `Button` (ghost).

## Foundation

| File | Story | What it proves |
| --- | --- | --- |
| `foundation/Palette.stories.jsx` | `Palette`, `Typography` | Every `--dd-*` token rendered as a swatch grid (surfaces, borders, text, accent + accent-2, status), plus shape/elevation demos and a typography specimen. The Accent section labels the pair: "Brand emerald (logo) = primary interactive; gold = secondary/highlights". The first thing to check when changing `tokens.css`. |

## Authoring conventions

### File shape

- One component per file. Filename = component name in `PascalCase`
  (e.g. `Toggle.jsx`). `Card.jsx` is the lone exception that ships
  related sub-components in the same file (`Card`, `CardHeader`,
  `CardContent`, `CardFooter`).
- **Export style varies.** Most primitives use `export default
  function`. `Badge`, `Card`, `Chip`, and `StatusDot` use **named
  exports only** (no `export default` in their `.jsx`) — confirm by
  reading the file before importing. `ProviderLogo` is the exception
  among newly added components: it ships **both** a default export and
  a named export for ergonomic imports. `shell/index.js` re-exports
  the shell modules; components are imported directly from their file.
- The story is the next file over: `Toggle.stories.jsx`. CSF3 only
  (no `storiesOf`); `meta` declares `title` and `component`, plus
  optional `argTypes` controls.
- `tags: ["autodocs"]` is opt-in. `Button.stories.jsx`,
  `Checkbox.stories.jsx`, and `IconButton.stories.jsx` are the only
  three that set it (verified with `grep -l "tags: \["`); the other
  24 stories do not. Don't add it speculatively; check the
  neighboring story first.
- Group titles under `Durin DS/<Group>/<Component>` (Actions / Choice /
  Data / Forms / Overlays / Surfaces / Shell / Foundation / Pages). Page
  mocks use `Durin DS/Pages/<Title>`.

### Token-only styling

- **Never** hardcode a hex value in a component. Reference the tokens
  through the generated utilities (`bg-dd-surface`, `text-dd-muted`,
  `border-dd-border-subtle`, …). The Theme toolbar must always flip the
  component.
- **Never** interpolate class names. Tailwind v4 scans source text for
  candidates; concatenated or template-literal class fragments generate
  no CSS. Branch on tone/size/density via lookup maps of full literal
  class strings (`TONE_CLASSES`, `SIZES`, …) and join at render time.
  This is a project-wide pattern, not a per-component choice — see
  `Button.jsx`, `Badge.jsx`, `Chip.jsx`, `Tooltip.jsx`, `StatusDot.jsx`,
  `Modal.jsx` for the canonical examples.

### Density and size

| Size | Height | Typical use |
| --- | --- | --- |
| `sm` | 28px (`h-7`) | Dense toolbars, table footers |
| `md` | 36px (`h-9`) | Default for forms, buttons |

Default to `md` everywhere. `sm` only in dense toolbars (`Header`
actions, `Pagination`, table rows).

### Focus and disabled

- Every interactive primitive uses
  `outline-none focus-visible:shadow-dd-focus`.
- Disabled state is `disabled:pointer-events-none disabled:opacity-50`
  for buttons; `disabled:cursor-not-allowed disabled:opacity-60` for
  inputs.

### Accessibility

- Every IconButton has a required `label` (used as `aria-label`); the
  glyph itself is `aria-hidden`.
- `Tabs`, `SegmentedControl` implement roving tabindex with arrow / Home
  / End navigation.
- `Select` uses `aria-haspopup="listbox"` + `aria-expanded` on the
  trigger and `role="listbox"` / `role="option" aria-selected` in the
  overlay.
- `Field` injects `aria-invalid` / `aria-describedby` into a single
  child control. Error lines carry `role="alert"`.
- `RangeSelector` opens the custom-date popover as a `role="dialog"`
  with `aria-haspopup="dialog"` on the trigger; `Escape` and outside
  pointer close it.

## Upstream-portability notes

Durin DS lives in `src/shared/ui/`. Everything else in the repo tracks
upstream 9router. For the full porting playbook — including how to
rebase a UI-heavy 9router PR onto DS tokens and how to decide what
becomes a new primitive — see
[`docs/development/porting-upstream-ui.md`](./porting-upstream-ui.md).
This section is a short summary; the playbook is authoritative.

### What is DurinDoor-owned

- `src/shared/ui/tokens.css`
- `src/shared/ui/components/`
- `src/shared/ui/shell/`
- `src/shared/ui/foundation/`
- `src/shared/ui/pages/`

These directories are diffed against `origin/main`, not against upstream.
They can be edited freely and the visual language can diverge aggressively
from 9router.

### What is upstream-tracking

- `src/app/**` (current dashboard, layout, globals)
- `open-sse/**` (compatibility API core)
- `src/sse/**` (routing layer)
- `tests/**`

These directories receive 9router PRs via `port/upstream-*` branches. The
upstream-portability rule applies here.

### Merge rule for styled pages (summary)

1. **Take the upstream logic.** State, effects, data flow, server calls,
   error handling, and accessibility wiring come from upstream verbatim.
2. **Keep our classes.** Replace the upstream `className` strings with
   `*-dd-*` token utilities. If the upstream PR adds a new class name,
   check the [token reference](#token-reference) for the right
   `*-dd-*` utility before writing anything new.
3. **Promote repeat patterns into `src/shared/ui/components/`.** If the
   same JSX+classes appear in three or more page mocks, extract a
   primitive (see the existing 27).
4. **Never edit `src/app/globals.css` from a Durin DS PR.** Tailwind v4
   only generates utilities for `@theme` tokens visible in the same
   compilation, which is why `tokens.css` is its own Tailwind root.
   `globals.css` stays neutral so upstream PRs can keep merging.
5. **Re-run the Storybook preview.** Toggle the Theme toolbar to confirm
   the change flips cleanly in both palettes.

### Porting a PR that introduces a new component (summary)

1. Add the component under `src/shared/ui/components/<Name>.jsx`. Use
   only `*-dd-*` utilities; no hex values.
2. Add `<Name>.stories.jsx` next to it with at least one CSF3 story per
   meaningful prop axis (variants, sizes, states).
3. If the component should appear on multiple page mocks, use it from
   those mocks; do not duplicate the JSX.
4. Run `cd .omc/wt-durin-ds && npm run storybook` and visually verify in
   both themes.
