# Criterion 3 failing-before evidence (PR #1271 / #1115)

Method: git worktree at merge-base with `origin/main`, overlay this PR's authorization/ownership test files, run Vitest with Node 20.20.2 / npm 10.8.2.

- base SHA: `5209b4aec3953106439231093c0c504af556959f` (= `origin/main` at evidence time; also `git merge-base HEAD origin/main`)
- overlay: PR versions of
  - `tests/unit/resource-ownership.test.js`
  - `tests/unit/native-provider.test.js`
  - `tests/unit/fleet-pr1271-cancel-ownership.test.js`
  - `tests/unit/public-api-encoded-routing.test.js`
  - `tests/unit/security-authorization-matrix.test.js`
- command shape: `cd <worktree>/tests && node node_modules/vitest/vitest.mjs run <file> --maxWorkers=2`
- fleet suite also required `DATA_DIR=<temp> NODE_ENV=test` (same isolation the scoped wrapper provides)

## Failing results

| File | Result |
| --- | --- |
| `unit/resource-ownership.test.js` | **8 failed / 8 passed (16)** |
| `unit/native-provider.test.js` | **58 failed / 29 passed (87)** |
| `unit/fleet-pr1271-cancel-ownership.test.js` | **6 failed / 0 passed (6)** with `DATA_DIR`+`NODE_ENV=test` |
| `unit/public-api-encoded-routing.test.js` | **17 failed / 7 passed (24)** |
| `unit/security-authorization-matrix.test.js` | **3 failed / 603 passed (606)** |

### Failing test names

**resource-ownership (8):** for both `accepted auth supplied=false` and `true`:
- uses the valid x-api-key owner despite stale Bearer (required=false)
- uses the valid x-api-key owner despite stale Bearer (required=true)
- rejects a stored inactive key without another valid credential
- rejects a stored expired key without another valid credential

**native-provider (58):** Anthropic `/v1/files` and `/v1/messages/batches` ownership suites (create/read/content|results/cancel/delete, foreign/unknown denial, operator known-only, cursor after_id/before_id validation and list filtering/pagination bounds), plus completion pricing/local-owned poll, xAI stream owner persistence, and shared-account foreign file/batch denial.

**fleet-pr1271-cancel-ownership (6):**
- waits for persistence before releasing a split ID and completes exactly once without reframing bytes
- does not release an ID-bearing chunk when ownership persistence fails
- persists ownership before usable JSON ID bytes and retains it after HTTP client cancellation before EOF (files)
- fully consumed creation permits creator mutation, denies foreign owners, and keeps operator unknown-owner fail-closed (files)
- persists ownership before usable JSON ID bytes and retains it after HTTP client cancellation before EOF (batches)
- fully consumed creation permits creator mutation, denies foreign owners, and keeps operator unknown-owner fail-closed (batches)

**public-api-encoded-routing (17):** encoded static prefixes (cli/owner), canonical static routes (`/v1/chat/completions`, `/v1/responses/compact`, `/responses`, `/codex/responses`, `/v1beta/models`), raw dynamic suffixes, encoded `files/[id]/content`, `batches/[id]/cancel`, `messages/batches/[id]/{cancel,results}`, unknown/double-encoded/nonterminal leaves, malformed/separator-expanded candidates, query/POST/body preservation, MiMo session cookie handling.

**security-authorization-matrix (3):**
- preserves local anonymous ownership (requireApiKey=false)
- preserves local anonymous ownership (requireApiKey=true)
- uses the authenticated x-api-key owner when Bearer is stale

## Cases that cannot fail on main (with reason)

1. **`tests/security-authorization-http.mjs`** — not a Vitest file; requires a disposable live Next fixture server, recording provider journal, and generated principal manifest that are not in this repository. Cannot produce offline failing-before against main source alone.
2. **`security-authorization-matrix.test.js` — 603 passing rows on main** — those rows already pass against current main's native ownership/handler surface (main already records/enforces Anthropic file/batch owners for the mocked matrix paths). They cannot demonstrate a failing-before delta for this PR versus current main; only the 3 principal-resolution rows above fail.
3. **`native-provider.test.js` — 29 passing rows on main** — pre-existing non-ownership (or already-implemented ownership) cases on main; not failing-before evidence for this PR's delta.
4. **`public-api-encoded-routing.test.js` — 7 passing rows on main** — negative/guard-only rows that already deny without `guardedApiDispatch`; they do not exercise the missing encoded rewrite API.
5. **`resource-ownership.test.js` — 8 passing rows on main** — CLI operator and local-fallback cases already aligned with main's older `resolveResourceOwner`; not failing-before for the accepted-principal fix.

Raw Vitest logs retained under `/tmp/criterion3-failing-before/` for this agent run (not published as secrets; no credentials).
