# API-key backup round-trip investigation

At integration head `cdfb0c5dbc1c18e85e37b194d96ac2367af0f9c8`, the reported `3eda1b260f65` full-gate failure in the `sql.js` restore test did not reproduce. On Node `v24.22.2` and Vitest `v4.1.12` with the default `testTimeout: 15_000` in `tests/vitest.config.js` (no increased timeout), the exact normal evidence command passed all 22 tests:

```sh
cd tests
node node_modules/vitest/vitest.mjs run unit/db-api-key-backup-roundtrip.test.js --maxWorkers=2
```

Observed clean run: exit `0`, `Test Files 1 passed (1)`, `Tests 22 passed (22)` in `24.51s` (`transform 9.88s`, `import 215ms`, `tests 23.94s`; an earlier run under local CodeGraph indexing also passed 22/22 in `25.97s`).

## Timing and profiling observations

Nineteen of the 22 tests finished in `237–381ms`. Three tests took `5.7–6.8s` even without competing suite workers, leaving narrow headroom against the `15_000ms` per-test timeout under heavy host or 4-worker full-gate load:

- `round-trips policy, expiry, totals, and the exact stored secret` (`6790ms`): first Vite/Oxc transform of the `@/lib/db/index.js` module graph.
- `fails closed and refuses export when stored policy JSON is corrupt` (`5871ms`): first Vite/Oxc transform of `src/sse/services/apiKeyPolicy.js` and its `open-sse` imports.
- `rejects sql.js restore before mutation while ordinary fallback accounting still works` (`5670ms`): `sql.js` import plus `initSqlJs()` took `19ms` and `sqljsAdapter.js` transform took `2.5ms`, but a worker CPU profile (`node --cpu-prof`) showed over `2.5s` in `@vitest/expect` (`keys`, `eq`, `iterableEquality`, `iterableEqualityWithStack`, `hasKey`, and GC) comparing the exported SQLite `Buffer` byte-by-byte in `expect(Buffer.from(fallback.raw.export())).toEqual(before)` (`tests/unit/db-api-key-backup-roundtrip.test.js:428`).

## Disposition

No production code or test file was modified because the reported failure did not reproduce under the normal timeout on `cdfb0c5dbc1c18e85e37b194d96ac2367af0f9c8`. The original `3eda1b260f65` full-gate failure output is needed to confirm whether that failure was a `15_000ms` timeout under contention (consistent with the profiled `Buffer` `.toEqual` hotspot) or an unrelated error. If timeout flakes recur in `tests/unit/db-api-key-backup-roundtrip.test.js:428`, replacing `.toEqual(before)` with `Buffer.prototype.equals` preserves exact byte-for-byte equality while avoiding the deep-equality loop.
