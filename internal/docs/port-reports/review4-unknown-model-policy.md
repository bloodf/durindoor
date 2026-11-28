# Review4 unknown-model policy precedence

Local source/base: `04e6a8a49cfb69f08f2d25766d40b9c47d725687`.
Upstream port provenance recorded by the existing unknown-model tests:
OmniRoute #21349 / KEA-9627, `b3ea831f1b9a2ddb5fc809f026d79cc49a932b02`.
This correction was developed and verified against the local base, not an
upstream checkout. Its source commit is the commit containing this report
(`git log -1 --format=%H -- src/sse/handlers/chat/singleModel/resolveModel.js`).
The final handoff records that exact commit SHA.

The resolver returned a local 404 before admission could enforce API-key model
policy. A key allowing only `openai/gpt-4o` therefore received 404 for a missing
bare name but 403 for its explicit `openai/` form. The missing-model branch now
calls the existing policy function with windowed limits disabled before returning
404. Resolved aliases still reach admission with their underlying identity;
malformed/ambiguous names retain their existing validation. Composite requests
retain their existing terminal 403 behavior and policy-rejection markers. No
exposure list, credential ordering, provider dispatch, or policy bypass changed.

## Handler evidence

The standalone `tests/unit/review4-model-policy-precedence.test.js` invokes the real
POST chat handler with an authenticated restricted API key. It uses disposable
SQLite fixtures rather than replacing the database policy implementation with
mocks. Global fetch is mocked, and provider credential selection is spied on.
All connection credentials are synthetic. This exercises real auth, alias
resolution, policy, composite routing, and connection-state persistence.

| Request under the same restricted key | Original source | Corrected source |
| --- | --- | --- |
| Missing bare model | 404 | 403 |
| Explicit openai/missing model | 403 | 403 |
| Missing bare alias | 404 | 403 |
| Configured alias to denied model | 403 | 403 |
| Configured alias to allowed model | 200 | 200 |
| Valid bare/prefixed allowed model | 200 | 200 |
| Malformed slash forms | 400 | 400 |
| Composite beginning with denied unknown leaf | 200 | 403 |
| Composite containing only denied unknown leaf | 404 | 403 |

Rejected standalone requests and composites assert zero upstream fetches and no
provider credential selection. Composite rejection leaves quota health healthy,
connection status active, and connection cooldown/locks absent. The original
protected unknown-model suite remains unchanged and proves unrestricted 404,
valid routing, malformed 400, and unrestricted non-cooling fallback.

Before the fix, the finalized standalone regression file produced four failures
and seven passes. The same assertions produced four failures and 20 passes
when combined with the original 13 tests. After the fix, seven focused
files passed all 65 tests. The standalone file contains 11 cases. Scoped ESLint
and `git diff --check` passed. Related suites cover API-key routing, identity,
model-access enforcement, composite access, and stage exports. A diagnostic about
an incomplete combo mock was printed by the existing combo suite; it passed.
No full CI or full-suite claim is made. No existing test assertions or failure
baselines changed.

## Portable reproduction

From this checkout, reuse installed dependencies. If dependencies are absent,
root and tests frozen-lockfile installs are essential; run each through the same
isolated wrapper below with a private `--store-dir "$run_dir/store"`. No CLI
install was needed for these selected files. Every command has a 300-second cap.

```sh
run_dir=$(mktemp -d /var/tmp/review4-policy.XXXXXXXX)
mkdir -m 700 "$run_dir/home" "$run_dir/data" "$run_dir/tmp" "$run_dir/cache" "$run_dir/store"
run() {
  env -i PATH=/usr/local/bin:/usr/bin:/bin \
    HOME="$run_dir/home" DATA_DIR="$run_dir/data" TMPDIR="$run_dir/tmp" \
    XDG_CACHE_HOME="$run_dir/cache" npm_config_cache="$run_dir/cache/npm" \
    COREPACK_HOME="$run_dir/cache/corepack" timeout 300 "$@"
}
run node tests/node_modules/vitest/vitest.mjs run \
  --config tests/vitest.config.js --maxWorkers=2 \
  tests/unit/review4-model-policy-precedence.test.js \
  tests/unit/unknown-model-404.test.js \
  tests/unit/api-key-policy-routing.test.js \
  tests/unit/api-key-policy-identity.test.js \
  tests/unit/api-key-model-access.test.js \
  tests/unit/combo-access-control.test.js \
  tests/unit/review-x-single-model-stages.test.js
run node node_modules/eslint/bin/eslint.js \
  src/sse/handlers/chat/singleModel/resolveModel.js \
  tests/unit/review4-model-policy-precedence.test.js
```

Actual installs, probes, tests, and lint used `env -i` and private HOME, DATA_DIR,
TMPDIR, caches and store under `/var/tmp/dd-review4-VLNv3eIo`. Logs remain there
privately; this path is not a portable prerequisite. Original-source comparisons
temporarily substituted only resolveModel.js from the exact local base and
restored the corrected file afterward. They compare that source on the same
integration runtime, not entire historical trees. No provider/publisher tokens,
real runtime data, host services/settings, GitHub writes, agents, main merges,
or frozen-train changes were used.

## Gate selector correction

The evidence gate rejected source commit
`cd37572a17aa8d0ef527888dccf345609acaafa1` because its selector
`unit/review4-model-policy-precedence.test.js` collected no files. Renamed the
standalone regression file to that exact path and updated the portable commands.
Test assertions and production code are unchanged. The exact selector, run from
`tests/`, now collects and passes all 11 cases. Scoped ESLint and
`git diff --check` pass. This correction does not claim a complete gate rerun.

## PR #2709 ambiguity amendment

At reviewed head `77215b64e55bedca6c3c60b0b26fd4be537911b0`, the missing-model
branch enforced policy but custom ambiguity still returned 400 first. That
validation claim did not establish policy isolation for ambiguity. Both
unresolved outcomes now enforce policy on the raw requested name before
returning details. Unrestricted ambiguity remains 400; restricted ambiguity
returns 403 without credential selection. See [the continuation report](2709-focused-correction-continuation.md).
