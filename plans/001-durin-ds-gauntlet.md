# Durin DS — whole production web UI rewrite gauntlet

## Primary deliverable: full production web UI rewrite

This plan drives an end-to-end rewrite of the live web UI. Storybook provides
supporting component validation; real-app implementation and working user flows
are the primary deliverable. Documentation and stories cannot substitute for it.

### What this plan actually delivers

- Rewrite every production page template, client component, layout, navigation
  and responsive surface in the live app using Durin DS, while preserving backend
  API contracts, auth/storage/i18n behavior, and existing supported actions. The
  shipped app at the final candidate must render the rewritten interface and
  complete real user workflows.
- Replace legacy visual chrome on every screen, not only dashboard pages. The
  same rewrite covers public/auth screens, the dashboard app shell
  (Sidebar, Header, HeaderMenu, layouts, navigation rail, mobile menu,
  collapsed/expanded states, language/theme affordances), the `/landing`
  marketing layout, and the `/login` and `/callback` flows. Rewrite the four
  existing custom error boundaries with their owning routes. Root redirects are
  behavior-verification only, not visual rewrites. Validate the framework's
  default missing-route surface; add custom 404 presentation only when evidence
  shows a consistency or accessibility gap, since no custom source exists today.
- Every visual consumer adopts DS tokens and primitives where applicable, using
  `src/shared/ui/tokens.css` and owned component/shell styling. Keep
  `src/app/globals.css` untouched, including its legacy variable definitions.
  Do not treat whole-interface scope as permission to rewrite every global token.
- Restyle every domain widget and shell adapter in place while preserving its
  runtime behavior. Replace only superseded generic shared primitives with
  zero-consumer proof; domain components are restyled, not deleted. Backend
  implementation, network/DB code, server endpoints and host services are
  outside this UI rewrite; API/auth/storage contracts, polling, retry, error
  mapping, accessibility policy and supported actions are preserved, not
  rewritten. Accessibility fixes and acceptance remain required across every
  migrated surface.
- Cover every existing shared form, overlay, table, chart, editor (including
  Monaco/diff), loading/empty/error/disabled/busy state, theme switch,
  RTL/LTR direction, responsive breakpoints and accessible equivalents for
  non-text data in the live app, not only in stories.

### What this plan does NOT deliver on its own

- Storybook alone, mock pages alone, or the design-system token catalog alone
  do not satisfy the rewrite. Working stories are an acceptance gate that
  proves the same migrated surfaces the running app uses.
- Visual and interaction defects found during rewrite enter a separate
  reproduction-backed fix lane/PR within this campaign. Affected route stays
  blocked until the fix is integrated and revalidated; required merge acceptance
  still applies. Unrelated backend changes remain out of scope. Known broken UI
  flows cannot be deferred outside the campaign or waived to declare completion.
- Release and deployment are separately authorized work; this plan does not
  authorize push, PR, merge, release, or deploy of the candidate.

### Hard anti-completion rules

- Storybook stories, mock-page rebuilds, or token-swap passes without adopted
  production source code never satisfy this plan. Every accepted row in the
  route ledger must show real production source paths and real running-app
  evidence.
- No legacy screen, route, widget, modal, or chrome element may remain hidden
  behind a new shell. Migration completeness requires replacing the actual
  rendered surface, not only adding DS primitives alongside unused legacy code.
- Plans or status rows that conflate planned runtime coverage with
  census-pending state are invalid. `implementationStatus` and
  `realAppEvidence` track the production rewrite separately from any story or
  mock evidence.

## Status and scope

**PLAN READY FOR EXECUTION; UI migration NOT STARTED; AAA NOT CLAIMED.**

Planned against `cf572ec911afbef2e7cc1248a9be2e7a7b0d439a` on 2026-09-05.
User requested plan first: update local main safely, inspect merged leftovers, then
plan an orchestrated redesign of every page with Playwright proof and a strict
quality repair loop. This document defines that execution; it does not report
future checks as passed. No product code, dependencies, production service, or
provider credentials changed during planning. No remote push, PR, merge, release,
or deployment is authorized by this planning artifact alone.

Working tree: `.omc/wt-ui-gauntlet-plan`, branch `docs/durin-ds-gauntlet`.
Local main fast-forwarded 30 commits, from `6505912f5b` to planned SHA.

### Preserved work and cleanup verdict

Verified planning observation: `2026-09-05T17:33:58+00:00`. Root checks ran with cwd
`/home/cortexos/Developer/github.com/bloodf/durindoor`: branch `main`, clean index
and worktree, HEAD equal to origin/main. PGlite status commands ran with cwd
`.omc/wt-pglite`; their `feat/pglite-migration` header is not root status.

| Tree | Tip | Main ancestor exit | Status at audit | Decision |
| --- | --- | --- | --- | --- |
| `.omc/wt-765` | `7d98c7be5c86f8130a33ae0adae69750043ba11f` | 1 | clean, unique commit | retain; no ancestry proof |
| `.omc/wt-gate2` | `aa1805185d547a07ae733dba5b78da0f3cc9c980` | 1 | modified anti-slop bundle; dependencies/results | retain |
| `.omc/wt-pglite` | initial `ce9a56a6846b9e9b392b44598a475a22f8428329`; later `762b2002dcb0172e2761d8647ff9a9d57d7fb409` | 1 at both observations | changed during audit; latest observed tracked tree clean, no upstream | protected active concurrent work; not cleanup candidate |

**Zero existing worktrees or branch refs deleted.** Clean does not mean merged;
squash-merge guesses are not sufficient deletion evidence. Re-evaluate only with
clean status, successful ancestry proof, no active writer and no unique ignored
payload. Exit 1 means not ancestor; exit above 1 means command failure, not absence.
Never use `reset --hard`, `git clean`, forced worktree removal, reflog expiry, or
remote branch deletion for this campaign's routine cleanup.

PGlite tip advanced during planning without this campaign modifying it. Inventory
is timestamped evidence, not a claim that another worktree remains frozen. Stop
cleanup of any moving worktree; re-inventory and coordinate with its owner before
any later authorized mutation.

Root's original 13 dirty files are preserved with exact file SHA-256 values,
staged/index entries, staged patch, unstaged patch and porcelain status in
`.omc/wt-ui-preflight-recovery`, branch `recovery/ui-preflight-20260905` at original
HEAD. Private backup: `/home/cortexos/durindoor-ui-preflight-x6ryhd78` (0700).
Stash retained: `81bd7f1957d32de0c561d381a8d9768ab7a81a92`.
Root was clean at the observation above; old WIP was relocated, not applied over
changed upstream files or discarded. During final review a new untracked
`.omp/agents/pg-astra.md` appeared in root. Preserve this concurrent work; root
tracked files/index remain clean at origin/main. Recovery tree, private backup
and stash are protected active evidence, never merged-leftover cleanup candidates.

## Binding decisions; stale guide instructions superseded

1. `src/app/globals.css` remains read-only in EVERY phase, including end-of-campaign
   retirement. Remove old styling from consumers. Put necessary DS token,
   reduced-motion or overlay styling in `src/shared/ui/tokens.css` or shell-owned
   files. Do not remove legacy variable definitions from globals.css merely to
   satisfy a grep count.
2. Preserve behavior-bearing `src/shared/components/Sidebar.js`, `Header.js`,
   `layouts/DashboardLayout.js`, `HeaderMenu.js`, `ThemeToggle.js` and domain
   components while referenced. Preview `DashboardShell` is not a production
   replacement. Use in-place behavior-preserving adapters, not re-exports.
3. Source inventory wins over old counts: **37 page templates, 35 visual screens,
   2 redirects; 32 dashboard screens; 3 public/auth screens; 27 DS primitive
   modules; 21 page mocks; 52 legacy shared JS/JSX modules.** Dynamic variants add
   concrete screens beyond 37; never count one `[id]` URL as all branches.
4. DS mock layout/brand intent is reference, not permission to copy broken focus,
   contrast, controls, mock data or mock state logic. Accessibility fixes precede
   page ports. Emerald primary, gold secondary, warm dark/light surfaces remain.
5. Preserve URL/method/headers/body shapes, routes/query parameters, storage/i18n
   keys, server inputs, polling/retry/effect semantics, error mapping and supported
   actions. Retain existing pagination hooks and server totals/cursors. Do not
   replace backend pagination with slicing one fetched page to mimic Storybook.
   Exceptions: specified session-local collapse and verified accessibility fixes;
   discovered inert/broken user actions receive a separate reproduction-backed fix.
   Required DS rows-per-page options are `[10, 25, 50, 100, "all"]`; standardize
   that presentation in owning page migration while retaining backend paging
   contract. Never send string `"all"` to numeric API limits or assume loaded rows
   equal server total. If current API cannot express full collection safely,
   record concrete contract gap and resolve it before accepting that route.
6. Existing props remain during foundation retokening; consumers migrate to DS
   APIs explicitly in page waves. No new compatibility exports/shims. Remove old
   generic files only once their last consumer is migrated and runtime proof holds.
7. Every writer receives at most five explicit file/directory targets, an ownership
   exclusion list, observable acceptance, shared contracts, and instruction to
   **skip ALL gates, tests, builds, linters and formatters**. Orchestrator runs
   gates and formats union once. Workers never self-publish or mark routes done.
8. Full human diff approval precedes any push/PR. No direct push to main. Unit
   tests and smallest fitting documentation accompany runtime changes per repo
   contract. No baseline growth, fake mocks in production or source-text tests
   pretending to prove UI behavior.

## Source references and drift gate

Read these again before execution: [design guide](../docs/development/durin-ds.md),
[port rules](../docs/development/porting-upstream-ui.md),
[campaign](../docs/development/ui-migration/README.md),
[phases](../docs/development/ui-migration/phases.md),
[page map](../docs/development/ui-migration/page-map.md),
[recipe](../docs/development/ui-migration/playbook.md),
[harness](../docs/development/ui-migration/harness-runbook.md),
[agent contract](../AGENTS.md), root/test package manifests.
Reconcile current Git tree and every listed path with planned SHA. New routes,
primitive exports, shared callers or runtime changes add ledger rows before
writing; disappearance requires source-backed retired verdict, not silent omission.

Current tooling: Node pin `20.20.2`, npm pin `10.8.2`; workstation default was Node
`24.20.0`/npm `12.0.2`. Use pins for app gates. No configured language server; no
`bun check` script and no first-party Playwright setup. `bun test` is not this
repo's Vitest CI contract. Do not invent successful typecheck/Playwright runs.
No `/setup` route, no custom `loading.js` or `not-found.js` found at planned SHA.
Auth/setup states live inside login or domain components. Built-in missing-route
surface still needs browser acceptance; add custom shell only if actual proof
shows a consistency/accessibility gap.

## Gauntlet phases and parallel ownership

Orchestrator is integration owner. Read-only scouts map paths, implementers edit,
`designer` reviews actual screenshots/interactions when available; otherwise an
independent reviewer with explicit design/accessibility remit owns that verdict.
`reviewer` checks behavior, security and evidence. Discover live role roster before
dispatch; never restore user agent definitions solely to satisfy a role name.
Each wave fans all disjoint ready lanes together (max 32
agents). Do not serialize independent work. Do not run full gates concurrently:
shared fixed ports/native caches make false failures. A produced API contract is
the only reason to serialize writers.

Mandatory companion: [Working Storybook coverage](002-storybook-coverage.md).
Every production page, component and widget receives source-backed story/state
coverage in the same migration, not just existing 21 mock pages. SB1–SB3 own
discovery, isolation and all-story browser runner; page/widget owners author
working CSF3 stories importing actual production views. Both Storybook and
real-app Playwright evidence are required before accepting any migrated surface.

### G0 — Baseline and harness, before source migration

- Reconcile protected Git baseline, route census, actual live runtime SHA/version
  and guide fixes. Existing systemd runtime is separate from checkout: inspected
  package says 3.18.1, planning checkout 3.19.0. Never call a production screenshot
  proof of candidate SHA without identifying built artifact.
- Record pre-migration screenshots and behavior contracts on immutable base, not
  root dirty/recovery tree. Establish actual lint/test/build/Storybook baseline.
- Parallel lane H0a owns `tests/e2e/runtime.mjs`,
  `tests/e2e/qa-child-entry.mjs`, `tests/e2e/compose.yml`,
  `tests/e2e/Dockerfile`, `tests/unit/ui-qa-isolation.test.js`. Implement the
  isolated launcher, child bootstrap, network/mount restrictions, destination
  audit collection and teardown. Export `startQa({ runDir, workerId })` from
  `runtime.mjs`; return `{ baseURL, dataDir, artifactDir, stop,
  assertNoExternalEffects }`. Return no password or raw child environment.
  Readiness requires containment negative controls and successful app startup;
  process creation alone is insufficient. `stop()` affects only this run's
  children/network and is safe after partial startup failure.
  Compose containment is mandatory configuration, not a comment: only `app` and
  `fake-upstream` services attach solely to `qa`; `networks.qa.internal: true`,
  `external: false`, no implicit/default/external network, host networking or
  host gateway aliases. App publishes only its allocated port with
  `host_ip: 127.0.0.1`; fake-upstream publishes no ports. Both services require
  `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`,
  non-root users, no privileged mode/added capabilities/devices, host PID/IPC,
  Docker/systemd sockets or production mounts. Source bind mount is read-only;
  writable HOME/DATA_DIR/cache paths are explicit tmpfs or fresh run-owned
  ephemeral volumes, never production paths or shared persistent volumes.
  Before startup, run `docker compose -f tests/e2e/compose.yml config --format json`
  with synthetic credential-free values and structurally assert every invariant
  above on normalized configuration (including service/network/port/mount sets).
  Do not archive expanded environment fields; publish allowlisted assertion
  results only. Inspect actual launched network attachments/mounts/ports too.
  A default bridge or added external network fails closed. Structural checks
  supplement, never replace, browser AND server outbound negative controls.
- Parallel lane H0b owns `tests/e2e/seeds.mjs`,
  `tests/e2e/fake-upstream.mjs`, `tests/unit/ui-qa-seeds.test.js`. Export
  `seedQa({ dataDir, scenario })` and `resetQa({ dataDir })` from `seeds.mjs`;
  enforce H0a's disposable directory boundary and reuse actual DB APIs.
  Fixtures return record IDs/URLs, never credentials. Fake upstream serves
  deterministic provider/SSE/media cases inside H0a's restricted network.
  Seed/reset operations are worker-local; no production bootstrap endpoint.
  H0a and H0b may author concurrently against these fixed interfaces. H1 imports
  their exports; it does not bury launcher/container/seed implementation inside
  `fixtures.js`. H1/H2 may author consumers concurrently, but acceptance waits
  for H0 safety and seed contracts to pass orchestrator verification.
  Any additional required file needs an explicit, non-overlapping child lane
  assigned by Main before editing. Otherwise stop that slice and report the
  missing target; five-path ownership is not permission to hide safety code.
- Parallel lane H1 owns `package.json`, `package-lock.json`, `.gitignore`,
  `playwright.config.mjs`, `tests/e2e/fixtures.js`. Introduce pinned, Node-compatible
  `@playwright/test` and `@axe-core/playwright` as direct root devDependencies,
  reproducible config, secret-safe fixture and proposed `test:ui` script. This is
  mandatory Phase 0 bootstrap before page dispatch, not optional tooling.
  Root devDependency growth is deliberate test-tooling cost. Orchestrator must
  verify clean installs/builds under pinned Node/npm, including `Dockerfile`
  builder and `.github/workflows/ci.yml` / `.github/workflows/test.yml` install
  paths. No browser download added to ordinary app install/build or production
  image; browser installation occurs explicitly in isolated QA environment.
  If that cannot be maintained, stop and reassign a separate e2e manifest before
  shipping, rather than silently alter packaging. No claim about postinstall
  behavior without inspecting pinned dependency and clean install evidence.
- Parallel lane H2 owns `tests/e2e/routes.json`, `tests/e2e/routes.spec.js`,
  `tests/e2e/states.spec.js`, `tests/e2e/accessibility.spec.js`,
  `tests/e2e/flows.spec.js`. Consume H1 interface specified below; may author in
  parallel but integration waits until fixtures exist. Real specs, not empty
  scaffolds: every route/state has a consumer-observable assertion.
- H1 exports `test`/`expect` and fixture `qa`: `qa.baseURL`, `qa.seed(name)`,
  `qa.reset()`, `qa.artifactPath(name)`, `qa.assertNoExternalEffects()`.
  `qa.seed` returns typed JSON IDs/URLs for fixture records, never production keys.
  Contract cannot escape disposable state or perform real external service work.
  Enforce network/process isolation described below; this assertion reads actual
  browser and server deny/allow audit records, not a no-op intent flag.
  Tests access actual `page` and browser requests. Authenticate through login UI,
  not injected magic auth cookie. Reset mutation state between scenarios.
  Deterministic QA launcher generates a fresh password per run, passes it only
  through `DURINDOOR_QA_PASSWORD` to Playwright setup and `INITIAL_PASSWORD` to
  isolated app. Setup reads `process.env.DURINDOOR_QA_PASSWORD`; missing/empty
  value fails without logging it. `DURINDOOR_TEST_PASSWORD` is separate and used
  only for optional authorized live read-only checks, never disposable QA setup.
  Build separate minimal child-env maps; never copy an unrestricted parent env.
  Immediately after required child/setup startup, remove `DURINDOOR_QA_PASSWORD`
  and `INITIAL_PASSWORD` from launcher `process.env` and temporary spawn maps;
  use `finally` on failure too. `qa-child-entry.mjs` and setup must consume their
  own bootstrap value before deleting their own env entry, and never forward it
  to later subprocesses. Unsetting parent env cannot erase a child's inherited
  copy: child cleanup is an explicit H0a/H1 responsibility. If app requires the
  value after bootstrap, resolve that lifecycle before G0 passes; do not claim
  premature deletion or add a production auth bypass. Env deletion is exposure
  reduction, not guaranteed memory zeroization. Never collect env dumps, full
  process diagnostics or expanded container configuration in artifacts.
  Login through UI, verify
  authenticated destination, then save `context.storageState()` in ignored
  restricted run output. Reuse only within matching browser/isolated backend
  worker; never share mutable backend state across parallel route workers.
  Configure explicit browser/theme/viewport projects: each of Chromium, Firefox,
  WebKit × dark/light × desktop/mobile. Name them `chromium-dark-desktop`, etc.
  Every route spec runs in this matrix; wider viewport/RTL/state coverage below
  remains required. Fixture failures keep sanitized screenshots and traces;
  tracing/screenshots are disabled for password entry, auth failures containing
  secret inputs and secret-reveal steps. Never publish auth storageState files.
  G0 must demonstrate login, storageState reuse, both themes/viewports, and a
  deliberately failed fixture assertion producing safe diagnostic artifacts.
- `routes.json` stores route-template ID, entry file, concrete URL variants,
  source predicate for each variant, owning lane, required states, action names,
  fixture names and expected destinations. Census compares app filesystem set to
  manifest set and rejects omissions, duplicates or unexpanded dynamic branches.
  H2 owns generic census/shared-state specs only during bootstrap. After G0,
  integration owner alone aggregates manifest/shared specs; page agents never
  edit these common files concurrently. Route-specific evidence lives in unique
  per-cluster files specified below.
- H3 (parallel with harness authoring) is read-only baseline/design evidence:
  existing story IDs, source/served colors, dimensions and navigation coverage.
  Orchestrator runs browsers; designer consumes captures and records defects.

G0 exit: all proposed tooling is installed/wired and exercised; deliberately
wrong expected heading causes chosen route spec to fail, reverted assertion
passes; fixture server proves non-production paths and no external effects.
A broken baseline is a repair task, not a passing campaign gate.

### G1 — Accessible foundation before any page consumes DS

Parallel disjoint foundation lanes:

| Lane | Exact owned targets (maximum five) | Required behavior |
| --- | --- | --- |
| F1 | `src/shared/ui/tokens.css`; `src/shared/ui/foundation/Palette.stories.jsx`; `tests/unit/durin-ds-contrast.test.js` | DS root already imported before globals.css at `src/app/layout.js:3-4`; preserve shipped order matching Storybook, no import edit needed. Fix text/semantic/action/focus pairs and reduced-motion rules; no globals.css edit |
| F2 | `src/shared/ui/components/Modal.jsx`; `src/shared/ui/components/Drawer.jsx`; `src/shared/ui/components/Modal.stories.jsx`; `src/shared/ui/components/Drawer.stories.jsx`; `tests/unit/durin-ds-overlays.test.js` | Initial focus, Tab/Shift+Tab containment, opener return, background inert, topmost-only Esc, nesting-safe scroll, preserved busy/backdrop/Esc dismissal contract |
| F3 | `src/shared/ui/components/Select.jsx`; `src/shared/ui/components/Select.stories.jsx`; `tests/unit/durin-ds-select.test.js` | Arrow/Home/End/typeahead; active option and selected value distinct; Enter/Space select; Esc cancel/return; disabled/empty/long options; no focusable nested option controls |
| F4 | `src/shared/ui/components/Tooltip.jsx`; `src/shared/ui/components/Tooltip.stories.jsx`; `tests/unit/durin-ds-tooltip.test.js` | Keyboard hover/focus descriptive relationship, Esc dismissal, touch-accessible equivalent, viewport/scroll-container clipping safety |
| F5 | `src/shared/ui/components/RangeSelector.jsx`; `src/shared/ui/components/RangeSelector.stories.jsx`; `tests/unit/durin-ds-range-selector.test.js` | Valid/invalid custom ranges, popover focus/return and keyboard, date semantics unchanged; emits only committed values |
| F6 | `src/shared/ui/components/DataTable.jsx`; `src/shared/ui/components/DataTable.stories.jsx`; `src/shared/ui/components/Pagination.jsx`; `src/shared/ui/components/Pagination.stories.jsx`; `tests/unit/durin-ds-data-table.test.js` | Accessible caption/name/header relationships; existing sort/row-action/pagination behavior supported; stable empty/all/server totals; viewport-safe scroll region |
| F7 | `src/shared/ui/components/Button.jsx`; `src/shared/ui/components/Button.stories.jsx`; `src/shared/ui/components/IconButton.jsx`; `src/shared/ui/components/IconButton.stories.jsx`; `tests/unit/durin-ds-target-size.test.js` | Explicit 44×44 non-overlapping pointer targets for every active size/variant; preserve button semantics; unit activation/disabled contract plus orchestrator Playwright box/hit-test assertions |
| F8 | `src/app/layout.js`; `src/i18n/RuntimeI18nProvider.js`; `src/i18n/runtime.js`; `src/i18n/config.js`; `tests/unit/durin-ds-locale-direction.test.js` | Document `lang` and `dir` follow existing normalized locale/cookie and update on language changes; RTL for ar/he/fa/ur, LTR otherwise, no second storage/locale registry. Preserve stylesheet import order, hydration and translator behavior |

Use native dialog/top-layer/focus semantics and existing dependencies first;
no one-implementation overlay framework. Choose minimum native implementation
that passes nesting, backdrop and focus tests across target browsers. Select
retains project-required custom listbox (not native select). DS Pagination's
internal native rows-per-page select is sole intentional exception.

F1 owns color/focus/motion tokens, not nonexistent dimension tokens. F7 owns
Button/IconButton geometry; F2–F6 own geometry in their explicit component files.
F8 alone owns root language/direction wiring. S2 later consumes existing locale
contract without editing F8 files; use current locale normalization and events.
Other undersized components receive explicit component+story+regression target
packs before foundation closes. If a shared helper is necessary, freeze its API,
nominate one writer and serialize consumers only at that boundary. No sibling
edits to tokens or root layout.
F2 primitives must preserve caller dismissal and submitting guards before modal
consumer adoption; current `closeOnOverlay` and className gaps are not optional.
All callers use actual DS export shapes, not guessed named/default imports.

Every other primitive in inventory below also gets meaningful keyboard/name,
contrast, target, motion and prop-state browser coverage. If it needs changes,
dispatch explicit component+story+small regression-file target pack (at most five
paths), not a blanket token workaround or global monkey patch. At minimum Button,
IconButton, Checkbox, Toggle, Tabs, SegmentedControl, Chip, PromptDialog and
ConfirmDialog must prove their actual activation/disabled/focus/error behavior.

Source-only baseline ratios (normal text threshold 7:1; not rounded for pass):

| Pair | Light | Dark |
| --- | --- | --- |
| text / surface | 17.53 | 14.27 |
| muted / surface | 5.94 | 6.76 |
| subtle / surface | 3.12 | 3.16 |
| on-accent / accent | 3.77 | 9.55 |
| on-danger / danger | 6.47 | 3.76 |
| focus ring composited over surface | 1.55 | 2.37 |
| focus ring composited over page background | 1.53 | 2.34 |

Those numbers are measured source token pairs, not served-page certification.
Focus rows use current 35%-alpha ring composited against actual token background;
they fail required 3:1 focused/unfocused change. F1 fixes this centrally, then
browser evidence measures actual served pixels/colors and qualifying ring area.
Muted/subtle are informative text, not blanket decorative exceptions. Preserve
brand hues/roles but change failing role values, on-colors and focus treatment.
Current 28/36px controls do not satisfy 44×44 custom target requirement merely
because they are dense. Keep 13px body density where legible; increase actual hit
boxes/row spacing without overlaps. AAA may require visible geometry deviations
from mocks; record revised reference, never silently lower threshold.

After F1–F8 contract gate, retoken legacy shared components and domain modals in
parallel L lanes below. Preserve all props and data logic. L3 depends on F2–F6.
Domain modal lanes depend on safe overlay primitive contracts. None changes shell
files concurrently with S lanes. Each lane's at most five paths explicit:

| Lane | Exact owned legacy paths | Dependency |
| --- | --- | --- |
| L1 | `src/shared/components/Button.js`<br>`src/shared/components/Input.js`<br>`src/shared/components/Select.js`<br>`src/shared/components/Toggle.js`<br>`src/shared/components/SegmentedControl.js` | Foundation gate |
| L2 | `src/shared/components/Card.js`<br>`src/shared/components/Badge.js`<br>`src/shared/components/Avatar.js`<br>`src/shared/components/Loading.js`<br>`src/shared/components/CapacityBadges.js` | Foundation gate |
| L3 | `src/shared/components/Modal.js`<br>`src/shared/components/Drawer.js`<br>`src/shared/components/Tooltip.js`<br>`src/shared/components/DateRangePicker.js`<br>`src/shared/components/Pagination.js` | Foundation gate |
| L4 | `src/shared/components/ProviderIcon.js`<br>`src/shared/components/ProviderInfoCard.js`<br>`src/shared/components/NoAuthProxyCard.js`<br>`src/shared/components/SetupDiagnosticCard.jsx` | Foundation gate |
| L5 | `src/shared/components/OAuthModal.js`<br>`src/shared/components/ImportTokenModal.js`<br>`src/shared/components/IFlowCookieModal.js`<br>`src/shared/components/GitLabAuthModal.js` | Foundation gate |
| L6 | `src/shared/components/KiroAuthModal.js`<br>`src/shared/components/KiroOAuthWrapper.js`<br>`src/shared/components/KiroSocialOAuthModal.js`<br>`src/shared/components/CursorAuthModal.js` | Foundation gate |
| L7 | `src/shared/components/EditConnectionModal.js`<br>`src/shared/components/AddCustomEmbeddingModal.js`<br>`src/shared/components/ManualConfigModal.js`<br>`src/shared/components/ModelSelectModal.js` | Foundation gate |
| L8 | `src/shared/components/ComboFormModal.js`<br>`src/shared/components/PricingModal.js`<br>`src/shared/components/McpMarketplaceModal.js` | Foundation gate |
| L9 | `src/shared/components/UsageStats.js`<br>`src/shared/components/RequestLogger.js`<br>`src/shared/components/chartTooltip.js` | Foundation gate |
| L10 | `src/shared/components/Footer.js`<br>`src/shared/components/ChangelogModal.js`<br>`src/shared/components/UpdatePanel.js` | Foundation gate |
| S1 | `src/shared/components/Sidebar.js`<br>`src/shared/components/SidebarNavIcons.js`<br>`src/shared/components/layouts/DashboardLayout.js` | Shell gate |
| S2 | `src/shared/components/Header.js`<br>`src/shared/components/HeaderMenu.js`<br>`src/shared/components/HeaderLanguage.js`<br>`src/shared/components/LanguageSwitcher.js`<br>`src/shared/components/ThemeToggle.js` | Shell gate |
| S3 | `src/shared/components/ThemeProvider.js`<br>`src/shared/components/layouts/AuthLayout.js` | Shell gate |
| I | `src/shared/components/index.js`<br>`src/shared/components/layouts/index.js` | Integration only |

G1 exit: named component unit regressions fail before fix/pass after fix;
Storybook build AND actual story iframe runtime pass; all legacy surfaces still
render; compiled served colors, hit boxes, focus states and reduced motion pass.
Do not re-pin `durin-ds-page-contract.test.js` source-regex expectations as proof.
If migration touches its wording/implementation assertions, replace/delete those
assertions and rely on rendered observable contract tests instead.

### G2 — Production shell, public/auth and low-risk screens

S1 owns Sidebar+SidebarNavIcons+DashboardLayout atomically: layout alone owns
`collapsed=false` state, passes `collapsed/onToggleCollapse`; no new storage key.
Preserve Next Link navigation, pathname active state, manual/auto accordions,
translator visibility from `/api/settings`, version banner/UpdatePanel from
`/api/version`, mobile `onClose`, notification rail and dismiss behavior.
Group order OBSERVE, ROUTE, OPTIMIZE, MEDIA, SYSTEM, HELP. Every old href retained;
health is reachable even if preview NAV_GROUPS omitted it. Runtime adapters not
preview shell exports own behavior. Use `/icons/icon-512.png` brand asset.

S2 owns Header/HeaderMenu/HeaderLanguage/LanguageSwitcher/ThemeToggle independently.
Preserve auth status/logout, name/login-method, command/search affordance,
apps/language/theme and mobile menu contract. S3 owns ThemeProvider/AuthLayout;
integration owner alone touches layout barrels and `src/app/(dashboard)/layout.js`
if needed. Root token import remains F1 ownership. Do not introduce a second
navigation registry or collapse state. Disabled, mobile, collapsed tooltip and
focus return states receive browser proof before page adoption.

Once shared shell contract is green, A route lanes run concurrently: API docs,
MCP help, health, skills, login, landing, callback. Public screens are real migration
scope, not a dashboard exemption. Two root redirects are assertion-only rows,
not new page implementations. No dashboard shell forced onto marketing/auth.
Preserve actual auth boundary in `src/dashboardGuard.js`/`src/proxy.js`; UI layout
is not security enforcement. Security routing changes require separate reviewed
fix, not a visual port.

### G3 — Route waves B, C and D

Every row in route ledger has a named wave, reference family and concrete
acceptance. Each page PR MUST add or update its uniquely owned
`tests/e2e/routes/<cluster-slug>.spec.js` with route-specific actions and states,
plus `tests/unit/<cluster-slug>.test.js` when runtime behavior changes. Reuse and
extend an existing cluster regression file instead of creating a duplicate.
Integration owner assigns unique slugs before dispatch; tightly coupled routes
such as token-saver overview/settings share one writer and one cluster spec.
Each lane owns at most five explicit targets: route directory (including local
clients/components AND their required stories), unique e2e spec, unique unit file
if needed, required external story/component path and one shared source path.
Every rendered symbol needs its own meaningful story or explicit parent-story
scenario; stories are mandatory, not optional reference work. Documentation
uses inline comments/JSDoc in owned source; Main alone aggregates page-map and
changelog updates. If required source ownership exceeds five targets, split into
disjoint child scopes rather than omit tests/docs or grant overlapping ownership.
Before dispatch enumerate ALL files in owned directory and shared callsites;
no broad root globs. No new generic components in legacy shared tree.
Non-overlapping route lanes run concurrently. Strict dependencies only:

- CLI index+detail+MITM share endpoint/model/card components. One CLI component
  writer owns `src/app/(dashboard)/dashboard/cli-tools/components`; other lanes
  consume frozen prop contracts. Index and detail may share one route-cluster PR.
- Providers and media share `providers/components/ConnectionsCard.js` and
  `ModelsCard.js`; one provider-domain writer owns these, media consumers wait for
  that contract. Provider `[id]` owner alone changes auth dispatch and local modals.
- Token saver overview/settings share `TokenSaverClient.jsx`: one owner edits both
  views. Never split two writers across same file.
- Timeline list/detail may run independently when shared contracts unchanged;
  fixture IDs come from actual stored traces, never guessed strings.
- Usage page and all UsageStats/RequestLogger/chartTooltip consumers need shared
  analytics primitives ready. Keep cost+token series in one graph, provide labels
  and non-color differentiation, accessible data equivalent.
- Domain shared modals retain OAuth/key/connection state machines. Restyle their
  chrome, not credentials or API behavior. Last legacy consumer controls deletion.
- Main alone updates page-map, changelog, lockfile, shared barrels and campaign
  status. Subagents never race on these files.

Wave B: management (keys, CLI, combos, providers/details, MCP, console log, pools,
headroom). Wave C: usage, timeline/detail, quota, both token-saver views,
compression studio. Wave D: playground, profile, media kinds/details/combo/web,
auto-configure, translator, pxpipe, MITM, pricing. Work can start for independent
ready lanes across waves; no page is accepted before its prerequisite contracts
and union gate. Wave labels express risk, not permission to skip high-risk pages.

### G4 — Integrated product gauntlet and repair loop

Compose accepted slices onto one immutable integration candidate; run union gates
and all routes on that exact candidate. Never claim per-branch tests prove combined
state. Rebase/update source drift before approval; revalidate affected dependency
closure. Shared token/component/shell change invalidates all consuming route
captures, not just one happy screen. Headless rendered checks plus independent
designer review are mandatory. If review finds a defect, dispatch corrective
writer with exact evidence/paths; do not silently patch substantial rejected work.

Keep small ignored JSON evidence ledger, not a new orchestration service:

```json
{
  "baseSha": "cf572ec911afbef2e7cc1248a9be2e7a7b0d439a",
  "candidateSha": null,
  "routeId": "R01",
  "url": "/dashboard/api-docs",
  "owner": "A-api-docs",
  "foundationRev": null,
  "sharedContractRevs": {},
  "evidenceCandidateSha": null,
  "lastGate": 0,
  "state": "planned",
  "attempt": 0,
  "evidence": [],
  "blockers": []
}
```

One orchestrator owns atomic state writes after each gate; no custom coordinator
unless ordinary harness persistence demonstrably fails. Resume by `lastGate+1`,
not loose state label. Every evidence record carries candidate SHA, browser
version, fixture revision, route/state/theme/viewport, command, exit code, artifact
path and reviewer verdict. Missing/corrupt evidence means unverified.
`foundationRev` is content hash of accepted tokens/primitive/shell source set;
`sharedContractRevs` maps each consumed contract path to its accepted content hash.
Before resuming, recompute dependency hashes and compare them to recorded values.
Any mismatch or `evidenceCandidateSha !== candidateSha` makes affected evidence
stale, sets `lastGate=1`, and invalidates gates 2–7; preserve old artifacts as stale
history. Never reuse screenshot acceptance across unknown/shared revisions.

| Gate | Transition requirement | Failure action |
| --- | --- | --- |
| 0 inventoried | Route/variants/owner/contracts complete | repair inventory, no source writes |
| 1 changed | Complete scoped diff, no stubs or mock production data | corrective writer |
| 2 code-green | Orchestrator formatting/checks/unit behavior gate | fix red cause; no screenshot acceptance |
| 3 runtime-green | Candidate app/Storybook launches; routes and workflows pass | reproduce browser/server failure, fix owner |
| 4 visual-accessible | All matrix captures, served contrast/target/focus checks, applicable WCAG ledger | designer/reviewer defects become corrective tasks |
| 5 review-ready | Complete diff plus independent technical/design pass | no push while rejected/unreviewed |
| 6 accepted | Explicit human approval and green final candidate | approved PR workflow, no direct main push |
| 7 migrated | Merged SHA and current-SHA browser/runtime proof | status stays not migrated until proof |

Code change resets gates from 2 for affected dependency closure. New shared
contract resets consumers' relevant gates. A transient tool/network failure records
infrastructure failure, never PASS/absence. Repeated same failure triggers deeper
root-cause review; no arbitrary retry count allows false completion. Genuine
unavailable auth/provider/browser/manual evidence is `[blocked]` with exact missing
prerequisite and completed reachable work; it never reduces required scope.

Only after integrated smoke passes, instantiate cleanup tasks from actual zero-
consumer findings: delete obsolete generic files/exports; remove stale imports and
throwaway scripts; update docs/changelog and guardrails. Preserve active domain and
shell adapters. `globals.css` remains untouched. Wire focused anti-slop checks into
existing lint for token-only UI, no app native select/prompt/confirm, proper DS
imports. Check UI code structurally, not broad regexes that flag example payloads,
provider logo assets or API documentation strings. Re-run full gauntlet after
cleanup; cleanup cannot invalidate earlier proof unnoticed.
Use logical inline/block spacing, alignment and borders for migrated UI. Guard
new physical-direction utilities where direction should follow locale; explicit
direction-independent chart coordinates and media geometry need reviewed narrow
exceptions, not a blanket ban. RTL layout and bidi text remain runtime gates.

### G5 — Final acceptance and delivery

Fresh candidate build; all gates, all route variants, both themes, real backend
workflows and independent reviews. Human approves full diff before push/PR. Any
merge conflict correction invalidates affected checks. CI must be green at actual
merge; unresolved review threads zero. Release/deployment is separately authorized
work with rollback and deployed-SHA smoke. Do not update production automatically
merely to capture screens. Local candidate completion and deployed completion are
separate evidence fields, neither implies the other.

### Production-output checkpoints

| Gate | Production output required before exit | Storybook role |
| --- | --- | --- |
| G0 | Baseline harness, route manifest, fixture isolation and pre-rewrite evidence only; no route is implemented or accepted. | Baseline support only. |
| G1 | Real accessible DS primitives and retokened production shared components ready for consuming live routes; `globals.css` unchanged. | Proves each real component state, never completion by itself. |
| G2 | Rewritten live shell/navigation plus public/auth/low-risk route components render in candidate app and complete actual workflows. | Supporting coverage for same production imports. |
| G3 | Every remaining visual route, dynamic detail branch, shared/domain widget, form, overlay, table, chart, editor, mobile/theme/RTL/loading/error state is adopted in production source and workflow-proven. | Supporting coverage for each migrated source surface. |
| G4 | One integrated candidate renders whole rewritten app; repair loop closes live-route, behavior, accessibility and visual defects. | Runtime/build proof supplements candidate-app proof. |
| G5 | Cleanup leaves no untouched legacy UI hidden behind new shell; final candidate completes actual product workflows on all ledger rows before human acceptance. | Final all-story proof remains additional required evidence. |

## Every route template: ownership and acceptance ledger

All rows currently have `implementationStatus: planned`, `realAppEvidence:
unverified`, and `storyEvidence: unverified`; none is migrated. `Production source
path` is exact at planned SHA. `Reference` is matching mock family below; where no
exact mock exists, use listed closest family's primitives and preserve complete real
content. Every visual row requires adopted production UI plus real workflow proof;
redirect rows require real navigation proof. Every row inherits full
state/theme/responsive/keyboard matrix, not only its listed special actions.

| ID | Route | Production source path | Wave | Reference | Required specific proof | implementationStatus | realAppEvidence | storyEvidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | `/dashboard/api-docs` | `src/app/(dashboard)/dashboard/api-docs/page.js` | A | api-docs | Read every section; anchors, code examples and endpoint links; narrow code-block scroll. | planned | unverified | unverified |
| R02 | `/dashboard/auto-configure` | `src/app/(dashboard)/dashboard/auto-configure/page.js` | D | settings | Analyze/preview/apply/error/cancel in disposable config; reload confirms actual saved result, no host discovery/config changes. | planned | unverified | unverified |
| R03 | `/dashboard/cli-tools/[toolId]` | `src/app/(dashboard)/dashboard/cli-tools/[toolId]/page.js` | B | cli-tools | All 18 valid tool IDs; each bespoke/default renderer, endpoint/key/model mapping, copy/manual/config states; invalid ID 404. | planned | unverified | unverified |
| R04 | `/dashboard/cli-tools` | `src/app/(dashboard)/dashboard/cli-tools/page.js` | B | cli-tools | Every CLI and MITM card, endpoint presets, prompt rename/delete cancellation, install/config error; host-file writes confined to isolated HOME. | planned | unverified | unverified |
| R05 | `/dashboard/combos` | `src/app/(dashboard)/dashboard/combos/page.js` | B | combos | Create/edit/delete disposable combo, reorder/fallback/weights/capability ceilings, connection-group restrictions, validation/cancel/server error. | planned | unverified | unverified |
| R06 | `/dashboard/compression-studio` | `src/app/(dashboard)/dashboard/compression-studio/page.js` | C | compression-studio | Tabs, source input/model selection, run/progress/cancel/error, diff editor keyboard and accessible text alternative. | planned | unverified | unverified |
| R07 | `/dashboard/console-log` | `src/app/(dashboard)/dashboard/console-log/page.js` | B | console-log | Log/timeline views, search/level filters, live/pause/resume, buffer clear isolation, stream disconnect/recovery and keyboard. | planned | unverified | unverified |
| R08 | `/dashboard/endpoint` | `src/app/(dashboard)/dashboard/endpoint/page.js` | B | endpoint | Create/edit/delete disposable keys, copy/reveal masking, scopes, expiration, quota, account restrictions; tunnel states simulated, never start production tunnel. | planned | unverified | unverified |
| R09 | `/dashboard/headroom` | `src/app/(dashboard)/dashboard/headroom/page.js` | B | headroom | Metrics and health unavailable/online, enable/config save+reload, error rollback; service controls faked behind isolated boundary. | planned | unverified | unverified |
| R10 | `/dashboard/health` | `src/app/(dashboard)/dashboard/health/page.js` | A | health | Refresh and polling, healthy/degraded/down/empty/error data, provider branding and pager boundaries. | planned | unverified | unverified |
| R11 | `/dashboard/mcp-gateway` | `src/app/(dashboard)/dashboard/mcp-gateway/page.js` | B | mcp-gateway | Server/tool state, marketplace modal, named prompt, cancel/reject/confirm delete, empty/disconnected/error; no external server spawn. | planned | unverified | unverified |
| R12 | `/dashboard/mcp-help` | `src/app/(dashboard)/dashboard/mcp-help/page.js` | A | mcp-help | Help navigation, code copy if present, keyboard-accessible links; preserve documented command content. | planned | unverified | unverified |
| R13 | `/dashboard/media-providers/[kind]/[id]` | `src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js` | D | media-providers | Every supported kind and distinct provider/no-auth/custom-embedding/example branch; validate forms, run/stop/error outputs with local fake upstream; invalid pair/node 404. | planned | unverified | unverified |
| R14 | `/dashboard/media-providers/[kind]` | `src/app/(dashboard)/dashboard/media-providers/[kind]/page.js` | D | media-providers | All ten registered kinds; webSearch/webFetch listing redirects; custom/local embedding branches, provider cards and unavailable/empty states; invalid kind 404. | planned | unverified | unverified |
| R15 | `/dashboard/media-providers/combo/[id]` | `src/app/(dashboard)/dashboard/media-providers/combo/[id]/page.js` | D | media-providers | Existing fixture combo direct link/edit/delete/cancel and unknown ID; listing create-combo is currently unreachable, do not invent route. | planned | unverified | unverified |
| R16 | `/dashboard/media-providers/web` | `src/app/(dashboard)/dashboard/media-providers/web/page.js` | D | media-providers | Search/fetch sections, provider connections and detail links, configured/no-auth/disabled/error cards; no real crawling. | planned | unverified | unverified |
| R17 | `/dashboard/mitm` | `src/app/(dashboard)/dashboard/mitm/page.js` | D | cli-tools | Tool/model mapping/config/status, confirmations and errors; no host cert installation, privileged commands or production traffic interception. | planned | unverified | unverified |
| R18 | `/dashboard` | `src/app/(dashboard)/dashboard/page.js` | S | redirect | No JSX; assert /dashboard/usage redirect for authenticated user, auth guard /login for unauthenticated user. | planned | unverified | unverified |
| R19 | `/dashboard/playground` | `src/app/(dashboard)/dashboard/playground/page.js` | D | playground | Model/provider/pinned connection selection, composer/send/stop/retry, streamed text/reasoning/tools/error, attachments and supported modes; abort consumes no stray stream. | planned | unverified | unverified |
| R20 | `/dashboard/profile` | `src/app/(dashboard)/dashboard/profile/page.js` | D | settings | All tabs, theme/language/auth/settings forms, save/reload/rollback, unsafe toggles cancelled; security mutations isolated. | planned | unverified | unverified |
| R21 | `/dashboard/providers/[id]` | `src/app/(dashboard)/dashboard/providers/[id]/page.js` | B | providers | Every auth family and dynamic compatible node, connections/groups, import/edit/remove/test, custom models/aliases; unknown-provider message; no real OAuth exchange. | planned | unverified | unverified |
| R22 | `/dashboard/providers` | `src/app/(dashboard)/dashboard/providers/page.js` | B | providers | Search and status filters, real logo fallback, configured/unconfigured/no-auth/disabled/error cards; test-all simulated upstream. | planned | unverified | unverified |
| R23 | `/dashboard/proxy-pools` | `src/app/(dashboard)/dashboard/proxy-pools/page.js` | B | proxy-pools | List/add/edit/delete/test disposable pool, validation/disabled/empty/error, assignment preservation; no production proxy probes. | planned | unverified | unverified |
| R24 | `/dashboard/pxpipe` | `src/app/(dashboard)/dashboard/pxpipe/page.js` | D | proxy-pools | Status/config/form validation/start-stop/error UI; subprocess boundary isolated or blocked, never control installed proxy. | planned | unverified | unverified |
| R25 | `/dashboard/quota` | `src/app/(dashboard)/dashboard/quota/page.js` | C | quota | Provider quotas/limits, unknown/unlimited/exhausted/reset states, refresh, no color-only meaning, unavailable data never shown as zero. | planned | unverified | unverified |
| R26 | `/dashboard/skills` | `src/app/(dashboard)/dashboard/skills/page.js` | A | skills | Search/catalog, endpoint and key selection, custom endpoint, generated command and clipboard success/failure. | planned | unverified | unverified |
| R27 | `/dashboard/timeline/[id]` | `src/app/(dashboard)/dashboard/timeline/[id]/page.js` | C | timeline | Persisted fixture trace, adjacent SSE chunk groups expand/collapse, string/JSON payloads, unknown trace, failed fetch, loading. | planned | unverified | unverified |
| R28 | `/dashboard/timeline` | `src/app/(dashboard)/dashboard/timeline/page.js` | C | timeline | Provider/model/status filters, live pause/resume, chart same filtered data, trace link/drawer, reconnect, no lost selected state. | planned | unverified | unverified |
| R29 | `/dashboard/token-saver` | `src/app/(dashboard)/dashboard/token-saver/page.js` | C | token-saver | Overview ranges, per-tool statistics, empty and error states, table/chart agreement; preserve shared client view behavior. | planned | unverified | unverified |
| R30 | `/dashboard/token-saver/settings` | `src/app/(dashboard)/dashboard/token-saver/settings/page.js` | C | token-saver | Every setting branch in shared TokenSaverClient, validation/save/reload/error/cancel, same persisted keys and data types. | planned | unverified | unverified |
| R31 | `/dashboard/translator` | `src/app/(dashboard)/dashboard/translator/page.js` | D | test-savers | Format/model selection, input validation, translated output, error and copy behavior; conditional navigation preserved. | planned | unverified | unverified |
| R32 | `/dashboard/usage` | `src/app/(dashboard)/dashboard/usage/page.js` | C | usage | Preset/custom ranges incl invalid dates, cost+tokens chart, per-key/model/provider tables, recent-request details, server pagination/all and filter reset parity. | planned | unverified | unverified |
| R33 | `/callback` | `src/app/callback/page.js` | A | settings | Suspense/loading/manual-copy/error/success/done; isolated opener+BroadcastChannel+storage relay and close timer using synthetic code/token only. | planned | unverified | unverified |
| R34 | `/dashboard/settings/pricing` | `src/app/dashboard/settings/pricing/page.js` | D | settings | Direct navigation outside route group; pricing modal edit/reset/cancel/error/reload; shell/auth exposure verified, not assumed. | planned | unverified | unverified |
| R35 | `/landing` | `src/app/landing/page.js` | A | api-docs | Hero/nav/footer CTAs, mobile menu and anchors, clipboard and external links, responsive marketing layout; inert CTA becomes explicit scoped functional repair. | planned | unverified | unverified |
| R36 | `/login` | `src/app/login/page.js` | A | settings | Loading/auth-status failure/password/OIDC/both/default/forced-change/rate-limit forms and safe next redirects; unit+browser proof for each meaningful branch. | planned | unverified | unverified |
| R37 | `/` | `src/app/page.js` | S | redirect | No JSX; assert server redirect to /dashboard and authenticated/unauthenticated final destinations; never omit from route census. | planned | unverified | unverified |

### Dynamic route expansion (mandatory, not sample coverage)

`src/shared/constants/providers.js` `MEDIA_PROVIDER_KINDS` enumerates
`embedding`, `rerank`, `image`, `imageToText`, `tts`, `stt`, `webSearch`, `webFetch`,
`video`, `music`. Enumerate ALL ten list URLs. `webSearch`/`webFetch` lists redirect
to `/dashboard/media-providers/web`; their detail pages remain distinct. No
`realtime` kind at this SHA; do not build phantom route based on old guide.

For each supported media kind enumerate detail fixtures by actual predicates:
built-in serviceKinds member; noAuth; optional notice/config; custom embedding node
(`custom-embedding-` prefix AND stored matching node); local Ollama embedding;
loading/missing custom node and incompatible kind/provider 404. TTS/STT/embedding
have separate example cards; generic examples cover webSearch/webFetch/image/
imageToText/video/music; rerank has no example. ModelsCard absent for TTS and web
kinds. `COMBO_KINDS` empty means no reachable list create-combo branch; retain direct
existing combo detail route and assert its valid/invalid ID states. Do not invent
new capabilities to match a mock.

`src/shared/constants/cliTools.js` `CLI_TOOLS` has 18 valid IDs:
`claude`, `openclaw`, `codex`, `opencode`, `cowork`, `hermes`, `droid`, `cursor`,
`cline`, `kilo`, `roo`, `continue`, `amp`, `qwen`, `deepseek-tui`, `jcode`,
`grok-build`, `omp`. Visit all 18 detail URLs in both themes, including unsupported
manual guide for amp. MITM index IDs `antigravity`, `copilot`, `kiro` are not valid
CLI detail IDs: assert current 404 guard rather than activate unreachable copilot
renderer. Index cards and MITM route still need their own coverage.

Provider detail fixtures cover registry precedence: providerNode, OAuth, API-key,
free, free-tier, web-cookie. Include OpenAI-compatible and Anthropic-compatible
stored node families; no-auth-only; mimocode stored no-auth; OAuth+apikey dual
choice; import-token; kiro wrapper/social; cursor; gitlab/gitlab-duo; generic OAuth;
iflow cookie; codex and grok-cli bulk import; antigravity first-use confirmation;
unknown provider visible message (not assumed 404). Exact concrete IDs selected
from current registry with a manifest assertion for each branch. Every available
provider list card renders, but real external credential exchanges are forbidden
in deterministic QA.

Timeline detail seed returns persisted trace ID. Response must contain `trace`
object and `events`; include adjacent and non-adjacent `sse_chunk` groups, string
and JSON payloads, sort order, 404 and non-404 errors. List link and direct URL must
resolve same record.

### Supplemental screen/state ownership

- Root layout: fonts, theme startup, body canvas, hydration, metadata and document
  language. Dashboard layout: nav, main landmark, padding, toast rail, mobile menu,
  collapsed rail, long menus and persistent header. Pricing lies outside dashboard
  route group; verify direct entry and auth, do not assume shell wrapping.
- Exact existing boundaries: `src/app/(dashboard)/dashboard/combos/error.js`,
  `src/app/(dashboard)/dashboard/mcp-gateway/error.js`,
  `src/app/(dashboard)/dashboard/mitm/error.js`,
  `src/app/(dashboard)/dashboard/providers/[id]/error.js`. Owning route lane ports
  boundary and proves reset/retry with local controlled error. Also unknown route
  404 and unauthenticated/expired-session redirects.
- Login renders initial loading, status timeout/failure, no-password warning,
  default-password warning, password/OIDC/both/unconfigured modes, server error,
  429 countdown, forced password change proof/no-proof, reauthenticate and safe
  `next`. Preserve real auth policy; never weaken guard for screenshots. Current
  login does not render `?error`; if broader task requires repairing invisible
  OIDC error, isolate reproduction and fix rather than invent a current behavior.
- `/callback` is visual relay, NOT `/api/auth/oidc/callback`. Isolated browser
  contexts only: manual URL, synthetic error description, synthetic success code
  and token, opener present/absent, permitted/blocked window.close with Done state,
  Suspense loading. Validate postMessage exact origin, BroadcastChannel/storage
  event behavior using synthetic values; never exchange a real token or use live
  provider callback. Missing automation for a branch is an unverified row.
- `/landing`: nav anchors/mobile menu/logo, all CTAs/footer links, clipboard,
  responsive hero and animated provider flow. Source audit found inert hero
  Get Started CTA; add reproduction-backed fix, same intended `/dashboard`
  destination as other CTAs. Respect reduced-motion and pause requirements.
- Every nested modal/tab/drawer, first-use wizard, API-key reveal, import/export,
  empty/loading/error/disabled/busy/long-content surface belongs to its route or
  explicit shared lane. Monaco/diff editors and drag graphs need keyboard and
  accessible equivalent information. OAuth external-host UI excluded from visual
  ownership, but local entry/error/cancel/retry/return states are not excluded.

## Playwright proof contract

### Isolation and secrets

Use pinned Node/npm and isolated QA app, never root/recovery/production tree.
Unique disposable `HOME` and `DATA_DIR` per backend-writing worker; isolated local
fake upstream server and controlled OS-action boundary. `JWT_SECRET` and
`INITIAL_PASSWORD` fixture values generated per run, same-origin login form,
`AUTH_COOKIE_SECURE` unset/false for loopback HTTP. No `.env` or DB copied from
production. No auth bypass endpoints added to app. Runtime must assert its real
paths are beneath QA directory before seeding/mutating. Host cert/proxy/service
commands must be fenced from production; if not safely simulatable, block that
mutation proof rather than execute it on workstation.

**Enforced egress boundary, before any seed or browser action:** run QA app and
local fake upstream inside isolated container/network namespace with no external
route. Use an internal-only network and explicit allowlist for the QA app, local
fake upstream and required local test DNS. Host gateway, LAN/private production
addresses, metadata endpoints and public Internet remain denied. No host socket,
Docker socket, systemd bus, production mounts or elevated capabilities exposed.
Download build dependencies/browser binaries beforehand in separate provisioning
step, then start offline QA runtime with isolated mounts and ephemeral state.

Clear upper/lowercase inherited proxy env and set deliberate local routing, but
`NO_PROXY` and other env variables are NOT security enforcement. Even if app
reconfigures its proxy-aware fetch, network boundary must deny egress. Browser
`context.route()` separately permits only explicit QA origins and blocks service
workers; it cannot contain server-side Next/open-sse requests. Record browser
blocked/allowed destinations and server firewall/network-proxy destination logs.
`qa.assertNoExternalEffects()` consumes both records and fails on any unexpected
attempt/success. Negative control, using credential-free synthetic requests,
must prove forbidden browser AND server targets unreachable while fake upstream
works. No trustworthy server deny log/negative control means G0 blocked.
Seed zero enabled proxy pools by default. Proxy-pool scenarios may enable only
explicit local fake-proxy addresses inside isolated QA network; app can repopulate
proxy env from stored config, so network containment remains mandatory regardless
of launch env or fixture state.

The password supplied in this session remains runtime-only. For optional,
authorized live read-only checks, the orchestrator injects it into
`DURINDOOR_TEST_PASSWORD` for the dedicated login child without echoing it, then
removes it from parent/spawn env maps. Never derive it from systemd configuration
or place its literal value in plans, scripts, logs, screenshots, traces, Git or
fixtures. Reuse private ephemeral `storageState`; do not repeatedly test wrong
passwords against the live limiter. Login may update auth bookkeeping. Screens can
contain keys, tokens, logs and private prompts: capture with disposable synthetic
records, not production data. Live checks limited to explicit non-mutating views;
button actions such as Test All can spend quota or alter state even without POST.

Playwright auth state kept in ignored restricted artifact directory; tracing and
request body capture off during authentication/reveal/provider-secret entry.
Sanitize URLs/headers/artifacts before publication. Local-only artifacts private;
never upload secret-bearing traces. Callback relay effects only isolated origin
and context, synthetic fixture values. No production OAuth/start callback, key
rotation, connection deletion, service restart or real provider roundtrip without
separate authorization.

The service unit's credential-like `INITIAL_PASSWORD` setting is a separate
sensitive configuration finding. Do not quote, reuse or rotate it in this UI
campaign. Maintainer should assess whether it remains active and remove/rotate
it through separately authorized operational work; do not alter service config.

Two complementary proof modes:

1. Deterministic screen matrix: real running app with seeded disposable data;
   narrowly controlled browser response delays/errors for loading/empty/error and
   fake local upstream SSE/media. Record intercepted cases explicitly. No broad
   `**/api/**` happy-response mocks that hide auth/backend faults.
2. Real-backend workflows: actual UI requests to disposable app APIs and DB,
   followed by reload and persisted outcome assertion. External vendor/service
   boundary fake only. CRUD, settings, pagination, auth and stream adapter contract
   must not be proved solely by route.fulfill echoes. Separate optional authorized
   live read-only deployed check from candidate proof.

### Matrix and evidence

For EVERY visual route/concrete dynamic variant:

- Chromium both themes at **1440×1000, 1280×800, 768×1024, 390×844, 320×800**.
  Also 844×390 landscape for overlay/composer/menu-heavy pages. 35 non-redirect
  template default states already require at least 350 captures before dynamic
  variants and non-default states; number is floor, not passing coverage count.
- All meaningful loading, zero-data, populated, error/retry, busy/disabled,
  empty search, long/unbroken text, large dataset, first/last/all pages,
  open overlay, validation, success and destructive cancellation states in both
  themes at desktop and 390px. Every conditional visible control exercised.
- Firefox and WebKit: every visual route/concrete variant default in both themes;
  complete auth, shell, forms, overlays, clipboard fallback and streaming workflows.
  Missing installed browser is blocker for its rows, not emulated Chromium pass.
- Keyboard-only Tab/Shift+Tab, Enter/Space, arrows/Home/End/typeahead for choices,
  Esc topmost-only, focus trap/restore, skip-to-main, nav landmarks and logical
  tab sequence. Touch/coarse pointer target boxes and pointer activation prove
  same action. Browser `boundingBox` alone insufficient if targets overlap;
  hit-test corners/centers with `elementFromPoint` and actual pointer actions.
- 200% text resize, 400% zoom/reflow equivalent 320 CSS px plus actual zoom where
  supported, WCAG text-spacing overrides, reduced motion, forced colors, long
  localized labels and current app language behavior. Every visual route also
  receives ar/he/fa/ur RTL captures at 1440×1000 and 390×844 in both themes, with
  shell, menus, forms, tables/charts and overlays exercised. Assert document lang/dir
  after initial load and language changes, logical layout, mixed-direction IDs,
  URLs/code and numeric values without corrupting copied strings. No clipped content/action,
  hidden horizontal page overflow or controls behind sticky headers. True
  two-dimensional tables/charts may use named keyboard-scroll regions with all
  information accessible; not whole page overflow.

Use Playwright `getByRole`/`getByLabel`, retrying expect, and locator-based stable
readiness. Wait for loaded fonts, assets, expected data and transition completion.
Do not use global networkidle for polling/SSE or fixed sleeps to hide races.
Collect pageerror, unhandled rejection, console errors, failed assets and unexpected
API responses. Expected injected errors are scoped to named scenario; no global
console suppression. Take full-page AND relevant viewport/overlay screenshots,
with stable fixture clock where necessary and approved dynamic masks only.

Output per case: candidate SHA, template+concrete URL, theme, browser/version,
viewport, state/action, fixture ID, screenshot, accessible tree/axe JSON,
contrast/target/focus results, workflow assertion, expected network outcomes,
reviewer score and precise defects. Trace retained only for sanitized failing
fixture sessions. Report tested count/expected count; any unexplained skip or
missing artifact fails gate. Snapshot update is never automatic acceptance.
Designer reads captures at their actual size against reference layout and then
reviews interactive path; screenshot similarity score alone cannot approve.

### Executable checks (existing versus proposed)

Existing orchestrator commands, at candidate worktree with correct pins:

```bash
npm ci --no-audit --no-fund
npm --prefix tests ci --no-audit --no-fund
npm run lint
npm run storybook:build
npm run build
npm run check:docs
npm --prefix tests run test:ci
```

Use project Vitest config for focused files (`tests/vitest.config.js`); execute from
an independent gate tree outside `.omc` if Vite's exclusion hides files. Example
from gate repo root, after planned unit files exist:

```bash
npm --prefix tests ci --no-audit --no-fund
tests/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/durin-ds-select.test.js tests/unit/durin-ds-overlays.test.js
```

Vitest defaults to Node environment. DOM-behavior unit files MUST begin with
`// @vitest-environment happy-dom`, matching existing repo tests and installed
tests dependency. Pure color arithmetic may remain Node. Happy-dom cannot prove
layout/target pixel sizes; Playwright remains authoritative for those assertions.

No source-text/source-import-wiring tests added. Real regressions exercise DOM
behavior/consumer outcome. Unit new test must fail under plausible bug mutation;
keep no false green. One small focused test file per uncertain component family,
not a test for every presentation line. Existing broken tests changed only when
observable contract changes, known-fails list never grows.

Proposed H1 commands — **not available at plan creation**:

```bash
npx playwright install chromium firefox webkit
npm run test:ui -- --project=chromium-dark-desktop
npm run test:ui
```

`test:ui` must resolve to `playwright test --config playwright.config.mjs` with
real routes/state/accessibility/flows specs and seed fixture lifecycle. Install
browser OS dependencies via approved container/toolchain, not unexplained sudo.
Processes managed through harness `hub start` with readiness URL/port; dedicated
port not occupied by production/default dev runtime. For agent verification start
`node scripts/next-owner-server.cjs --dev --port <allocated-port>` in QA worktree;
release candidate uses shipped standalone runtime and actual production build.
Readiness is successful login page + expected runtime health, not process spawn.
Stop owned processes after proof, preserve evidence.

No configured LSP: report diagnostics unavailable; do not add unrelated TS migration
to make `bun check` exist. If LSP later available, use references before exported
API edits and diagnostics on changed files. Otherwise inspect exact imports/callers
and prove with build + behavior. Full test:ci serial, fresh disposable DATA_DIR,
no shared native/cache symlinks and no runtime production state. A failed gate
must be attributed and fixed or concretely blocked, not waived as old noise.

Before approved push and merge, separately validate conventional commit range and
PR title using repo commitlint config; confirm tool installed, no implicit latest
npx download under wrong Node. CI green on final SHA; no baseline edits or orphan
scripts as substitute for gates.

## AAA product-quality acceptance (all clauses, no averages hiding defects)

AAA here means premium usable product **and** explicit applicable WCAG 2.2 AAA
assessment. It is not a claim that axe or screenshots certify accessibility.
Create criterion ledger for every A/AA/AAA criterion and complete supported user
process; PASS or N/A with evidence and reviewer reason, never unexamined omission.
Third-party essential interactions and generated media must be assessed as part of
process scope; external uncertainty stays blocked, not blanket conformance.

| Axis | Required pass |
| --- | --- |
| Visual hierarchy | Single clear page identity/action hierarchy; consistent Durin warm surfaces/emerald-gold roles, typography, spacing, brand assets; no mixed legacy chrome |
| Text contrast | Unrounded served computed foreground/composited background ≥7:1 normal text, ≥4.5:1 large text (24px regular or 18.67px bold); placeholders/tooltips and status text included; documented normative inactive/logo exceptions only |
| Non-text/focus | Essential controls/graphics ≥3:1 where required; focus indicator area at least 2 CSS px perimeter and ≥3:1 focused/unfocused pixels; focus not obscured, forced-color usable |
| Targets | Custom targets ≥44×44 CSS px except documented actual normative exceptions; not just mobile, no overlapping padded hitboxes |
| Input and navigation | Full keyboard, no trap outside intended modal; input labels/errors/help; predictable navigation; preserved passwords/paste/password-manager/autocomplete support |
| Content/accessibility | Logical landmarks/headings, name/role/value, meaningful alt and status announcements, table/chart equivalent data, reader/zoom/text-spacing support, reading/help requirements and complete AAA criterion ledger |
| Motion/time | Reduced motion, pause/control auto-updating content, timeout/reauth continuity, no flashing or involuntary context change; live streams and expiry preserve recoverable user input |
| Task usability | Every stated user workflow completes or shows actionable truthful error; confirmation and cancellation protect destructive actions; no dead CTAs, no silent save failures |
| Responsive behavior | Matrix passes; no cropped text/actions, overlap, unintended horizontal page scrolling, jumpy loading or inaccessible editor/graph |
| Stability/performance | No unexpected runtime/asset/hydration/network errors. On fixed local fixture Chromium p75 cold LCP ≤2.5s and CLS ≤0.1; representative click/key-to-paint ≤200ms measured separately from upstream latency. Three repeated runs; no claim these lab measures certify field Core Web Vitals |
| Independent review | Designer scores hierarchy, consistency, readability, responsiveness, interaction feedback and task clarity 0–5; each ≥4, none critical/major, no unresolved defects. Technical reviewer verifies preserved behavior and evidence scope |

Normative references: [WCAG 2.2](https://www.w3.org/TR/WCAG22/),
[enhanced contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html),
[enhanced target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html),
[focus appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html).
Automation references: [Playwright authentication](https://playwright.dev/docs/auth),
[retrying assertions](https://playwright.dev/docs/test-assertions).

Manual screen-reader/assistive-technology evaluation is separately recorded; ARIA
snapshot not substitute for speech/browse-mode use. Use available real AT tools;
if unavailable, request precise human check and leave conformance blocked. Do not
announce AAA while required manual evidence or any route/variant remains missing.
User visual approval supplements objective gates; cannot waive accessibility
failure and still retain unqualified AAA label.

## Complete DS and shared inventories

All components/story variants get foundation proof; all mock pages get runtime
iframe proof in both palettes after shared changes. Build success does not catch
post-build React errors. Keep classic JSX runtime behavior sound; no speculative
`globalThis.React` shims. Repair actual source/config contract if runtime breaks.

### DS primitive modules

| Component | Source | Story |
| --- | --- | --- |
| Badge | `src/shared/ui/components/Badge.jsx` | `src/shared/ui/components/Badge.stories.jsx` |
| Button | `src/shared/ui/components/Button.jsx` | `src/shared/ui/components/Button.stories.jsx` |
| Card | `src/shared/ui/components/Card.jsx` | `src/shared/ui/components/Card.stories.jsx` |
| Checkbox | `src/shared/ui/components/Checkbox.jsx` | `src/shared/ui/components/Checkbox.stories.jsx` |
| Chip | `src/shared/ui/components/Chip.jsx` | `src/shared/ui/components/Chip.stories.jsx` |
| ConfirmDialog | `src/shared/ui/components/ConfirmDialog.jsx` | `src/shared/ui/components/ConfirmDialog.stories.jsx` |
| DataTable | `src/shared/ui/components/DataTable.jsx` | `src/shared/ui/components/DataTable.stories.jsx` |
| Drawer | `src/shared/ui/components/Drawer.jsx` | `src/shared/ui/components/Drawer.stories.jsx` |
| EmptyState | `src/shared/ui/components/EmptyState.jsx` | `src/shared/ui/components/EmptyState.stories.jsx` |
| Field | `src/shared/ui/components/Field.jsx` | `src/shared/ui/components/Field.stories.jsx` |
| IconButton | `src/shared/ui/components/IconButton.jsx` | `src/shared/ui/components/IconButton.stories.jsx` |
| Input | `src/shared/ui/components/Input.jsx` | `src/shared/ui/components/Input.stories.jsx` |
| KeyValue | `src/shared/ui/components/KeyValue.jsx` | `src/shared/ui/components/KeyValue.stories.jsx` |
| Modal | `src/shared/ui/components/Modal.jsx` | `src/shared/ui/components/Modal.stories.jsx` |
| PageHeader | `src/shared/ui/components/PageHeader.jsx` | `src/shared/ui/components/PageHeader.stories.jsx` |
| Pagination | `src/shared/ui/components/Pagination.jsx` | `src/shared/ui/components/Pagination.stories.jsx` |
| PromptDialog | `src/shared/ui/components/PromptDialog.jsx` | `src/shared/ui/components/PromptDialog.stories.jsx` |
| ProviderLogo | `src/shared/ui/components/ProviderLogo.jsx` | `src/shared/ui/components/ProviderLogo.stories.jsx` |
| RangeSelector | `src/shared/ui/components/RangeSelector.jsx` | `src/shared/ui/components/RangeSelector.stories.jsx` |
| SegmentedControl | `src/shared/ui/components/SegmentedControl.jsx` | `src/shared/ui/components/SegmentedControl.stories.jsx` |
| Select | `src/shared/ui/components/Select.jsx` | `src/shared/ui/components/Select.stories.jsx` |
| StatCard | `src/shared/ui/components/StatCard.jsx` | `src/shared/ui/components/StatCard.stories.jsx` |
| StatusDot | `src/shared/ui/components/StatusDot.jsx` | `src/shared/ui/components/StatusDot.stories.jsx` |
| Tabs | `src/shared/ui/components/Tabs.jsx` | `src/shared/ui/components/Tabs.stories.jsx` |
| Textarea | `src/shared/ui/components/Textarea.jsx` | `src/shared/ui/components/Textarea.stories.jsx` |
| Toggle | `src/shared/ui/components/Toggle.jsx` | `src/shared/ui/components/Toggle.stories.jsx` |
| Tooltip | `src/shared/ui/components/Tooltip.jsx` | `src/shared/ui/components/Tooltip.stories.jsx` |

### Page mock sources (21)

| Mock | Story |
| --- | --- |
| `src/shared/ui/pages/api-docs/ApiDocsPage.jsx` | `src/shared/ui/pages/api-docs/ApiDocsPage.stories.jsx` |
| `src/shared/ui/pages/cli-tools/CliToolsPage.jsx` | `src/shared/ui/pages/cli-tools/CliToolsPage.stories.jsx` |
| `src/shared/ui/pages/combos/CombosPage.jsx` | `src/shared/ui/pages/combos/CombosPage.stories.jsx` |
| `src/shared/ui/pages/console-log/ConsoleLogPage.jsx` | `src/shared/ui/pages/console-log/ConsoleLogPage.stories.jsx` |
| `src/shared/ui/pages/endpoint/EndpointPage.jsx` | `src/shared/ui/pages/endpoint/EndpointPage.stories.jsx` |
| `src/shared/ui/pages/headroom/HeadroomPage.jsx` | `src/shared/ui/pages/headroom/HeadroomPage.stories.jsx` |
| `src/shared/ui/pages/health/HealthPage.jsx` | `src/shared/ui/pages/health/HealthPage.stories.jsx` |
| `src/shared/ui/pages/mcp-gateway/McpGatewayPage.jsx` | `src/shared/ui/pages/mcp-gateway/McpGatewayPage.stories.jsx` |
| `src/shared/ui/pages/mcp-help/McpHelpPage.jsx` | `src/shared/ui/pages/mcp-help/McpHelpPage.stories.jsx` |
| `src/shared/ui/pages/media-providers/MediaProvidersPage.jsx` | `src/shared/ui/pages/media-providers/MediaProvidersPage.stories.jsx` |
| `src/shared/ui/pages/playground/PlaygroundPage.jsx` | `src/shared/ui/pages/playground/PlaygroundPage.stories.jsx` |
| `src/shared/ui/pages/providers/ProvidersPage.jsx` | `src/shared/ui/pages/providers/ProvidersPage.stories.jsx` |
| `src/shared/ui/pages/proxy-pools/ProxyPoolsPage.jsx` | `src/shared/ui/pages/proxy-pools/ProxyPoolsPage.stories.jsx` |
| `src/shared/ui/pages/quota/QuotaPage.jsx` | `src/shared/ui/pages/quota/QuotaPage.stories.jsx` |
| `src/shared/ui/pages/settings/SettingsPage.jsx` | `src/shared/ui/pages/settings/SettingsPage.stories.jsx` |
| `src/shared/ui/pages/skills/SkillsPage.jsx` | `src/shared/ui/pages/skills/SkillsPage.stories.jsx` |
| `src/shared/ui/pages/test-savers/TestSaversPage.jsx` | `src/shared/ui/pages/test-savers/TestSaversPage.stories.jsx` |
| `src/shared/ui/pages/timeline/TimelinePage.jsx` | `src/shared/ui/pages/timeline/TimelinePage.stories.jsx` |
| `src/shared/ui/pages/token-saver-settings/SettingsPage.jsx` | `src/shared/ui/pages/token-saver-settings/SettingsPage.stories.jsx` |
| `src/shared/ui/pages/token-saver/TokenSaverStatsPage.jsx` | `src/shared/ui/pages/token-saver/TokenSaverStatsPage.stories.jsx` |
| `src/shared/ui/pages/usage/UsagePage.jsx` | `src/shared/ui/pages/usage/UsagePage.stories.jsx` |

Shell references: `src/shared/ui/shell/DashboardShell.jsx`, `Header.jsx`,
`Sidebar.jsx`, `withDashboardShell.jsx`, `index.js`, and `Shell.stories.jsx` under
that directory. Foundation: `src/shared/ui/foundation/Palette.stories.jsx`.
Storybook configuration: `.storybook/main.js`, `.storybook/preview.jsx`,
`.storybook/preview.css`, `.storybook/preview-head.html`. No page story may bypass
production acceptance with mock-only success. `withDashboardShell` accepts
`activePath/actions`; title/icon/subtitle are PageHeader in page body, not inferred
from ignored decorator arguments.

## Dispatch packet (required for each writer)

Copy this contract, fill actual paths/IDs; never dispatch unfinished placeholder
packet. Main controls mapping and API contracts, not worker inventing scope.

```text
# Target
Exact candidate worktree/base SHA; <=5 explicit paths; route IDs/concrete variants;
read-only references and exclusions; name sole shared-file owner.
Before any edit, run pwd and git rev-parse --show-toplevel with explicit cwd;
both must equal assigned worktree. Report identity first. All edit paths must
be absolute under that worktree. Primary checkout is never reference-to-write target.
# Change
Keep listed endpoints/state/polling/storage/error/i18n contracts; adopt actual DS
exports and props; spell out screenshot reference, all conditional UI branches,
loading/empty/error/busy/keyboard/mobile behaviors and edge cases.
# Acceptance
Observable actions/results and exact screenshot/behavior cases from route ledger.
Each page PR owns tests/e2e/routes/<cluster-slug>.spec.js; behavior changes also
own tests/unit/<cluster-slug>.test.js. Inline docs stay in owned source. Shared
manifest/index/changelog aggregation is integration-owner-only.
Keep one small behavior regression file for genuine changed contract; no mock
echo/source-text assertions. Update smallest fitting inline docs. No stub UI.
DOM-behavior unit files begin // @vitest-environment happy-dom (repo defaults node).
Pixel/layout/hit-testing proof belongs to orchestrator Playwright, not happy-dom.
Skip ALL tests, builds, linters, validation and formatters. No commit/push/PR.
Return full diff, changed paths, preserved contracts, unresolved evidence/questions.
Send via hub before final yield if agent-result schema fails.
```

Acceptance ledger counts complete only when evidence verified by orchestrator.
During planning all future route/foundation gates remain unexecuted. At execution
capture every unresolved item as a concrete task; never rename remaining work a
follow-up or call a phase boundary project completion.

## Final done checklist

- [ ] Every currently routable page template equals manifest; all dynamic branch
      predicates expanded; 35 visual + 2 redirect base rows fully accounted.
- [ ] Every shared primitive/domain widget, shell, public/auth state, existing
      error boundary and missing-route response has current-SHA evidence.
- [ ] Every production UI symbol and meaningful state maps to working Storybook
      coverage; all built story IDs render and interactions pass on final SHA,
      alongside separate actual-app evidence. No missing widget or mock-only pass.
- [ ] All required Playwright matrix/workflows, real-backend fixture proof,
      component unit regressions, served contrast/focus/target and complete
      applicable WCAG ledger green. No unexplained skips, masks or exceptions.
- [ ] Independent design and technical review passed; human reviewed full diff;
      no unresolved blockers or minor defects disguised by aggregate score.
- [ ] Exact final candidate passes lint, docs, Storybook runtime+build, app build,
      focused tests and full test:ci, commitlint where applicable. No baseline growth.
- [ ] Post-smoke obsolete code removed only with zero-consumer proof; protected
      worktrees/WIP/stash untouched; globals.css unchanged.
- [ ] Proposed migration doc corrections and route statuses reflect actual merged
      and verified state; deployment claims only when separately authorized and
      deployed SHA verified. Never equate plan completion with AAA product.
