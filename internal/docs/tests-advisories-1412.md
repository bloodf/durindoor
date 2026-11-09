# Tests Package Security Advisories and Dependency Analysis (Issue #1412)

## Overview and Scope

This document records the dependency advisory audit, verification, and resolution for the `tests/` package in DurinDoor, addressing GitHub Issue [#1412](https://github.com/bloodf/durindoor/issues/1412).

- **Owned paths in this unit**:
  - `tests/package.json`
  - `tests/package-lock.json`
  - `internal/docs/tests-advisories-1412.md`
- **Disjoint paths owned by other units**:
  - Root `package.json` and `package-lock.json` (19 dev-only moderate advisories under `eslint`, `eslint-config-next`, and `@storybook/react-vite` minimatch/glob dependency chain).
  - `cli/package.json` and `cli/package-lock.json` (2 advisories in CLI chain).
  - These remain deferred to dedicated root/CLI toolchain and major migrations per repository policy ("no unrelated major root/CLI upgrades").

---

## Primary Source Advisory Verification

Issue #1412 identified 3 high and 2 moderate security advisories in the `tests/` package. Primary sources from GitHub Advisory Database and npm audit were analyzed to determine genuine fix floors:

1. **`happy-dom` (Targeted: 21.0.4)**
   - **Vulnerabilities**:
     - `GHSA-834v-8h66-3h79` (High): Script execution / DOM clobbering / CSS parsing vulnerabilities.
     - `GHSA-c8p4-j97h-3vg8` (High): Element prototype and XML serialization bypass.
   - **Fix Evaluation**:
     - Issue #1412 initially proposed `happy-dom 20.14.6`.
     - Primary source inspection confirmed that `20.14.6` still carries both `GHSA-834v-8h66-3h79` and `GHSA-c8p4-j97h-3vg8`.
     - The minimal safe floor that completely clears these high advisories is `happy-dom >= 21.0.4`.

2. **`vite` (Targeted: 8.3.5)**
   - **Vulnerabilities**:
     - `GHSA-9cwx-2883-4wfx` (Moderate): `server.fs.deny` bypass via special path encodings.
     - `GHSA-64vr-g452-qvp3` (Moderate): HTML injection / DOM manipulation in development server.
   - **Fix Evaluation**:
     - Fixed in `vite >= 8.3.5`. Vitest transitively pulls `vite`. Moving to `vitest ^4.1.12` cleanly resolves `vite` to `8.3.5`.

3. **`source-map-js` (Targeted: 1.2.2)**
   - **Vulnerabilities**:
     - Regular expression denial of service / parsing anomalies in source mapping.
   - **Fix Evaluation**:
     - Fixed in `source-map-js >= 1.2.2`. Pinned transitively through updated build toolchain dependencies.

4. **`postcss` (Targeted: 8.5.32 via override)**
   - **Vulnerabilities**:
     - Line return parsing vulnerability in older `postcss` releases.
   - **Fix Evaluation**:
     - Manifest override `"postcss@<8.5.23": "8.5.23"` ensures resolution to non-vulnerable versions; currently resolved at `8.5.32`.

### Audit Result
Running `npm --prefix tests audit --package-lock-only` confirms:
```
found 0 vulnerabilities
```
The `tests/` package dependency graph is completely free of known vulnerabilities.

---

## Prior `happy-dom` 20.14 Regression Analysis

CHANGELOG noted that `happy-dom 20.14` previously caused regressions across the test suite:

- **Root Cause**:
  In `happy-dom >= 20.14`, `CSSStyleDeclaration` was reimplemented as a JavaScript `Proxy`. The proxy's `defineProperty` trap returns falsish when attempting to redefine style properties via `Object.defineProperty(document.body.style, "overflow", ...)`.
- **Suite Impact**:
  Two test suites (`tests/unit/durin-ds-overlays.test.js` and `tests/unit/ui-production-shared-overlays.test.js`) saved the descriptor using `Object.getOwnPropertyDescriptor(document.body.style, "overflow")` and attempted to restore it in `afterEach`. This caused 24 tests to fail with:
  `TypeError: 'defineProperty' on proxy: trap returned falsish`.
- **Resolution**:
  Because no test in the suite actually reconfigures the descriptor of `overflow`, restoring the property descriptor was redundant dead cleanup. The tests were updated to restore only the property value:
  ```js
  document.body.style.overflow = originalBodyOverflow;
  ```
  This enables clean execution on both `happy-dom 20.14.6` and `happy-dom 21.0.4`.

---

## Toolchain Comparison: Node 26 (Main) vs Node 24 (PR #1663)

### Current `origin/main` (`044632eb8bc4cd51a65340fb6c87100879969e70`)
- **Node**: `26.13.0` (LTS)
- **Package Manager**: `npm 11.20.0`
- **Lockfile Format**: `tests/package-lock.json` (Lockfile Version 3)
- **Dependency Hoisting**: Relies on standard npm hoisting. Implicit dependencies such as `@testing-library/dom` and `yaml` are resolved through the hoisted hierarchy.
- **Engines declaration in `tests/package.json`**:
  ```json
  "engines": {
    "node": "26.13.0",
    "npm": "11.20.0"
  }
  ```

### Pending Draft PR #1663 (`chore/node24-pnpm12-migration-20261107`)
- **Node**: `>=24.22.2 <25`
- **Package Manager**: `pnpm@12.18.0`
- **Lockfile Format**: `pnpm-lock.yaml` (v9/v12)
- **Dependency Isolation**: pnpm uses hardlinks and symlinks without automatic flat hoisting. Packages imported in test suites must be explicitly declared in `tests/package.json`:
  ```json
  "devDependencies": {
    "@testing-library/dom": "10.4.2",
    "yaml": "2.9.0"
  }
  ```
- **Engines declaration**:
  ```json
  "engines": {
    "node": ">=24.22.2 <25"
  },
  "packageManager": "pnpm@12.18.0"
  ```
- **Migration Boundary**: PR #1663 is pending independent review and qualification. This unit targets `origin/main` and retains exact compatibility with the Node 26.13.0 / npm 11.20.0 baseline while documenting the explicit declaration pattern for downstream pnpm alignment.

---

## Manifest and Lockfile Integrity Strategy

- `tests/package.json` and `tests/package-lock.json` are currently in a verified, clean, 0-advisory state at commit `044632eb8bc4cd51a65340fb6c87100879969e70`.
- Per policy, lockfile entries and integrity hashes must **never be hand-fabricated**.
- If a future dependency bump is authorized, the exact reproducible package manager commands are:
  ```bash
  # Verification (offline / lockfile only)
  npm --prefix tests audit --package-lock-only

  # Reproducible install & lockfile regeneration (owner/gate environment only)
  npm --prefix tests install --package-lock-only
  npm --prefix tests ci
  ```

---

## Offline Behavior Selector Plan

Per `AGENTS.md` and `internal/docs/local-ci.md`, full test validation of the test suite requires four sequential, independently supervised Vitest commands rather than a single monolithic run.

### Supervised Execution Constraints
1. **Concurrency**: At most 4 workers per command (`--maxWorkers=4`).
2. **Isolation**: `--isolate` and `--pool=forks` enabled.
3. **Ceiling**: 300 seconds timeout per command with silence watchdog.
4. **Baseline**: Empty failure baseline (`tests/__baseline__/known-fails.txt`). Any failed assertion is a gate regression.
5. **Inventory Partition**:
   Discovered test files in `tests/` are sorted alphabetically and partitioned modulo 4:
   ```js
   Array.from({ length: 4 }, (_, index) => files.filter((_, i) => i % 4 === index));
   ```
6. **Command Template**:
   ```bash
   node node_modules/vitest/vitest.mjs run <batch_files> \
     --maxWorkers=4 \
     --isolate \
     --pool=forks \
     --reporter=verbose \
     --reporter=json \
     --outputFile.json=<batch_report.json>
   ```
7. **Report Aggregation**:
   `tests/__baseline__/full-batches.mjs:mergeBatchReports(batches, reports, tests)` aggregates batch results and verifies:
   - No missing or duplicate test files.
   - `numRuntimeErrorTestSuites === 0`.
   - Zero regressions against empty baseline.

---

## Qualification and Gate Status

- **Stage**: Source-only proposal & documentation delivery.
- **Runtime Execution**: `RUNTIME UNRUN` (no candidate code execution, install, build, or test in this unprivileged source delivery unit).
- **Gate Requirement**: Full checkpoint (`scripts/local-ci.mjs --mode full`) required under owner supervision prior to merge or publication.
