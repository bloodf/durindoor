# Issue #1143 Runtime Upgrade & Artifact Compatibility Matrix Acceptance Audit

Audit of merged Node runtime support, engine alignment, artifact compatibility, driver fallback, and migration/recovery contracts against GitHub issue #1143 acceptance criteria.

Date: 2026-11-21  
Target: `bloodf/durindoor:main` (branch `orq/toty04/n1143-audit-a1`)  
Issue Reference: [bloodf/durindoor#1143](https://github.com/bloodf/durindoor/issues/1143) — `chore(runtime): plan Node support upgrade and artifact compatibility matrix`  
Parent Epic: #1067 (Roadmap #1056, Stage 3, Priority P2)  
Linked Pull Requests:
- PR #1598: `docs(deployment): add Node, driver and platform compatibility matrix` (merged commit `5fb63c3ba`)
- PR #2135: `fix(routing): reset connection circuit after credential updates` (merged commit `1c75c441f`)
- PR #2139: `fix(metrics): bound runtime pressure diagnostics` (merged commit `fddf5bf76`)
Associated Audit & Evidence Commits:
- `dccd1b276`: `test: document runtime compatibility evidence`
- `d6e114595`: `test(runtime): cover staged artifact compatibility`

Outcome Target:
DurinDoor pins Node 20.20.2 while upstream compatibility reports cover Node 24/26. Evaluate an upgrade as a compatibility project, not an untested engine-range edit.

---

## 1. Executive Summary & Verification Evidence

Issue #1143 addresses the challenge where upstream OmniRoute compatibility reports (specifically OmniRoute issue #15180: *nightly-compat: Node 24/26 failures on release/v3.8.52*) surfaced runtime breakages on newer Node versions. Rather than applying an untested engine range bump in `package.json`, #1143 established a delivery contract requiring a systematic compatibility project: evaluating dependencies and native runtimes, verifying component and artifact behavior across drivers and architectures, publishing an operational migration and recovery guide, and enforcing a single deterministic CI gate.

The integrated implementation resolves these requirements by:
1. Pinning the runtime toolchain to Node `24.22.2` (enforced as `>=24.22.2 <25` in manifests, and exact `24.22.2` in `.nvmrc` and CI) and package manager `pnpm@12.18.0`.
2. Guarding cross-surface alignment via [`tests/unit/node-version-alignment.test.js`](../../tests/unit/node-version-alignment.test.js), locking app manifests, CLI, tests, website, Dockerfile, and all `.github/workflows/*.yml`.
3. Validating child process launcher heap arguments and IPv4 DNS precedence via [`tests/unit/1143-runtime-compat.test.js`](../../tests/unit/1143-runtime-compat.test.js).
4. Verifying staged CLI fast paths and sidecar loading without server boot or data mutation via [`tests/unit/1143-artifact-compat.test.js`](../../tests/unit/1143-artifact-compat.test.js).
5. Publishing an honest, evidence-based compatibility matrix in [`docs/deployment/compatibility.mdx`](../../docs/deployment/compatibility.mdx) and runtime evidence in [`docs/reference/cli.mdx`](../../docs/reference/cli.mdx) distinguishing what is tested, health-checked, checked manually, or untested.
6. Providing step-by-step procedures for platform migration, startup verification, and rollback in [`docs/operations/upgrading.mdx`](../../docs/operations/upgrading.mdx) and [`docs/deployment/compatibility.mdx`](../../docs/deployment/compatibility.mdx).

### Mandatory Verification Suite Execution

In accordance with audit instructions, the dedicated issue #1143 verification suite was executed:

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/1143-runtime-compat.test.js unit/1143-artifact-compat.test.js --maxWorkers=2
```

**Results**:
- **Test Files**: 2 passed (2 total)
- **Tests**: 3 passed (3 total)
- **Duration**: ~514ms
- **Breakdown**:
  - [`tests/unit/1143-runtime-compat.test.js`](../../tests/unit/1143-runtime-compat.test.js) (1 test passed):
    - Asserts `buildNodeArgs` from [`cli/hooks/nodeFlags.js`](../../cli/hooks/nodeFlags.js) honors `NODE_OPTIONS` (`--max-old-space-size=128`), overrides it when `NINEROUTER_MAX_OLD_SPACE_SIZE=256` is supplied, and leaves `NODE_OPTIONS` intact when disabled with `0`, exercising real Node child processes via `v8.getHeapStatistics().heap_size_limit`.
  - [`tests/unit/1143-artifact-compat.test.js`](../../tests/unit/1143-artifact-compat.test.js) (2 tests passed):
    - Runs staged CLI fast paths (`--help` and `--version`) with a stubbed machine ID (`node-machine-id`) and an isolated temporary `DATA_DIR`, verifying zero unintended disk writes to the data directory.
    - Loads copied standalone sidecars (`head-response-guard.cjs`, `web-login-host-boundary.cjs`) via `copyRequiredStandaloneSidecars` and confirms `validateArtifact` validates entry point existence while throwing on missing entry files.

### Extended Related Test Suite Execution

All 9 related unit suites covering driver fallback, migration checks, sidecar packaging, and web-session runtimes pass without regressions (41 tests passed in 4.41s):
- [`tests/unit/1143-runtime-compat.test.js`](../../tests/unit/1143-runtime-compat.test.js) (1 test)
- [`tests/unit/1143-artifact-compat.test.js`](../../tests/unit/1143-artifact-compat.test.js) (2 tests)
- [`tests/unit/node-version-alignment.test.js`](../../tests/unit/node-version-alignment.test.js) (6 tests)
- [`tests/unit/db-driver-chain.test.js`](../../tests/unit/db-driver-chain.test.js) (3 tests)
- [`tests/unit/port-27f3710c8-sqljs-runtime.test.js`](../../tests/unit/port-27f3710c8-sqljs-runtime.test.js) (5 tests)
- [`tests/unit/port-3314-cli-no-native-sqlite.test.js`](../../tests/unit/port-3314-cli-no-native-sqlite.test.js) (2 tests)
- [`tests/unit/db/pgSyncWorker-result-transfer.test.js`](../../tests/unit/db/pgSyncWorker-result-transfer.test.js) (1 test)
- [`tests/unit/db/noPgImportWhenSqlite.test.js`](../../tests/unit/db/noPgImportWhenSqlite.test.js) (3 tests)
- [`tests/unit/omniroute-websession-runtime.test.js`](../../tests/unit/omniroute-websession-runtime.test.js) (18 tests)

---

## 2. Requirement-to-Evidence Matrix

| # | Acceptance Criterion | Implementation Scope & Mechanism | Exact Code Locations | Covering Tests | Status |
|---|---|---|---|---|---|
| **1** | **Choose supported Node versions from dependency/native-runtime evidence** | • Bounded runtime target to Node `24.22.2` with declared engine range `>=24.22.2 <25` across all packages (`package.json`, `cli/`, `tests/`, `website/`).<br>• Enforced exact `24.22.2` in `.nvmrc`, `Dockerfile` (`ARG NODE_IMAGE=node:24.22.2-alpine`), and all `.github/workflows/*.yml`.<br>• Enforced `pnpm@12.18.0` uniformly across all workspace packages.<br>• Verified dependencies against native support: `better-sqlite3@12.11.1` and `sql.js@1.14.1` pinned in `cli/hooks/sqliteRuntime.js` satisfying app ranges.<br>• CLI child process launcher (`cli/hooks/nodeFlags.js`) injects `--dns-result-order=ipv4first` and resolves V8 heap caps (`NINEROUTER_MAX_OLD_SPACE_SIZE` vs `NODE_OPTIONS`). | • [`package.json:6-9`](../../package.json)<br>• [`cli/package.json:4, 34-36`](../../cli/package.json)<br>• [`tests/package.json:23-26`](../../tests/package.json)<br>• [`website/package.json:34-36`](../../website/package.json)<br>• [`.nvmrc:1`](../../.nvmrc)<br>• [`Dockerfile:2`](../../Dockerfile)<br>• [`cli/hooks/sqliteRuntime.js:9-13`](../../cli/hooks/sqliteRuntime.js)<br>• [`cli/hooks/nodeFlags.js:1-40`](../../cli/hooks/nodeFlags.js)<br>• [`docs/deployment/compatibility.mdx:8-17`](../../docs/deployment/compatibility.mdx)<br>• [`docs/reference/cli.mdx:6, 17-27, 49-62`](../../docs/reference/cli.mdx) | • `tests/unit/node-version-alignment.test.js` (lines 16–62)<br>• `tests/unit/1143-runtime-compat.test.js` (lines 20–28) | **Met (Evidence-Bounded)** |
| **2** | **Verify SQLite native/sql.js/PostgreSQL, workers, web sessions, CLI tray and standalone artifacts on target OS/architectures** | • Database 3-tier fallback chain implemented in `driver.js`: `better-sqlite3` -> `node:sqlite` -> `sql.js`.<br>• `sql.js` WASM asset preservation in `scripts/build-app.mjs` and Dockerfile.<br>• PostgreSQL synchronous query worker implemented via `worker_threads` and `SharedArrayBuffer` in `pgSyncWorker.cjs`. Migration DDL parity checked via `scripts/check-postgres-migrations.mjs`.<br>• Web-session timeout/abort utilities in `websession-utils.js`.<br>• CLI standalone sidecars (`head-response-guard.cjs`, `web-login-host-boundary.cjs`) copied and validated via `standaloneSidecars.js`.<br>• Staged artifact execution and sidecar integrity tested in `1143-artifact-compat.test.js`.<br>• Full standalone and packed tarball smoke checks in `scripts/smoke-installed-artifact.mjs` and `smoke-npm-pack.mjs`.<br>• Honest compatibility matrix published in `docs/deployment/compatibility.mdx` enumerating tested vs untested components and platforms. | • [`src/lib/db/driver.js:15-45`](../../src/lib/db/driver.js)<br>• [`src/lib/db/adapters/pgSyncWorker.cjs:1-120`](../../src/lib/db/adapters/pgSyncWorker.cjs)<br>• [`scripts/check-postgres-migrations.mjs:1-50`](../../scripts/check-postgres-migrations.mjs)<br>• [`open-sse/executors/websession-utils.js:1-60`](../../open-sse/executors/websession-utils.js)<br>• [`cli/scripts/standaloneSidecars.js:20-55`](../../cli/scripts/standaloneSidecars.js)<br>• [`scripts/build-app.mjs:19-75`](../../scripts/build-app.mjs)<br>• [`scripts/smoke-installed-artifact.mjs:16-105`](../../scripts/smoke-installed-artifact.mjs)<br>• [`docs/deployment/compatibility.mdx:19-53`](../../docs/deployment/compatibility.mdx) | • `tests/unit/1143-artifact-compat.test.js` (lines 34–69)<br>• `tests/unit/db-driver-chain.test.js` (lines 27–60)<br>• `tests/unit/port-27f3710c8-sqljs-runtime.test.js` (lines 31–67)<br>• `tests/unit/port-3314-cli-no-native-sqlite.test.js` (lines 40–69)<br>• `tests/unit/db/pgSyncWorker-result-transfer.test.js` (lines 6–38)<br>• `tests/unit/db/noPgImportWhenSqlite.test.js` (lines 10–50)<br>• `tests/unit/omniroute-websession-runtime.test.js` (lines 25–52) | **Partially Met / Documented Gaps**<br>*(Offline unit & staged checks pass on Linux x64; multi-platform execution on macOS/Windows and live PostgreSQL/browser/tray remain unexercised in CI, as cataloged)* |
| **3** | **Publish a migration/recovery guide and maintain one deterministic required CI gate** | • Published operational guides for moving runtimes, machine migration, backup requirements, and recovery procedures in `docs/deployment/compatibility.mdx` and `docs/operations/upgrading.mdx`.<br>• Documented exact rollback steps for code, runtime, and database (including SQLite corruption restoration and PostgreSQL-era write loss).<br>• Enforced single deterministic CI gate via `.github/workflows/test.yml` (`🧪 Tests`) running `pnpm run test:ci` (`run-ci.mjs` + `verify-no-regression.mjs`).<br>• Empty failure baseline enforced (`tests/__baseline__/known-fails.txt` has 0 entries).<br>• Local gate authority (`scripts/local-ci.mjs`) defaults to `--mode full`. | • [`docs/deployment/compatibility.mdx:59-72`](../../docs/deployment/compatibility.mdx)<br>• [`docs/operations/upgrading.mdx:10-85`](../../docs/operations/upgrading.mdx)<br>• [`docs/reference/cli.mdx:17-29, 49-68`](../../docs/reference/cli.mdx)<br>• [`docs/operations/postgres.mdx:1-120`](../../docs/operations/postgres.mdx)<br>• [`.github/workflows/test.yml:16-80`](../../.github/workflows/test.yml)<br>• [`tests/__baseline__/known-fails.txt:1`](../../tests/__baseline__/known-fails.txt)<br>• [`scripts/local-ci.mjs:1-150`](../../scripts/local-ci.mjs) | • `tests/unit/node-version-alignment.test.js` (lines 16–62)<br>• `tests/__baseline__/verify-no-regression.mjs` | **Met** |

---

## 3. Deep-Dive Analysis of Acceptance Criteria

### Criterion 1: Node Version Choice & Dependency / Native Runtime Evidence

1. **Target Selection and Pinning**:
   - The original DurinDoor baseline pinned Node `20.20.2`. Upstream OmniRoute nightly testing surfaced regressions when attempting to run on Node 24 and Node 26.
   - DurinDoor evaluated upstream and dependency compatibility:
     - `better-sqlite3` `^12.11.1` (declaring Node 20.x through 26.x support; ABI 147 for Node 26, Node 24 ABI).
     - `sql.js` `1.14.1` (pure JS + WASM fallback).
     - `pg` `^8.13` (PostgreSQL client).
   - In PR #1598 (commit `5fb63c3ba`), Node 26.13.0 was initially documented. Subsequently, the project focused its active migration target onto Node `24.22.2`.
   - Manifests explicitly declare:
     - `package.json`: `"engines": { "node": ">=24.22.2 <25" }`, `"packageManager": "pnpm@12.18.0"`
     - `cli/package.json`: `"engines": { "node": ">=24.22.2 <25" }`, `"packageManager": "pnpm@12.18.0"`
     - `tests/package.json`: `"engines": { "node": ">=24.22.2 <25" }`, `"packageManager": "pnpm@12.18.0"`
     - `website/package.json`: `"engines": { "node": ">=24.22.2 <25" }`, `"packageManager": "pnpm@12.18.0"`
     - `.nvmrc`: `24.22.2`
     - `Dockerfile`: `ARG NODE_IMAGE=node:24.22.2-alpine`
     - `.github/workflows/*.yml` (`test.yml`, `ci.yml`, `artifact-smoke.yml`, `release.yml`, etc.): all require `node-version: 24.22.2` and `pnpm: 12.18.0`.
2. **Alignment Enforcement**:
   - [`tests/unit/node-version-alignment.test.js`](../../tests/unit/node-version-alignment.test.js) acts as an automated regression lock. It parses `.nvmrc`, all four package manifests, `docs/deployment/compatibility.mdx`, `cli/hooks/sqliteRuntime.js`, `Dockerfile`, and every workflow file in `.github/workflows/`, failing if any file drifts from the declared version.
3. **Runtime Heap and DNS Flag Precedence**:
   - In [`cli/hooks/nodeFlags.js`](../../cli/hooks/nodeFlags.js), `buildNodeArgs` injects `--dns-result-order=ipv4first` so unreachable IPv6 addresses do not cause socket timeouts in `undici`.
   - `resolveHeapFlags` evaluates `NINEROUTER_MAX_OLD_SPACE_SIZE`:
     - Positive integer sets `--max-old-space-size=<MB>` (taking precedence over `NODE_OPTIONS`).
     - `0` disables launcher heap flags completely, delegating sizing to Node or `NODE_OPTIONS`.
     - Unset uses 75% of system memory, from `512` to `6144` MB, unless `--max-old-space-size` is already present in `NODE_OPTIONS`.
   - This contract is verified in real Node child processes by [`tests/unit/1143-runtime-compat.test.js`](../../tests/unit/1143-runtime-compat.test.js).

### Criterion 2: Component Verification Across SQLite Native, sql.js, PostgreSQL, Workers, Web Sessions, CLI Tray, and Standalone Artifacts on Target OS/Architectures

1. **SQLite Native (`better-sqlite3`)**:
   - Preferred driver in [`src/lib/db/driver.js`](../../src/lib/db/driver.js). Unit tests on Linux x64 exercise driver selection and schema migrations.
   - CLI runtime (`cli/hooks/sqliteRuntime.js`) manages installation into `DATA_DIR/runtime`. [`tests/unit/port-3314-cli-no-native-sqlite.test.js`](../../tests/unit/port-3314-cli-no-native-sqlite.test.js) verifies CLI startup does not trigger unprompted npm installs, and caps postinstall warmup at 30 seconds.
   - *Limitation*: In [`docs/deployment/compatibility.mdx`](../../docs/deployment/compatibility.mdx), status is recorded as *"Pending Node 24 validation"*, noting that prebuild loading across non-Linux platforms (macOS arm64, Windows) has not been verified in CI.
2. **`sql.js` (Pure-JS / WASM Fallback)**:
   - Evaluated as third choice in [`src/lib/db/driver.js`](../../src/lib/db/driver.js). [`tests/unit/db-driver-chain.test.js`](../../tests/unit/db-driver-chain.test.js) verifies that when both `better-sqlite3` and `node:sqlite` fail, driver resolution falls back to `sql.js`.
   - Asset preservation: Next.js file tracing silently drops WASM assets. [`scripts/build-app.mjs`](../../scripts/build-app.mjs) and [`Dockerfile`](../../Dockerfile) explicitly copy `sql-wasm.js` and `sql-wasm.wasm` into `.next/standalone`. Guarded by [`tests/unit/port-27f3710c8-sqljs-runtime.test.js`](../../tests/unit/port-27f3710c8-sqljs-runtime.test.js).
   - *Limitation*: Marked as *"Component tested, server untested"* because no test boots the server with native drivers forced off.
3. **PostgreSQL & Worker Threads**:
   - PostgreSQL queries execute synchronously via a `worker_threads` worker ([`src/lib/db/adapters/pgSyncWorker.cjs`](../../src/lib/db/adapters/pgSyncWorker.cjs)) using `SharedArrayBuffer` and `Atomics`.
   - [`tests/unit/db/pgSyncWorker-result-transfer.test.js`](../../tests/unit/db/pgSyncWorker-result-transfer.test.js) verifies worker protocol result and error transfer across secondary buffers.
   - Migration DDL parity between SQLite and PostgreSQL is checked by [`scripts/check-postgres-migrations.mjs`](../../scripts/check-postgres-migrations.mjs).
   - Isolation: [`tests/unit/db/noPgImportWhenSqlite.test.js`](../../tests/unit/db/noPgImportWhenSqlite.test.js) asserts static module graph isolation, ensuring `pg` is never imported when SQLite is active.
   - *Limitation*: Marked as *"Migration parity tested, live server untested"* because CI runs no live PostgreSQL container.
4. **Web Sessions (Playwright / Chromium)**:
   - Handled via `open-sse/executors/websession-utils.js` (tested in `tests/unit/omniroute-websession-runtime.test.js` for abort and timeout propagation).
   - Docker container supports optional Playwright browser installation (`ARG CHATGPT_WEB_BROWSER=false`).
   - *Limitation*: Marked as *"Untested"* in `docs/deployment/compatibility.mdx` because no test drives a live browser session.
5. **System Tray (CLI)**:
   - Uses `systray2@2.1.4` (macOS/Linux) or PowerShell `NotifyIcon` (Windows).
   - *Limitation*: Marked as *"Untested"* because CI runs headless (`DISPLAY` unset) and no test initializes a system tray.
6. **Standalone Artifacts & Smoke Verification**:
   - `custom-server.js` sits outside Next.js standalone tracing root. [`cli/scripts/standaloneSidecars.js`](../../cli/scripts/standaloneSidecars.js) copies mandatory sidecars: `custom-server.js`, `head-response-guard.cjs`, and `web-login-host-boundary.cjs`.
   - [`tests/unit/1143-artifact-compat.test.js`](../../tests/unit/1143-artifact-compat.test.js) validates staged CLI fast paths and sidecar loading with stubbed machine ID and verifies `validateArtifact` rejects missing entries.
   - [`scripts/smoke-installed-artifact.mjs`](../../scripts/smoke-installed-artifact.mjs) and [`scripts/smoke-npm-pack.mjs`](../../scripts/smoke-npm-pack.mjs) provide full HTTP server startup, health probe, login verification, session cookie check, settings modification, and auth denial verification on Linux x64 in `.github/workflows/artifact-smoke.yml` and `release.yml`.
7. **Target OS & Architecture Breakdown**:
   - As cataloged in [`docs/deployment/compatibility.mdx:42-51`](../../docs/deployment/compatibility.mdx):
     - **Linux x64**: Tested (source, npm, standalone).
     - **Linux x64 (Docker)**: Health-checked (`/api/health` only).
     - **Linux arm64 (Docker)**: Health-checked (`/api/health` on `ubuntu-24.04-arm`).
     - **Linux arm64 (bare metal)**: Untested.
     - **macOS arm64**: Checked manually once pre-migration on Node 26. Not in CI. Untested on Node 24.
     - **macOS x64**: Untested.
     - **Windows x64**: Untested.
     - **Windows arm64, Linux arm (32-bit), Bun**: Untested.

### Criterion 3: Migration / Recovery Guide Publication and Deterministic CI Gate Maintenance

1. **Published Operational Guides**:
   - [`docs/deployment/compatibility.mdx:59-72`](../../docs/deployment/compatibility.mdx):
     - Comprehensive 5-step procedure: Stop writers, create full verified backup with secrets (`JWT_SECRET`, `API_KEY_SECRET`, `master-key`), install Node 24.22.2 and reinstall dependencies (`pnpm install --frozen-lockfile`), restore `DATA_DIR` with matching secrets, inspect startup driver logs, and verify health and inference.
     - Recovery from failed moves: native driver fallback to `sql.js`, PostgreSQL boot fallback to SQLite, and restoring pre-move backups for corrupted SQLite.
   - [`docs/operations/upgrading.mdx:10-85`](../../docs/operations/upgrading.mdx):
     - Detailed instructions for Docker, npm, and Source upgrades.
     - Pre-bump checks: recording `node --version`, verifying engine range, checking Docker image digest.
     - Post-bump verification: curl `/api/health`, `/v1/models`, authenticated inference check, database usage row confirmation, dashboard inspection.
     - Rollback procedure: 5-step rollback including restoring previous Node runtime and rebuilding previous artifact.
   - [`docs/reference/cli.mdx:17-29, 49-68`](../../docs/reference/cli.mdx):
     - Published runtime and artifact evidence matrix detailing exact test evidence and limits for Linux x64, standalone, npm package, Docker, and non-Linux platforms.
     - Memory heap settings (`NINEROUTER_MAX_OLD_SPACE_SIZE`) and optional dependency installation details.
2. **Deterministic Required CI Gate**:
   - Managed in [`.github/workflows/test.yml`](../../.github/workflows/test.yml):
     - Pins `node-version: 24.22.2` and `version: 12.18.0` for pnpm.
     - Executes `pnpm run test:ci` in `tests/`, invoking `node __baseline__/run-ci.mjs` and `verify-no-regression.mjs`.
     - Fails closed on any unexpected test failure; [`tests/__baseline__/known-fails.txt`](../../tests/__baseline__/known-fails.txt) is completely empty.
     - Enforces output of `.test-results.json` and `.test-results.junit.xml`.
   - Local-first CI authority ([`scripts/local-ci.mjs`](../../scripts/local-ci.mjs)):
     - Operates in `--mode full` by default, running complete test inventory, reports, and commitlint checks in unprivileged isolated environments.

---

## 4. Concrete Outstanding Gaps, Verification Limitations & Architectural Boundaries

In accordance with the issue delivery contract ("do not claim completion without proof"), the following concrete gaps, boundaries, and limitations are documented:

### 1. Multi-Platform CI Execution Gap (macOS and Windows Untested in CI)
- **Status**: The CI gate (`test.yml`) and build workflows run exclusively on Ubuntu Linux x64 runners (`ubuntu-latest`).
- **Impact**: There are no automated CI jobs running on macOS (x64 or arm64) or Windows (x64 or arm64). Although launcher hooks contain platform-specific code (e.g., PowerShell `NotifyIcon`, Windows path handling, macOS plist autostart), their actual execution on those operating systems is untested by automated gates.

### 2. Native SQLite Prebuild Verification Pending for Node 24
- **Status**: As explicitly documented in [`docs/deployment/compatibility.mdx:25`](../../docs/deployment/compatibility.mdx), `better-sqlite3` native loading, ABI prebuild availability, and driver selection remain marked as *"Pending Node 24 validation"*.
- **Impact**: While upstream `better-sqlite3` 12.11.1 declares support for Node 20.x–26.x, prebuild download and binding on non-Linux platforms under Node 24.22.2 has not been validated in this repository's automated CI.

### 3. Absence of Live PostgreSQL Server Testing
- **Status**: Migration DDL parity is validated by `scripts/check-postgres-migrations.mjs` and worker result transfer is tested in `pgSyncWorker-result-transfer.test.js`, but no CI job provisions or starts a real PostgreSQL container.
- **Impact**: Server behavior against a live PostgreSQL database instance (including connection drop recovery, connection pooling, and multi-version PostgreSQL 16/17/18 compatibility) remains untested in CI.

### 4. Pure-JS `sql.js` HTTP Server Runtime Untested
- **Status**: Driver fallback logic and WASM asset copying are tested in unit suites (`db-driver-chain.test.js`, `port-27f3710c8-sqljs-runtime.test.js`), but no test runs the full HTTP server with native drivers forcefully disabled.
- **Impact**: The server is not known from CI evidence to successfully serve production HTTP traffic end-to-end solely on `sql.js`.

### 5. CLI System Tray Untested
- **Status**: Automated test environments are headless (`DISPLAY` is unset).
- **Impact**: The system tray (`systray2` on Linux/macOS, PowerShell `NotifyIcon` on Windows) is never initialized, clicked, or verified in CI. Marked as *"Untested"*.

### 6. Web-Session Real Browser Automation Untested
- **Status**: Playwright browser downloads are disabled in test environments (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).
- **Impact**: No test drives a real browser session using Chromium under Xvfb for web session providers. Marked as *"Untested"*.

### 7. Hermetic Execution Boundaries
- **Status**: All tests in `tests/unit/1143-runtime-compat.test.js` and `tests/unit/1143-artifact-compat.test.js` run offline without contacting external networks, live AI providers, or Docker daemons.
- **Impact**: Staged artifact tests use a stubbed machine ID and isolated directories to verify CLI fast paths (`--help`, `--version`) and sidecar loading; they do not exercise a live running gateway serving external inference requests.

---

## 5. Conclusion & Acceptance Status Summary

The acceptance criteria defined in GitHub issue #1143 are mapped with truthful evidence:
1. **Choose Supported Node Versions from Evidence**: **Met (Evidence-Bounded)**. Node `24.22.2` (range `>=24.22.2 <25`) and `pnpm@12.18.0` are chosen and locked across all manifests, `.nvmrc`, Dockerfile, workflows, and documentation, guarded by `tests/unit/node-version-alignment.test.js` and `tests/unit/1143-runtime-compat.test.js`.
2. **Verify SQLite native/sql.js/PostgreSQL, workers, web sessions, CLI tray and standalone artifacts on target OS/architectures**: **Partially Met / Documented Gaps**. Unit-level driver fallback, worker protocol transfer, migration parity, and staged artifact compatibility pass offline on Linux x64 (verified by 3 tests in `1143-runtime-compat.test.js` and `1143-artifact-compat.test.js` and 38 additional tests across related suites). As candidly cataloged in `docs/deployment/compatibility.mdx`, macOS, Windows, live PostgreSQL, live web sessions, and CLI tray remain unexercised in CI and are correctly documented as untested rather than claiming unsupported completion.
3. **Publish Migration/Recovery Guide and Maintain Deterministic Required CI Gate**: **Met**. Step-by-step migration, driver startup verification, and rollback procedures are published in `docs/deployment/compatibility.mdx`, `docs/operations/upgrading.mdx`, and `docs/reference/cli.mdx`. A single deterministic required CI gate is enforced in `.github/workflows/test.yml` and `scripts/local-ci.mjs` against an empty failure baseline.
