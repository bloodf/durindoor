# SQLite per-handle release contract

`src/lib/db/exclusiveLockRelease.js` exports `releaseExclusiveLock(adapter)`. It closes one SQLite adapter handle, such as one holding `locking_mode = EXCLUSIVE`, and reports what it observed. It is adapted from OmniRoute PR 21159 (see [the intake report](./port-reports/1073-omni-21159-intake.md)).

No DurinDoor code calls it yet. It is a standalone contract for a future caller that owns an adapter and needs to release its lock.

## Adapter state

Each SQLite adapter exposes two read-only getters:

| Adapter | `open` | `inTransaction` |
| --- | --- | --- |
| better-sqlite3 | driver `db.open` | driver `db.inTransaction` |
| node:sqlite | driver `isOpen` (unknown if the driver lacks it) | driver `isTransaction`, read only while open (the driver throws after close); unknown when `isOpen` is missing |
| bun:sqlite | our own flag, cleared only when `close(true)` returns | driver `inTransaction`, read only while open |
| sql.js | not exposed | not exposed, so a release is refused as unknown |

Adapter `close()` keeps swallowing driver errors, as before. The `open` getter is how a swallowed refusal becomes visible.

## Outcomes

The helper never throws and never sets a pragma. With a live cursor the pragma is the statement that throws, so setting one would hide the close.

| Outcome | Meaning |
| --- | --- |
| `{ kind: "CLOSED" }` | This handle went from open to closed. A close that threw after taking effect still reports `CLOSED`. |
| `REFUSED_OPEN_TRANSACTION` | `inTransaction` is `true`. Nothing was closed; the transaction is untouched. |
| `REFUSED_UNKNOWN_TRANSACTION` | `inTransaction` is missing, not a boolean, or its read threw. Nothing was closed. |
| `REFUSED_STILL_OPEN` + `CLOSE_THREW` | Close threw and the handle still reports open. End live cursors, then retry. `message` carries the error. |
| `REFUSED_STILL_OPEN` + `OPEN_STILL_TRUE` | Close returned and the handle still reports open. Retrying unchanged does nothing. |
| `REFUSED_STILL_OPEN` + `OPEN_WITNESS_UNREADABLE` | The `open` read threw or was not a boolean. The handle may be open or closed: do not reuse it or retry blindly. |

## Limits

- `CLOSED` describes one handle. It does not mean the database file is free, that a successor can read it, or that another holder in this or another process is gone.
- A failed close still stops the adapter's periodic checkpoint timer (and, for better-sqlite3, removes its signal listeners), because `close()` does that before the driver close. A retry of `close()` still works.
- The node:sqlite driver bundled with Node 24 did not block a second connection while in exclusive mode in the test environment, so its test asserts post-release readability only. better-sqlite3 is the driver whose exclusive holder demonstrably blocks the second connection.

Tests: `tests/unit/omni-21159-sqlite-release.test.js`.
