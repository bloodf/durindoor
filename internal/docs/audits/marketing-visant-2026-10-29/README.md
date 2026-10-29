# Marketing and docs design repairs

## Surfaces

| File | Surface (A/B/C) | Business variable it moves | Notes |
|---|---|---|---|
| website/src/app/(home)/page.js | A | Installation and demo discovery | Existing doorway identity and full section sequence preserved |
| website/src/app/docs/[[...slug]]/page.js | B | Documentation task completion | Public MDX only, article search and reading themes |
| website/src/app/demo-preview/page.jsx | A | Product evaluation before installation | Production dashboard components with browser-local sample backend |
| website/src/app/login/page.js | C | Explicit sample-session access | Existing simulated password contract preserved |

## Preflight

The owner's established direction is PRODUCT.md and DESIGN.md: developer audience, local gateway installation and documentation task completion. Preserve the carved doorway emblem, emerald palette, local Cormorant Garamond and Space Grotesk fonts, all existing sections and the real-component mocked demo. No new analytics, vendor data transmission, invented claims or production dashboard changes. Delivery is a separate review PR, not deployment. Existing brand vectors and 1920px gate poster are present. Numeric claims must trace to current source.

## Screen seen

| Route | Width | Data state | Observed result |
|---|---|---|---|
| / | 390 | Initial marketing and open short-screen navigation | Built baseline panel extended to 429px on a 360px-high viewport. The fixed panel now scrolls internally and its final Demo action is reachable. |
| /docs | 1440 | Public docs index | Read the approved branded index, ordered setup cards, public guide directory and sidebar. |
| /docs | 390 | Public docs index | Baseline theme action was unavailable with sidebar closed; the repaired header exposes it. |
| /docs/getting-started/installation | 390 | Japanese marketing cookie, English article | Reading language switches to English, theme persists after reload and search returns results. |
| /demo-preview | 1280 | Injected sample-session initialization 503 | Error preserves the sample data and exposes Retry. The test then retries into the actual Endpoint dashboard. |

Production build and automated Chromium interactions are separate from the integration owner's independent in-app-browser review. Screenshots remain in the local review artifact folder, not public assets.

## Findings confirmed before edits

| ID | Finding | Source evidence | Repair |
|---|---|---|---|
| M01 | Clipboard failures silently reset to the original button and offer no recovery feedback | ui/primitives.jsx CopyButton catch | Explicit live failure state and retry, clean timer lifecycle |
| M02 | Mobile navigation panel has no available-height bound or scroll region, so short screens can hide Docs and Demo | home.css mobile nav-panel | Bound to available viewport height with internal scrolling |
| M03 | Language popover stays open after keyboard focus leaves, allowing an abandoned overlay to obscure navigation | HomeLocaleProvider.jsx | Close on focus leaving the selector; preserve Escape restoration |
| M04 | Hero and several navigation actions render arrow font glyphs; homepage uses bespoke stroked action icons despite existing Lucide assets | hero/Hero.jsx, ui/Icon.jsx, sections | Use established library icons with consistent metrics |
| M05 | Homepage metadata defaults absolute share-card URLs to localhost in production without configuration | (home)/layout.js metadataBase | Canonical deployed default and discovery metadata |
| M06 | Docs inherit cookie-selected non-English html language while all public guides remain English | app/layout.js, docs/layout.js | Mark actual English docs shell and dialogs explicitly |
| M07 | Documentation theme control is tucked in a 32px sidebar footer and unavailable when the mobile sidebar is closed | docs/ThemeToggle.jsx, docs/layout.js | Keep reading-theme action available at article top on small screens |

## Verification

- Production website build passes with all public routes, robots and sitemap generated.
- Focused component/data/docs tests: **89 passed across 13 files** on the final source.
- Browser suite: **15 passed in 2.1 minutes** on the production build. It includes every public docs route, actual WebGL gate behavior, embedded navigation, both reading themes, mobile bounds, clipboard denial and retry, metadata, search and failed initialization.
- Demo contract smoke: all five scenarios pass, 298 registered mock routes, no missing or failed checked endpoints.
- Docs integrity and git diff whitespace checks pass.
- Full repository lint/build/test checkpoint, exact candidate-head review and PR publication remain with the integration owner. Focused and browser evidence is not a full repository CI claim.

## Additional findings confirmed during implementation

| ID | Finding | Repair |
|---|---|---|
| M08 | Coverage showed a stale 238-provider snapshot; the reviewed registry contains 270 visible entries | Compute the total and per-kind coverage server-side using visible registry entries and the same default chat classification as the provider UI |
| M09 | First-run native commands omitted required signing secrets and printed simulated startup success | Include documented environment setup, user-chosen initial password and loopback binding; remove fabricated success output |
| M10 | Docker generated an initial password inside the command without giving the visitor a value to type | Use an explicit user-chosen INITIAL_PASSWORD variable before container creation |
| M11 | Model resolver loops forever without Pause and its tabs lack roving keyboard behavior and panel relationships | Pause/resume, arrow/Home/End navigation, labelled panels and complete immediate manual examples |
| M12 | Integration links keep moving while keyboard users focus them | Focus pauses the track, with an explicit Pause/Play control for pointer users |
| M13 | Sample-session initialization failure offers reload text without a recovery control | Existing-layout error branch with Retry and documentation actions, preserving sample data |
| M14 | Public site has no sitemap or robots discovery, while simulated dashboard routes can be indexed | Public MDX sitemap, crawler policy and explicit noindex for preview/login/dashboard |
| M15 | Marketing search title only repeats the fantasy motto | Task-specific self-hosted AI gateway title in all six locales, preserving the approved hero motto |
| M16 | Default highlighted code keywords have 3.9:1 contrast on parchment reading surfaces | High-contrast Shiki token themes in both docs reading themes; no accessibility exclusion added |
| M17 | A previous successful demo-password copy remains labelled Copied when a later write fails | Clear stale confirmation before each attempt and announce failure beside the still-visible password |
| M18 | Earlier delayed clipboard promises can overwrite the newest result | Bind both copy controls to request generations and ignore completions after unmount |
| M19 | Quota SVG stroke animation can continue under reduced motion | Set the real quota arc in markup and use a zero-duration reduced-motion update |

Two additional browser-test failures were fixture errors, repaired in the tests: a sitemap assertion confused the legitimate `/docs/deployment/localhost` guide with a localhost origin, and an unscoped alert locator matched Next's route announcer as well as the demo error.

## Adversarial review

This is a mixed acquisition and reading target. Marketing and docs are T2 routes; the sample login simulates identity locally and does not qualify production authentication.

| Question | Evidence and decision |
|---|---|
| F1. What can be reused? | Existing home primitives, Lucide assets already used by docs, Fumadocs, the approved gate and production dashboard imports. No replacement design system or new dependency. |
| F2. Does it belong to this product? | PRODUCT.md and DESIGN.md retain the moonlit doorway, local fonts, silver type, emerald actions and parchment docs. The live dashboard keeps its own system. |
| F3. What was measured? | Baseline built site at 390×360 put the navigation bottom at 429px. Mobile docs at 390×844 hid the theme action. Regression checks measure the document width and interaction results after hydration. |
| F4. Is the next task clear? | Installation has prerequisites before startup, then provider connection, gateway key and a first request. The docs directory and article navigation remain intact. |
| F5. What should be iconized or hidden? | Font arrows and custom action paths became consistent library glyphs. Error guidance appears only after failure. The model preview keeps concise Pause/Play actions instead of instructions over the content. |
| F6. What was missing for a finished experience? | Accurate coverage, accessible keyboard tabs, short-screen navigation, copy failure feedback, sample-session retry and readable highlighted code. These are repaired directly. |
| Does every number have a source? | Live registry counts replace marketing snapshots. Quota examples remain explicitly labelled sample data. The RTK example still runs the actual filter on a sample list. |
| Are the promises the size of the proof? | Demo copy continues to identify mocked browser-local data. No live provider, savings, throughput, testimonials or new analytics claims were introduced. |
| Can a visitor finish without animation? | Existing static gate fallback remains. Reduced motion ends count/arc motion; tabs show full examples immediately on selection. The moving integration track has a pause control and focus pause. |
| Does the losing branch preserve work? | Copy controls retain readable commands/passwords. Demo retry preserves sample storage. No failed initialization is presented as a loaded dashboard. |
| Are documentation and private references separated? | Fumadocs and sitemap use the existing public docs collection; internal references and brand maintenance artifacts remain excluded from routes, search and asset copies. |
| Why preserve the overall composition? | The baseline already has a distinctive, approved brand and useful task structure. Replacing it would add risk without fixing these confirmed problems. |

## Scars

- Bound mobile navigation to available dynamic viewport height. A correct desktop header does not prove landscape navigation remains usable.
- Keep both copy controls bound to the latest request. A later failure must never retain an earlier Copied confirmation.
- Keep high-contrast code palettes when changing the parchment background. The default keyword red measured only 3.9:1.
- Derive registry counts in the server page. Importing registry transports into a client component would ship unrelated provider code.
- Public docs are English even when marketing is localized. Set and restore the actual reading language across navigation.
- Signing secrets are generated for setup and persisted by the operator. Documentation must not imply rotating them on every start.

## Detector calibration

The pinned Visant token fallback, Copy and Noise detectors now report zero findings on `website/src/components` and `website/src/app/docs`. Refine reports zero. The final run with the Node 20 tool path also ran Impeccable. All four detectors completed with zero findings, and the completed surface/screen report opened the Visant gate. Root lint and its existing anti-slop check remain required separately.

The approved hero's emerald italic ending has a written, local Visant exception. Slow decorative provider orbits remain intentional marketing motion and stop under reduced motion. The motion linter reports their three long durations plus the 1.6s noninteractive quota reveal as MEDIUM; it reports zero HIGH. Those values are not delays on controls or network feedback. No scanner baseline, third-party skill, policy or rule was weakened.

## Component coverage

The initial table classified routes before changes. This expanded inventory binds the final shared-component scan to each owning route. It does not claim a separate browser visit to a component with no route.

| File | Surface (A/B/C) | Business variable it moves | Notes |
|---|---|---|---|
| src/components/brand/BrandMark.jsx | A | Recognize the canonical doorway brand | Shared implementation in the route classification above |
| src/components/demo/DemoAuthGuard.jsx | C | Reach the simulated dashboard with a valid sample session | Shared implementation in the route classification above |
| src/components/demo/DemoBanner.jsx | C | Recognize browser-local sample data and find the site | Shared implementation in the route classification above |
| src/components/demo/DemoPasswordNotice.jsx | C | Sign in using the exact simulated password and copy it reliably | Shared implementation in the route classification above |
| src/components/demo/MockNetwork.jsx | C | Evaluate production components without provider calls | Shared implementation in the route classification above |
| src/components/docs/Hero.jsx | B | Start the documented gateway setup | Shared implementation in the route classification above |
| src/components/docs/PopularList.jsx | B | Find the most common documentation tasks | Shared implementation in the route classification above |
| src/components/docs/SearchTrigger.jsx | B | Find a public guide by query | Shared implementation in the route classification above |
| src/components/docs/SectionGrid.jsx | B | Choose a task-oriented documentation category | Shared implementation in the route classification above |
| src/components/docs/SidebarFooter.jsx | B | Return to home/demo and switch reading themes | Shared implementation in the route classification above |
| src/components/docs/StartRow.jsx | B | Complete installation then connection then a first request | Shared implementation in the route classification above |
| src/components/docs/ThemeToggle.jsx | B | Read guides in a persistent accessible reading theme | Shared implementation in the route classification above |
| src/components/home/flow/FallbackTiers.jsx | A | Understand the user-configured combo fallback order | Shared implementation in the route classification above |
| src/components/home/flow/FlowDiagram.jsx | A | Understand supported client-to-provider request paths | Shared implementation in the route classification above |
| src/components/home/flow/FlowSection.jsx | A | Locate routing documentation after inspecting the mechanism | Shared implementation in the route classification above |
| src/components/home/flow/ModelResolver.jsx | A | Inspect callable model shapes with keyboard and pause controls | Shared implementation in the route classification above |
| src/components/home/hero/Hero.jsx | A | Discover the gateway and open the real-component demo | Shared implementation in the route classification above |
| src/components/home/hero/HeroCanvas.jsx | A | Preserve usable install/demo actions with optional branded WebGL | Shared implementation in the route classification above |
| src/components/home/sections/Constellation.jsx | A | Identify supported provider authentication choices | Shared implementation in the route classification above |
| src/components/home/sections/DemoTeaser.jsx | A | Evaluate actual dashboard components before installing | Shared implementation in the route classification above |
| src/components/home/sections/DeployTabs.jsx | A | Choose and copy a complete installation method | Shared implementation in the route classification above |
| src/components/home/sections/Features.jsx | A | Find documentation for implemented gateway capabilities | Shared implementation in the route classification above |
| src/components/home/sections/FinalCta.jsx | A | Start installation or read its prerequisites | Shared implementation in the route classification above |
| src/components/home/sections/Footer.jsx | A | Find docs, package and source links | Shared implementation in the route classification above |
| src/components/home/sections/QuickStart.jsx | A | Reach a working authenticated first request | Shared implementation in the route classification above |
| src/components/home/sections/QuotaUsage.jsx | A | Understand account-specific quota views through labelled samples | Shared implementation in the route classification above |
| src/components/home/sections/ServiceKinds.jsx | A | Assess actual provider coverage by service kind | Shared implementation in the route classification above |
| src/components/home/sections/TokenSavers.jsx | A | Generate a truthful RTK compression example from sample input | Shared implementation in the route classification above |
| src/components/home/sections/TokenSaversView.jsx | A | Compare actual filter input and output before opting in | Shared implementation in the route classification above |
| src/components/home/sections/ToolsMarquee.jsx | A | Find a supported client setup guide without chasing moving links | Shared implementation in the route classification above |
| src/components/home/three/Beams.jsx | A | Retain the approved carved gateway identity and contrast | Shared implementation in the route classification above |
| src/components/home/three/Mist.jsx | A | Retain the approved optional gateway illustration | Shared implementation in the route classification above |
| src/components/home/three/Particles.jsx | A | Retain the approved optional gateway illustration | Shared implementation in the route classification above |
| src/components/home/three/Portal.jsx | A | Retain the approved opening doorway mechanism | Shared implementation in the route classification above |
| src/components/home/three/Scene.jsx | A | Pause optional rendering offscreen and preserve readable actions | Shared implementation in the route classification above |
| src/components/home/threeui/ThreeStage.jsx | A | Support mechanism diagrams without hidden content | Shared implementation in the route classification above |
| src/components/home/ui/Icon.jsx | A | Identify actions using consistent library glyph metrics | Shared implementation in the route classification above |
| src/components/home/ui/chrome.jsx | A | Discover docs/demo and navigate short screens by keyboard | Shared implementation in the route classification above |
| src/components/home/ui/primitives.jsx | A | Copy install commands with truthful feedback and bounded motion | Shared implementation in the route classification above |

## Independent integration review corrections

The integration owner opened the built site in the in-app browser and found two additional defects.

- M20. CountUp reset every metric to 0 after hydration while offscreen. It now retains the final value before entering view. An independent screen-reader value always contains the real number, while only the explicitly hidden visual copy may animate. Server-render regression proof pins the final value.
- M21. The closing CTA still copied a startup shortcut without signing secrets. It now displays and copies the exact complete first-run environment and npx command used by the setup guide. The clipboard browser scenario asserts visible and copied contents match.

The stable theme contrast check waits for finite theme transitions to finish before running Axe. The previous immediate check captured the 250ms light-to-dark transition itself. No Axe rule is disabled or excluded in the new marketing suite.

## Shared demo accessibility correction

M22. The iframe's production Endpoint MonitoringStrip provider-health table overflowed horizontally on phones, but its wrapper could not receive keyboard focus. The integration owner extended ownership to this exact source line. The wrapper now has `role="region"`, `aria-label="Provider health"` and `tabIndex={0}`. The new unit test loads fixture provider-health data and focuses the real component. The built-iframe check also focuses the region and runs Axe. No website DOM mutation or source-rewriting adapter was added.

## Skill source

Applied [Visant Killer](https://github.com/pedrojaques99/visant-skills-public/blob/fe555cfdeb405799db51ca52468079512c9adc1a/visant-killer/SKILL.md), Frontend, Motion, Refine, Copy and Preflight at commit `fe555cfdeb405799db51ca52468079512c9adc1a`. The English product voice and approved brand take precedence over Visant's agency-specific Brazilian Portuguese voice.

## Final verification receipts

- `npm --prefix website run build`: pass. The production build generates 108 routes including the 73 public docs pages, crawler policy and sitemap.
- `node tests/node_modules/vitest/vitest.mjs run --config tests/vitest.config.js tests/unit/visant-marketing-docs.test.js tests/unit/website-home-i18n.test.js tests/unit/website-brand-canvas.test.js tests/unit/website-public-brand.test.js tests/unit/website-docs-entrypoints.test.js tests/unit/website-demo-password.test.js tests/unit/website-marquee-accessibility.test.js tests/unit/website-gate-geometry.test.js tests/unit/website-gate-opening.test.js tests/unit/website-account-mocks.test.js tests/unit/website-mock-contract.test.js tests/unit/docs-claims-check.test.js tests/unit/check-docs.test.js --maxWorkers=2`: 89 passed, 13 files.
- From `website/`, `DOCS_BASE_URL=http://127.0.0.1:3100 WEBSITE_CHROMIUM_EXECUTABLE=<installed-headless-chromium> node node_modules/@playwright/test/cli.js test tests/marketing.spec.mjs tests/docs.spec.mjs --config playwright.config.mjs`: 15 passed in 2.1 minutes. The complete 73-doc route sweep returned 200 with no recorded console errors. The new Axe pass uses no exclusions, checks both reading themes at 1440px and 390px, and passes the embedded table keyboard check.
- `node scripts/check-docs.mjs`: pass.
- From `website/`, `node --import ./scripts/register-alias.mjs scripts/mock-smoke.mjs`: five scenarios pass, 298 mock routes registered, zero missing or failed checked routes.
- Pinned `killer-scan.mjs --report internal/docs/audits/marketing-visant-2026-10-29/README.md website/src/components website/src/app/docs`: all four detectors run with zero findings, gate open. Refine also returns zero findings.
- `git diff --check`: pass.

All repo commands used Node 20.20.2 with npm 10.8.2. The preview remains at port 3100 for independent review. Screenshots are local review evidence under `/tmp/durindoor-marketing-visant-screens`, with desktop/mobile index and installation captures in both reading themes. They are not published website assets. The integration owner independently inspected the built homepage and installation docs in the in-app browser, and the two review corrections are recorded above.

The distribution side-gate on first-party `website/src` reports zero HIGH. Its two route-title notices are false positives: the client preview and login pages have route-specific metadata in their immediately adjacent layouts, and the built pages prove those values. A broad post-build scan of `website/` additionally flags the copied Monaco HTML worker as an unmeasured lead form. That is third-party editor code, not a site form or conversion. No analytics were added to silence it, and no scanner baseline or external rule was changed. The existing site has no lead collection or checkout flow.

This evidence is Chromium source/fixture/built-site verification. It does not prove real provider access, deployed behavior, production auth, or a full-repository checkpoint. No branch was pushed, merged or deployed by this task worker.
