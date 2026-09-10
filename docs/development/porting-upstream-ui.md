# Porting upstream 9Router UI to Durin DS

> Audience: agents that port upstream PRs which touch styled pages or shared
> components. Read [`durin-ds.md`](./durin-ds.md) once for the visual language,
> then use this playbook as the operational checklist per port.

## 1. Ownership map

| Boundary | Owner | Rule |
| --- | --- | --- |
| `src/shared/ui/**` (tokens, components, shell, foundation, pages) | **DurinDoor** | Diffed against `origin/main`, free hand. Durin styling wins. |
| `.storybook/**` | **DurinDoor** | Free hand. |
| `docs/development/durin-ds.md`, this file | **DurinDoor** | Free hand. |
| `src/app/(dashboard)/**` | upstream-tracking | Preserve upstream behavior (state, effects, data flow, error handling, a11y wiring). Apply Durin DS primitives; class strings and structural JSX change as the golden rules require (raw `<select>` → `Select`, raw `<table>` → `DataTable`, `window.prompt` → `PromptDialog`, etc.). |
| `src/shared/components/**` | upstream-tracking | Same rule. |
| `src/app/globals.css` | upstream-tracking | **Never edit from a Durin DS PR.** Tailwind v4 only generates utilities for `@theme` tokens visible in the same compilation; `tokens.css` is its own Tailwind root. |
| `open-sse/**`, `src/sse/**`, `tests/**` | upstream-tracking | Logic-only ports. Styling not in scope. |

When an upstream PR adds a new class name to `src/app/...`, do not ship it
as-is. Find the matching `*-dd-*` token utility in
[`durin-ds.md` §"Token reference"](./durin-ds.md#token-reference) and rewrite
the class string. When the upstream PR introduces a new interactive
primitive (a raw `<table>` with its own pager, a `<select>`, a
`window.prompt` call, an ad-hoc confirm dialog, a custom provider glyph),
replace the JSX with the matching DS primitive from §3 below — the
caller's hooks, fetch, and state are the part that stays. Never
interpolate; never ship hex.

## 2. Golden rules (apply to every port)

1. **Token-only styling.** `bg-dd-*`, `text-dd-*`, `border-dd-*`,
   `rounded-dd*`, `shadow-dd-*` only. No hex. No raw Tailwind palette
   utilities (`bg-emerald-500`, `text-blue-600`, …). Branch tone/size/density
   via lookup maps of full literal class strings (see `Button.jsx`,
   `Badge.jsx`, `StatusDot.jsx`, `ConfirmDialog.jsx`).
2. **No `window.prompt` / `window.confirm`.** Use `PromptDialog` /
   `ConfirmDialog` from `@/shared/ui/components/`.
3. **No native `<select>`.** Use `Select` from
   `@/shared/ui/components/Select.jsx` (custom listbox, DS-styled). Note:
   `Pagination` keeps a native `<select>` for its rows-per-page control —
   that is the one intentional exception, do not "fix" it.
4. **Tables → `DataTable` + `Pagination`.** Every paged list passes a
   `pagination` prop. Rows-per-page options: `[10, 25, 50, 100, "all"]`
   (the `Pagination` default — do not hand-roll).
5. **Range filters → `RangeSelector`.** Every "last 7 days / custom"
   filter uses it. Do not build a custom two-date-input widget.
6. **Provider branding → `ProviderLogo`.** Resolve
   `provider → /providers/<id>.svg|png` via the `ALIASES` table; falls
   back to a neutral letter tile.
7. **Charts: single graph, multiple series.** Primary series
   `stroke="var(--dd-accent)"`, secondary `stroke="var(--dd-accent-2)"`.
   Never split the same metric into tabbed sub-graphs.
8. **Focus rings `outline-none focus-visible:shadow-dd-focus`.** Every
   interactive primitive. Disabled: `disabled:pointer-events-none
   disabled:opacity-50` (buttons) or
   `disabled:cursor-not-allowed disabled:opacity-60` (inputs).
9. **Icons via material-symbols ligatures.** `<span className="material-symbols-outlined"
   aria-hidden="true">{name}</span>`. Never import a glyph SVG.
10. **Density defaults.** Body `text-[13px]`, meta `text-xs`, metrics
    `dd-tnum`. PageHeader title `text-xl font-semibold tracking-tight`.
    All controls render at one height, 44px (`min-h-11`); `size="sm"` only
    shrinks padding/font in dense toolbars — never set a fixed `h-*` on a
    control.
11. **Keep live adapters and prop fidelity.** Retain caller's existing hooks,
    query adapters, and callback behavior. Never make a lossy call-site DS
    prop replacement before prerequisite primitive parity exists.

## 3. Before / after patterns

### 3.1 Page header

Upstream-style (in `src/app/(dashboard)/.../page.js`):

```jsx
<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
  <div className="min-w-0">
    <h1 className="text-2xl font-bold text-text-main">Combos</h1>
    <p className="text-sm text-text-muted mt-1">Group models under one name…</p>
  </div>
  <Button className="w-full sm:w-auto">Create Combo</Button>
</div>
```

Durin DS (the page mock at
`src/shared/ui/pages/combos/CombosPage.jsx:137`):

```jsx
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import Button from "@/shared/ui/components/Button.jsx";

<PageHeader
  icon="layers"
  title="Combos"
  subtitle="Model combos with fallback"
  actions={
    <Button variant="primary" icon="add">Create Combo</Button>
  }
/>
```

Notes: `PageHeader` handles wrapping/right-alignment. Its icon tile is
emerald-tinted (`bg-dd-accent-soft text-dd-accent`).

### 3.2 Table with pagination

Upstream-style:

```jsx
<table className="min-w-full text-sm">
  <thead className="bg-surface-2 text-text-muted">
    <tr>
      <th className="px-4 py-2 text-left">Name</th>
      <th className="px-4 py-2 text-right">Tokens</th>
    </tr>
  </thead>
  <tbody>
    {rows.map((row) => <tr key={row.id}>…</tr>)}
  </tbody>
</table>
<div className="flex justify-end gap-2 mt-2">
  <button onClick={() => setPage(page - 1)}>Prev</button>
  <span>{page} / {pageCount}</span>
  <button onClick={() => setPage(page + 1)}>Next</button>
</div>
```

Durin DS (schematic; reuse caller's actual existing hook/result and callback
names — names below are illustrative only):

```jsx
import DataTable from "@/shared/ui/components/DataTable.jsx";

// Keep upstream query hooks, server pagination metadata, and server-returned
// rows intact. `DataTable` renders `rows`; do not introduce client slicing.
// `rows`, `page`, `pageCount`, `total`, `rowsPerPage`, `onPage`, and
// `onRowsPerPageChange` are caller-owned existing values/callbacks.

const columns = [
  { key: "name", label: "Name" },
  { key: "tokens", label: "Tokens", align: "right", mono: true },
];

<DataTable
  columns={columns}
  rows={rows}
  keyFn={(row) => row.id}
  density="compact"
  filterBar={/* Select / Input / RangeSelector, size="sm" */}
  emptyState={{ icon: "inbox", title: "No rows", message: "Nothing here yet." }}
  pagination={{
    page,
    pageCount,
    total,
    rowsLabel: `Showing server page ${page} of ${pageCount} (${total} results)`,
    onPage,
    rowsPerPage,
    onRowsPerPageChange,
  }}
/>
```

`Pagination` owns prev/next chevrons, current page as an emerald square, and
the rows-per-page select. Preserve existing fetch hooks, live adapters, server
totals, and callback behavior; do not reset or reshape them for DS.

### 3.3 Modal confirm

Upstream-style:

```jsx
<ConfirmModal
  isOpen={!!confirmState}
  onClose={() => setConfirmState(null)}
  onConfirm={confirmState?.onConfirm}
  title="Delete combo?"
  message="This cannot be undone."
  variant="danger"
/>
```

Durin DS:

```jsx
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";

<ConfirmDialog
  open={!!confirmState}
  title="Delete combo?"
  message="This cannot be undone."
  confirmLabel="Delete"
  cancelLabel="Cancel"
  tone="danger"
  onConfirm={confirmState?.onConfirm}
  onCancel={() => setConfirmState(null)}
/>
```

Differences: prop names are `open` / `onCancel` (DS); `tone="danger"`
keeps red as action color (the one place red is allowed); `Modal` size
is fixed at `sm`.

## 4. Port checklist (paste into PR body)

```markdown
## Port checklist (Durin DS)

- [ ] Read `docs/development/durin-ds.md` and the relevant component
      stories under `src/shared/ui/components/`.
- [ ] Preserve upstream behavior (state, effects, data flow, error
      handling, a11y wiring); rewrite classes and JSX only as the DS
      rules require (raw `<select>` → `Select`, raw `<table>` + pager
      → `DataTable` + `pagination`, `window.prompt` → `PromptDialog`,
      etc.).
- [ ] Replace every color/size literal with `*-dd-*` token utilities. No
      hex. No raw Tailwind palette utilities.
- [ ] Replace every `window.prompt` / `window.confirm` with
      `PromptDialog` / `ConfirmDialog`.
- [ ] Replace every native `<select>` with `Select`. The only allowed
      exception is the rows-per-page control that `Pagination` renders
      internally (`src/shared/ui/components/Pagination.jsx:14,98`):
      call `Pagination` (or `DataTable`'s `pagination` prop) and never
      write your own `<select>` for rows-per-page.
- [ ] Retain live adapters, caller hooks, and existing callback behavior.
      Never make a lossy DS prop replacement before prerequisite primitive
      parity exists.
- [ ] Replace every hand-rolled table + prev/next pager with
      `DataTable` + `pagination` prop on `DataTable`. Rows-per-page options
      `[10, 25, 50, 100, "all"]`.
- [ ] Replace every date-range filter widget with `RangeSelector`.
- [ ] Replace every provider-branding glyph with `ProviderLogo`.
- [ ] Replace every chart with a single Recharts component; primary
      series `var(--dd-accent)`, secondary `var(--dd-accent-2)`. No
      metric-tabbed sub-graphs.
- [ ] Add `outline-none focus-visible:shadow-dd-focus` to every
      interactive primitive that lacks it.
- [ ] Icons via `<span className="material-symbols-outlined"
      aria-hidden="true">{name}</span>`.
- [ ] Density: body `text-[13px]`, meta `text-xs`, metrics
      `dd-tnum`. No raw `text-base` on the page body.
- [ ] New shared component? Add it under `src/shared/ui/components/<Name>.jsx`
      with a `*.stories.jsx` next to it (one CSF3 story per meaningful
      prop axis). Do not put it under `src/shared/components/`.
- [ ] Did not touch `src/app/globals.css`; it is read-only in every phase.
- [ ] Did not introduce a hex value.
- [ ] Did not grow `tests/__baseline__/known-fails.txt`.
- [ ] Orchestrator ran required gates, formatter, and browser checks after
      worker edits; workers do not run them.
- [ ] Visual proof includes Storybook's actual iframe under classic JSX
      runtime and affected app surface, in both palettes, including AAA
      contrast where applicable. A successful Storybook build alone is not
      proof.
- [ ] Human approved full diff before push or PR.
```

## 5. Verification and review ownership

Workers edit only. They do not run gates, formatters, builds, linters, tests,
or browser checks. The orchestrator runs every required gate and formatter
after worker edits, then obtains actual browser proof.

Storybook build is necessary but does not prove classic JSX runtime or
accessibility. Browser proof must open Storybook's rendered iframe and affected
app surface, verify both palettes, and verify AAA contrast where applicable.

Human reviews and approves the complete diff before any push or PR.

If GitHub Actions minutes are exhausted, the orchestrator pastes local command
output (fenced `bash` block per command, with exit codes) into the PR body.
See [`AGENTS.md` §6.4](../../AGENTS.md#64-ci-gates).

## 6. When to add a new DS component

A new pattern is a new DS component if the **same JSX+classes** show up
in three or more page mocks or app pages. The 27 existing primitives are in
[`durin-ds.md` §"Component inventory"](./durin-ds.md#component-inventory).
Add a component only when prerequisite primitive parity exists and pattern
survives two ports; do not replace DS props lossily to force a migration.

Steps:

1. `src/shared/ui/components/<Name>.jsx` — token-only, full-literal
   class names (Tailwind v4 source scan).
2. `src/shared/ui/components/<Name>.stories.jsx` — one CSF3 story per
   meaningful prop axis. Title `Durin DS/<Group>/<Component>`.
3. Replace duplicated JSX only after prerequisite primitive parity; retain
   live adapters and upstream behavior.
4. Orchestrator verifies Storybook iframe and app surface under classic JSX
   runtime, both palettes, and AAA contrast where applicable.

## 7. Pitfalls (verified against source)

- **Native `<select>` in upstream code.** Almost every
  `src/app/(dashboard)/.../page.js` ships a native `<select>` with raw
  `bg-surface border-border` classes. Replace with `Select`; otherwise
  the dropdown's OS-rendered chrome will not flip with the Theme
  toolbar and will not match the rest of the dashboard.
- **`window.prompt` in `src/app/.../cli-tools/components/BaseUrlSelect.js`
  and `EndpointPresetControl.js`, and in
  `src/app/.../mcp-gateway/page.js`.** Replace each with
  `PromptDialog`. The caller owns the `onSubmit(value)` callback and
  the open/close state.
- **`hover:border-dd-subtle` resolves to a text-color token.** Tailwind
  v4's `border-*` utilities map to `--color-dd-*`, and
  `dd-subtle` is defined as `--color-dd-subtle: var(--dd-text-subtle)`.
  Use `hover:border-dd-border-subtle` instead. (See
  [`durin-ds.md` §"Token reference"](./durin-ds.md#token-reference).)
- **Interpolated class names generate no CSS.** Tailwind v4 scans source
  text. Lookup maps of full literals (e.g. `VARIANTS`, `SIZES`,
  `TONE_CLASSES`) are the project pattern — do not template-literal
  class fragments.
- **Single accent (emerald) is the interactive color; gold is the
  secondary accent.** `--dd-accent` is emerald
  (light `#059669`, dark `#10E882`); `--dd-accent-2` is gold
  (light `#A8851B`, dark `#D4AF37`). Reserve gold for secondary
  emphasis; primary actions stay emerald.
- **`Pagination` keeps a native `<select>` for rows-per-page on
  purpose.** It is the one intentional exception to rule 3. Do not
  "fix" it during a port.
- **`globals.css` is read-only from DS PRs.** Upstream CSS lives
  there; `tokens.css` is its own Tailwind root so utilities for
  `dd-*` tokens exist in the same compilation as the component
  source.

## 8. Related references

- [`durin-ds.md`](./durin-ds.md) — token reference, component inventory,
  shell, page mocks, authoring conventions, known inconsistencies.
- [`AGENTS.md`](../../AGENTS.md) §5A — compact ownership + golden rules
  for the agent contract.
