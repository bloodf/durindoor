# DurinDoor Test Suite

The `tests/` package covers routing handlers, translators, providers, executors, persistence, security, the CLI, and repository contracts.

## Requirements and setup

Use Node.js `20.20.2` and npm `10.8.2`.

```bash
npm ci --no-audit --no-fund
cd tests
npm ci --no-audit --no-fund
```

Set disposable `HOME` and `DATA_DIR` values for commands that can touch runtime storage.

## Focused tests

Run tests from this directory and load the repository config:

```bash
npx vitest run --config vitest.config.js unit/example.test.js
npx vitest run --config vitest.config.js translator/example.test.js
```

Translator tests that call `translateRequest` or `translateResponse` must import `translator/registerAll.js`; otherwise the bundler-only lazy registration can produce a false pass.

## Full suite

```bash
npm test
```

For the authoritative CI and baseline gate:

```bash
npm run test:ci
```

`test:ci` removes stale result files, runs Vitest with machine-readable output, writes `.test-results.json` and `.test-results.junit.xml`, then verifies the curated baseline. It fails closed on startup, collection, runtime, report, parse, new-failure, and stale-baseline errors.

Do not add entries to `__baseline__/known-fails.txt`. Remove entries when a covered failure is fixed.

## Test groups

- `unit/`: application, API, database, provider, executor, CLI, security, and build contracts.
- `translator/`: offline request/response translation and bug-exposure tests.
- `translator/real/`: credential-backed provider smoke tests, enabled explicitly with `RUN_REAL=1`.
- `functional/` and route-specific suites: end-to-end behavior where present.

Real-provider tests use active local connections and can consume quota. Run them only with explicit credentials and intent:

```bash
RUN_REAL=1 npx vitest run --config vitest.config.js translator/real/
```

Credential, account, and quota errors may be skipped by the real-test harness; application and protocol failures remain failures.
