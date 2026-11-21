# V5 production integration plan (#1300)

This plan moves the V5 interface from the Storybook review into the production dashboard. Later units each implement one slice from [section 5](#5-implementation-slices). It does not add a visual specification. The V5 review defines the target. Production source defines behavior.

- Tracker: #1300. Parent epic: #1066. Release gate: #1067. Roadmap: #1056.
- Integration owner: repository owner (`bloodf`).
- Every slice PR body says `Refs #1300`. Final verification on the V5 release candidate belongs to #1067.
- Related record: [V5 interface integration (#1300)](./v5-interface-integration-1300.md) holds the Storybook inventory counts and inventory commands. This plan does not repeat them.

Baseline for this plan: `main` at `0f513f755` (2026-11-21).

## 1. Acceptance status

| # | #1300 criterion | Satisfied by | Left |
|---|---|---|---|
| A1 | Link the existing UI branch/PR and confirm its owner | [PR #1313](https://github.com/bloodf/durindoor/pull/1313) merged 2026-11-03 at `816f871fa8e446d548fc6ac48d9b243f17c37bd9` from `codex/v5-admin-storybook`. The owner is `bloodf`, recorded here. | Post the owner and this plan's link as a #1300 comment when this doc merges. |
| A2 | Reconcile the agreed V5 scope with #1066 and product/design docs | [PR #2049](https://github.com/bloodf/durindoor/pull/2049) reconciled the story inventory with current sources. [Section 2](#2-reconciled-scope) of this doc reconciles surfaces. | Owner acknowledgement of section 2 on #1300. 332 source rows and 1,273 reference stories in `tests/e2e/storybook-surfaces.json` still need review (see the related record). |
| A3 | Preserve provider, key/account authorization, routing, accounting and data-management behavior | [PR #2043](https://github.com/bloodf/durindoor/pull/2043) extracted `ProviderRpmControl.jsx` so the review and production share one control, covered by `tests/unit/1300-v5-ui.test.js`. #1313 kept production request handling and API contracts. | Every slice adds a parity test: the same user action issues the same `fetch` method, URL and body with V5 on and off. No slice may change `src/app/api/**`, `src/lib/**` or `open-sse/**`. |
| A4 | Record UI review plus interaction, loading/empty/error, responsive and accessibility checks for the changed surfaces | #1313 and the [V5 design audit](./audits/v5-design-2026-10-29/README.md) cover the Storybook build only: 854/854 story lifecycles, 328/328 Chromium axe/interaction cases, and 164 rendered snapshots. | No production surface has V5 evidence yet. Each slice adds the jsdom assertions in [section 4](#4-surface-table). Browser/axe evidence for production routes is collected at #1067. |
| A5 | Integrate through independently reviewed PRs with exact-head checks | #2043 and #2049 followed the contributor contract. | Each slice: independent review, `npm run lint`, focused tests, `cd tests && npm run test:ci`. Run `npm run storybook:build` when `src/shared/ui/v5/**` or `.storybook/**` changes. Run the website build when the website demo's inputs change. |
| A6 | Verify the integrated UI against the final V5 candidate before #1067 is accepted | Not started. | S20 flips the default. #1067 then runs the browser matrix (`tests/unit/v5-storybook.browser.test.js` and equivalent production-route checks) on the candidate head. |

## 2. Reconciled scope

#1066 lists #1300 as the V5 interface gate. Its other children (#1137 to #1142) are separate features. They adopt V5 only through the shared primitives and shell delivered here. #1300 states that the ticket "does not introduce new visual specification". The V5 review is therefore the ceiling on visual change.

`PRODUCT.md` requires a truthful dashboard kept separate from marketing, and a website demo that reuses production dashboard components. Root `DESIGN.md` covers the public identity. [The dashboard design system](./design-system.mdx) defines `--dd-*` tokens, a 44px control height, `focus-visible` rings and the "no card in a card" rule. `src/shared/ui/v5/DESIGN.md` names `review.css` as the V5 token source.

**Token source correction.** The V5 review does not use `v5.css`. That file belongs to the rejected prototype. The V5 tokens are the `html[data-v5-review="true"]` blocks at the top of `src/shared/ui/v5/review.css`. They override `--dd-*` values only and add no new token names. Existing `*-dd-*` utilities therefore pick them up unchanged.

### In scope

| V5 element | Review source | Production target |
|---|---|---|
| Forest-neutral light/dark tokens, focus and selection | `review.css` token blocks | New `src/shared/ui/v5/production/v5-tokens.css` |
| Motion buttons and leading action icons | `motion/ReviewButton.jsx`, `AnimateButton.jsx`, `ReviewNativeButton.jsx` | `src/shared/ui/components/Button.jsx`, plus per-surface native buttons |
| Animated SVG glyphs and navigation icons with reduced motion | `motion/MotionIcon.jsx`, `ReviewGlyph.jsx`, `animatedIconCatalog.js` | Sidebar icons; each surface's Material glyph spans |
| Icon-only help tooltip | `motion/ReviewIconHelp.jsx`, `iconHelp.js` | `src/shared/ui/components/Tooltip.jsx` |
| Themed single select with native form semantics | `NativeSelect.jsx` | Each surface's `<select>` |
| Shell: navigation icons, Token Saver "Dashboard" label | `review-navigation.js` (icon map and label only) | `Sidebar.js`, `SidebarNavIcons.js`, `Header.js` |
| Login doorway with WebGL scene, pause and CSS fallback | `login/ReviewLoginView.jsx`, `GateScene.jsx`, `gate-scene.js`, `login.css` | `src/app/login/LoginView.js` |
| Provider model auto-sync card | `providers/ReviewAutoSyncCard.jsx` | `providers/[id]/ModelAutoSyncPanel.js` and its placement |
| Combo inventory, form and model picker | `combos/*` | `combos/page.js`, `ComboFormModal.js`, `ModelSelectModal.js` |
| Usage widget layout with draft/save/cancel, keyboard ordering and a keyboard-reachable limits table | `usage/*` | `usage/page.js`, `usage/components/*` |
| Token Saver monitoring dashboard with nine widgets | `dashboards/TokenSaverDashboard.jsx`, `SaverWidgets.jsx`, `PxpipeWidgets.jsx`, `DashboardCanvas.jsx`, `MonitoringWidget.jsx` | `token-saver/TokenSaverClient.jsx` (monitoring view only) |
| Per-route state repairs (pending, rejected, retry, retained data) | Source stories under `src/app/**` | Already in production source. #1313 landed them in shared code. Slices verify them. |

### Out of scope

| Excluded | Reason |
|---|---|
| Archive "Rejected v5 prototype": `AdminReview.jsx`, `Dashboard.jsx`, `DataTable.jsx`, `Forms.jsx`, `PageContents.jsx`, `catalog.js`, `components.jsx`, `model.js`, `v5.css` and the `Foundation`/`Forms`/`Interactions` stories | The README and V5 `DESIGN.md` exclude it from acceptance. |
| `/dashboard/workspaces` ("My dashboards"), `WorkspacesPage.jsx`, and the "My dashboards" sidebar entry | This is a new route with new persisted data that has no server API. It is a new feature, not integration of an existing surface. #1300 forbids new specification. It is deferred to a separate proposal under #1066. |
| Review-only chrome: `ReviewFrame.jsx`, review bar, `review-parameters.js`, `surfaceForRoute`, fixtures and `.storybook/network.js` | Storybook harness |
| `website/` marketing pages and `/landing` | Excluded by the audit. Only the website dashboard demo follows the flag (S20). |
| Any change to `src/app/api/**`, `src/lib/**`, `open-sse/**`, settings schema or authorization allow-lists | A3. The opt-in switch is an environment variable so that no settings or authorization surface changes. |
| Browser-only visual acceptance in unit tests | Unit tests run in a DOM emulator. Pixel, axe and multi-engine evidence belongs to #1067. |

## 3. Mechanism

Production adopts V5 **in place**. The `.storybook/main.js` plugin `v5-review-control-boundary` currently injects every V5 change at build time, gated on `document.documentElement.dataset.v5Review === "true"`. Each slice moves one of those injections into real source behind one shared switch. Storybook then renders that production source directly. Repository code keeps one component per surface. Where a V5 component replaces an incumbent (login, combos, model picker, auto-sync, Token Saver, Usage layout), the incumbent stays only as the flag-off branch of the same export and is deleted in S21.

### Switch

- **Name.** Environment variable `DURINDOOR_UI_V5`. `1`, `true` and `on` mean on. `0`, `false` and `off` mean off. Anything else uses the default.
- **Default.** Off from S01 through S19, so `main` stays releasable and unchanged for operators between slices. S20 changes the default to on for the V5 release candidate, and `DURINDOOR_UI_V5=0` stays as the opt-out. S21 removes the switch after #1067 accepts the release.
- **Why an environment variable rather than a setting.** A setting would add a key to `settingsRepo.js` and to the `settingsPatchAuth.js` allow-list, which touches data management and authorization (A3). The root layout is already dynamic because it calls `cookies()`, so it reads `process.env` at request time without a rebuild.
- **Resolution.** `src/shared/ui/v5/production/uiVersion.js` exports `isUiV5Enabled(env = process.env)` and `UI_V5_ATTRIBUTE = "data-ui"`. It also exports a client hook, `useUiV5()`, that reads `document.documentElement.dataset.ui === "v5"` and returns `false` during SSR. `src/app/layout.js` renders `<html data-ui="v5">` when the switch is on. Server components that need the value call `isUiV5Enabled()` directly.
- **Tokens.** S01 moves the two token blocks from `review.css` into `v5-tokens.css`. The selectors are `html[data-ui="v5"], html[data-v5-review="true"]` and the dark equivalents, so the token values have one source. The root layout and `.storybook/preview.jsx` import the file.
- **Storybook boundary retirement.** S01 changes the plugin so that it skips any file that already imports `@/shared/ui/v5/production/uiVersion`. A migrated file therefore never gets a duplicate transform, and the plugin's "signature changed" error cannot fire. Slices do not edit `.storybook/main.js`. S21 deletes the plugin. The Storybook review frame sets both `data-v5-review="true"` and `data-ui="v5"`, so migrated sources render V5 in the review.
- **Storage keys.** Production never reads `durindoor:v5-review:*` keys. Usage layout uses `durindoor:usage-layout:v1` and Token Saver uses `durindoor:token-saver-layout:v1`. Storage failure keeps the current view, as the review contract requires.
- **Forked review copies.** `usage/ReviewUsageStats.jsx`, `ReviewUsageChart.jsx`, `ReviewApiKeyLimitsCard.jsx` and `combos/Review*` are copies taken at #1313. Production has changed since then, for example with #2147 session capture and #2141 readiness diagnostics. Slices port the V5 *presentation* onto the current production component. They never swap a review copy in. The current production fetches and payloads are authoritative.

The production shell keeps the existing navigation structure when V5 is off. With V5 on, navigation uses animated icons and calls the Token Saver overview Dashboard; the existing drawer and language workflows remain in place.

## 4. Surface table

How to read the table:

- **V5 source** is the review file that defines the target. "Tokens + primitives" means the surface gets V5 only through `v5-tokens.css`, S02 primitives, `V5NativeSelect` and `ReviewGlyph` in its own files.
- **States** are the named review scenarios from `review-manifest.js` that the slice must reproduce.
- **Common checks for every row:**
  - Keyboard: every action is reachable by Tab, has a visible `focus-visible` ring, Escape closes dialogs, and focus returns to the opener.
  - Accessibility: icon-only controls have accessible names, decorative glyphs are `aria-hidden`, status changes use `role="status"` or `role="alert"`, and pending controls set `aria-busy` or `disabled`.
  - Responsive: wide tables sit in a focusable local scroll region (`tabIndex=0`, `role="region"`, `aria-label`) and nothing forces document overflow at 390px. Unit tests assert the class or attribute; pixel overflow is #1067 evidence.
  - Motion: under `prefers-reduced-motion: reduce`, animated icons render statically.
- **Testing.** "jsdom-testable" means DOM-emulated unit tests under `tests/unit/`, written like `tests/unit/1300-v5-ui.test.js`: `// @vitest-environment happy-dom`, `createRoot`, `act`, and a mocked `fetch`. No browser.
- **Parity.** Every row also needs the A3 parity assertion: the primary write action issues an identical `fetch` (method, URL, body) with `data-ui="v5"` set and unset.

| Route / entry | Production source | V5 source | Required states | Specific keyboard / a11y / responsive checks | jsdom assertions | Slice |
|---|---|---|---|---|---|---|
| Shell (all dashboard routes) | `shared/components/layouts/DashboardLayout.js`, `Sidebar.js`, `SidebarNavIcons.js`, `Header.js`, `HeaderLanguage.js`, `LanguageSwitcher.js` | `review-navigation.js` (icons, label), `motion/MotionIcon.jsx` | n/a | Nav drawer traps focus on mobile and closes on Escape. The active item has `aria-current="page"`. Locale flag marks are `aria-hidden`. | V5 on: nav icons render `MotionIcon` and the Token Saver child is labelled "Dashboard". No "My dashboards" entry. V5 off: the DOM matches the current one (snapshot of the nav labels list). | S03 |
| `/login` | `src/app/login/LoginView.js`, `page.js` | `login/ReviewLoginView.jsx`, `GateScene.jsx`, `gate-scene.js` | LoginErrorAndResetHint, RejectedPassword, MfaRejected, OIDC, password change | The form sits in its own landmark. The pause control is a button with `aria-pressed`. 44px targets (#1640). The scene is `aria-hidden` and has `pointer-events:none`. | The props contract is identical in both branches. Submit calls the same handler with the same args. With `getContext` returning null, the CSS fallback renders. With reduced motion, one frame renders and no RAF loop starts. Error text uses `role="alert"`. | S04 |
| `/callback` | `src/app/callback/page.js`, `CallbackStatusView.js` | Tokens + primitives | Error, LiveError, success | Status text in `role="status"` and errors in `role="alert"`. The retry link is focusable. | Each state renders its message and recovery action. `callbackDelivery` is called the same way on and off. | S04 |
| `/dashboard` | `dashboard/page.js` | none (redirect) | n/a | n/a | Redirect target stays `/dashboard/usage`. | S03 |
| `/dashboard/usage` | `usage/page.js`, `usage/components/*` (UsageChart, MonitoringWidgets, ProviderLimits), `shared/components/UsageStats.js`, `keys/components/ApiKeyLimitsCard.js` | `usage/ReviewUsagePage.jsx`, `UsageWidgetLayout.jsx`, `layout.js`, `ReviewApiKeyLimitsCard.jsx`, `ReviewUsageChart.jsx` | Chart/key-limit loading, failure, retry with retained snapshot. Empty reports. Reset pending/failure. ProviderLimits Loading/Error/ConnectionCatalogUnavailable | Customize supports keyboard reordering with move buttons. Layout reset and usage-data reset are separate confirm dialogs. The limits table is a focusable region. Period controls scroll locally. | Draft reorder, then Cancel, restores order. Save writes `durindoor:usage-layout:v1` only. Blocked storage shows a notice and keeps the view. The retry button re-requests the same URL. Usage reset still calls the existing endpoint. | S10, S11 |
| `/dashboard/providers` | `providers/page.js`, `providers/components/*` | Tokens + primitives | LoadFailureAndRetry, MalformedResponseAndRetry, NetworkFailureAndRetry, RejectedToggleAndRetry, PartiallyRejectedToggle, ProviderTogglePending, BatchProviderUnavailable | The toggle is a switch with a name. A pending toggle is disabled. The provider grid reflows to one column. | A rejected toggle reverts and shows Retry. Pending blocks a duplicate PATCH. The toggle PATCH body is the same on and off. | S06 |
| `/dashboard/providers/[id]` | `providers/[id]/page.js`, `ModelAutoSyncPanel.js`, `ProviderRpmControl.jsx` and siblings | `providers/ReviewAutoSyncCard.jsx` | Auto-sync loading/unsupported/no-connection/paused/synced/failed/retry, ApiKeyValidationError, ErrorState, provider error rules | The auto-sync card sits between Connections and Models and is hidden for compatible providers. Round Robin and Cache Affinity labels stay with their toggles. RPM label stays visible (#2043). | The auto-sync toggle merges `modelAutoSyncProviders` in its PATCH like the incumbent. A stale status response is ignored after a provider change. An unmount aborts the request. | S05, S07 |
| `/dashboard/combos` | `combos/page.js`, `shared/components/ComboFormModal.js`, `ModelSelectModal.js` | `combos/ReviewCombosPage.jsx`, `ReviewComboFormModal.jsx`, `ReviewSharedComboFormModal.jsx`, `ReviewModelSelectModal.jsx` | Empty, LoadFailure, SaveFailure, RetainedError, RejectedClearAndRetry, Retry | Member ordering by keyboard and pointer. Remove targets are 44px. Capability checkboxes have names. Invalid weight shows field feedback without losing focus. | Strategy and timeout PATCH bodies equal the incumbent's. A blank timeout never writes 0. A rejected allow-list change keeps the draft and Retry resends it. The picker's add/remove calls the caller's `onSelect` contract. | S08, S09 |
| `/dashboard/token-saver` | `token-saver/page.js`, `TokenSaverClient.jsx` | `dashboards/TokenSaverDashboard.jsx`, `SaverWidgets.jsx`, `PxpipeWidgets.jsx`, `DashboardCanvas.jsx` | UnavailableServices, Empty, ServiceUnavailable, LoadingMetrics, PxpipeInitialLoading, PxpipeStatsUnavailable, PxpipeEventsRetry, RejectedCompressionSettings, RetryCompressionSave | Same canvas keyboard rules as Usage. Actual bytes and estimated tokens are labelled separately. | `view="settings"` always renders the incumbent. A hidden widget stops its subscription. Layout key is `durindoor:token-saver-layout:v1`. A stream failure retains the last snapshot and shows Retry. | S12 |
| `/dashboard/token-saver/settings` | `token-saver/settings/page.js` | Tokens + primitives | Rejected and pending settings | Field labels and pending state | A PATCH rejection rolls the value back. Duplicate submit is blocked. | S12 |
| `/dashboard/health` | `health/page.js` | Tokens + primitives | Empty, LoadFailure, IndependentHeadroomFailure | "Unknown" is distinct from "down" in text, not only colour. | A headroom failure leaves provider health rendered. Retry re-fetches. | S13 |
| `/dashboard/monitoring` | `monitoring/page.js` | `dashboards/MonitoringWidget.jsx` (presentation only) | RequestFailure, live poll | Pause/refresh are buttons with names. | Pause stops the poll timer. Failure keeps the last values with an alert. | S13 |
| `/dashboard/timeline` | `timeline/page.js` | Tokens + primitives | Loaded, LoadError, Loading, InitialReadUnavailable | The provider label does not wrap. The list scrolls locally. | The error state has Retry. V5 on: the provider cell has `whitespace-nowrap`. | S13 |
| `/dashboard/timeline/[id]` | `timeline/[id]/page.js` | Tokens + primitives | Loaded, Loading | Hop list keyboard reachable | Loading skeleton, then trace render | S13 |
| `/dashboard/console-log` | `console-log/page.js` | Tokens + primitives | Empty, TransportUnavailable, ClearRejected | Live output uses `aria-live="polite"`. Pause is a toggle button. | The Streaming/Polling label follows the transport outcome. A failed Clear keeps the output. | S14 |
| `/dashboard/translator` | `translator/page.js` | Tokens + primitives | Loading, Empty, LoadFailure, ErrorBoundary, DismissError, CaptureSaveFailure | Collapsible panels are buttons with `aria-expanded`. | A capture save failure keeps the draft. Dismiss error is announced. | S14 |
| `/dashboard/skills` | `skills/page.js` | Tokens + primitives | CopyInstructionFailure | The copy button has a name and its result is announced. | V5 on: the instruction block has `basis-full sm:basis-0`. A clipboard rejection shows an error. | S14 |
| `/dashboard/playground` | `playground/page.js` | Tokens + primitives | EmptyConversation, CompletionError, Compare | Stop is reachable during streaming. The transcript is a log region. | Completion error shows Retry. The request body is the same on and off. | S15 |
| `/dashboard/compression-studio` | `compression-studio/page.js` | Tokens + primitives | Empty, UnavailableEngine, PreviewFailure | Engine choice uses `V5NativeSelect` with a label. | A preview failure keeps the input. An unavailable engine is disabled with a reason. | S15 |
| `/dashboard/headroom` | `headroom/page.js`, `HeadroomClient` | Tokens + primitives | Loaded, failure | Controls are labelled. | The settings write body is the same on and off. | S15 |
| `/dashboard/pxpipe` | `pxpipe/page.js` | Tokens + primitives | Empty, Unavailable, Loading, Retry | Window selector is labelled. | An events outage does not blank savings. Retry re-fetches. | S15 |
| `/dashboard/keys` | `keys/page.js` | Tokens + primitives | Empty, RevocationPending, RevocationRejectedAndRetry | Revoke confirm dialog focus is trapped and restored. | A rejected revocation keeps the key listed with Retry. The create/revoke requests are the same on and off. | S16 |
| `/dashboard/endpoint` | `endpoint/page.js`, `EndpointPageClient` | Tokens + primitives | Loading, LoadFailureAndRetry, MalformedResponseAndRetry, NetworkFailureAndRetry, StatusFailureAndRetry, SecurityWriteRejected, EmptyBlockList, AddAndRejectDuplicateRule | Block-list table region. The duplicate rule error is attached to its field. | A security write rejection retains the draft. A duplicate rule is rejected client-side without a request. | S16 |
| `/dashboard/mcp-gateway` | `mcp-gateway/page.js` | Tokens + primitives | EmptyInstances, FailedTestRequiresLogin, ErrorBoundary, RetainedErrorBoundary | Instance actions have names. | An error boundary keeps the prior list. The test action reports a login requirement. | S16 |
| `/dashboard/mcp-gateway/keys` | `mcp-gateway/keys/page.js` | Tokens + primitives | EmptyKeys, LoadFailureAndRetry, MalformedResponseAndRetry, NetworkFailureAndRetry, MintPending, MintRejectedAndRetry | The minted secret is shown once in a labelled field. | A pending mint blocks a duplicate. A rejection shows Retry. The mint body is the same on and off. | S16 |
| `/dashboard/media-providers/[kind]` | `media-providers/[kind]/page.js` | Tokens + primitives | LoadFailureAndRetry, MalformedResponseAndRetry, NetworkFailureAndRetry | The grid reflows. | Retry re-fetches the same kind URL. | S17 |
| `/dashboard/media-providers/[kind]/[id]` | `media-providers/[kind]/[id]/page.js` and components | Tokens + primitives | Loaded, example cards (STT, generic) | File input and example controls are labelled. | Model and account writes are the same on and off. | S17 |
| `/dashboard/media-providers/combo/[id]` | `media-providers/combo/[id]/page.js` | Tokens + primitives | EmptyProviders, DeleteError | Delete confirm focus is managed. | A delete error keeps the combo. | S17 |
| `/dashboard/media-providers/web` | `media-providers/web/page.js` | Tokens + primitives | CreateComboError, LoadFailureAndRetry, MalformedResponseAndRetry, NetworkFailureAndRetry | Form fields are labelled. | A create error keeps the form values. | S17 |
| `/dashboard/media-routes` | `media-routes/page.js` | Tokens + primitives | LoadError, EmptyRoute, CustomUnavailable | Per-operation selects use `V5NativeSelect` and keep their names. | The fallback ordering PATCH is the same on and off. | S17 |
| `/dashboard/proxy-pools` | `proxy-pools/page.js` | Tokens + primitives | Empty, CreatePending, CreateError, DeletePending, DeleteError, LoadFailureAndRetry, MalformedResponseAndRetry, NetworkFailureAndRetry | Pool table region | Pending blocks duplicates. Errors keep data. | S18 |
| `/dashboard/mitm` | `mitm/page.js` | Tokens + primitives | Loaded, trust prompts | Trust actions require explicit confirmation with focus management. | The certificate/trust request is the same on and off. | S18 |
| `/dashboard/cli-tools` | `cli-tools/page.js`, `CLIToolsPageClient` | Tokens + primitives | Catalog, Loading, FetchError, FetchErrorRetry, MitmSectionVisible | Catalog cards are keyboard reachable. | Retry re-fetches. | S18 |
| `/dashboard/cli-tools/[toolId]` | `cli-tools/[toolId]/page.js` | Tokens + primitives | Loading, DiscoveryUnavailable, per-tool loaded states | Endpoint/model/key selects are labelled. | The applied config body is the same on and off. | S18 |
| `/dashboard/auto-configure` | `auto-configure/page.js`, `AutoConfigureClient` | Tokens + primitives | StatusPreview, RunSuccess, RunFailure, StatusLoadRecovery | The planned-change list is announced before apply. | A run failure keeps the preview. Apply posts the same body. | S18 |
| `/dashboard/profile` | `profile/page.js` | Tokens + primitives | SettingsLoading, SettingsUnavailable, LoadCatalog, SetupApiError, VerificationApiError, DisableApiError (MFA) | MFA code input has `autocomplete="one-time-code"` and a label. Destructive confirms are managed. | MFA setup/verify/disable request bodies are the same on and off. Settings-unavailable shows Retry. | S19 |
| `/dashboard/settings/database` | `settings/database/page.js` | Tokens + primitives | StatusUnavailable, cutover/rollback | Cutover confirm uses danger tone with focus management. | Read-back ordering: status is re-read after a write. The request sequence is the same on and off. | S19 |
| `/dashboard/settings/pricing` | `src/app/dashboard/settings/pricing/page.js` | Tokens + primitives | EmptyPricing | Pricing table region | The empty state renders guidance. | S19 |
| `/dashboard/quota` | `quota/page.js` | Tokens + primitives | Loading, EmptyProviders, failure/retry | Account rows are reachable. | Quota failure shows Retry without clearing other providers. | S19 |

## 5. Implementation slices

Each slice fits in one hour and touches only its own files, so slices can run in parallel after S01. S02 and S03 should land before the surface slices so those can use the primitives. Every slice adds the named test file under `tests/unit/`, follows the [section 4](#4-surface-table) rows it owns, keeps flag-off DOM and requests unchanged, and does not edit `.storybook/main.js` (S01 and S21 excepted).

| Slice | Scope | Files (all under `src/` unless noted) | Test added |
|---|---|---|---|
| S01 Foundation | Switch, tokens, root attribute, Storybook skip rule | new `shared/ui/v5/production/uiVersion.js`; new `shared/ui/v5/production/v5-tokens.css`; `shared/ui/v5/review.css` (remove the moved token blocks); `app/layout.js`; `.storybook/main.js` (skip files importing `uiVersion`); `.storybook/preview.jsx` (import tokens, set `data-ui`) | `tests/unit/v5-int-01-foundation.test.js`: env parsing (unset, `0`, `1`, `on`, garbage); the layout attribute is present only when on; `v5-tokens.css` declares both selectors; `review.css` no longer declares `--dd-accent` |
| S02 Primitives | Motion button, icon help, select, pagination | `shared/ui/components/Button.jsx`, `Tooltip.jsx`, `Pagination.jsx`; `shared/ui/v5/NativeSelect.jsx` (native `<select>` when off) | `tests/unit/v5-int-02-primitives.test.js`: Button keeps `type`, `disabled`, `ref` and form submit on and off; the tooltip opens only for icon triggers and Escape closes it; `V5NativeSelect` serializes its value in `FormData` and enforces `required`; reduced motion has no animation class |
| S03 Shell | Navigation icons and labels, header, language marks, redirect | `shared/components/Sidebar.js`, `SidebarNavIcons.js`, `Header.js`, `HeaderLanguage.js`, `LanguageSwitcher.js`, `layouts/DashboardLayout.js` | `tests/unit/v5-int-03-shell.test.js` (shell row) |
| S04 Login and callback | Doorway login, callback states | `app/login/LoginView.js`; `app/callback/CallbackStatusView.js`; `shared/ui/v5/login/*` (production-safe imports only) | `tests/unit/v5-int-04-login.test.js` |
| S05 Provider-detail review coverage | Add source stories for `AutoPingScheduleModal`, `InferenceStatus`, `ModelCatalogProvenance`, `NativeProviderReadiness` and `ProviderRpmControl`; regenerate wrappers | `app/(dashboard)/dashboard/providers/[id]/<those five>.stories.jsx`; generated `shared/ui/v5/stories/*`; `shared/ui/v5/review-manifest.js`; `tests/e2e/storybook-surfaces.json` | `tests/unit/v5-int-05-provider-stories.test.js`: each of the five has a manifest entry with loading or error states |
| S06 Providers list | Tokens, primitives and states for the list | `app/(dashboard)/dashboard/providers/page.js`, `providers/components/*` | `tests/unit/v5-int-06-providers.test.js` |
| S07 Provider detail | Auto-sync card and placement, toggle grouping | `providers/[id]/page.js`, `providers/[id]/ModelAutoSyncPanel.js`; `shared/ui/v5/providers/ReviewAutoSyncCard.jsx` | `tests/unit/v5-int-07-provider-detail.test.js` |
| S08 Model picker and shared combo form | Picker and shared form | `shared/components/ModelSelectModal.js`, `ComboFormModal.js`; `shared/ui/v5/combos/ReviewModelSelectModal.jsx`, `ReviewSharedComboFormModal.jsx`, `CapabilityIcons.jsx`, `ModelSummary.jsx`, `model.js`, `combos.css` | `tests/unit/v5-int-08-model-picker.test.js` |
| S09 Combos page | Inventory, strategy queue, allow-lists | `app/(dashboard)/dashboard/combos/page.js`, `combos/components/*`; `shared/ui/v5/combos/ReviewCombosPage.jsx`, `ReviewComboFormModal.jsx` | `tests/unit/v5-int-09-combos.test.js` |
| S10 Usage reports | Chart and key-limit states, keyboard table region | `shared/components/UsageStats.js`; `app/(dashboard)/dashboard/keys/components/ApiKeyLimitsCard.js`; `usage/components/UsageChart.js`, `UsageTable.js`, `ProviderLimits/*` | `tests/unit/v5-int-10-usage-reports.test.js` |
| S11 Usage layout | Widget layout with draft/save/cancel and production key | `app/(dashboard)/dashboard/usage/page.js`; `shared/ui/v5/usage/UsageWidgetLayout.jsx`, `layout.js` | `tests/unit/v5-int-11-usage-layout.test.js` |
| S12 Token Saver | Monitoring dashboard and settings states | `token-saver/TokenSaverClient.jsx`, `token-saver/settings/page.js`; `shared/ui/v5/dashboards/TokenSaverDashboard.jsx`, `SaverWidgets.jsx`, `PxpipeWidgets.jsx`, `DashboardCanvas.jsx`, `model.js` (production key) | `tests/unit/v5-int-12-token-saver.test.js` |
| S13 Inspection routes | health, monitoring, timeline, timeline/[id] | Those route directories | `tests/unit/v5-int-13-inspection.test.js` |
| S14 Logs and tools | console-log, translator, skills | Those route directories | `tests/unit/v5-int-14-logs-tools.test.js` |
| S15 Playground and compression | playground, compression-studio, headroom, pxpipe | Those route directories | `tests/unit/v5-int-15-playground-compression.test.js` |
| S16 Access | keys, endpoint, mcp-gateway, mcp-gateway/keys | Those route directories | `tests/unit/v5-int-16-access.test.js` |
| S17 Media | media-providers (four routes), media-routes | Those route directories | `tests/unit/v5-int-17-media.test.js` |
| S18 Network and clients | proxy-pools, mitm, cli-tools, cli-tools/[toolId], auto-configure | Those route directories | `tests/unit/v5-int-18-network-clients.test.js` |
| S19 Settings | profile, settings/database, settings/pricing, quota | Those route directories and `app/dashboard/settings/pricing/page.js` | `tests/unit/v5-int-19-settings.test.js` |
| S20 Release-candidate flip | Default on, opt-out documented, website demo follows | `shared/ui/v5/production/uiVersion.js` (default); `website/src/app/dashboard/layout.js` (`data-ui`); `docs/` operator note on `DURINDOOR_UI_V5=0` | `tests/unit/v5-int-20-default.test.js`: unset resolves on and `0` resolves off. Run the website build. Hands off to #1067 for A6. |
| S21 Cleanup (after #1067 accepts) | Remove flag-off branches, incumbents, the switch and the Storybook boundary plugin | Every file listed above; `.storybook/main.js` | Update the S01 to S20 tests to drop flag-off cases. Parity tests stay, comparing against recorded request fixtures. |

Notes:

- Slices touching a file that S02 or S03 owns must wait for that slice. No other slices share files.
- "Those route directories" means `src/app/(dashboard)/dashboard/<route>/**` (page, client, components and colocated stories). It never includes the shared components already assigned to S02, S03 or S08, nor `keys/components/ApiKeyLimitsCard.js`, which S10 owns.
- A slice that finds a production behavior gap against a review scenario (a missing Retry, for example) fixes it only when the fix stays inside its own files and keeps the API contract. Anything else goes to a separate issue under #1066.
- If a slice cannot fit in one hour, it splits by route before starting, never by layer.
