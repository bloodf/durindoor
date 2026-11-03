# DurinDoor v5 Storybook review

The active catalog now wraps the actual admin pages, components, fields and
handlers. It replaces the rejected generic page prototypes. Production routes,
provider executors and credentials are unchanged; this branch is not merged.

Run `npm run storybook` with Node 20.20.2 and open
[Explore workspace](http://localhost:6006/?path=/story/v5-review-start-here--explore-workspace).
Use the existing sidebar for page navigation and **Browse workflows** to find
page, component and named scenario stories. Change the Storybook theme and
canvas size to review light, dark and responsive layouts.

## Preserved workflows and improvements

The usage workspace includes the real overview metrics, provider connection
graph, recent requests and live sessions, request chart, grouped reports,
combo attribution and API key limits. **Customize dashboard** supports pointer
and keyboard movement, move buttons, rename, width, visibility, widget library,
reset and draft/save/cancel. Start here stores only its review layout in a
separate browser key. Deterministic interaction stories disable persistence.
Usage periods, custom dates, logs/details and usage-data reset remain separate
from layout editing. Chart and key-limit reports expose loading, failure and retry
feedback, retaining the last loaded snapshot after subsequent request failures.
Reset pending/failure, empty reports and stream-error retention have named stories.

Provider authentication, AWS credentials, optional/keyless accounts, secret
retention, models, connection rules, key policies, combination strategies,
media routes, endpoint protections and proxy workflows have dedicated scenarios.
Administration scenarios cover CLI adapters, MCP, MITM, MFA/OIDC login and
settings, database cutover/rollback and service failures. Token Saver overview
and settings are separate routes.

The green/neutral review tokens apply to the real shell, content and portaled
dialogs. Native single-select callers receive the existing accessible themed
Select with a hidden successful native form control, required validation,
controlled values, disabled options/groups and external form association.
Outside the v5 review scope the native select remains intact.

## Coverage and boundaries

`review-manifest.js` enumerates source surfaces and named scenarios. The generator
retains original CSF args, render, play, decorators and fixture lifecycle, and
adds the review shell. Preservation stories add domain-specific payload and
read-back assertions. Source reuse preserves implementation; enumeration alone
does not establish complete state coverage or a fully redesigned page.

Fixtures are synthetic and unknown fetch/EventSource requests are rejected.
Authentication, database changes, client configuration, provider requests and
certificates are simulated. Do not enter real credentials. Layout storage is
local to the review. Nothing here demonstrates live gateway operation.

**Archive / Rejected v5 prototype** retains the earlier generic design for
comparison. It is excluded from active v5 verification and acceptance claims.
The scoped [design record](./DESIGN.md) describes the current review direction.
Acceptance and production integration remain later steps.

## Verification

```sh
npm run lint
npm run storybook:build
cd tests && npm run test:ci
```

Browser verification requires a running preview and installed Playwright
engines. Use the tests package's runner, which uses the repository config:

```sh
RUN_V5_STORYBOOK=1 tests/node_modules/.bin/vitest run --config tests/vitest.config.js tests/unit/v5-storybook.browser.test.js --maxConcurrency=1
```

The catalog gate attempts every active v5 story and records successful lifecycle,
play failures, exceptions and page overflow. Representative layouts add axe and
light/dark desktop/mobile checks. `V5_STORYBOOK_URL` selects a stable built preview;
`V5_CHROMIUM_EXECUTABLE`, `V5_FIREFOX_EXECUTABLE`, `V5_WEBKIT_EXECUTABLE` and
`V5_FIREFOX_DRIVER` support locally installed compatible engines. Exact executed
results belong to ignored `.impeccable/review/v5/` reports; test declarations do
not imply every engine has been run.

Run this gate after repository CI. Browser matrices run one at a time so the
gateway suite and multiple rendering engines do not compete for CPU while
checking the existing story and topology completion deadlines.

Run `node scripts/gen-v5-stories.mjs` after adding source stories. Hand-authored
preservation, usage and missing-route stories feed that generator. Generated
wrappers must not be edited by hand.

### October 9 refinement

The combo inventory and dialogs use ordered model rows, a searchable catalog,
explicit selected models, compact timeouts and a grouped capability ceiling.
The login uses the website split doorway logo and a lit WebGL doorway, with
pause, reduced motion and a CSS fallback. Provider model auto-sync occupies its
own card and exposes loading, unsupported, pending, retry and save failures.

Usage and Token Saver remain separate editable dashboards. My dashboards adds
named layouts with widgets from Usage, Token Saver, quota and monitoring. Layout
preferences belong to the review; none of these prototypes update a live gateway.
Token Saver settings retain the original settings workflow. Component stories
render without an unrelated page shell. Page headings use a neutral background.

Buttons adapt the Animate UI motion primitive under its MIT license; icons use
individual AnimateIcons imports. Both respect reduced motion. All replacements
are injected by the Storybook Vite boundary; production imports stay intact.

Icon help appears when hovering or touching an icon, or focusing its control with
the keyboard. Hovering a row, button label or empty control space does not open
help. Explanations include model capabilities,
provider identities and action controls. Close and save glyphs are exempt. Help
uses one viewport-clamped top-layer tooltip, preserves existing accessible
descriptions, and restores authored metadata when the review unmounts. Escape
dismisses help first; changing triggers opens the new explanation.

Action buttons receive a leading icon when they do not already have one. Native
button semantics, form submission, refs, disabled state and legacy variants are
preserved. Tabs, option rows and pagination numbers retain their existing controls.

The Storybook glyph adapter replaces static Material font glyphs with animated
SVG equivalents. Each glyph responds to direct hover, focus and touch; action
controls also animate their icons. Loading icons spin while pending. Navigation
uses distinct drawings for distinct pages, including Monitoring and Timeline.
Provider identity marks retain their artwork and animate in place. Reduced-motion
preferences remove spatial motion and spinning while preserving static feedback.
