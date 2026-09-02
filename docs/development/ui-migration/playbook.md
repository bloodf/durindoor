# Per-page migration recipe

> Numbered mechanical procedure. Each page PR is one execution of this
> procedure. The mock under `src/shared/ui/pages/<slug>/<Slug>Page.jsx`
> is the visual spec; the real page under
> `src/app/(dashboard)/dashboard/...` is the substrate.

## 0. Pre-flight

- Confirm the page is in the current phase's wave (see
  [`phases.md`](./phases.md) §2).
- Create a worktree at `.omc/wt-ds-<slug>/` from `origin/main` (or from
  the in-flight `feat/ds-migrate-<slug>` branch's parent — see
  [`harness-runbook.md`](./harness-runbook.md)).
- Read the matching `*.stories.jsx` for the page's mock to get the
  `activePath`, title, subtitle, and icon. These become the
  `PageHeader` props.
- Read [`durin-ds.md` §"Component inventory"](../durin-ds.md#component-inventory)
  for any DS primitives the mock uses that you do not already know.

## 1. Read the mock — it is the visual spec

```bash
open src/shared/ui/pages/<slug>/<Slug>Page.jsx
open src/shared/ui/pages/<slug>/<Slug>Page.stories.jsx
```

Note:

- The `PageHeader` icon/title/subtitle (from the story's
  `withDashboardShell({ activePath, title, subtitle, icon })`).
- Every DS component the mock uses (e.g. `DataTable`, `RangeSelector`,
  `StatCard`, `Drawer`, `KeyValue`, `Tabs`, `ProviderLogo`,
  `Pagination`).
- Any custom classes (`text-dd-text`, `border-dd-border-subtle`,
  `rounded-dd-lg`, …) — these confirm the `*-dd-*` utility to use.

## 2. Keep the page's data and behavior byte-identical

The page's hooks, fetch calls, state, effects, and error handling
**stay as-is**. Only the rendering layer changes. Before editing,
re-read the real page file and mark the call sites you will keep
(imports from `@/shared/services/**`, `@/lib/**`, `@/store/**`,
`useState` / `useEffect` / `useMemo` blocks) and the call sites you
will rewrite (the JSX that produces the chrome, table, and modals).

## 3. Swap imports to DS primitives

For every import the page needs, confirm the DS file exists and note
any prop differences before you swap.

| Legacy import | DS import | Prop differences |
| --- | --- | --- |
| `import { Button } from "@/shared/components"` | `import Button from "@/shared/ui/components/Button.jsx"` | DS is default-export. `variant` values: `primary` / `secondary` / `ghost` / `danger` (legacy had `outline` and `success` — those are **not** in DS; switch to `secondary` or `ghost` and `danger`). `size` values: `sm` / `md` (legacy had `lg` — switch to `md` or stack). Trailing icon prop is `iconTrailing` (legacy was `iconRight`). `fullWidth` is gone; pass `className="w-full"` instead. |
| `import Card from "@/shared/components/Card"` | `import { Card, CardHeader, CardContent, CardFooter } from "@/shared/ui/components/Card.jsx"` | DS uses **named** exports only — no default. `Card` props: `padding` (boolean), `hover` (boolean), `className`. `CardHeader` props: `icon`, `title`, `subtitle`, `actions`, `className`. |
| `import { Modal, ConfirmModal } from "@/shared/components"` | `import Modal from "@/shared/ui/components/Modal.jsx"` (and `import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx"`) | DS `Modal` is default-export. Prop renames: `open` (not `isOpen`); `onClose` preserved; `subtitle` is supported but `showTrafficLights` is gone (the macOS dots are intentionally not reproduced). `closeOnOverlay` is gone — backdrop click always closes. `className` is not forwarded; pass a `className` to a child if needed. DS `ConfirmDialog` is default-export; props `open` / `onCancel` (not `isOpen` / `onClose`); `tone="danger"` (default) is the only case red is the action color, `tone="primary"` uses emerald. |
| `import { Input } from "@/shared/components"` | `import Input from "@/shared/ui/components/Input.jsx"` | DS is default-export. Same `value` / `onChange`; `size` values `sm` / `md` (no `lg`); optional `label` / `hint` / `error` auto-wrap in `Field`. |
| `import Select from "@/shared/components/Select"` | `import Select from "@/shared/ui/components/Select.jsx"` | DS is default-export. Custom listbox (not native `<select>`); `value` / `onChange` preserved; `placement="top"` for footer toolbars. |
| `import Pagination from "@/shared/components/Pagination"` | `import Pagination from "@/shared/ui/components/Pagination.jsx"` | DS is default-export. Page/slicing logic moves to the parent; the new `DataTable` consumes `pagination` as a prop. See §5. |
| `import { Toggle } from "@/shared/components"` | `import Toggle from "@/shared/ui/components/Toggle.jsx"` | DS is default-export. `checked` / `onChange` preserved. With `label` / `description` it renders a settings-style row. |
| `import { Badge } from "@/shared/components"` | `import { Badge } from "@/shared/ui/components/Badge.jsx"` | DS `Badge` is **named**-export only. `tone` values: `accent` / `success` / `warning` / `danger` / `info` / `neutral` (legacy was `success` / `warning` / `error` / `default` — map `error` → `danger`, `default` → `neutral`); `size` `sm` / `md`; optional leading `icon`. |
| `import ProviderIcon from "@/shared/components/ProviderIcon"` | `import ProviderLogo from "@/shared/ui/components/ProviderLogo.jsx"` (or `import { ProviderLogo } …` — DS exports both forms) | `provider` / `size` (px box, default 28) / `className`; alias map (`cc` → `claude`, `cx` → `codex`, `ollama` → `ollama-local`, …) handled internally; falls back to a token-styled letter tile. |
| `import { DateRangePicker } from "@/shared/components"` | `import RangeSelector, { rangeLabel } from "@/shared/ui/components/RangeSelector.jsx"` | DS `RangeSelector` is **default**-export; `rangeLabel` is the only **named** export. New API: emits `{ preset }` or `{ preset: "custom", from, to }`; see §6. |
| `import { Tooltip } from "@/shared/components"` | `import Tooltip from "@/shared/ui/components/Tooltip.jsx"` | DS is default-export. Prop renames: `content` (not `text`); `children` is the trigger; `side` (not `position`) — values `top` / `right` / `bottom` / `left`. `color` is gone (use `tone` in a follow-up if you need themed variants). |
| `import SegmentedControl from "@/shared/components/SegmentedControl"` | `import SegmentedControl from "@/shared/ui/components/SegmentedControl.jsx"` | DS is default-export. `value` / `onChange` preserved; `options` array shape unchanged. |
| `import { Drawer } from "@/shared/components"` | `import Drawer from "@/shared/ui/components/Drawer.jsx"` | DS is default-export. `open` (not `isOpen`); `onClose` preserved; `width` in px (default 420); `footer` slot. |
| `import { Tabs } from "@/shared/components"` (no existing wrapper in legacy) | `import Tabs from "@/shared/ui/components/Tabs.jsx"` | DS `Tabs` is **default**-export only — there is no named export. Roving tabindex with arrow / Home / End; active tab uses emerald text + 2px accent indicator; optional neutral `count` pill per tab. |
| `import { CardSkeleton } from "@/shared/components/Loading"` | use `DataTable loading` prop or write a `Skeleton` block with `bg-dd-surface-2 animate-pulse rounded-dd` | DS has no `CardSkeleton`; replace with `DataTable loading` or inline `animate-pulse` blocks. |

Always `grep` the destination file for the actual export shape before
you write the import — DS exports vary (default vs. named).

## 4. Replace raw markup per the golden rules

From [`AGENTS.md` §5A](../../AGENTS.md#5a-ui--durin-ds-design-system) and
[`porting-upstream-ui.md` §2](../porting-upstream-ui.md):

1. **Token-only styling.** `bg-dd-*` / `text-dd-*` / `border-dd-*` /
   `rounded-dd*` / `shadow-dd-*` only. No hex, no raw Tailwind palette.
2. **No `window.prompt` / `window.confirm`.** Use `PromptDialog` /
   `ConfirmDialog`.
3. **No native `<select>`.** Use `Select`. The one allowed exception is
   the `Pagination` rows-per-page control — never write your own.
4. **Tables → `DataTable` + `pagination` prop.** Rows-per-page
   `[10, 25, 50, 100, "all"]`.
5. **Range filters → `RangeSelector`.**
6. **Provider branding → `ProviderLogo`.**
7. **Charts: single graph, multiple series.** Primary `var(--dd-accent)`,
   secondary `var(--dd-accent-2)`. No metric-tabbed sub-graphs.
8. **Focus rings `outline-none focus-visible:shadow-dd-focus`.** Every
   interactive primitive.
9. **Icons via Material Symbols ligatures.** `<span className="material-symbols-outlined"
   aria-hidden="true">{name}</span>`.
10. **Density:** body `text-[13px]`, meta `text-xs`, metrics `dd-tnum`.
    `PageHeader` title `text-xl font-semibold tracking-tight`.

## 5. Tables — `DataTable` + `pagination`

Replace every raw `<table>` + prev/next pager with `DataTable` and its
`pagination` prop. The parent owns slicing and resets `page` to 1 on
`onRowsPerPageChange`.

```jsx
import DataTable from "@/shared/ui/components/DataTable.jsx";

const [page, setPage] = useState(1);
const [rowsPerPage, setRowsPerPage] = useState(25);
const pageCount = rowsPerPage === "all"
  ? 1
  : Math.max(1, Math.ceil(rows.length / rowsPerPage));
const currentPage = Math.min(page, pageCount);
const visibleRows = useMemo(
  () => rowsPerPage === "all"
    ? rows
    : rows.slice(
        (currentPage - 1) * rowsPerPage,
        (currentPage - 1) * rowsPerPage + rowsPerPage,
      ),
  [currentPage, rows, rowsPerPage],
);
const firstVisibleRow = rows.length === 0
  ? 0
  : rowsPerPage === "all"
    ? 1
    : (currentPage - 1) * rowsPerPage + 1;
const lastVisibleRow = rowsPerPage === "all"
  ? rows.length
  : Math.min(currentPage * rowsPerPage, rows.length);

const columns = [
  { key: "name", label: "Name" },
  { key: "tokens", label: "Tokens", align: "right", mono: true },
  { key: "actions", label: "", align: "right", render: (row) => (
    <IconButton label="Edit" icon="edit" variant="ghost" size="sm" onClick={() => edit(row)} />
  ) },
];

<DataTable
  columns={columns}
  rows={visibleRows}
  keyFn={(row) => row.id}
  density="compact"
  filterBar={/* Select / Input / RangeSelector, size="sm" */}
  emptyState={{ icon: "inbox", title: "No rows", message: "Nothing here yet." }}
  loading={isLoading}
  pagination={{
    page: currentPage,
    pageCount,
    total: rows.length,
    rowsLabel: `Showing ${firstVisibleRow} to ${lastVisibleRow} of ${rows.length} results`,
    onPage: setPage,
    rowsPerPage,
    onRowsPerPageChange: (value) => { setRowsPerPage(value); setPage(1); },
  }}
/>
```

Edge case: when the table is rendered inside a modal, use
`density="compact"`; the full-screen page table can use
`density="comfortable"`.

## 6. Range filters — `RangeSelector`

```jsx
import RangeSelector, { rangeLabel } from "@/shared/ui/components/RangeSelector.jsx";

const [range, setRange] = useState({ preset: "7d" });

<RangeSelector
  value={range}
  onChange={setRange}
  size="md"
  align="end"
/>

// rangeLabel(range) → "Last 7 days" / "Jun 1 – Jun 7" / "All time"
```

Custom ranges only emit after the user confirms the From/To popover.
Validate that `from <= to` and surface an error with `Field error` if
not (this is a defensive check; the popover does it too, but the page
should not crash on bad state).

## 7. Provider branding — `ProviderLogo`

```jsx
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";

<ProviderLogo provider="cc" size={20} />          // "cc" → claude via ALIASES
<ProviderLogo provider="codex" size={20} />        // direct
<ProviderLogo provider="minimax" size={20} />      // direct
// Falls back to a neutral letter tile if no asset exists at
// /providers/<resolved-id>.svg|png.
```

## 8. Delete replaced one-off styled components

When the page consumed local one-off styled components (e.g. an inline
`<div className="rounded-xl border border-border bg-surface p-4">` that
duplicated `Card`), delete them only after the migration renders
without them. Keep the legacy file's exported helpers if other pages
still import them — flag in the PR body and clean up in Phase 3.

## 9. Run the gates

```bash
npm run lint                    # full repo gate (eslint + anti-slop)
npm run storybook:build
cd tests && npm run test:ci
git diff tests/__baseline__/known-fails.txt   # empty
npx commitlint --from=origin/main --to=HEAD
```

All five must exit 0. If any fails, fix before pushing.

## 10. Screenshots checklist

Manual visual verification (capture in PR body or attach to the
Storybook story if a new one was added):

- [ ] Dark + light, both palettes render.
- [ ] Empty state (no data, no error, no loading).
- [ ] Loading state (skeleton rows for tables; spinner / `DataTable
      loading`).
- [ ] Error state (force a known 4xx/5xx and screenshot the
      `EmptyState` or error banner).
- [ ] Modal / `Drawer` / `PromptDialog` / `ConfirmDialog` open and
      close cleanly.
- [ ] All `Select` triggers flip with the theme toolbar.
- [ ] Keyboard: `Tab` walks the controls, `Esc` closes overlays,
      arrow keys move inside `Tabs` and `SegmentedControl`.

## Worked example — `/dashboard/health`

The real page is at
`src/app/(dashboard)/dashboard/health/page.js`. Its mock is at
`src/shared/ui/pages/health/HealthPage.jsx` (story title
`Durin DS/Pages/Health`, `activePath: /dashboard/health`,
`title: Provider Health`, `icon: health_and_safety`).

### Before (real page, abbreviated)

```jsx
// src/app/(dashboard)/dashboard/health/page.js
import { Badge, Button, Card } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";
import { usePagination } from "@/shared/hooks/usePagination";

export default function HealthPage() {
  const { pageItems, page, pageSize, setPage, setPageSize, totalItems, totalPages } = usePagination({ ... });
  // ... loading / error / fetch logic preserved ...
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-main">Provider Health</h1>
        <Button onClick={onRefresh} loading={refreshing}>Refresh</Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {summary.map((s) => <SummaryCard key={s.label} {...s} />)}
      </div>
      <Card padding="sm">
        {/* headroom row */}
      </Card>
      <Card padding="sm">
        <table className="min-w-full text-sm">…</table>
        <Pagination page={page} pageSize={pageSize} total={totalItems} onPage={setPage} onPageSize={setPageSize} />
      </Card>
    </div>
  );
}
```

### After (DS, abbreviated)

```jsx
// src/app/(dashboard)/dashboard/health/page.js
import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
import DataTable from "@/shared/ui/components/DataTable.jsx";
import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
import StatCard from "@/shared/ui/components/StatCard.jsx";
import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
// ... all data/load logic preserved ...

const STATE_BADGE_TONE = { healthy: "success", degraded: "warning", down: "danger", blocked: "danger", unconfigured: "neutral", unknown: "neutral" };

const columns = [
  { key: "name", label: "Connection", width: "20%",
    render: (row) => <span className="font-medium text-dd-text">{row.name}</span> },
  { key: "provider", label: "Provider", width: "14%",
    render: (row) => (
      <span className="flex items-center gap-2 font-mono">
        <ProviderLogo provider={row.provider} size={18} />
        {row.provider}
      </span>
    ) },
  { key: "state", label: "State", width: "21%",
    render: (row) => (
      <div className="flex items-center gap-2">
        <StatusDot tone={row.tone} />
        <Badge tone={STATE_BADGE_TONE[row.state]} size="sm">{row.label}</Badge>
      </div>
    ) },
  { key: "latency", label: "Latency", mono: true, align: "right", width: "12%" },
  { key: "status", label: "Status", mono: true, align: "right", width: "10%" },
  { key: "error", label: "Error",
    render: (row) => (
      <span className={row.error === "HTTP 404" ? "text-dd-danger" : "text-dd-muted"}>{row.error}</span>
    ) },
];

export default function HealthPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // ... fetch / poll logic preserved ...
  const rows = data?.providers ?? [];
  const summary = data?.summary ?? [];
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const pageCount = rowsPerPage === "all" ? 1 : Math.max(1, Math.ceil(rows.length / rowsPerPage));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = useMemo(
    () => rowsPerPage === "all"
      ? rows
      : rows.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage),
    [currentPage, rows, rowsPerPage],
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageHeader
        icon="health_and_safety"
        title="Provider Health"
        subtitle="Reachability of your configured provider connections"
        actions={
          <Button variant="ghost" icon="refresh" onClick={onRefresh} loading={refreshing}>
            Refresh
          </Button>
        }
      />
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {summary.map((s) => <StatCard key={s.label} {...s} />)}
      </section>
      <Card padding={false}>
        <CardHeader icon="compress" title="Headroom compression proxy" subtitle="Local proxy availability" />
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <span className="font-mono text-[13px] text-dd-text">{headroom.url}</span>
          <StatusDot tone={headroom.tone} label={headroom.state} pulse />
        </CardContent>
      </Card>
      <DataTable
        columns={columns}
        rows={visibleRows}
        keyFn={(row) => row.id}
        density="compact"
        loading={loading}
        emptyState={{ icon: "inbox", title: "No providers", message: "Configure a provider to see health." }}
        pagination={{
          page: currentPage,
          pageCount,
          total: rows.length,
          rowsLabel: `Showing ${rows.length === 0 ? 0 : (currentPage - 1) * (rowsPerPage === "all" ? rows.length : rowsPerPage) + 1} to ${Math.min(currentPage * (rowsPerPage === "all" ? rows.length : rowsPerPage), rows.length)} of ${rows.length} results`,
          onPage: setPage,
          rowsPerPage,
          onRowsPerPageChange: (v) => { setRowsPerPage(v); setPage(1); },
        }}
      />
    </div>
  );
}
```

### Diff sketch

```diff
-import { Badge, Button, Card } from "@/shared/components";
-import Pagination from "@/shared/components/Pagination";
+import PageHeader from "@/shared/ui/components/PageHeader.jsx";
+import Button from "@/shared/ui/components/Button.jsx";
+import { Card, CardContent, CardHeader } from "@/shared/ui/components/Card.jsx";
+import DataTable from "@/shared/ui/components/DataTable.jsx";
+import { ProviderLogo } from "@/shared/ui/components/ProviderLogo.jsx";
+import StatCard from "@/shared/ui/components/StatCard.jsx";
+import { StatusDot } from "@/shared/ui/components/StatusDot.jsx";
+import { Badge } from "@/shared/ui/components/Badge.jsx";
@@
-      <div className="flex items-center justify-between">
-        <h1 className="text-2xl font-bold text-text-main">Provider Health</h1>
-        <Button onClick={onRefresh} loading={refreshing}>Refresh</Button>
-      </div>
+      <PageHeader
+        icon="health_and_safety"
+        title="Provider Health"
+        subtitle="Reachability of your configured provider connections"
+        actions={
+          <Button variant="ghost" icon="refresh" onClick={onRefresh} loading={refreshing}>
+            Refresh
+          </Button>
+        }
+      />
@@
-      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
-        {summary.map((s) => <SummaryCard key={s.label} {...s} />)}
-      </div>
+      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
+        {summary.map((s) => <StatCard key={s.label} {...s} />)}
+      </section>
@@
-      <Card padding="sm">
-        <table className="min-w-full text-sm">…</table>
-        <Pagination page={page} pageSize={pageSize} total={totalItems} onPage={setPage} onPageSize={setPageSize} />
-      </Card>
+      <DataTable
+        columns={columns}
+        rows={visibleRows}
+        keyFn={(row) => row.id}
+        density="compact"
+        loading={loading}
+        emptyState={{ icon: "inbox", title: "No providers", message: "Configure a provider to see health." }}
+        pagination={{
+          page: currentPage,
+          pageCount,
+          total: rows.length,
+          rowsLabel: `Showing … of ${rows.length} results`,
+          onPage: setPage,
+          rowsPerPage,
+          onRowsPerPageChange: (v) => { setRowsPerPage(v); setPage(1); },
+        }}
+      />
```

### Behavior invariants to verify in this PR

- Same API call: `GET /api/health` (or whatever the page polls).
- Same route path: `/dashboard/health`.
- Same localStorage keys (none on this page).
- Same refresh cadence.
- Same `usePagination` slicing logic — only the rendering around it
  changed.
