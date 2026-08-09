# Upstream Port Ledger — 2026-08-09 (D3)

Scope: user-selected `decolua/9router` PR #3163, `fix(usage): make hourly usage chart timezone-aware`.

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| #3163 | GAP | `src/lib/db/repos/usageRepo.js` bucketed every timestamp in server-local time, `src/app/api/usage/chart/route.js` ignored `tz`, and `UsageChart.js` did not send browser timezone. | Ported IANA validation, tz-aware day boundary, 24-hour label pass-through, route forwarding, and browser timezone query. |

## Implemented changes

- `src/lib/db/repos/usageRepo.js`
  - `getChartData(period = "7d", timeZone)` validates IANA timezone.
  - `today` returns 24 one-hour buckets beginning at midnight in the requested zone.
  - `24h` labels render using the requested zone.
- `src/app/api/usage/chart/route.js`
  - Reads `tz` and calls `getChartData(period, tz)`.
- `src/app/(dashboard)/dashboard/usage/components/UsageChart.js`
  - Sends `Intl.DateTimeFormat().resolvedOptions().timeZone` as `tz`.
- Tests:
  - `tests/unit/usage-period-tz.test.js` checks Los Angeles day boundaries and invalid-zone fallback.
  - `tests/unit/usage-period-routes.test.js` checks explicit timezone forwarding.

## Verification

- Focused tests: `tests/unit/usage-period-routes.test.js` and `tests/unit/usage-period-tz.test.js`: 18 passed.
- Revert proof: timezone route forwarding test failed against the pre-port route, then passed with the port.
