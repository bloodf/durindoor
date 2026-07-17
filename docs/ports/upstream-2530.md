# Port: 9router #2530 — better-sqlite3 parameter-binding spread crash

Source: `decolua/9router` PR #2530 (fixes issue #2529), OPEN upstream.
Runtime change is byte-exact with the upstream diff: 3 lines in
`src/lib/db/adapters/betterSqliteAdapter.js` spreading `params` into
`run` / `get` / `all`.

## Root cause

The adapter passed the whole params array as a single argument
(`prepare(sql).run(params)`). better-sqlite3 accepts a bare array only for
anonymous `?` placeholders; for named placeholders (`$key`) the
array-wrapped bind map is bound as one scalar and the driver throws:

```
TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and null
```

Upstream issue #2529 hit this as an HTTP 500 when setting a new dashboard
password in an environment where `better-sqlite3` was the selected driver.
The `node:sqlite` and `bun:sqlite` adapters already spread params; this
aligns `better-sqlite3` with them.

Verified against installed better-sqlite3 12.11.1:

- `stmt.run([{ name, n }])` with `$name`/`$n` placeholders → throws the
  TypeError above (old shape, regression caught by the new test).
- `stmt.run({ name, n })` (spread shape) → succeeds.
- Positional `?` placeholders work under both shapes, so a live positional
  assertion alone cannot distinguish old vs new — the named-parameter case
  is the regression discriminator.

## Test

`tests/unit/db-better-sqlite-binding.test.js`:

1. Single named-parameter object in the params array (`$key`/`$value`) —
   fails on the old call shape, passes with the spread fix.
2. Multiple positional parameters through `run`, `get`, and `all` — covers
   all three changed lines and preserves existing statement semantics.

Adapter instances are closed in `afterEach` (clears the checkpoint
interval and process signal listeners).
