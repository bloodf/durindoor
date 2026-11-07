# Visant dashboard design audit

Date: 2026-10-29. Scope: source review on `codex/v5-admin-storybook`, including production components reused by the v5 Storybook transforms. No product edits. These are source-confirmed behavior findings, not claims of a fresh visual/browser acceptance pass.

**Diagnosis:** The widget inventory is now substantially preserved, but several dashboards still present missing or failed measurements as valid empty, healthy or saved states.

## Surface classification

| Route / region | Class | Business variable | Persuasion present / verdict |
| --- | --- | --- | --- |
| `/dashboard/usage` overview, topology, grouped usage, logs/details | B | Time to attribute traffic, errors and spend | None needed; measurements and investigation actions are the product |
| Usage reset dialog | C | Avoid unintended loss of historical usage | Irreversibility copy belongs here; a plain toolbar reset still needs deliberate treatment |
| `/dashboard/monitoring` | B | Time to identify gateway runtime failures | None; do not claim Online before a snapshot exists |
| `/dashboard/timeline` and trace detail | B | Time to isolate a failing routing hop | None; current URL-only filters impose technical work on the operator |
| `/dashboard/quota` | B | Time to select viable accounts before depletion | None; configuration or load failures must not masquerade as zero connections |
| Quota connection deletion, reset credits, account state writes | C | Prevent account loss or accidental consumption of reset credits | Explicit scope/irreversibility belongs here |
| `/dashboard/health` | B | Time to identify an unreachable provider or compression dependency | None; unknown, loading and empty require separate treatments |
| `/dashboard/console-log` | B; clear is C | Time to find the relevant failure without losing output | None; streaming and paused must describe actual transport behavior |
| `/dashboard/token-saver` | B | Decision quality about actual byte reduction versus estimated token savings | None; actual and estimated values must remain separate |
| `/dashboard/token-saver/settings` | C | Correct, recoverable compression configuration | None; optimistic controls must reconcile failed writes |
| `/dashboard/workspaces` | B; layout/name/delete writes are C | Investigation speed through reusable operator-selected dashboards | None; chrome should follow edit state and preserve unfinished work |

## Existing pieces to reuse

| Need | Exists at |
| --- | --- |
| Charts | Recharts 3.9.2 in root package.json; `src/shared/ui/v5/usage/ReviewUsageChart.jsx`, `dashboards/SaverWidgets.jsx`, `dashboards/PxpipeWidgets.jsx` |
| Chart empty/error/loading | ReviewUsageChart explicitly separates all three; SaverWidgets has retained snapshot and previous-period feedback; no single shared ChartState wrapper discovered in the inspected dashboard compositions |
| Chart tooltip | `src/shared/components/chartTooltip.js` |
| Table and pagination | `src/shared/ui/components/DataTable.jsx`, `Pagination.jsx`, `src/shared/hooks/usePagination` |
| Card, metric, status, control primitives | `src/shared/ui/components/{Card,StatCard,StatusDot,SegmentedControl,Select,Toggle,Input,Button,Modal}.jsx` |
| Widget editor and keyboard DnD | `src/shared/ui/v5/dashboards/DashboardCanvas.jsx` and `src/shared/ui/v5/usage/UsageWidgetLayout.jsx` |
| Layout identity / reconciliation | `src/shared/ui/v5/dashboards/model.js` and `src/shared/ui/v5/usage/layout.js` |
| Tokens | `src/shared/ui/tokens.css`, existing `--dd-*` complete color values; bare `var(--dd-accent)` is correct here |
| Animation / reduced motion | `src/shared/ui/v5/motion/MotionIcon.jsx`; common CSS reduced-motion handling; not a reason to invent a second chart/metric family |

## Confirmed findings

Severity below uses ordinary bug priorities: P1 materially false saved/operating state; P2 localized workflow or feedback defect. The Visant critique calls correctness findings its highest category; that category does not imply a production incident or P0 urgency here.

### D1 — P1: Compression settings can display rejected writes as saved

- Evidence: `src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.jsx:137` changes Caveman state before calling PATCH and ignores the result. Headroom enable/URL at lines 142–153 and Ponytail at 286–293 do the same. PXPIPE minimum size, timeout and allowlist similarly update accepted state before an unchecked PATCH at lines 383, 395 and 426. `patchSetting` returns unsuccessful responses/null without surfacing an error at line 111.
- Behavior: a 400/500/network failure leaves the switch, level, URL or numeric value showing the new configuration although the gateway kept the old configuration. RTK silently refuses to change and PXPIPE-enable alone rolls back, so identical-looking controls have three different save semantics.
- Visant rule / variable: “UI must not lie to the database”; correct operator configuration and confidence in compression behavior.
- Fix: keep the prior accepted value, expose pending per setting, inspect the PATCH result, rollback on failure and show a nearby retryable inline error. Reuse Input `error`, Button and the existing error styles. Add failing PATCH stories per setting family, not just unavailable daemon stories.

### D2 — P1: Quota load failure is converted into “No Providers Connected”

- Evidence: `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/index.js:788` catches `/api/providers/client` failure, clears connections/options/totals and returns `[]`; line 1528 then renders the ordinary empty state.
- Behavior: initial 503 and a real zero-provider response appear as the same state. A failed refresh removes the last valid accounts from the view and recommends connecting providers instead of retrying the fetch.
- Visant rule / variable: separate empty/error/loading; preserve decision quality about available capacity.
- Fix: introduce a connection-list error distinct from per-account quota errors. Retain the last list on refresh failure, mark it stale, provide Retry. Only render the zero-connection setup state after a successful empty response. Source-backed Storybook must include this failure, not only per-account usage endpoint errors.

### D3 — P1: Console transport failure still reports “Streaming”

- Evidence: `src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js:97` derives status only from `paused`; line 107 treats `logs=[]` as a confirmed no-logs result. `src/app/(dashboard)/dashboard/console-log/transport.js:45` and line 88 only console-log transport errors; there is no UI status/error callback.
- Behavior: a failed initial GET followed by failed SSE/polling shows a successful green Streaming label and “No console logs yet.” The operator cannot distinguish a quiet gateway from an unavailable log stream.
- Visant rule / variable: absence must carry its actual meaning; incident investigation time.
- Fix: surface connecting/streaming/polling/reconnecting/unavailable status through the existing transport callback contract, preserve stale logs with a timestamp and show Retry. Add initial GET failure, SSE fallback, repeated polling failure and recovery stories.

### D4 — P2: Paused console updates resume implicitly during polling fallback

- Evidence: `src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js:62` guards SSE messages with `pausedRef`, but `onSnapshot` at line 73 always calls `setLogs`. The transport switches to polling at `src/app/(dashboard)/dashboard/console-log/transport.js:53`; poll interval is 1000ms in `src/shared/constants/config.js:58`.
- Behavior: click Pause, then operate under polling fallback: new snapshots replace the supposedly frozen output and the auto-scroll effect moves it to the bottom. Clear can also fail silently at ConsoleLogClient.js:54, leaving no feedback near the action.
- Visant rule / variable: control shape/state must match the operation; preserve the operator's reading position.
- Fix: apply the pause contract consistently to snapshots and events (buffer if needed); show clear pending/failure and offer retry. Add Pause + fallback + arriving-lines scenario and failed-clear scenario.

### D5 — P2: PXPIPE claims “no savings / events” before it knows

- Evidence: `src/shared/ui/v5/dashboards/PxpipeWidgets.jsx:196` selects the chart empty state from absent `stats` without checking loading/error; line 225 says “No savings recorded yet — enable PXPIPE…”. Raw events similarly render “No transform events yet” at line 279 from `logs=null`. The broad error at line 116 does not prevent those local false claims.
- Behavior: slow initial fetch, initial 503, successful empty data and disabled pipeline all share empty-content claims; an error banner can coexist with advice to enable an already enabled pipeline. With stats successful/logs failed, the banner inaccurately lumps all activity together.
- Visant rule / variable: empty/error/loading are three distinct states; correct interpretation of compression effectiveness.
- Fix: track status per resource. Reuse the state structure in ReviewUsageChart: measured-height skeleton, local error + Retry, successful empty state only after success, retained data with explicit stale feedback. Add all-PXPIPE-loading, stats-only failure, logs-only failure and recovery stories.

### D6 — P2: Monitoring renders “Online” and zero activity before first response

- Evidence: `src/app/(dashboard)/dashboard/monitoring/page.js:113` uses `error ? Error : Online`, ignoring `loading`/`data`. `formatNum` at line 197 maps missing measurements to “0”. Its load handler at line 20 does not set loading true for later refreshes and has no epoch/abort guard.
- Behavior: a slow initial request briefly declares a healthy online gateway with zero measured activity; subsequent refresh offers no honest pending state and overlapping reads can overwrite newer snapshots. v5 Storybook Monitoring reuses this page directly (`src/shared/ui/v5/routes/Monitoring.stories.jsx`), while the My Dashboards MonitoringWidget already avoids first-load Online and guards stale requests.
- Visant rule / variable: no number without evidence; incident triage decision quality.
- Fix: compose the page from the existing guarded MonitoringWidget logic or share the guarded hook, preserving source fields and separate page chrome. Use loading/unknown, not zero, until success. Add delayed initial response and out-of-order refresh stories.

### D7 — P2: Health failure state also declares no connections and unavailable Headroom

- Evidence: `src/app/(dashboard)/dashboard/health/page.js:37` throws before the Headroom request starts; no headroom result is available, but lines 80–85 declare Unavailable. Summary lines 99–100 map missing data to zeros; table empty state at line 122 declares “No active connections”.
- Behavior: failed first provider probe request shows an alert plus six zero counts, a no-connections claim and a compression proxy unavailable claim, even though none was measured. A separate Headroom-status failure is swallowed and its unknown state becomes “Not configured / Unavailable”.
- Visant rule / variable: absence is information only if genuine; avoid misdiagnosing healthy providers as unconfigured dependencies.
- Fix: give provider and Headroom reads independent pending/error/data states, retain last known data, show unknown when that source has never loaded. Avoid zero summary tiles on failed/unloaded data. Extend the existing Health LoadFailure story to assert the false claims are absent.

### D8 — P2: Timeline live status reports “Listening” after SSE disconnect

- Evidence: `src/app/(dashboard)/dashboard/timeline/page.js:107` attaches only `onmessage`, no `onopen`/`onerror` state; line 145 derives “Listening for updates” and success pulse solely from the requested `live` boolean.
- Behavior: request live mode, then disconnect its SSE transport: success-style Listening remains visible while no trace updates arrive. Initial REST failure also leaves the “Waiting for a call” empty-state copy below its error alert (lines 138 and 147).
- Visant rule / variable: state must describe actual operation, not intended configuration; time to notice a silent tracing outage.
- Fix: separate wanted-live from connection status and expose reconnecting/unavailable plus Retry. Suppress genuine-empty messaging on initial REST error. Add disconnected stream, reconnect and failed first fetch stories.

### D9 — P2: Hidden data sources still generate unrelated dashboard errors

- Evidence: `src/shared/ui/v5/dashboards/WorkspacesPage.jsx:49` always mounts ReviewUsageStats → SaverWidgets → PxpipeWidgets as resource wrappers around the canvas, regardless of selected visible widget IDs. Their top-level errors render independently of canvas visibility (SaverWidgets.jsx:60, PxpipeWidgets.jsx:295, ReviewUsageStats.jsx:423).
- Behavior: an all-widgets-hidden canvas or a Monitoring-only dashboard still fetches Usage/Token Saver/PXPIPE. A failing unused Token Saver stream can show unrelated alerts above a user-created monitoring dashboard. Hiding a widget does not hide its resource feedback.
- Visant rule / variable: chrome and alerts must follow state relevant to the current work; scan speed and confidence that an alert belongs to a visible measurement.
- Fix: derive required resource groups from visible widget IDs; mount or subscribe only those groups, or scope source failure feedback to the widgets using them. Keep resources shared per dashboard to avoid duplicate streams. Add single-source and empty dashboards with unused sources unavailable.

### D10 — P2: Selecting another dashboard silently drops the current unsaved layout

- Evidence: `src/shared/ui/v5/dashboards/WorkspacesPage.jsx:49` changes active dashboard immediately through Select, and remounts `DashboardCanvas key={current.id}`. `src/shared/ui/v5/dashboards/DashboardCanvas.jsx:53` owns an unsaved local draft with no outward dirty notification.
- Behavior: customize a layout, rename/resize/hide a widget, then select another named dashboard before Save: switching back restores the saved layout without explaining that the draft was discarded. Current Save/Cancel promises suggest an explicit commit boundary, but the persistent dashboard picker bypasses it.
- Visant rule / variable: reversibility and correctness on C regions; prevent lost operator work.
- Fix: report dirty/edit state to the parent and offer Save / Discard / Stay when leaving, or preserve a draft per dashboard until explicitly committed/cancelled. Test both pointer and keyboard picker paths.

## Design improvements / taste proposals, not demonstrated rendering bugs

1. **Timeline needs UI filters.** All eight filters exist in its query contract (timeline/page.js:16), but the page tells the person to edit a URL (line 137). Add a searchable provider/model/connection filter popover and active removable chips, preserving query URLs. This moves investigation throughput. This is a missing interface over existing capability, not a claim that filter endpoints fail.
2. **Give the decision one numeric hierarchy.** The four compression tiles and six PXPIPE status cards currently carry comparable weight. Prioritize actual payload reduction, keep estimated tokens visibly qualified and subordinate, and move version/uptime into a compact status disclosure. Preserve every metric and source. Do not remove healthy/zero results that are essential evidence solely to satisfy Visant's generic “zero tiles” rule.
3. **Avoid dual-axis implication.** ReviewUsageChart intentionally puts tokens and dollars on separate y axes (lines 143 and 153). Both units are labeled, so this is not a confirmed wrong calculation. Nevertheless independent auto-scales make geometric intersections look meaningful; two aligned panels or a Tokens/Cost view using shared interval selection would be clearer. Preserve both metrics and accessibility data. Compare actual screens before changing the existing deliberate DS decision.
4. **Unify the widget editor.** UsageWidgetLayout and DashboardCanvas duplicate movement/name/width/hide/edit semantics with different labels, help presentation and move-arrow orientation. Prefer the newer reusable composition while preserving Usage's original storage key. This should reduce divergence; it is not a reason to change validated behavior wholesale.
5. **Make width choice visual.** Four text options in a dropdown conceal the grid relation; use the existing SegmentedControl with 1/3, 1/2, 2/3, full-width pictograms and icon-specific tooltips. A new DS primitive is unnecessary. Validate 390px target size before adopting.
6. **Move infrequent dashboard rename/delete into one menu.** Workspaces toolbar renders both on every view; keep active dashboard + period + Customize immediately available. A compact existing menu can disclose management actions and reduce mobile chrome. Preserve keyboard and explicit destructive confirmation.

## What not to change

- All **seven Usage widget identities** are present: overview, provider connections, recent requests/sessions, chart, grouped usage, combo usage, API key limits (`usage/layout.js:5`). Provider topology is default-visible again; do not drop it to make the dashboard shorter.
- All **nine Token Saver/PXPIPE widget identities** are preserved (`dashboards/model.js:6`), including raw events and history pagination. Do not collapse the redesign into four attractive KPI tiles.
- Actual bytes, Headroom token delta and estimated image tokens remain separate. SaverWidgets says “Estimated image tokens”; PXPIPE explicitly references billed Usage as ground truth. Keep those evidence boundaries.
- Usage and SaverWidgets retain previous-period labels during snapshot transitions; do not replace the stale snapshot with a fake zero or keep stale numbers under a new period label.
- Keep identity-based layout reconciliation and unknown-source guidance in `dashboards/model.js`, plus saved/draft separation, Cancel, keyboard DnD, explicit move controls and full-width fallback at small sizes.
- Token Saver dashboard/settings routes are already separated; do not re-embed the settings form in the metric dashboard.
- Persistence is documented opt-in and deterministic CSF fixtures turn it off. Do not describe this deliberate review-only storage limit as a production data-loss defect. Acceptance still needs a browser scenario explicitly turning persistence on.

## Real tension

User asks for icons everywhere and less text; Visant asks that an icon only replace text when its shape carries the meaning. Removing labels from Quota, compression estimates or destructive actions would trade reading density for memorization and mistake risk. Recommendation: use icons with short labels on commands and modes; reserve icon-only buttons for familiar local actions with the required tooltips; keep units, period and actual-versus-estimated labels visible. Revisit after a keyboard + touch walkthrough if tooltips become necessary to complete ordinary tasks.

## Keyboard, height and narrow-viewport evidence boundary

- Source confirms KeyboardSensor + sortableKeyboardCoordinates, reachable move/edit/hide controls, native form semantics and several polite status regions. This is not a completed keyboard walkthrough.
- No fresh viewport geometry, Chrome budget measurements, both-theme screenshots, 390px scrollWidth checks or modal right-edge checks were performed by this delegated source reviewer. Parent audit must supply those; no visual score is assigned here.
- Dynamic flow gaps to check live: drag handle Space/arrow/Space; moving a wide chart to 1/3 width; library search and no-results; all widgets hidden; chart tooltip within narrow panel; long saved widget/dashboard names; unsaved dashboard switching; live disconnected status; focus after save/cancel.
- The 854-story historical catalog render pass establishes fixture render/play coverage only. It does not prove the failure branches identified above or every viewport state.

## Review-only result

No product file changed. No user data, provider endpoints or real credentials accessed. Findings are for the existing Storybook review branch and should first gain source-backed stories with explicit failures and recovery before promotion to production.
