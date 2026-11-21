# 1072: Combo model usage snapshot

Attributed request totals and model counts now come from one grouped usage-history query. The report combines those groups into the existing connection totals and combo-wide share denominators, including requests without provider or model details. Unattributed history remains separately queried as before. A single statement supplies the attributed snapshot for both supported database engines.

Offline evidence: `(cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/combo-model-usage-attribution.test.js)` passed (1 file, 3 tests). The regression inserts a usage row after the attributed query returns and checks that the reported request count and model share both reflect the earlier snapshot, including a request without model details. This is focused SQLite evidence; it does not exercise a live PostgreSQL database or constitute full-suite coverage.
