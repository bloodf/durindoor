# Phased rollout

> Four phases. Each phase is a series of PRs; every PR must clear the
> five hard gates in [`README.md`](./README.md#hard-gates-every-migration-pr-must-pass).

## Phase 0 — Foundation adoption

Goal: make the running app consume the Durin DS token layer and repoint
the existing `src/shared/components/*` primitives' internals to
`*-dd-*` tokens — **without changing their props or breaking any page**.

### 0.1 Token-load decision

Two options were on the table. We pick **option A**.

| Option | Mechanism | Verdict |
| --- | --- | --- |
| **A — import `tokens.css` from `src/app/layout.js`** | Add `import "@/shared/ui/tokens.css";` to `src/app/layout.js` next to the existing `import "./globals.css";`. Two Tailwind roots compile side by side; the `--dd-*` utilities are generated and resolvable inside the app, and `globals.css` stays untouched so upstream PRs keep merging. | **Picked.** |
| B — merge `tokens.css` into `src/app/globals.css` | Fold the `--dd-*` block into `globals.css` so the app has a single Tailwind root. | Rejected. `globals.css` is read-only from a Durin DS PR (`AGENTS.md` §5A, `porting-upstream-ui.md` §1), and merging would force future migrations to re-edit `globals.css` on every token change. |

`tokens.css` is a self-contained Tailwind root
(`@import "tailwindcss" source("../../");`) and already proves out the
side-by-side pattern — `.storybook/preview.jsx` imports both `tokens.css`
and `globals.css` today. Duplicate framework output is identical and
harmless.

### 0.2 Tasks

- PR `feat(ui): load durin ds tokens in app layout`
  - `src/app/layout.js`: add `import "@/shared/ui/tokens.css";` immediately
    after `import "./globals.css";`.
  - Verify: `npm run dev`, confirm the Theme toolbar still flips
    `document.documentElement.classList` and the new `*-dd-*` utilities
    resolve in the browser dev-tools.
- PR `feat(ui): repoint shared primitives to dd-* tokens`
  - For each file in `src/shared/components/` that ships a default
    export with a `className` literal, replace the legacy class names
    (`bg-surface`, `text-text-main`, `border-border`, `bg-primary`, …)
    with the equivalent `*-dd-*` token utility. Keep the same prop
    surface (do not rename `variant`, `size`, `tone`, `isOpen`, `onClose`,
    `onConfirm`, etc.).
  - Critical imports to verify both sides exist before swapping:
    - `src/shared/components/Modal.js` → keep `isOpen` / `onClose` /
      `onConfirm`; style change only.
    - `src/shared/components/Select.js` → already custom; rewrite
      classes to `*-dd-*`.
    - `src/shared/components/Pagination.js` → keep prop names.
    - `src/shared/components/Card.js` → keep `padding="sm|md|lg"`.
    - `src/shared/components/Button.js` → keep `variant`.
    - `src/shared/components/Input.js`, `Textarea.js`, `Toggle.js`,
      `Tooltip.js`, `Badge.js` → keep prop names; rewrite classes.
  - Do **not** touch `src/app/globals.css`.
  - Do **not** change `src/shared/components/Modal.js`'s `isOpen` → DS
    `Modal` uses `open`. Component re-pointing keeps the legacy name; the
    DS-native rename happens in Phase 2 per-page.

### 0.3 Verification

```bash
npm run storybook:build       # mocks still build
npm run lint                  # eslint + anti-slop
cd tests && npm run test:ci   # baseline unchanged
npm run dev                   # boot, click through every existing page
```

### 0.4 Entry / exit

- **Entry:** none.
- **Exit:** app launches; all existing pages still render with new
  tokens; every `src/shared/components/*` file references only
  `*-dd-*` utilities; no prop-name changes in any of those files;
  no `src/app/globals.css` edit.

## Phase 1 — shell swap

Goal: swap the visual chrome of `Sidebar`, `Header`, and
`DashboardLayout` to the Durin DS shell, with a single concrete
collapse owner and the regrouped nav from `src/shared/ui/shell/Sidebar.jsx`.

### 1.0 The adapter rule (do not skip)

Re-exporting the shell modules in `src/shared/ui/shell/` is **not**
acceptable. They are visual specs, not drop-in replacements. The
legacy components in `src/shared/components/` carry behavior the DS
shells do not:

| Behavior | Legacy owns | DS shell provides |
| --- | --- | --- |
| `usePathname()` derived active state | yes (live) | no — requires explicit `activePath` |
| `fetch("/api/settings")` → `enableTranslator` toggle | yes | no |
| `fetch("/api/version")` → new-version banner + `UpdatePanel` modal | yes | no |
| `onClose` prop for mobile-menu close | yes | no |
| Providers / Token Saver / Media Providers accordions (manual + auto expanded) | yes (`userToggled`, `providersToggled`, `mediaOpen`) | no — `NAV_GROUPS` is static |
| `Header` `usePathname()` + `/api/auth/status` + `/api/auth/logout` + mobile menu open state + `<HeaderMenu onLogout={…} />` | yes | no — only `title/subtitle/icon/actions` + theme toggle |
| `DashboardLayout` toast/notifications rail + mobile `sidebarOpen` overlay | yes | no — only `collapsed` state |

Phase 1 deliverable: **adapter components** in
`src/shared/components/` that keep every legacy behavior and apply the
regrouped DS nav + new collapse control + brand icon from
`src/shared/ui/shell/`. The shell modules are the visual reference,
not the implementation.

### 1.1 Tasks

- PR `feat(ui): swap sidebar to durin ds shell`
  - Edit `src/shared/components/Sidebar.js` in place. Adopt the
    regrouped nav from `src/shared/ui/shell/Sidebar.jsx`
    (`NAV_GROUPS`: OBSERVE → ROUTE → OPTIMIZE → MEDIA → SYSTEM →
    HELP). Keep:
    - `usePathname()` derivation for active state — feed it into
      the `activePath` prop the DS sidebar expects.
    - `useState` for `mediaOpen` / `userToggled` /
      `providersToggled` (reused for the OBSERVE/ROUTE/OPTIMIZE/MEDIA
      accordions that `NAV_GROUPS` does not auto-expand).
    - `useEffect` for `fetch("/api/settings")` and
      `fetch("/api/version")`.
    - `<UpdatePanel … />` overlay mount.
    - `onClose` prop forwarding (mobile menu).
    - All nav items, including the `enableTranslator` debug-item
      conditional.
  - Re-render chrome with DS classes (`bg-dd-bg-alt border-r
    border-dd-border-subtle`, `text-dd-text`, `text-dd-muted`,
    `text-dd-accent` for active state). Use `IconButton` for
    icon-only controls. Keep `<Link>` for navigation — do not
    switch to plain `<a>`; the shell uses anchors because Storybook
    has no router.
  - **Collapse is owned by `src/shared/components/layouts/DashboardLayout.js`.**
    One `useState(defaultCollapsed)`; default `false` (the
    current UX — the legacy Sidebar has no collapse at all). No
    `localStorage` persistence is introduced; the `collapsed`
    flag is session-local. The `Sidebar` adapter does **not**
    own collapse state — it receives `collapsed` and
    `onToggleCollapse` from `DashboardLayout`. A follow-up
    persistence PR is out of scope for the migration campaign.
  - **Brand icon: `/icons/icon-512.png`**, 28×28, in a 9×9 rounded
    `bg-dd-surface-3` tile, mirroring the shell spec. The legacy
    `BRAND_LOGO_SRC` image is replaced with the same asset the DS
    shell uses. The wordmark (`APP_CONFIG.name` + version) stays.
  - Behavior invariants: every existing `href` resolves; fetch
    endpoints unchanged; `UpdatePanel` mount unchanged; `onClose`
    semantics unchanged; active-state detection still derives from
    `usePathname()`.
- PR `feat(ui): swap header to durin ds shell`
  - Edit `src/shared/components/Header.js` in place. Keep:
    - `usePathname()` derived page identity — the adapter still
      resolves the route's title/subtitle/icon and passes them to
      the DS `Header` as `title`/`subtitle`/`icon`.
    - `useState` for `displayName`, `loginMethod`, mobile menu
      open.
    - `useEffect` for `fetch("/api/auth/status")`.
    - Logout handler calling
      `fetch("/api/auth/logout", { method: "POST" })`.
    - `<HeaderMenu onLogout={handleLogout} />` mount.
  - Re-render the chrome with DS classes. The legacy header's
    search/command-palette affordance, language switcher, theme
    toggle, and apps menu all stay; the DS `Header` does not own
    any of them, so the adapter owns them.
  - Do not delete `HeaderLanguage`, `HeaderMenu`,
    `LanguageSwitcher`, or `ThemeToggle` from
    `src/shared/components/` — the adapter still imports them.
- PR `feat(ui): swap dashboard layout to durin ds shell`
  - Edit `src/shared/components/layouts/DashboardLayout.js` in
    place. **Do not mount `src/shared/ui/shell/DashboardShell.jsx`.**
    The shell composes its own DS `Sidebar` and DS `Header`
    internally, which would bypass the behavior-preserving
    adapters in this phase.
  - Instead, mirror the DS shell's layout (a flex row: the
    `Sidebar` adapter on the left, the `Header` adapter on top
    of a scrollable `<main>`) directly in `DashboardLayout.js`,
    with the same `bg-dd-bg text-dd-text` page surface and the
    same `p-6 lg:p-8` main padding the shell uses.
  - **Single collapse owner: `DashboardLayout`.** One
    `useState(defaultCollapsed)` matches the shell's collapse
    contract. Default `false` (the current UX — the legacy
    Sidebar has no collapse at all). No `localStorage` key is
    introduced; the flag is session-local. A follow-up
    persistence PR is out of scope for the migration campaign.
  - Pass the layout's `collapsed` + setter to the `Sidebar`
    adapter as `collapsed` / `onToggleCollapse` props.
  - Keep:
    - `useState` for `sidebarOpen` (mobile).
    - The notifications rail — `useNotificationStore` selector,
      `removeNotification`, the `getToastStyle(type)` mapping.
    - The mobile overlay with `<Sidebar onClose={…} />` + backdrop.
  - The `Sidebar` is mounted as a child of the layout, not
    re-implemented. The adapter adds the mobile overlay and toast
    rail the legacy code owns.

### 1.2 Verification

```bash
npm run storybook:build
npm run lint
cd tests && npm run test:ci
npm run dev   # click every nav link, log in/out, open the mobile menu, toggle collapse, trigger the update banner
```

### 1.3 Entry / exit

- **Entry:** Phase 0 complete.
- **Exit:** all dashboard routes reachable via the regrouped
  DS nav (OBSERVE → ROUTE → OPTIMIZE → MEDIA → SYSTEM → HELP);
  every existing `href` resolves; mobile menu opens and closes;
  collapse toggles the desktop rail (session-local, no
  `localStorage` key added); brand icon renders as
  `/icons/icon-512.png` in a `bg-dd-surface-3` tile;
  `/api/auth/status` still drives login state; `/api/auth/logout`
  still works; `/api/settings` still toggles the debug translator
  item; `/api/version` still surfaces the update banner;
  `UpdatePanel` overlay still mounts; toast rail still renders
  notifications; theme toggle still flips the chrome. No page
  content changed. No re-exports of `src/shared/ui/shell/`.

## Phase 2 — Page-by-page migration

Goal: convert every route in [`page-map.md`](./page-map.md) to the
matching Durin DS visual spec, one route (or tightly coupled route
cluster) per PR. Risk-ordered across four waves.

### 2.1 Wave A — leaf / read-only (low risk)

Order pages by fewest data flows first. Each PR is a mechanical
application of [`playbook.md`](./playbook.md).

1. `/dashboard/api-docs` → mock `pages/api-docs/ApiDocsPage.jsx`. Static,
   server-rendered. Low.
2. `/dashboard/mcp-help` → mock `pages/mcp-help/McpHelpPage.jsx`. Static
   help text. Low.
3. `/dashboard/health` → mock `pages/health/HealthPage.jsx`. Polling, but
   read-only. Low.
4. `/dashboard/skills` → mock `pages/skills/SkillsPage.jsx`. Static
   catalog + copy. Low.

**Per-PR template:** `feat(ui): migrate <route> to Durin DS` (commitlint
≤ 100 chars). Body lists scope, mock link, gate output, and behavior
invariants.

### 2.2 Wave B — management (medium risk)

Forms, modals, and per-row mutations. Mock-rich, so most of the
playbook's before/after patterns apply directly.

5. `/dashboard/endpoint` → mock `pages/endpoint/EndpointPage.jsx`. Native
   `<select>` × 2 + per-row inputs. Medium.
6. `/dashboard/cli-tools` (+ `/dashboard/cli-tools/[toolId]`) → mock
   `pages/cli-tools/CliToolsPage.jsx`. `window.prompt` × 2 in
   `EndpointPresetControl.js` and `BaseUrlSelect.js`; native `<select>` × 2
   in the same files. Medium.
7. `/dashboard/combos` → mock `pages/combos/CombosPage.jsx`. CRUD + table.
   Medium.
8. `/dashboard/providers` → mock `pages/providers/ProvidersPage.jsx`.
   Cards, toggles, status filters. Medium.
9. `/dashboard/providers/[id]` → no mock. Port the pattern from
   `pages/providers/ProvidersPage.jsx`; flag the deviation in the PR
   body. Medium.
10. `/dashboard/mcp-gateway` → mock `pages/mcp-gateway/McpGatewayPage.jsx`.
    `window.prompt` × 1 in `mcp-gateway/page.js:237`. Medium.
11. `/dashboard/console-log` → mock `pages/console-log/ConsoleLogPage.jsx`.
    Tabs + log buffer. Medium.
12. `/dashboard/proxy-pools` → mock `pages/proxy-pools/ProxyPoolsPage.jsx`.
    Card list. Medium.
13. `/dashboard/headroom` → mock `pages/headroom/HeadroomPage.jsx`. Read-
    only metrics + settings toggle. Medium.

### 2.3 Wave C — analytics (medium-high risk)

Range filters, charts, multi-table paged views, dual-axis lines.

14. `/dashboard/usage` → mock `pages/usage/UsagePage.jsx`. `RangeSelector`,
    dual-axis chart, three paged tables. Medium-high.
15. `/dashboard/timeline` → mock `pages/timeline/TimelinePage.jsx`. Live
    area chart + filters + `Drawer`. Medium-high.
16. `/dashboard/timeline/[id]` → no mock. Port from
    `pages/timeline/TimelinePage.jsx`. Medium-high.
17. `/dashboard/quota` → mock `pages/quota/QuotaPage.jsx`. Multi-provider
    cards. Medium.
18. `/dashboard/token-saver` → mock `pages/token-saver/TokenSaverStatsPage.jsx`.
    Stats + per-tool breakdown. Medium-high.
19. `/dashboard/token-saver/settings` → mock
    `pages/token-saver-settings/SettingsPage.jsx`. Form + toggles.
    Medium.
20. `/dashboard/compression-studio` → mock `pages/test-savers/TestSaversPage.jsx`.
    Diff viewer. Medium.
21. `/dashboard/headroom` (already in Wave B for the surface; if the
    headroom config lives elsewhere, flag in PR body).

### 2.4 Wave D — playground + media providers + remaining (high risk)

Most state, most modals, deepest tables.

22. `/dashboard/playground` → mock `pages/playground/PlaygroundPage.jsx`.
    Composer, model picker, SSE preview. High.
23. `/dashboard/profile` → mock `pages/settings/SettingsPage.jsx`. Forms,
    toggles, theme. Medium.
24. `/dashboard/media-providers/[kind]` → mock
    `pages/media-providers/MediaProvidersPage.jsx`. List of providers per
    kind; mock only covers `embedding`. Other kinds (`tts`, `stt`,
    `image`, `realtime`) port from the same mock. Medium-high.
25. `/dashboard/media-providers/[kind]/[id]` → no mock. Port from the
    `[kind]` mock. High (5 native `<select>` across 4 sub-components).
26. `/dashboard/media-providers/combo/[id]` → no mock. Port from the
    `[kind]` mock. High.
27. `/dashboard/media-providers/web` → no mock. Port from the `[kind]`
    mock. Medium.
28. `/dashboard/auto-configure` → no mock. Port from the closest pattern
    (a settings form). Medium.
29. `/dashboard/translator` → no mock. Port from the closest pattern (a
    simple form view). Medium.
30. `/dashboard/pxpipe` → no mock. Port from the closest pattern. Medium.
31. `/dashboard/mitm` → no mock. Port from the closest pattern. Medium.
32. `/dashboard/settings/pricing` (special path
    `src/app/dashboard/settings/pricing/page.js`) → no mock. Port from
    `pages/settings/SettingsPage.jsx`. Low.
33. `/dashboard` (root redirect to `/dashboard/usage`) — no work needed.
    Skip.

### 2.5 Per-PR verification

The five hard gates from `README.md`, plus a dev-server manual click
through the page in both themes. Each PR body must include the bash
output of:

```bash
npm run lint                    # full repo gate (eslint + anti-slop)
npm run storybook:build
cd tests && npm run test:ci
npx commitlint --from=origin/main --to=HEAD
git diff tests/__baseline__/known-fails.txt   # empty
```

### 2.6 Phase 2 exit

- All 32 page PRs (1-32 above; #33 is a no-op) merged.
- `page-map.md` status column flips from `pending` to `migrated`.
- `tests/__baseline__/known-fails.txt` diff empty.
- All four gate commands green in the latest merge commit.

## Phase 3 — Cleanup

Goal: remove the replaced primitives, retire the legacy `globals.css`
tokens, drop the grid overlay, and add the anti-slop / lint guardrails
that prevent regression.

### 3.1 Tasks

- PR `chore(ui): delete replaced legacy primitives`
  - Delete primitives in `src/shared/components/` that Phase 2 has fully
    replaced by DS equivalents. The retained list (from `index.js`):
    - Keep: `Avatar`, `HeaderLanguage`, `HeaderMenu`, `LanguageSwitcher`,
      `UpdatePanel`, `Footer`, `RequestLogger`, `UsageStats`,
      `ThemeProvider`, `SetupDiagnosticCard`, `chartTooltip`,
      `ProviderInfoCard`, `NoAuthProxyCard`, `CapacityBadges`,
      `PricingModal`, `ChangelogModal`, `McpMarketplaceModal`,
      `ComboFormModal`, `ManualConfigModal`, `ModelSelectModal`,
      `ImportTokenModal`, `KiroAuthModal`, `KiroOAuthWrapper`,
      `KiroSocialOAuthModal`, `CursorAuthModal`, `IFlowCookieModal`,
      `GitLabAuthModal`, `OAuthModal`, `EditConnectionModal`,
      `AddCustomEmbeddingModal`, `SidebarNavIcons`. (Domain-specific
      modals; out of DS scope.)
    - Delete after every consumer migrates: `Button.js`, `Input.js`,
      `Select.js`, `Card.js`, `Modal.js` (default only — keep
      `ConfirmModal` until Wave B finishes), `Loading.js`,
      `Pagination.js`, `Badge.js`, `ProviderIcon.js`, `Toggle.js`,
      `ThemeToggle.js`, `DateRangePicker.js`, `Tooltip.js`,
      `Sidebar.js`, `Header.js`, `layouts/DashboardLayout.js`,
      `SegmentedControl.js`.
  - Update `src/shared/components/index.js` to drop the deleted exports.
- PR `chore(ui): retire legacy globals.css tokens`
  - Remove from `src/app/globals.css` (`:root` and `.dark`):
    - `--color-brand-50` … `--color-brand-900`
    - `--color-primary`, `--color-primary-hover`
    - `--color-gold`, `--color-gold-soft`
    - The legacy `--color-bg`, `--color-bg-alt`, `--color-surface`,
      `--color-surface-2`, `--color-surface-3`, `--color-sidebar`
      scales that map to the coral/green/gold palette.
  - Keep `globals.css`'s neutral surface tokens that DS does not yet
    cover; verify no `src/app/**` file still references a deleted var.
  - Verify `npm run dev` still boots; verify the Theme toggle still
    flips both palettes.
- PR `chore(ui): remove grid overlay`
  - Locate the legacy grid overlay in `globals.css` (or in
    `DashboardLayout.js`) and remove it. Confirm the dashboard chrome
    is clean in both themes.
- PR `chore(ui): add anti-slop guardrails`
  - Extend `scripts/check-anti-slop.mjs` (or add a sibling check) to
    fail on:
    - hex literals (`/#[0-9a-fA-F]{6}/`) in `src/app/**` and
      `src/shared/components/**` (allowlist: `public/**`,
      `.storybook/**`, `src/shared/ui/foundation/**`).
    - `window.prompt` / `window.confirm` in `src/app/**`.
    - Native `<select` JSX in `src/app/**` (allowlist: the
      `Pagination` rows-per-page control).
  - Wire the check into `npm run lint` (already runs
    `lint:anti-slop`).

### 3.2 Verification

```bash
grep -rE "(--color-brand-|--color-primary|--color-gold)" src/app src/shared/components 2>&1 | wc -l   # expect 0
grep -rE "window\.(prompt|confirm)" src/app 2>&1 | wc -l   # expect 0
grep -rnE "<select" src/app 2>&1 | wc -l                  # expect 0 (Pagination's is in src/shared/ui)
npm run storybook:build
npm run lint
cd tests && npm run test:ci
git diff tests/__baseline__/known-fails.txt   # empty
```

### 3.3 Entry / exit

- **Entry:** Phase 2 fully merged.
- **Exit:** all cleanup PRs merged; grep counts above all zero;
  `tests/__baseline__/known-fails.txt` unchanged; gates green.
