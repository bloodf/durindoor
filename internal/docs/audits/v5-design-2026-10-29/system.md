# Shared system, access, settings and tools audit

Audit head: `250a42caaac957098cc46c0618cf6b78d8539df7`. Read-only source audit. No product files changed. Runtime screenshots and interaction measurement are owned by the main audit; this report identifies its screenshot corroboration explicitly and does not claim an independent full visual pass or measured jank.

Applied Visant Motion (all instructions plus motion-rules reference), Visant Copy (all instructions and English reference), and Killer slop catalog. Existing Durin DS semantics and actual doorway/provider brand marks are the baseline. Visant’s own cyan palette, font stack, Portuguese client copy, and house components are not imported into this app.

## Surface inventory and business variable

| Surface | Class | User task / business variable | Current review path |
|---|---|---|---|
| Shared authenticated shell, sidebar, header, language/theme/menu | B work | Reach the correct operational task quickly, retain orientation | Production shell inside ReviewFrame, animated SVG boundaries |
| Shared fields, input, select, checkbox, switch | B, C when writing settings | Complete an accurate draft with fewer corrections | Existing primitives, native select adapter in review |
| Shared dialogs, confirmation and password prompts | C trust | Make reversible changes and deliberate destructive operations | Native dialog and focus trap retained |
| Login, password rotation, MFA, OIDC, rate lockout | C trust | Authenticate successfully without losing recovery paths | ReviewLoginView and GateScene plus source login handlers |
| First-use/default-password guidance | A orientation, C access | Reach a usable authenticated workspace | Existing login branches; no separate new onboarding funnel is implemented |
| Settings General, appearance and language | B work | Configure device preferences | Profile source page with review styles/icons |
| Settings model exposure lists | C trust | Expose intended models while keeping policy understandable | Profile General tab |
| Security, password, MFA, OIDC | C trust | Preserve administrator access | Profile Security tab and preservation scenarios |
| Routing defaults and model auto-update interval | C trust | Apply intended routing and discovery policy | Profile Routing tab |
| Network/proxy/Firecrawl | C trust | Correct upstream connectivity | Profile Network tab |
| Observability, retention, cleanup, backup import/export, shutdown | C trust | Operate without accidental data loss | Profile System & Data; preservation dialogs |
| Database engine, test, cutover, rollback | C trust | Keep a truthful view of the active engine and recovery state | Source database settings page plus preservation scenarios |
| Playground conversation, session history, model/connection/effort selector | B work, C provider request | Inspect model behavior and retain conversation work | Production PlaygroundPageClient review wrapper |
| Translator editor and execution steps | B work, C live send region | Diagnose protocol shape and inspect outcomes | Production TranslatorWorkspace review wrapper |
| Auto-configure current status and dry-run preview | B work | Understand planned setup changes | Source AutoConfigureClient wrapper |
| Auto-configure apply | C trust | Apply intended local configuration | Same component, explicit dry-run flag |
| Compression/Test Savers input, presets, results | B work | Compare compression results and choose a suitable engine | Source compression studio with review model picker |

## Confirmed source defects and requirement gaps

### P1. Failed settings discovery becomes editable false/default settings

- Evidence: `src/app/(dashboard)/dashboard/profile/page.js:120-145`.
- Initial state only contains `fallbackStrategy: "fill-first"` (line 68). Fetch never checks `res.ok`. Network rejection only logs and clears loading; no screen-level error or retry state is stored. A non-OK JSON response is assigned as settings.
- Consequence: server failure is visually presented as apparently loaded off/empty policy values, and controls become editable. Security switch reads `settings.requireLogin === true` at line 935, making an unknown value look like Off. Model exposure lists likewise appear to be loaded defaults.
- Visant rule: Killer 12, error collapsed into empty/default. This is correctness of a trust surface, not a taste complaint.
- Next implementation: explicit settings load status; check HTTP status; keep controls unavailable until a valid snapshot exists; show retry in the existing layout, retaining a prior snapshot after later failures. Add first-load network/HTTP failure and recovery stories. Existing OIDC and retention failure stories do not exercise initial settings discovery.
- Evidence boundary: source-confirmed; no backend calls or credentials used in this audit.

### P2. Database “Last refresh” reports render time rather than successful data time

- Evidence: `src/app/(dashboard)/dashboard/settings/database/page.js:161` renders `new Date().toLocaleTimeString()`.
- Refresh logic at lines 33-52 retains existing status on failed polling and sets an error, but records no successful-update timestamp. A failed refresh changes state and rerenders a fresh “Last refresh” time beside old status.
- Consequence: the operator cannot tell how stale the active-engine snapshot is. On a cutover/rollback surface that date is operational data.
- Next implementation: record lastSuccessfulRefresh only after valid response; show stale status and the last successful time; clear the previous load error on a later successful refresh. Add success → poll failure → recovered poll story.

### P2. Leading field icons cannot receive the requested pointer tooltip or animation

- Evidence: `src/shared/ui/components/Input.jsx:67` sets `pointer-events-none` on the leading-icon wrapper. `src/shared/components/Header.js:400` does the same for header search.
- The v5 glyph boundary preserves those classes. `src/shared/ui/v5/motion/ReviewIconHelp.jsx:62-68` requires a pointer event target inside the actual icon; the special enclosing-field lookup exists only for keyboard focus. MotionIcon attaches pointer listeners to the icon host and an enclosing button/link, not a text field.
- Consequence: hovering the search glyph hits the underlying field, so that icon cannot trigger its explanation or animated response. Keyboard focus help remains supported.
- Next implementation: restore hit testing only on the actual glyph in review, preserve click-to-focus behavior, and prove icon hover vs input-text/blank-space hover independently. Do not restore whole-row tooltips.
- Evidence boundary: source-confirmed event-path gap; the main audit can corroborate with a pointer screenshot.

### P2. Translator hides streaming output until the stream completes

- Evidence: `src/app/(dashboard)/dashboard/translator/TranslatorWorkspace.jsx:192-197` accumulates chunks in local `full` and calls `setContent(5, full)` only after EOF. The send region has no cancellation action (`getAction` at line 210).
- Consequence: a slow or stalled provider looks like one long pending Send; useful partial output is invisible and there is no stop action in this surface. The app already demonstrates stream-and-stop behavior in Playground, so this is an inconsistent process.
- Visant Motion waiting-state rule: streaming partials are the result surface; a long unknown wait needs an out.
- Next implementation: open response on first chunk, incrementally paint content, preserve partial text on error, offer Stop, and identify cancelled vs failed vs complete. Add slow-stream, midstream error and cancel scenarios. Preserve protocol diagnostics and raw data.
- Evidence boundary: current UI behavior follows directly from source; no live provider invocation performed.

### P2. Auto-configure loses the initial status failure

- Evidence: `src/app/(dashboard)/dashboard/auto-configure/page.js:22` catches status discovery to `null`. `src/app/(dashboard)/dashboard/auto-configure/AutoConfigureClient.js` renders current status only for truthy `status`, and its error state only tracks the later POST run.
- Consequence: failed initial status discovery looks like no status section, without a reason or retry. The user may apply changes while the current setup could not be assessed.
- Next implementation: represent unavailable current status explicitly, expose retry/check status, keep a prior snapshot if one exists. Add initial status-unavailable story separately from Run Failure.

### P2. Existing icon detection breaks after bundling and adds a second plus

- Browser corroboration from main audit: `screenshots/providers-light-desktop.png`, 1280px light. Both Add Anthropic Compatible and Add OpenAI Compatible visibly show two plus glyphs.
- Authored caller has one icon only: `src/app/(dashboard)/dashboard/providers/page.js:464-479`.
- Root cause: legacy `src/shared/components/Button.js:43` defines ButtonIcon without stable metadata. `.storybook/review-button-boundary.mjs` wraps its native button. `src/shared/ui/v5/motion/ReviewNativeButton.jsx:9-14` decides whether an icon exists by `child.type.displayName || child.type.name`, then regex matches Icon. In minified built Storybook, a renamed local ButtonIcon loses that recognition, so lines 19-22 infer a second add from the label. Tests presently use named/stable icon fixtures and raw SVGs, missing this built artifact behavior.
- Next implementation: explicit stable icon ownership metadata at the AST boundary or primitive boundary; do not rely on minifiable function names. Verify exactly one leading glyph in the built artifact, with original legacy ButtonIcon + label and loading + trailing-icon variants.

### P2. The language boundary converts two different marks to the same globe

- Main audit observed Monitoring English trigger with two globe symbols.
- Authored `src/shared/components/LanguageSwitcher.js:116-118` has one language glyph, English label and locale flag.
- `.storybook/main.js` marks the flag span `data-icon-name="language"`; `review-glyph-boundary.mjs` converts that span to ReviewGlyph. Both the authored language glyph and transformed flag now map to GlobeIcon (`animatedIconCatalog.js:327`). This is separate from inference/minification above.
- Next implementation: preserve the country/locale mark or use a single animated language symbol. Do not silently replace state-bearing locale data with an identical duplicate. Add a built-language-trigger assertion.

## Confirmed design-system composition issue

### P2. Shell and page both introduce the same place

- Evidence: `src/shared/components/Header.js:217-228` supplies Settings and Translator titles/subtitles; its common rendering at lines 349-365 paints that chrome. Profile additionally paints Settings at `src/app/(dashboard)/dashboard/profile/page.js:891-893`. Translator paints Translator Debug at `TranslatorWorkspace.jsx:214`. Auto-configure likewise has its shell title and `AutoConfigureClient.js` PageHeader.
- ReviewFrame composes the actual shell above these page headers (`src/shared/ui/v5/ReviewFrame.jsx:71`), adding a review bar between them. This is not fixed by source reuse.
- Consequence: repeated title, subtitle, icon tile and review chrome consume first-fold space before task controls, reproducing the user’s complaint of too much text. Settings vs Translator/Translator Debug also use differing names between layers.
- Visant Killer 4 and 27: the shell owns orientation; pages should add task-specific actions and context once.
- Next design pass: choose one page identity owner, keep breadcrumb/title in shell, move primary actions/period/status to a compact page toolbar. Component-only stories already bypass the shell and should retain that safeguard. Do not simply remove the only semantic h1: consolidate ownership correctly.

## Motion findings, calibrated

Tool run: Visant `motion-lint.mjs` over shared UI/components, login, profile, playground, translator, auto-configure, compression-studio. Output `system-motion.json`: 5 HIGH and 39 MEDIUM raw candidates. These are not 44 accepted defects.

Accepted actionable source candidates:

- Sidebar width animation at `src/shared/components/Sidebar.js:223` runs layout on collapse and moves all adjacent workspace content. `transition-[width,colors]` includes the non-property `colors`; use explicit color properties. Review also uses this component. This is a performance-risk candidate, not measured jank. Prefer instant width settlement or a FLIP/transform passage with a stable task region; verify actual frames before assigning runtime severity.
- No shared timing/easing token owner found across JS and CSS. Examples: `AnimateButton.jsx:10` has 0.16, `MotionIcon.jsx:59` has 0.45, `review.css:147` hardcodes 180ms plus a cubic curve, and globals carries independent entry curves. Consolidation is P3 cohesion work. Do not blindly shorten icon choreography or the purposeful doorway scene to satisfy a regex.
- Tooltip opens immediately on every new icon (`ReviewIconHelp.jsx:82-95`) rather than delaying first entry and skipping delay between adjacent icons. With many dense capability icons this can flash help during pointer travel. P3 proposed feel improvement; validate timing in browser first.

Rejected / calibrated candidates:

- `duration: 0` in DashboardLayout story is notification lifetime, not motion.
- `src/shared/ui/pages/...` prototype UI is not automatically evidence of an active v5 route.
- GateScene is intentionally long 3D identity motion, not a slow button response. It pauses under reduced motion, hidden document, and user pause; it cleans WebGL resources and has a static fallback. Keep.
- All icons animated is an explicit user requirement. Visant’s default high-frequency-motion ban cannot override it. Keep animation on intent, bounded, with reduced-motion handling; do not remove icons or silently make them static.
- Generic transition-all hits in a color-only context are LOW, not automatic broken interactions.
- Actual provider logos are identity data, not synthetic-cover slop.

## Existing safeguards worth retaining

- Native showModal top layer, body scroll-lock count, nested-dialog stack, visible/enabled focus trapping, Escape ownership, pending dismissal lock and opener restoration in Modal.
- Select portal is hosted inside the closest dialog, position is viewport-clamped, options carry disabled and selected semantics, active descendant is separate from selection, and keyboard navigation/typeahead is present.
- Native select adapter preserves name/form/required through a hidden native successful control and leaves multi-select native. This should not be replaced with a generic div menu.
- Field/Input/Checkbox propagate error and hint IDs; labels and required controls have real native associations.
- Shared controls retain 44px targets; dense visual switch/checkbox size is not itself a small target defect.
- Tooltip is in browser top layer, tracks input modality, preserves authored accessibility metadata, clamps to viewport, supports popup hover, and deliberately excludes Close/Save.
- Distinct Monitoring Activity and Timeline History animated icons are present in current catalog. The old duplicate-nav screenshot is not a current finding.
- Brand marks are actual site artwork. Green/neutral review tokens and body-scoped portals preserve the requested palette. Do not “correct” these to Visant’s own brand.

## Copy and UI proposals (not applied)

Visant copy-lint produced 43 raw occurrences across 254 files in the scoped invocation (`system-copy.txt`). Many are archived prototype sentences or documentation, and do not establish visible active UI defects. Numeric range `1–5 of 7` is a functional range, not AI marketing prose; do not churn it. Metadata separators carry less cost than repeated paragraphs. Follow user priority: controls and hierarchy first.

| Location | Before | Proposed UI/copy | Why |
|---|---|---|---|
| Profile routing, line 948 | Two independent-looking Round Robin and Cache Affinity switches for the same exclusive fallbackStrategy | One strategy segmented choice: Priority / Round robin / Cache affinity; conditional sticky input | Shape the control to mutually exclusive data, preserve all behaviors |
| Profile routing footer, line 948 | Long “Currently…” paragraph repeats the chosen switch/limit | Compact selected strategy summary with on-demand details | Reduce repeated narration, maintain explanatory content |
| Auto-configure run region | Preview changes before applying them, while Dry run is initially false | Primary Preview action, explicit Apply action after review | Trust-surface proposal: align action sequence to promise; do not remove direct-apply capability without acceptance |
| Compression model region, page lines 96-98 | Model selector button plus separate model-ID input | One editable model combobox with a catalog icon action | Keep both manual IDs and catalog discovery in one understandable control |
| Combo strategy labels | Fallback — try in order, Round Robin — rotate | Short visible strategy labels; descriptive per-option detail on demand | Less dropdown text; existing strategy descriptions remain accessible |
| Login | Enter your password to access the dashboard | Password field and Sign in button carry the task; keep recovery/lockout notices | Remove instruction that repeats the field, preserve essential security state guidance |

## Required validation after any implementation

Profile: network/HTTP discovery failure → retry → saved values, no editable fake defaults. Database: successful snapshot → failed poll, timestamp remains truthful → recovery. Translator: partials visible, cancel works, partial output retained on failure. Input prefix: hover glyph explains and animates; hover label/row/blank input does not show that tooltip; keyboard and touch still work. Shell: one task identity/h1, preserved action placement at mobile width. Run both themes plus keyboard, reduced motion and the existing modal/select preservation checks. Those are acceptance gates, not results asserted by this source audit.

## Scanner provenance clarification

The scoped standalone motion/copy runs above invoked scripts from the pinned downloaded tree under `/Users/heitor/Documents/Codex/visant-design-audit-2026-10-29/`, not the killer wrapper’s ~/.claude fallback. Root killer log’s Impeccable invocation failed and should be marked unavailable rather than counted as ten design defects. None of this report’s accepted findings depends on those raw fallback counts. Active motion priority is streaming wait/cancel, then measured sidebar passage, then shared token consolidation. No active copy-only defect outranks the interaction and state defects above; style proposals remain separate, consistent with Visant Copy’s rule zero.
