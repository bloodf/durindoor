# Phased rollout

> Four phases. Each phase is a series of PRs; every PR must clear the
> five hard gates in [`README.md`](./README.md#hard-gates-every-migration-pr-must-pass).

## Phase 0 — Foundation adoption

Goal: verify existing Durin DS token load, remediate their contrast in both served themes,
then retoken the internals of existing `src/shared/components` primitives to
`*-dd-*` tokens, preserving every exported prop, export shape, and
page-level import unchanged. Swapping page consumers/imports/JSX to DS
equivalents is Phase 2 work only — Phase 0 never touches a page file.

Before any page port, keep token/color remediation in
`src/shared/ui/tokens.css`; component and i18n behavior repairs use their
explicit G1 ownership. Keep `globals.css` definitions untouched. New
grid/focus/scrim overlays belong in DS tokens plus their shell-owned surface.
Preserve emerald/gold semantic roles. Measure normal text at 7:1, large text
at 4.5:1, and essential controls/graphics at 3:1 in light and dark. Missing
visible keyboard focus, keyboard traps, unreachable controls, and inaccessible
dialogs block page ports. Screenshots and axe alone never certify WCAG 2.2 AAA;
record measured applicable focus-appearance and target-size evidence.

Foundation minimum (must ship with the retoken, before any Phase 2 page
adoption PR opens): `Select` Arrow/Home/End key navigation, typeahead, and
visible focus; `Modal`/`Drawer` initial focus, focus trap, focus return,
background `inert`, topmost-only `Escape` handling, and nesting support;
`Button`/`IconButton` own real 44×44 target geometry; root layout + i18n own
`lang`/`dir` RTL support for `ar`, `he`, `fa`, and `ur` through current locale
cookie, reusing existing locale configuration with no second registry. Each
requirement needs a small component unit regression
plus the orchestrator's Playwright keyboard/target-size and desktop/mobile,
both-theme RTL assertions passing.

### 0.1 Token-load decision

Two options were on the table. We pick **option A**.

| Option | Mechanism | Verdict |
| --- | --- | --- |
| **A — retain existing `tokens.css` import in `src/app/layout.js`** | `src/app/layout.js` already imports `@/shared/ui/tokens.css` before `./globals.css`, matching Storybook's dual-root order. The `--dd-*` utilities are generated and resolvable inside the app, while `globals.css` stays untouched so upstream PRs keep merging. | **Picked and already shipped. Verify only; do not add or reorder imports.** |
| B — merge `tokens.css` into `src/app/globals.css` | Fold the `--dd-*` block into `globals.css` so the app has a single Tailwind root. | Rejected. `globals.css` is read-only from a Durin DS PR (`AGENTS.md` §5A, `porting-upstream-ui.md` §1), and merging would force future migrations to re-edit `globals.css` on every token change. |

`tokens.css` is a self-contained Tailwind root
(`@import "tailwindcss" source("../../");`) and already proves out the
side-by-side pattern — `.storybook/preview.jsx` imports both `tokens.css`
and `globals.css` today. Duplicate framework output is identical and
harmless.

### 0.2 Tasks

- Verify existing Durin DS token loading in `src/app/layout.js`
  - Confirm the existing `import "@/shared/ui/tokens.css";` remains before
    `import "./globals.css";`, matching Storybook's dual-root order. This is
    verification only: do not add, remove, or reorder imports, and do not
    edit `src/app/globals.css`.

- PR `feat(ui): remediate durin ds token contrast`
  - Adjust only `src/shared/ui/tokens.css` token mappings to meet the
    foundation thresholds above in both served themes. No page migration is
    complete in this PR; no shell adapter or `globals.css` edit is allowed.
- PR `feat(ui): retoken shared primitive internals to durin ds tokens`
  - Retoken the internals of existing `src/shared/components/<Name>.js`
    primitives: replace hard-coded class strings with `*-dd-*` token
    utilities. Do **not** swap consumer imports or JSX to the DS
    equivalents in `src/shared/ui/components/<Name>.jsx`, do not change any
    exported prop name or shape, and do not rename `Modal.js` `isOpen` to
    DS `Modal`'s `open` — that swap happens only inside the owning page's
    Phase 2 PR.
  - Every existing page import of `src/shared/components/<Name>.js`
    continues to resolve to the same module and prop contract; only the
    internal class strings change.
  - Ship the foundation minimum from above alongside the retoken: `Select`
    Arrow/Home/End/typeahead/focus, `Modal`/`Drawer` focus
    trap/return/inert/topmost-Escape/nesting, and real 44×44 targets, each
    covered by a component unit regression plus the orchestrator's
    Playwright keyboard/target-size assertions.
  - Do not delete `Sidebar.js`, `Header.js`, `layouts/DashboardLayout.js`, or
    `ThemeToggle.js`; they remain live runtime adapters.
  - Do **not** touch `src/app/globals.css`.

### 0.3 Verification

> Command ownership: workers edit source only. The migration orchestrator
> runs every gate below and collects evidence before human complete-diff
> review; do not run these commands as a substitute for orchestrator gating.

```bash
npm run storybook:build       # mocks still build
npm run lint                  # eslint + anti-slop
cd tests && npm run test:ci   # baseline unchanged
npm run dev                   # boot, click through every existing page; recorded full-screenshot and WCAG assessment live in the all-page gauntlet plan
# Token contrast recorded evidence (foundation PR): measured contrast
# for every `--dd-*` text/surface pair in both served themes
```

### 0.4 Entry / exit

- **Entry:** all-page gauntlet inventory started.
- **Exit:** contrast and keyboard-blocker evidence recorded; app launches;
  existing pages render with new tokens; primitive internals retoken to
  `*-dd-*` with props, exports, and page imports unchanged; foundation
  minimum (Select/Modal/Drawer/target-size) proven via unit and
  orchestrator Playwright gates; no `src/app/globals.css` edit, page
  cutover, or runtime-adapter deletion.

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

Goal: convert every actionable visual surface in [`page-map.md`](./page-map.md)
to the matching Durin DS visual spec, one route (or tightly coupled route
cluster) per PR. Redirect rows on the page map are verification only, not
visual migrations. Risk-ordered across four waves.

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
6. `/dashboard/cli-tools` → mock `pages/cli-tools/CliToolsPage.jsx`.
   `window.prompt` × 2 in `EndpointPresetControl.js` and `BaseUrlSelect.js`.
   Medium.
7. `/dashboard/cli-tools/[toolId]` → no mock. Port from
   `pages/cli-tools/CliToolsPage.jsx`. Medium.
8. `/dashboard/combos` → mock `pages/combos/CombosPage.jsx`. CRUD + table.
   Medium.
9. `/dashboard/providers` → mock `pages/providers/ProvidersPage.jsx`.
   Cards, toggles, status filters. Medium.
10. `/dashboard/providers/[id]` → no mock. Port the pattern from
    `pages/providers/ProvidersPage.jsx`; flag deviation in PR body. Medium.
11. `/dashboard/mcp-gateway` → mock `pages/mcp-gateway/McpGatewayPage.jsx`.
    Medium.
12. `/dashboard/console-log` → mock `pages/console-log/ConsoleLogPage.jsx`.
    Medium.
13. `/dashboard/proxy-pools` → mock `pages/proxy-pools/ProxyPoolsPage.jsx`.
    Medium.
14. `/dashboard/headroom` → mock `pages/headroom/HeadroomPage.jsx`. Medium.

### 2.3 Wave C — analytics (medium-high risk)

Range filters, charts, multi-table paged views, dual-axis lines.

15. `/dashboard/usage` → mock `pages/usage/UsagePage.jsx`. Medium-high.
16. `/dashboard/timeline` → mock `pages/timeline/TimelinePage.jsx`. Medium-high.
17. `/dashboard/timeline/[id]` → no mock. Port from `pages/timeline/TimelinePage.jsx`. Medium-high.
18. `/dashboard/quota` → mock `pages/quota/QuotaPage.jsx`. Medium.
19. `/dashboard/token-saver` → mock `pages/token-saver/TokenSaverStatsPage.jsx`. Medium-high.
20. `/dashboard/token-saver/settings` → mock `pages/token-saver-settings/SettingsPage.jsx`. Medium.
21. `/dashboard/compression-studio` → mock `pages/test-savers/TestSaversPage.jsx`. Medium.


### 2.4 Wave D — playground + media providers + remaining (high risk)

Most state, most modals, deepest tables.

22. `/dashboard/playground` → mock `pages/playground/PlaygroundPage.jsx`. High.
23. `/dashboard/profile` → mock `pages/settings/SettingsPage.jsx`. Medium.
24. `/dashboard/media-providers/[kind]` → mock `pages/media-providers/MediaProvidersPage.jsx`; cover `embedding`, `rerank`, `image`, `imageToText`, `tts`, `stt`, `video`, and `music`; `webSearch`/`webFetch` redirect to `/dashboard/media-providers/web`; no `realtime`. Medium-high.
25. `/dashboard/media-providers/[kind]/[id]` → no mock; port every supported dynamic branch. High.
26. `/dashboard/media-providers/combo/[id]` → no mock. High.
27. `/dashboard/media-providers/web` → no mock. Medium.
28. `/dashboard/auto-configure` → no mock. Medium.
29. `/dashboard/translator` → no mock. Medium.
30. `/dashboard/pxpipe` → no mock. Medium.
31. `/dashboard/mitm` → no mock. Medium.
32. `/dashboard/settings/pricing` → no mock. Low.
33. `/login` → no mock; preserve auth/password/OIDC/rate-limit/change-password states. High.
34. `/landing` → no mock; public surface. Medium.
35. `/callback` → no mock; preserve OAuth callback origin/replay protections. High.
36. `/` redirect to `/dashboard` — verify behavior; not visual migration.
37. `/dashboard` redirect to `/dashboard/usage` — verify behavior; not visual migration.

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

- The page map has 37 inventory rows: 35 actionable visual surfaces
  (32 dashboard rows plus `/login`, `/landing`, `/callback`) and 2 redirect
  verification rows (`/`, `/dashboard`). Same-client/route clusters may share
  one PR; route count is not a PR count. Redirects are not visually migrated.
- No page-map status flips to `migrated` before consumer/render proof and merge.

## Phase 3 — Cleanup

Goal: after consumer/render proof, remove only generic primitives with zero
consumers, move any needed overlay treatment into DS tokens or shell-owned
surfaces, and add guardrails. `src/app/globals.css` remains untouched.

### 3.1 Tasks

- PR `chore(ui): remove proven-unused generic primitives`
  - Before any physical deletion, prove zero live consumers and preserved
    functionality. Keep all domain widgets and their live imports.
  - `Sidebar.js`, `Header.js`, `layouts/DashboardLayout.js`, and
    `ThemeToggle.js` are runtime adapters; retain them unless zero-consumer
    proof demonstrates a behavior-preserving replacement. Do not schedule
    their automatic deletion.
  - Update `src/shared/components/index.js` only for symbols actually
    deleted after that proof. Do not use reset/clean or any destructive
    cleanup command.
  - Eligible candidate list (no automatic deletion): `Button.js`, `Input.js`,
    `Select.js`, `Card.js`, `Modal.js` (default only — keep `ConfirmModal`
    until Wave B finishes), `Loading.js`, `Pagination.js`, `Badge.js`,
    `ProviderIcon.js`, `Toggle.js`, `DateRangePicker.js`, `Tooltip.js`,
    `SegmentedControl.js`. Each candidate requires its own zero-consumer
    and preserved-functionality evidence before deletion.
- PR `chore(ui): move DS-owned overlay treatment`
  - Add or remove only DS-owned overlay treatment in
    `src/shared/ui/tokens.css` or its shell-owned rendering surface. Leave
    legacy `globals.css` definitions untouched.
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
# `src/app/globals.css` stays untouched; no legacy-token removal check.
grep -rE "window\.(prompt|confirm)" src/app 2>&1 | wc -l   # expect 0
grep -rnE "<select" src/app 2>&1 | wc -l                  # expect 0 (Pagination's is in src/shared/ui)
npm run storybook:build
npm run lint
cd tests && npm run test:ci
git diff tests/__baseline__/known-fails.txt   # empty
```

### 3.3 Entry / exit

- **Entry:** Phase 2 consumer/render proof complete.
- **Exit:** each deletion has zero-consumer and preserved-functionality proof;
  legacy `globals.css` remains unchanged; `tests/__baseline__/known-fails.txt`
  unchanged; gates green.
