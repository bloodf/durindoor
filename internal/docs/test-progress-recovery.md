# Full-test progress and fixture cleanup

The full local gate keeps four sequential test commands, four fork workers,
per-file isolation, the five-minute command ceiling, the three-minute silence
watchdog, the empty failure baseline and complete inventory/report validation.

Each full batch now emits real verbose test-completion progress while writing
its JSON report through the reporter-specific `outputFile.json` option. This
makes actual progress visible to the existing watchdog. It does not add a
heartbeat or suppress a failure. A subprocess regression verifies that genuine
completion text appears, intentional failures remain nonzero/failed in JSON,
and the report validator still rejects that failed run.

The documentation-example security fixtures retain their original roots,
extension filter and literal-value parser. They prune only exact `node_modules`
entries before traversal instead of enumerating those excluded dependencies
first. Hidden/build directories and similarly named directories remain in
scope. Eligible symlink files are checked with `stat`; directory symlinks are
not newly traversed. Regression fixtures compare the old and new file sets.

Quota-concurrency tests retain all 100 independent writers, their shared start
barrier, original database assertions and 15-second timeout. Test-owned workers
are tracked immediately after construction and terminated on normal completion,
rejection and test teardown. Teardown waits for termination before deleting the
SQLite fixture. Premature worker exit rejects the operation and termination
failures remain failures. An actual timed-out Vitest subprocess proves worker
cleanup runs after timeout; it is an intentional negative fixture, not a skipped
acceptance test.

These changes require independent review, a newly frozen runner/import closure
and a fresh full exact-head receipt. Earlier diagnostic or failed receipts do
not establish acceptance. A two-worker diagnostic exceeded the command ceiling,
so this change deliberately retains the existing four-worker setting.
