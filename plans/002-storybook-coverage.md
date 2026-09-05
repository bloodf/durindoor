# Working Storybook coverage for every production UI surface

## Status and dependency

PLANNED — no new stories implemented or runtime proof claimed in this planning
change. Base `cf572ec911afbef2e7cc1248a9be2e7a7b0d439a`. This is a mandatory
subplan of [the all-pages gauntlet](001-durin-ds-gauntlet.md), not a replacement
for real-app Playwright verification. User requires inspection of every component,
page and widget and working stories for all meaningful states.
The campaign rewrites the real production web interface: all 35 visual pages plus
two redirect checks, shared and domain widgets, navigation, layouts, public and
auth surfaces. It changes actual page/client rendering and presentation while
preserving backend, API, auth and storage contracts. Storybook is mandatory
additional proof for each migrated production view; it never marks a route
migrated or this project complete.

Execute infrastructure alongside gauntlet G0; foundation stories alongside G1;
shell/page/domain-widget stories alongside their owning migration lanes. No lane
is accepted until BOTH its Storybook and app evidence pass. No separate later
Storybook phase can excuse missing stories in a page PR.

## What every means

Inspect every production UI file and renderable symbol, including local components
inside page files, shared domain widgets, auth/public pages, layouts, error
boundaries, forms, tables, charts, editors, provider cards, configuration cards,
modals, drawers, popovers and first-use flows. Starting inventory is 37 routes
(35 visual templates plus two redirects), 27 DS primitive modules, 21 reference
page mocks and 52 legacy shared modules. These counts are NOT complete widget or
story counts. Route-local widgets and distinct exports add inventory rows.

Planned-at row ledger: [storybook-census.json](storybook-census.json). It records
272 source modules, 371 renderable/wrapper candidates plus 47 nonvisual module
rows (418 total), 50 existing story files and 177 named CSF exports. All 418 rows
are runtime-UNVERIFIED; current story association is module-import evidence,
not a claim every symbol already has a working story. Parser `@babel/parser`
7.29.8 parsed scanned files with zero errors; scanner source, command, source
hashes, required axes and exception rationale are embedded for reproduction.
Raw scanner output supplies candidates/imports; classification and required axes
are planning annotations requiring owner verification before coverage closes.
The five route audit roots contain 147 JS/JSX files (145 production plus two
tests), not the scout's preliminary 133. The tracked-path/AST census supersedes
that incomplete count. Existing reference data files number 17, not 21.
Exact audit roots: `src/app/(dashboard)/dashboard`,
`src/app/dashboard/settings/pricing`, `src/app/login`, `src/app/landing`,
`src/app/callback`. The separate `src/app/(dashboard)/layout.js` is excluded from
that 147-file subtotal but included in the complete 272-module census.

Full scan is not restricted to those audit roots: `scannedModules` records all
794 tracked non-test source modules under `src` plus 50 story files, considering
`.js`, `.jsx`, `.mjs`, `.ts`, `.tsx`. All module classifications remain proposed
and pending, including files outside app/shared trees. Current planned SHA has
no extra MJS/TS/TSX files; new extensions or renderable symbols elsewhere must
enter census on drift. Direct JSX, private fragments, lazy/dynamic/memo/forwardRef,
compound components and wrapper providers are candidates, not automatic truth.

### Runnable planning snapshot integrity gate

From isolated plan worktree, with pinned Node 20.20.2:

```bash
node plans/check-storybook-census.mjs
```

This dependency-free check runs now, before H1/SB2 implementation. It parses JSON,
asserts counts against arrays, 418 unique row IDs, every row pending with empty
approved scenarios/reviewer/exception, valid story references, zero parse errors,
and complete eligible path set. It checks each source hash against BOTH planned
Git SHA and current file bytes; 794 modules plus 50 story files and 177 CSF exports
must reconcile. Expected exit 0 reports planning integrity only, never coverage.
The checker does not execute scanner source embedded in JSON. Reproducing parser
output separately uses recorded parser/version/command and is a source audit,
not a requirement to trust executable JSON from another author.
Intentional source changes invalidate this snapshot: update execution manifest
through reviewed census regeneration, not weakening hashes or auto-approving rows.

Expected output for this immutable snapshot:

```text
Planning census integrity passed: 418 pending rows; 794 modules + 50 story files; 177 CSF exports. No runtime coverage claimed.
```

This [planning checker](check-storybook-census.mjs) validates only the immutable
`plans/storybook-census.json` baseline, including its deliberately pending rows.
Do not run it against execution progress or reset approved rows to satisfy it.
SB2's separate `scripts/check-storybook-coverage.mjs` validates the evolving
`tests/e2e/storybook-surfaces.json`: allow reviewed `pending` to `approved`
transitions with named reviewer, current source hashes, story/scenario IDs and
passing runtime evidence. Allow approved nonvisual/retired exceptions only with
source-backed rationale. Final coverage fails pending/stale/missing rows, not
legitimate approvals. Keep the planning snapshot unchanged as historical evidence.

Verified negative controls, reproducible without modifying the snapshot: create
three temporary JSON copies; in each change only (1) a second row ID to duplicate
the first, (2) one row's `reviewStatus` to `approved`, or (3) one scanned module's
`sourceSha256` to 64 zeroes. Pass each temporary path as the checker's argument:
`node plans/check-storybook-census.mjs <temporary-copy.json>`. Each must exit
nonzero; the untouched snapshot must exit 0. Remove only those temporary copies.
These reject corrupt or prematurely approved planning evidence; SB2 regression
tests must separately prove valid execution approvals are accepted.

Maintain `tests/e2e/storybook-surfaces.json` during execution. Row key is
`sourcePath#symbol`, not just filename. Each row records:

- category and exact production source/export or parent-owned local symbol;
- owning route cluster and sole writer;
- story module, CSF export names, built Storybook IDs and production import path;
- required prop/state/interaction axes and scenarios;
- direct story or explicit parent-composition coverage target;
- app scenario IDs, dependency content hashes and current-SHA evidence;
- classification: required, covered, retired-with-proof, or nonvisual-with-reason.
- `reviewStatus` initially `pending`, proposed coverage rationale, named reviewer,
  approved story/scenario IDs and explicit approved exception (initially null).
  Candidate classification is not reviewed truth. Integration reviewer alone
  approves rows after inspecting source and recorded story/app outcomes. Private
  renderable parent coverage is a rationale, not an exception. Only proven
  nonvisual/retired rows may receive an approved exception; all other rows require
  specific story/scenario IDs. No pending row can pass execution closure.

Inventory discovery uses syntax-aware React/JSX/component inspection plus review
of returned elements, wrappers/HOCs/lazy imports, not filename/capitalization/JSX
regex alone. Compare source census, manifest and built Storybook `index.json` in
both directions. A missing module/symbol/state or unresolved classification fails
coverage. Do not count a single default page story as all nested widgets or states.

SB2's `tests/unit/storybook-coverage.test.js` MUST include fixture regressions for
direct/default/named exports, memo/forwardRef/lazy/dynamic wrappers, compound
members, private local JSX/element fragments and providers; nonvisual redirects,
data constants and DOM `document.createElement` helpers must not become fake
visual coverage. Wrapped `UsageStats#ProviderTopology` and translator `Editor`
remain explicit candidates even without direct JSX. `AUTH_NOTE`/render helpers
require parent scenario review, not standalone-component claims. Parse failure,
unknown wrapper, omitted state/symbol, duplicate ID or unapproved exception fails
closed. Scanner fixtures must show missing actual story coverage turns gate red.

Nonvisual helpers, barrels and pure redirects do not get fake stories. They need
source-backed nonvisual classification; redirects remain real-app assertions.
Providers with no visual output get a composition story exercising their visible
consumer behavior. A private local widget can be covered through a named parent
story with its own fixture, selector and interactions; do not export every private
function merely to satisfy an artificial one-file-per-widget ratio. Reusable
exported widgets get standalone stories. Every subcomponent export (for example
CardHeader/CardContent/CardFooter) needs explicit standalone or composition proof.

“All possible” means every supported meaningful variant, state, rendering branch
and user-observable interaction, not infinitely many input strings or Cartesian
products of equivalent props. Each axis needs coverage; interactions between axes
with plausible defects need combination stories (disabled+selected,
modal+dropdown, mobile+long-content, loading+cancel, RTL+overlay). N/A needs a
reviewed reason, not a generic exemption.

Do not load the entire JSON ledger into every worker's prompt. Dispatch only
owned `sourcePath#symbol` rows, matching source/story files, applicable state
contract and proof commands. Orchestrator retains full ledger for reconciliation;
this bounded subplan avoids repeating whole campaign plan per widget.

## Grounded infrastructure baseline

- `.storybook/main.js` uses `@storybook/react-vite`, Storybook dependency
  `^10.5.10`, and currently discovers only `src/shared/ui/**/*.stories.jsx`.
  App/shared legacy stories would otherwise be silently absent.
- Vite already includes `@vitejs/plugin-react` for automatic JSX runtime, `@` alias
  and root PostCSS config. Preserve automatic runtime; no global React shim.
- `.storybook/preview.jsx` imports `tokens.css` BEFORE `globals.css`; preserve order.
  Existing decorator only sets dark/light theme/background and font readiness.
  App router/auth/i18n/store/network contexts are not already provided.
- Current 21 page mocks are visual references. They do not establish production
  page behavior. Existing primitive stories need review, not blanket acceptance.
  Mock layouts are design references only. They cannot replace production data,
  rendering or user flows: stories must accompany their actual migrated production
  views, and mock-only layouts never count as production coverage.
- Use installed CSF3 APIs. Verify `storybook/test` exports against pinned version
  before using `expect`, `fn`, `userEvent`, canvas queries or lifecycle hooks.
  Do not upgrade frameworks/add testing runners just because latest web docs show
  different APIs. H1-introduced Playwright runner owns browser automation.

## Independent ownership lanes

All paths below are repo-relative targets inside assigned isolated worktree.
Workers first report `pwd` and `git rev-parse --show-toplevel`, then use absolute
write paths beneath that tree. Workers skip ALL builds/tests/lint/formatters;
orchestrator runs union gates. No source writes to primary checkout.

| Lane | Exact owned targets (maximum five) | Deliverable and dependency |
| --- | --- | --- |
| SB1 discovery/preview | `.storybook/main.js`; `.storybook/preview.jsx`; `.storybook/preview.css`; `.storybook/decorators.jsx`; `tests/unit/storybook-isolation.test.js` | Discover CSF3 stories in `src/shared/ui`, `src/shared/components`, and `src/app` without duplicate globs; preserve assets/JSX/theme; add scoped locale/router/store decorators and lifecycle cleanup. Only owner of global Storybook config. |
| SB2 coverage/runner | `tests/e2e/storybook-surfaces.json`; `tests/e2e/storybook.spec.js`; `scripts/check-storybook-coverage.mjs`; `tests/unit/storybook-coverage.test.js` | Source/symbol/state manifest and built-index reconciliation; actual iframe traversal, render/play/assertion completion, screenshots and error evidence. Depends on H1's planned Playwright fixture. |
| SB3 safe dependencies | `.storybook/fixtures.js`; `.storybook/network.js`; `.storybook/next-navigation.js`; `.storybook/next-image.jsx`; `tests/unit/storybook-boundaries.test.js` | Per-story deterministic boundary fixtures for actual production components; no real server bootstrap/network/auth. Exports fixture lifecycle consumed by SB1; explicit aliases only if needed after installed framework audit. |

Shared contract fixed before dispatch: `.storybook/fixtures.js` exports
`setupStoryFixture({ scenario, locale, pathname })`, returning `{ cleanup }`;
cleanup restores only story-owned stores/cookies/storage/network/timers. No real
credentials. `.storybook/network.js` owns per-story request handlers and rejects
unexpected destinations. `.storybook/decorators.jsx` wraps only required contexts
and consumes this lifecycle. Each module has one owner; dependents may author
concurrently but integration waits for produced contract and browser proof.

H1 package owner alone wires proposed `check:storybook-coverage` and
`test:storybook` scripts and any proven missing direct devDependency. SB workers
never race on package.json/lockfile or Playwright config. SB2 runner imports H1
`test`/`expect` and consumes built output URL supplied by orchestrator. Missing
additional adapter/file requires explicit disjoint child assignment before editing;
no hiding all adapters inside one generic factory or expanding file ownership.

Story content stays with migration owner:

- DS primitives: adjacent `<Name>.stories.jsx`, matching existing convention.
- Shared domain components: adjacent `<Name>.stories.jsx` under
  `src/shared/components`; these are stories for existing components, not new DS
  primitives in legacy tree. New reusable DS primitives still go under
  `src/shared/ui/components` with adjacent stories.
- Route-local widgets: adjacent `<Widget>.stories.jsx`; private widgets represented
  by explicit parent scenarios where direct import would require artificial API.
- Actual route screens: route-local `page.stories.jsx` or existing client component
  story, importing production view. Label `Durin DS/Production Pages/<route>`.
  Keep old references clearly labeled as reference/mock stories; never substitute
  them for production coverage.
- Route cluster writer owns source directory including stories, unique
  `tests/e2e/routes/<slug>.spec.js`, focused unit file when behavior changes and
  inline documentation. Split additional disjoint widget packs as needed;
  manifests/page-map/changelog remain integration-owner-only.

## Production views, server boundaries and truthful stories

Stories render the actual production component, not copied JSX matching screenshot.
Do not add `if (storybook)` branches or fake data fallbacks to production runtime.
Provide real props and deterministic boundary dependencies; state transitions
remain component logic. A mock echo is not an interaction assertion.

Async/server route entries cannot be assumed runnable in a Vite browser. Inspect
imports before loading: filesystem/DB/auth/tunnel/bootstrap modules must never
execute in Storybook, even during build. Prefer existing client/view component.
If no browser-safe view exists, extract minimum presentational view consumed by
BOTH actual route and story, keeping server orchestration and behavior unchanged.
No one-implementation view factory, mirrored page markup or Storybook-only app.
Server wrapper remains covered by real-app route test and maps to its view story;
no fake Storybook proof of server behavior. Imports requiring a new framework
must be justified and gated by SB1/H1 rather than automatic migration to NextJS
Storybook framework.

Mock only external boundaries: router context, local API responses, clipboard,
media devices, files and outside processes. A function spy/automock may still
EVALUATE module side effects; prevent dangerous module evaluation through explicit
Storybook-only replacement or safe production seam. Never import root app layout
just to obtain contexts: it imports service bootstrap and outbound proxy setup.
No provider credential, OAuth exchange, systemd operation, cert install, tunnel
startup, live quota spend or production data access from stories.

Reset stores, cookies, storage, timers, event listeners, network handlers and
BroadcastChannels between stories; abort pending polls/SSE. Repeated open/close
and direct iframe load must produce same initial state. Use local seeded assets,
fonts and media. Do not depend on CDN/editor worker downloads during offline proof;
serve real installed editor workers/assets and prove editor keyboard interaction.
Do not replace Monaco/chart/graph with a blank mock and call widget covered.

## Required story-state families

| Surface | Minimum meaningful stories/behavior |
| --- | --- |
| Actions | Every supported variant/size, icon/label, loading/disabled, pointer and keyboard activation, 44×44 geometry |
| Inputs/choices | Label/hint/error, empty/value/long input, required/disabled/read-only where supported, validation, selected/unselected, no-options/long-options, keyboard/typeahead |
| Tabs/navigation | Active/disabled items, nested/deep links, long labels, keyboard order, collapsed/mobile shell, locale/RTL, auth/version/notification state |
| Data/status | Empty/loading/populated/error/retry, zero/unknown/unlimited/exhausted values, long rows, sorting/filtering, first/last/all pagination, expandable details, caption/header semantics |
| Overlays | Closed/open, confirm/cancel, submit/error/busy, backdrop/Escape guards, nested layers, focus initial/trap/return, mobile clipping, long content |
| Charts | Zero/single/multiple series, sparse/missing/large data, legend/toggle/filter if supported, hover/keyboard detail, non-color series distinction, accessible table equivalent |
| Domain forms | Create/edit/invalid/server-failed/success/cancel, connection/auth families, custom models, key scopes, imports/exports; all fixture-only |
| Editors/playground/media | Idle/typing/streaming/done/cancel/retry/disconnect/error, reasoning/tools/attachments, supported media kinds, real editor/diff keyboard behavior, output alternatives |
| Pages/layouts | Every 35 visual template and dynamic renderer branch, direct-entry/context, loading/empty/error/success, opened key overlays, desktop/mobile/RTL; four error boundaries retry/reset |
| Callback/login | Loading/manual/error/success/done, local relay close/no-close, password/OIDC/forced-change/timeout/rate-limit using synthetic values; no real OAuth or passwords |

Decorators supply dark/light, viewport and normalized locale; no duplicate story
export for every theme unless it is a distinct behavior. Each interactive story
has a CSF3 `play` exercising a meaningful consumer-visible outcome. Await queries,
user interactions and assertions. Static stories need a visible semantic assertion
in runner, not a fake click. Verify no-op loading/disabled actions do not mutate.
Stories must work when selected manually in Storybook AND opened directly by URL.

## Storybook runtime gauntlet

1. At pinned Node 20.20.2/npm 10.8.2, orchestrator installs existing lockfiles,
   runs lint, relevant unit tests and `npm run storybook:build`. No output from
   another candidate or source worktree reused as evidence.
2. SB2 checker reconciles source/symbol/state manifest against built `index.json`.
   Every story entry is executable coverage or explicitly reference-only with
   owned render proof. Autodocs entries classified separately. Missing stories,
   unmatched IDs, hidden disabled stories and unknown source symbols fail.
3. Serve built static Storybook in isolated QA environment through an owned
   supervised process. Use existing `app` service slot in a separate Compose run
   with read-only Storybook output; never expose public ingress or add an external
   Docker network. Browser fetch and server egress constraints from G0 still hold.
4. Playwright opens EVERY executable `/iframe.html?id=<built-id>&viewMode=story`.
   Read expected visible fixture content, verify play function completion and
   assertions using installed Storybook integration, and reject Storybook error
   surfaces, hydration/runtime exceptions, console errors, failed assets or
   unexpected requests. Merely awaiting page load or absence of an error banner
   does not prove play passed. Inject one deliberate failed play assertion during
   harness verification; runner must turn red, then green after reverting it.
5. Run all stories in dark/light at desktop/mobile, plus explicit narrow/RTL,
   reduced-motion, long-content and nested-overlay combinations defined by state
   manifest. Capture full canvas and focused widget/overlay, actual served
   contrast/target/focus measurements, axe output and reviewer verdict. Run all
   interactive families under Chromium/Firefox/WebKit; final route browser matrix
   from parent plan remains required as separate actual-app evidence.
6. Prove isolation by running story A, incompatible story B, then A again and
   comparing observable initial state; remount/cleanup leaves no network/timer/
   store/channel residue. Use bounded abortable streaming fixtures, not eternal
   timers that hang story runner.
7. Real app proof follows on SAME candidate SHA. Both proof columns must pass.
   Changed primitive/fixture/decorator invalidates all dependent stories and app
   cases through recorded source/shared-contract hashes. Designer inspects actual
   captures, not only snapshot comparison numbers.

Proposed scripts, wired by H1 and verified before use:

```bash
npm run storybook:build
npm run check:storybook-coverage
npm run test:storybook
```

`check:storybook-coverage` invokes SB2's checker with required built index and
source manifest. `test:storybook` invokes H1's planned Playwright config targeting
`tests/e2e/storybook.spec.js`; no separate test framework solely for stories.
Resolve exact installed completion API during SB1/SB2 bootstrap and document it;
unknown or unexercised completion signaling blocks harness rather than fake pass.
Current scripts do not exist yet except `storybook:build`; no executed claim.

## Closure requirements

- Every source UI symbol has reviewed classification and meaningful story-state
  mapping; every built story has a manifest owner. No undiscovered route/widget.
- All stories build, render directly and work interactively inside Storybook in
  required themes/viewport/state matrix, with no errors or unsafe side effects.
- Every page/component PR carries required stories and route/state specs; changed
  behavior also has focused unit coverage and inline docs. No story-only mock
  component counts as production coverage.
- Actual-app-first acceptance: on the final candidate, every production visual
  surface adopts Durin DS and its real workflows pass; Storybook evidence is
  additional mandatory proof, never a substitute for production migration.
- Both Storybook and actual-app Playwright proof pass on final SHA after cleanup.
  All applicable WCAG 2.2 A/AA/AAA criteria and manual evidence remain mandatory;
  Storybook/axe cannot certify full conformance alone.
- Source inventories and story IDs refresh on drift. Missing story or failing
  interaction sends exact owning lane back to repair; no project-done declaration
  while any required surface/state remains uncovered.

References: [Storybook interactions](https://storybook.js.org/docs/writing-tests/interaction-testing),
[module isolation](https://storybook.js.org/docs/writing-stories/mocking-data-and-modules/mocking-modules).
External docs currently describe 10.6; source dependency is 10.5.x. Verify actual
installed API before adopting examples; no speculative version-specific promise.
