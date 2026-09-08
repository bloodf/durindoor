# Dashboard version preview

The Durin DS rewrite replaced every dashboard page in place. That left no way
to compare the redesign against what shipped before, and no way to back out if
the new layout turned out worse for a real task. This preview keeps both
dashboards available while the redesign is being judged.

## What a reader sees

The dashboard they already know, until they choose otherwise. **Profile →
Local Mode → Dashboard version** switches between `Old UI` and `New UI`.
The choice is per browser and survives restarts.

Both dashboards carry the switch, each styled for the palette it lives in, so
a reader who moves to either one can always get back.

## How it works

| Piece | Role |
| --- | --- |
| `src/legacy/` | Frozen copy of the pre-rewrite dashboard: pages under `pages/`, its own component copies under `shared/components/`. |
| `src/app/legacy-ui/**` | Thin route wrappers that re-export those pages, so the tree is mounted without duplicating implementations. |
| `dashboardResponse()` in `src/dashboardGuard.js` | Reads the `durindoor-ui-version` cookie and rewrites `/dashboard/*` onto `/legacy-ui/dashboard/*`. |
| `UiVersionSwitch` | Writes the cookie and reloads. Two copies, one per tree. |

A cookie rather than client state because the server picks the route tree
before any client code runs. A reload on change for the same reason.

### Ordering and access

The rewrite happens **after** the guard's authentication checks, so the
preview cannot be used to reach a page a reader could not already open. An
unauthenticated request still gets the login redirect.

`/legacy-ui` is an internal rewrite target, not a public address. A direct
request is redirected to the canonical `/dashboard/...` path, so each page
keeps one URL.

Anything other than `new` — including a stale or hand-edited cookie, or no
cookie at all — means the old dashboard. The default is deliberate, not a
fallback: until the redesign is official, an absent preference serves the
interface people already know.

## Making the redesign official

One line in `src/dashboardGuard.js`: change the condition in
`dashboardResponse()` so an absent preference serves the new tree and only an
explicit `legacy` rewrites. There is no constant to flip; it is the cookie
comparison itself.

## Retiring the preview

Delete `src/legacy/`, `src/app/legacy-ui/`, both `UiVersionSwitch` copies and
their two callers, `dashboardResponse()` and the `/legacy-ui` redirect in
`src/dashboardGuard.js`, the `FROZEN_LEGACY` entry in
`scripts/check-storybook-coverage.mjs`, and the two test files
(`tests/unit/ui-version-switch.test.js`, plus the preview cases in
`tests/unit/dashboard-guard.test.js`). No page code depends on any of it.

## Coverage

`src/legacy/` is exempt from Durin DS story coverage: it is a frozen snapshot
that ships unchanged and is deleted when the preview retires. The mounted
routes under `src/app/legacy-ui/` stay in scope — they are live code, and as
one-line re-exports they have nothing to cover. Switch behaviour is tested
for both copies in `tests/unit/ui-version-switch.test.js`; routing, auth
ordering and query preservation in `tests/unit/dashboard-guard.test.js`.
