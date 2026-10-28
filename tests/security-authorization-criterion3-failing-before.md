# Criterion 3 failing-before evidence (PR #1271 / #1115)

Independently re-run (not fabricated). Method: detached git worktree at `origin/main`, overlay this PR's authorization/ownership Vitest files onto main's production sources, then run the same files on the PR tip.

- **Main / merge-base SHA:** `5209b4aec3953106439231093c0c504af556959f`
- **PR tip used for pass-after:** `6b5dad63fff666ab7b70eb57b7a80c6691778a8e` (production and the five suites unchanged by the documentation commit that records this evidence)
- **Main production files confirmed (blob = `origin/main`):**
  `src/proxy.js`, `src/sse/handlers/nativeProvider.js`, `src/sse/handlers/nativeProviderConfig.js`,
  `src/sse/services/nativeResourceOwners.js`, `src/sse/services/nativeUsage.js`,
  `src/sse/services/resourceOwnership.js` (all six exist on main)
- **Overlay (PR versions into the main worktree):**
  - `tests/unit/resource-ownership.test.js`
  - `tests/unit/native-provider.test.js`
  - `tests/unit/fleet-pr1271-cancel-ownership.test.js`
  - `tests/unit/public-api-encoded-routing.test.js`
  - `tests/unit/security-authorization-matrix.test.js`
- **Toolchain:** Node `v20.20.2` / npm `10.8.2`
- **Command (fail-before and pass-after):**

```sh
cd <checkout>/tests
DATA_DIR="$(mktemp -d /tmp/dd-c3-XXXXXX)" NODE_ENV=test \
  node node_modules/vitest/vitest.mjs run <file> --maxWorkers=2
```

Combined pass-after also used the five files in one Vitest invocation with the same `DATA_DIR` / `NODE_ENV` / `--maxWorkers=2` shape.

Scratch worktree was not committed.

## Failing-before (main production + PR tests)

| File | Result |
| --- | --- |
| `unit/resource-ownership.test.js` | **8 failed / 8 passed (16)** |
| `unit/native-provider.test.js` | **58 failed / 29 passed (87)** |
| `unit/fleet-pr1271-cancel-ownership.test.js` | **6 failed / 0 passed (6)** |
| `unit/public-api-encoded-routing.test.js` | **17 failed / 7 passed (24)** |
| `unit/security-authorization-matrix.test.js` | **3 failed / 603 passed (606)** |

**Totals on main overlay:** **92 failed / 647 passed (739)** across five files.

Matrix collected 606 cases on main (config-driven expansion); the same file collects 760 cases on the PR tip.

### Representative failing tests

**resource-ownership (8):** for both `accepted auth supplied=false` and `true`:
- uses the valid x-api-key owner despite stale Bearer (required=false / true)
- rejects a stored inactive key without another valid credential
- rejects a stored expired key without another valid credential

**native-provider (58):** Anthropic `/v1/files` and `/v1/messages/batches` ownership (create/read/content|results/cancel/delete, foreign/unknown denial, operator known-only, `after_id`/`before_id` cursor validation, list filtering/pagination), plus completion pricing/local-owned poll, xAI stream owner persistence, and shared-account foreign file/batch denial. Examples: `records creation ownership before allowing the creator to read the resource`, `denies foreign and unknown ownership before POST /cancel dispatch`, `rejects another key's native Anthropic file content on a shared account`.

**fleet-pr1271-cancel-ownership (6):**
- waits for persistence before releasing a split ID and completes exactly once without reframing bytes
- does not release an ID-bearing chunk when ownership persistence fails
- persists ownership before usable JSON ID bytes and retains it after HTTP client cancellation before EOF (files / batches)
- fully consumed creation permits creator mutation, denies foreign owners, and keeps operator unknown-owner fail-closed (files / batches)

**public-api-encoded-routing (17):** encoded static prefixes (cli/owner), canonical static routes, encoded `files/[id]/content`, `batches/[id]/cancel`, `messages/batches/[id]/{cancel,results}`, unknown/double-encoded/nonterminal leaves, malformed candidates, query/POST/body preservation, MiMo session cookies. Dominant failure mode under main: `TypeError: Invalid URL` from missing post-guard encoded rewrite.

**security-authorization-matrix (3):**
- preserves local anonymous ownership (requireApiKey=false / true)
- uses the authenticated x-api-key owner when Bearer is stale

## Pass-after (PR tip)

| File | Result |
| --- | --- |
| `unit/resource-ownership.test.js` | **16 passed (16)** |
| `unit/native-provider.test.js` | **87 passed (87)** |
| `unit/fleet-pr1271-cancel-ownership.test.js` | **6 passed (6)** |
| `unit/public-api-encoded-routing.test.js` | **24 passed (24)** |
| `unit/security-authorization-matrix.test.js` | **760 passed (760)** |

**Combined five-file run:** **5 files passed, 893 passed / 0 failed**.

## Cases that cannot fail on main (with reason)

1. **`tests/security-authorization-http.mjs`** — not Vitest; needs a disposable live Next fixture server, recording journal, and generated principal manifest absent from the repo.
2. Rows that already pass on main (counts above) — already-implemented behavior; not a failing-before delta for this PR.
3. Matrix case-count delta (606 on main overlay vs 760 on PR tip) — generation follows production config; main collects fewer rows, so pass-after is not a 1:1 row rematch for every matrix id.

Raw Vitest logs: `/tmp/criterion3-failing-before-rerun/` (no credentials).
