# Visant audit repairs

These changes address the confirmed audit findings. V5 page compositions remain isolated in Storybook until visual acceptance. Shared request handling fixes preserve the production API contracts. Marketing and public documentation repairs are in a separate branch and PR.

## Request and workflow outcomes

| Finding | Repair | Regression evidence |
|---|---|---|
| W1 | Provider and media switches confirm account writes, retain rejected accounts and expose read-back recovery | Workflow request tests and provider pending/partial/rejected stories |
| W2 | Proxy pools, media providers, MCP and CLI distinguish failed or malformed reads from empty configuration | HTTP, transport, malformed-response and retry stories; workflow and system boundary tests |
| W3 | MCP credential errors remain visible with retry | Source MCP key failure stories |
| W4 | Combo allow-list changes retain the draft after rejection | Direct rejected-clear/retry regression |
| W5 | Key deletion waits for confirmation and keeps the dialog open after rejection | Pending and rejected revoke stories |
| W6 | MCP credential minting awaits completion and blocks repeated submission | Direct pending/rejected submit tests |
| W7 | Combo timeout commits on Enter or blur; whole-map writes serialize; failed drafts remain editable | Early-clear, ordered-save, rejected-save and retry tests |
| W8 | Endpoint settings remain unavailable until their reads succeed | Status/settings failure and retry stories |

## Dashboards and live data

| Finding | Repair | Regression evidence |
|---|---|---|
| D1 | Token Saver settings confirm PATCH responses before showing saved state | Pending/rejected/retry settings tests and stories |
| D2 | Quota retains accepted lists on failure; unknown first-load counts stay hidden | Initial failure and retained-list regressions |
| D3 | Console transport exposes connecting, streaming, polling and unavailable states | Transport lifecycle tests and source stories |
| D4 | Paused console preserves the upstream frozen snapshot; rejected Clear remains visible | Pause and clear regressions |
| D5 | PXPIPE distinguishes loading, error and empty data for each resource | Source-specific failure/loading tests and stories |
| D6 | Monitoring reports unknown before a confirmed snapshot and retains old measurements after failure | Monitoring loading/error/refresh tests; the upstream production redirect to Usage remains intact |
| D7 | Health reads fail independently without false zeroes or unavailable-service conclusions | Per-source failure stories |
| D8 | Timeline reflects disconnected, retrying and live states | Reconnect source story and transport tests |
| D9 | Hidden widget sources stop subscriptions; enabling a source keeps the dashboard editor mounted | Hidden-source and editor-remount regressions |
| D10 | Switching personal dashboards retains each unsaved editing session | Dirty-layout switching tests and story |

Scrollable provider-health tables in Usage and Endpoint expose named keyboard focus regions. The login emblem retains its artwork with an explicit DurinDoor logo explanation and reduced-motion support.

Usage includes all seven original widgets plus the runtime-monitoring widget added upstream. Token Saver retains all nine widgets. Personal dashboards retain cross-source composition, visibility, order, width, names and saved layouts. Combos now also retains the connection-usage report introduced upstream.

## Shared system and review navigation

| Finding | Repair | Regression evidence |
|---|---|---|
| S1 | Profile blocks policy editing until a confirmed non-null settings object loads | Loading, failed-read, null and recovery tests/stories |
| S2 | Database timestamps advance only after successful reads; mutations force fresh read-back and invalidate older polls | Unknown/recovery and pending-poll/cutover/stale-response regressions |
| S3 | Search-prefix glyphs receive pointer help, including portaled dialogs outside the story canvas; clicking them still focuses the input | Icon-help regression and browser pointer check |
| S4 | Translator renders decoded chunks immediately, supports cancellation and retains partial responses after failure | Incremental UTF-8, cancellation, transport-failure tests; cancelled and capture-save-failure stories |
| S5 | Auto-configure exposes initial status failures and read-only retry | Status recovery regression and story |
| S6 | Authored ButtonIcon identity survives minification, preventing inferred duplicate icons | Stable-name/minified-name and one-glyph regression |
| S7 | Locale flags retain their artwork instead of becoming another globe; icon help and reduced-motion rules remain | Locale metadata and browser icon checks |
| S8 | A page with its own heading owns the title; the shell keeps navigation, breadcrumbs and global tools | Shared heading rule and rendered page review |
| R1 | Quota filters use fixture-aware Next navigation instead of rewriting the real host pathname | Quota navigation and virtual-router checks |
| R2 | Compression settings uses Next Link and stays within review navigation | Dashboard-to-settings navigation check |
| R3 | Provider titles reserve a permanent trailing action lane | Provider card layout and browser geometry checks |

## Inventory and qualification

`node scripts/sync-storybook-inventory.mjs --write` reconciles exact source hashes, renamed story identities and the current built catalog. It retains unchanged source approvals and demotes changed evidence to pending review, preserving its history. It cannot grant approval or runtime qualification.

Inventory mode validates these pending associations. Final coverage still rejects pending review and requires the existing exact-head runtime, browser, accessibility and artifact evidence. A passing inventory or catalog smoke run does not close that stronger gate. Fresh command results and exact-head full CI receipts are recorded in the PR; visual acceptance remains with the reviewer.
