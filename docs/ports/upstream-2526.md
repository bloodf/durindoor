# Port: 9router #2526 — Hide disabled provider connections in combo picker

## Source
- Upstream: `decolua/9router` PR #2526
- Fetched via: `gh pr diff 2526 -R decolua/9router`
- Preflight: `filterActiveConnections` absent on `origin/dev` (git grep empty); dev's `src/shared/utils/connectionStatus.js` held only `getStatusVariant`; combos page used raw `providersData.connections || []`. Not a duplicate.

## Behavior / adaptation
Disabled provider connections (`isActive === false`) no longer appear as combo targets on the combos dashboard page. Enabled connections, legacy rows without the `isActive` flag, and no-auth connections remain visible.

- New helper `filterActiveConnections(connections)` in `src/shared/utils/connectionStatus.js` (JSDoc-documented at the change site): non-array input → `[]`; keeps every connection except those explicitly `isActive === false`.
- `src/app/(dashboard)/dashboard/combos/page.js` wraps `providersData.connections` with the filter before `setActiveProviders`, matching the upstream diff verbatim (JS-to-JS, no adaptation needed).

## Files
- `src/shared/utils/connectionStatus.js` — added `filterActiveConnections` (+ JSDoc)
- `src/app/(dashboard)/dashboard/combos/page.js` — import + apply filter in `fetchData`
- `tests/unit/connection-status.test.js` — focused unit test (new)

## Test
`tests/unit/connection-status.test.js` covers the acceptance controls directly:
- `isActive: true` connection kept
- `isActive: false` connection hidden
- legacy row without `isActive` kept
- no-auth connections (with/without flag) kept
- mixed list filters to non-disabled only
- invalid input (`undefined`/`null`) → `[]`

## Verification
No gates run per assignment (parent orchestrator verifies once: `.omc/gate.sh`, lint, build). Doc form: this file plus JSDoc at the change site.
