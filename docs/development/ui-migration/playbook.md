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
- Read matching `*.stories.jsx` for mock’s `activePath` and visual details.
  `withDashboardShell` accepts only `activePath` and optional `actions`; it
  does not receive or render title, subtitle, or icon. Page identity remains
  in mock body’s `PageHeader`.
- Read [`durin-ds.md` §"Component inventory"](../durin-ds.md#component-inventory)
  for DS primitives mock uses.
- Workers skip tests, builds, lint, formatters, visual runs, commits, pushes,
  and PR creation. Return complete diff and preserved-contract notes.

## 1. Read the mock — it is the visual spec

```bash
open src/shared/ui/pages/<slug>/<Slug>Page.jsx
open src/shared/ui/pages/<slug>/<Slug>Page.stories.jsx
```

Note:

- The `PageHeader` icon/title/subtitle (from the mock body's `PageHeader`;
  the story decorator supplies only `activePath` and optional `actions`).
- Every DS component the mock uses (e.g. `DataTable`, `RangeSelector`,
  `StatCard`, `Drawer`, `KeyValue`, `Tabs`, `ProviderLogo`,
  `Pagination`).
- Any custom classes (`text-dd-text`, `border-dd-border-subtle`,
  `rounded-dd-lg`, …) — these confirm the `*-dd-*` utility to use.

## 2. Keep the page's data and behavior byte-identical

Page hooks, fetch calls, state, effects, error handling, request/query/header
shapes, server inputs, storage behavior, and backend pagination behavior stay
as-is. Presentation exposes `[10, 25, 50, 100, "all"]`; retain backend
totals, cursors, page semantics, callbacks, and data hooks. Never pass string
`"all"` to a numeric backend limit. Adapt `"all"` only through existing,
verified backend capability; if capability is absent, block page migration.
Never silently slice loaded rows. Only rendering changes. Preserve existing
`aria-*`, focus, and keyboard behavior; scoped accessibility repair requires
identified defect and must not change application behavior. Before editing,
re-read real page and mark call sites kept (`@/shared/services/**`,
`@/lib/**`, `@/store/**`, `useState` / `useEffect` / `useMemo`) versus JSX
chrome/table/modal changes.

## 3. Swap imports to DS primitives

For every import the page needs, confirm the DS file exists and note
any prop differences before you swap.

| Legacy import | DS import | Prop differences |
| --- | --- | --- |
| `import { Button } from "@/shared/components"` | `import Button from "@/shared/ui/components/Button.jsx"` | DS is default-export. Variants are `primary` / `secondary` / `ghost` / `danger`; sizes are `sm` / `md`; trailing icon is `iconTrailing`; `fullWidth` is absent. Do **not** silently map legacy `success` to `danger`, `outline` to `secondary`/`ghost`, `lg` to `md`, or `fullWidth` to classes: each changes visual/size/layout contract. Block migration until primitive parity exists or explicit approved behavior decision preserves contract. |
| `import Card from "@/shared/components/Card"` | `import { Card, CardHeader, CardContent, CardFooter } from "@/shared/ui/components/Card.jsx"` | DS uses **named** exports only — no default. `Card` props: `padding` (boolean), `hover` (boolean), `className`. `CardHeader` props: `icon`, `title`, `subtitle`, `actions`, `className`. |
| `import { Modal, ConfirmModal } from "@/shared/components"` | `import Modal from "@/shared/ui/components/Modal.jsx"` (and `import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx"`) | DS `Modal` is default-export. `open` replaces `isOpen`; `onClose` and `subtitle` preserve. DS currently lacks `closeOnOverlay` parity and does not forward `className`: do **not** migrate modal needing either until prerequisite primitive change adds parity. Preserve backdrop/Esc dismissal and submitting semantics; never silently drop behavior. `showTrafficLights` removal needs approved behavior decision. DS `ConfirmDialog` is default-export; `open` / `onCancel` replace `isOpen` / `onClose`, but it lacks legacy `loading` parity. Do not migrate a loading/submitting `ConfirmModal` until primitive parity disables duplicate actions and preserves pending UI. `tone="danger"` (default) is only red action; `tone="primary"` uses emerald. |
| `import { Input } from "@/shared/components"` | `import Input from "@/shared/ui/components/Input.jsx"` | DS is default-export. Same `value` / `onChange`; `size` values `sm` / `md` (no `lg`); optional `label` / `hint` / `error` auto-wrap in `Field`. |
| `import Select from "@/shared/components/Select"` | `import Select from "@/shared/ui/components/Select.jsx"` | DS is default-export. Custom listbox (not native `<select>`); `value` / `onChange` preserved; `placement="top"` for footer toolbars. |
| `import Pagination from "@/shared/components/Pagination"` | `import Pagination from "@/shared/ui/components/Pagination.jsx"` | DS is default-export. Keep existing backend paging, totals, cursors, and callbacks through presentation adapter. Expose `[10, 25, 50, 100, "all"]`; map `"all"` only through verified backend capability, never to numeric limit. Do not add client slicing, derive totals from loaded rows, reset page, or rewrite data hooks merely to match mock. `DataTable` consumes `pagination` prop. See §5. |
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

From [`AGENTS.md` §5A](../../../AGENTS.md#5a-ui--durin-ds-design-system) and
[`porting-upstream-ui.md` §2](../porting-upstream-ui.md):

1. **Token-only styling.** `bg-dd-*` / `text-dd-*` / `border-dd-*` /
   `rounded-dd*` / `shadow-dd-*` only. No hex, no raw Tailwind palette.
2. **No `window.prompt` / `window.confirm`.** Use `PromptDialog` /
   `ConfirmDialog`.
3. **No native `<select>`.** Use `Select`. The one allowed exception is
   the `Pagination` rows-per-page control — never write your own.
4. **Tables → `DataTable` + `pagination` prop.** Presentation must expose
   `[10, 25, 50, 100, "all"]`. Preserve backend totals, cursors, page
   semantics, and callbacks. `"all"` must use verified backend capability,
   never client-side slicing or a numeric backend limit; absent capability
   blocks migration.
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

## 5. Tables — `DataTable` presentation adapter

Replace raw table markup only after verifying `DataTable` and `Pagination`
represent page's backend contract. Presentation always exposes
`[10, 25, 50, 100, "all"]`; retain server totals, cursor/page semantics,
current-page bounds, callbacks, and existing data hooks. Do not derive `total`
from currently loaded rows, add client slicing, reset page, or change fetch
inputs merely to resemble mock.

`"all"` is presentation-only. It must never reach a numeric backend limit.
Use it only when existing backend capability provides a safe all-results
request or equivalent cursor-aware contract. If that capability does not
exist, block page migration until prerequisite work adds it; do not silently
slice already-loaded rows.

```jsx
// Schematic: keep existing pagination/data hooks and backend adapter intact.
const PRESENTATION_PAGE_SIZES = [10, 25, 50, 100, "all"];

<DataTable
  columns={columns}
  rows={pageItems}
  keyFn={(row) => row.id}
  density="compact"
  loading={isLoading}
  emptyState={existingEmptyState}
  pagination={{
    page,
    pageCount: totalPages,
    total: totalItems,
    rowsLabel: existingRowsLabel,
    onPage: setPage,
    rowsPerPage: presentationPageSize,
    rowsPerPageOptions: PRESENTATION_PAGE_SIZES,
    onRowsPerPageChange: setPresentationPageSize,
  }}
/>
```

`setPresentationPageSize` may pass numeric values to existing backend paging.
For `"all"`, it must invoke only verified all-results capability; it must not
pass `"all"` to a numeric limit or slice loaded rows. For modal tables retain
existing density and dismissal behavior; presentation change cannot alter it.

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

Custom ranges only emit after user confirms From/To popover. Preserve page’s
existing range validation, input shape, fetch behavior, and errors. Do not
add defensive validation or alter bad-state handling during visual migration.

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

When page consumed local one-off styled components, delete them only if they
become unused through rendering-only replacement. Preserve exported helpers
still imported elsewhere; flag for Phase 3. Do not use a preview
`DashboardShell` in production; runtime shell adapters remain integration
boundary.

## 9. Worker handoff and orchestrator proof
Workers return complete diff plus preserved-contract notes. They must not run
tests, builds, lint, formatters, Storybook, dev server, commitlint, commits,
pushes, or PR creation. Orchestrator rebases, formats, runs documented gates,
commits locally, and obtains current-SHA runtime proof. Independent review,
then human full-diff review follow. Explicit human approval is required only
before push/PR, not local validation, rebase, or commit.


Storybook build, screenshots, and axe alone never certify AAA. Orchestrator
records applicable measured WCAG 2.2 AAA evidence.

Working stories are mandatory for every page and widget in the migration:
follow [`Storybook coverage`](../../../plans/002-storybook-coverage.md), render
actual production components with safe fixture dependencies, cover meaningful
states and interactions, and return stories with the page's unique e2e spec.
Private widgets may use explicit parent-story scenarios; no copied mock UI.
Orchestrator gates Storybook runtime/play results AND the actual app on same SHA.
After G0 wires them, package scripts `check:storybook-coverage` and
`test:storybook` are mandatory per-PR gates, not alternatives to app tests.

Foundation blockers precede page adoption: token text-contrast remediation,
Select Arrow/Home/End behavior, overlay focus trap/return/inert/nesting
(`Modal`/`Drawer`), and chart/table caption gaps. Token contrast source pairs
are diagnostic only, not served-surface proof; measure rendered foreground /
background pairs before AAA claims.

## 10. Runtime proof checklist

Orchestrator verifies current working SHA after formatting and gates, before
independent and human full-diff review:

- [ ] Dark + light palettes.
- [ ] Empty, loading, and error states with same data behavior.
- [ ] Overlay dismissal and submitting semantics.
- [ ] Keyboard paths, including foundation prerequisite fixes.
- [ ] Applicable WCAG 2.2 AAA criteria measured on served UI.

## Worked example — `/dashboard/health`

Schematic only: preserve health's real backend paging, totals, cursors, and
hooks. Its presentation uses `[10, 25, 50, 100, "all"]`; `"all"` requires
verified backend all-results capability and blocks this migration if absent.

The real page is at
`src/app/(dashboard)/dashboard/health/page.js`. Its mock is at
`src/shared/ui/pages/health/HealthPage.jsx`; story `meta.title` is
`Durin DS/Pages/Health`, while decorator `activePath` is
`/dashboard/health`. Mock body’s `PageHeader` owns `Provider Health` and
`health_and_safety`; decorator does not receive page identity props.

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
// ... all data/load/usePagination logic preserved ...

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
  // Existing usePagination state and server/client behavior remain unchanged.
  const { pageItems, page, pageSize, setPage, setPageSize, totalItems, totalPages } =
    usePagination(existingOptions);

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
        rows={pageItems}
        keyFn={(row) => row.id}
        density="compact"
        loading={loading}
        emptyState={{ icon: "inbox", title: "No providers", message: "Configure a provider to see health." }}
        pagination={{
          page,
          pageCount: totalPages,
          total: totalItems,
          rowsLabel: existingRowsLabel,
          onPage: setPage,
          rowsPerPage: presentationPageSize,
          rowsPerPageOptions: [10, 25, 50, 100, "all"],
          onRowsPerPageChange: setPresentationPageSize,
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
      <DataTable
        columns={columns}
        rows={pageItems}
        keyFn={(row) => row.id}
        density="compact"
        loading={loading}
        emptyState={{ icon: "inbox", title: "No providers", message: "Configure a provider to see health." }}
        pagination={{
          page,
          pageCount: totalPages,
          total: totalItems,
          rowsLabel: existingRowsLabel,
          onPage: setPage,
          rowsPerPage: presentationPageSize,
          rowsPerPageOptions: [10, 25, 50, 100, "all"],
          onRowsPerPageChange: setPresentationPageSize,
        }}
      />
```

### Behavior invariants to verify in this PR

- Same API call: `GET /api/health` (or page’s real poll contract).
- Same route path: `/dashboard/health`.
- Same localStorage keys and semantics (none on this page).
- Same refresh cadence, query/header/request shape, and server inputs.
- Same backend pagination state, totals, cursors, callbacks, and hooks.
- Presentation page sizes are `[10, 25, 50, 100, "all"]`. `"all"` uses only
  verified backend all-results capability; it never reaches numeric limits or
  silently slices loaded rows. Missing capability blocks migration.
