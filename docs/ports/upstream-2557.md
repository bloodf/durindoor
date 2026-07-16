# Port: upstream 9router #2557 → connection reorder by availability

## Live-source mapping (ID/title swap)

- Plan slot: **9router #2557** — "connection reorder by availability".
- Live upstream: PR **#2558** `feat(providers): add reorder connections by availability button` (`decolua/9router`, OPEN). Its diff is the sole source for this port.
  - Live head SHA: `24e691b2a2fe01752a1ab27509638ef92b786b06`
  - Live base SHA: `9845a1702f7766607bd7ac3315d1f87e59e45fb5` (base branch `master`)
- Live upstream PR **#2557** is `feat(providers): add random-available connection strategy` — a *different* behavior, owned by plan slot #2558 (branch `port/upstream-2558`). The upstream PR numbers are swapped relative to the plan's labels. This port contains **no** random-available code.

## Preflight

- Port base: `origin/dev` fetched SHA `397d54b6a42c4056d7f375cc51c0567c5a4b71ff`.
- Grep of `origin/dev` for the change's distinctive symbols (`handleReorderByStatus`,
  `Reorder by availability`, `swap_vert`, `sortConnectionsByAvailability`,
  `connectionAvailability`): **no matches** → change absent, port proceeds.

## Behavior

A one-click **Reorder** control on the provider dashboard sorts a provider's
connections so available ones come first, then persists the new order as
sequential `priority` values (`PUT /api/providers/:id`).

- **Available** = effective status `active` or `success`.
- **Effective status**: `unavailable` is treated as `active` unless the
  connection has a live `modelLock_*` cooldown (lock timestamp in the future).
  An `unavailable` probe without an active lock is transient, not dead.
- **Stable ties**: `Array.prototype.sort` is stable and the comparator returns
  `0` for ties, so the existing (manual) priority order within each
  availability group is preserved.

## Files

- `src/shared/utils/connectionAvailability.js` — pure helper:
  `getEffectiveConnectionStatus`, `isConnectionAvailable`,
  `sortConnectionsByAvailability` (input not mutated; `now` injectable for
  deterministic tests).
- `src/app/(dashboard)/dashboard/providers/[id]/page.js` — `handleReorderByStatus`
  + Reorder `Button` (`icon="swap_vert"`, shown when `connections.length > 1`,
  next to the Round Robin toggle).
- `src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js` — same
  handler + button in the self-contained connections card.
- `tests/unit/connection-availability-order.test.js` — focused availability-order
  test (8 cases: effective-status cooldown rules, availability classification,
  stable available-first ordering, no input mutation).

## Persistence & failure handling

The UI updates optimistically, then issues one priority PUT per connection.
`Promise.allSettled` waits for **every** write (no `Promise.all` early-reject
race); each response is checked with `!res.ok` → throw. If any write failed
(network error or non-OK), the handler refetches the connection list so the UI
shows the true server order instead of a false optimistic one.

## Verification

Focused test only (no gates run by the implementer):
`tests/unit/connection-availability-order.test.js` → 8/8 pass under pinned
Node 20.20.2; inverting the comparator turns the ordering test red, restoring
returns to green.
