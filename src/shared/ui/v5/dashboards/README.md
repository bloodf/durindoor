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
