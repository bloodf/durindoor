# Dashboard review workflows

These components run in the v5 Storybook review. They do not change gateway
configuration, credentials, compression settings, provider quotas or usage data.

`TokenSaverDashboard` separates monitoring from the existing compression settings
route. Its nine widgets preserve the aggregate period stream, RTK bytes, Headroom
token delta and skip reasons, actual byte reduction, image token estimates, PXPIPE
status, five savings windows, 30-day timeline, history pagination and transform
logs. Actual bytes and estimated tokens remain separate measurements. Stream and
activity failures retain the last received snapshot and provide a retry action.

`WorkspacesPage` lets users create, select, rename and delete named dashboards.
The final dashboard cannot be deleted. The library combines the real Usage,
Token Saver and ProviderLimits components, plus a flat source-derived monitoring
widget retaining runtime, activity, latency and storage measurements. One shared
Dashboard period controls Usage and aggregate Token Saver queries; PXPIPE retains
its own five supported time windows. Monitoring retains its 10-second live poll,
pause and refresh actions without embedding another page header. Switching dashboards reads
back each dashboard's saved layout. Unknown saved widget identities remain visible
with replacement guidance rather than disappearing silently.

Usage also reports refresh and live-stream failures when its period controls are
hosted by the dashboard. Retained totals identify their actual previous period
until the new snapshot arrives; Retry reloads the selected period. Closed streams
cannot update the current dashboard.

`DashboardCanvas` edits a draft: drag with a pointer or keyboard, use move buttons,
rename, choose width, hide or restore widgets, and reset the draft to defaults.
Save commits these preferences; Cancel restores the prior saved layout. The empty
layout opens the widget library directly. The existing Usage dashboard retains
its original layout component and storage key.

Persistence is opt-in and uses only `durindoor:v5-review:` browser storage keys.
Named dashboards use `durindoor:v5-review:workspaces:v1`; Token Saver uses
`durindoor:v5-review:token-saver-layout:v1`. Storage failure keeps the current view
and reports that persistence was unavailable. Named CSF scenarios disable storage
so interaction checks are deterministic.

Tests in `tests/unit/v5-dashboard-builder.test.js` cover preference reconciliation,
draft save/cancel, hidden and unavailable source recovery, multiple dashboards,
blocked storage, and aggregate/PXPIPE lifecycle behavior. Story plays additionally
exercise complete source metrics, period controls, refresh, pagination, creating
and composing a cross-source dashboard, switching to read it back, and deletion
confirmation. This does not claim every backend failure state is enumerated.

Visant repair contracts (October 2026): named dashboards retain independent
unfinished editing sessions across dashboard selection, including draft names,
widths, order and visibility. Save and Cancel remain the commit boundary. Hidden
Usage, aggregate Saver and PXPIPE sources stop their subscriptions; a monitoring-only
or blank canvas does not fetch unrelated resources. Enabling a widget reconnects
its source, and stale retained snapshots identify refresh failures.

PXPIPE loading, initial failure, successful-empty and retained-data refresh errors
are distinct per resource. A raw-event outage does not erase savings or produce a
false empty message. Estimated image tokens remain separate from actual bytes.
Compression settings show accepted values until each PATCH succeeds; pending
controls block duplicates, rejected drafts roll back and expose an explicit Retry.
Console Streaming/Polling labels follow actual transport outcomes, while Pause
freezes the display during both SSE and polling; failed Clear retains output.

`v5-visant-dashboards.test.js` adds behavioral checks for rejected/pending settings,
independent health failure, quota failure/retry, PXPIPE initial and partial
failures, monitoring request ordering, console fallback and frozen output,
source selection, and retained dirty dashboard sessions. Source stories add
corresponding recoverable failures and delayed-loading examples.

The integrated main branch moved live Monitoring into Usage. Review Usage now
retains that complete source-backed monitoring surface as an eighth editable
widget in addition to its seven original widgets, including runtime active
requests and recorded provider health. Its measurements are independent of the
selected historical Usage period.
