# Review4: restore supported bare model identities

Source review head: `d71edd211730575027b65a47e537184a244fd295`.
Prior source: `491948ee0481d03e6d27ea6a266f74de92c258a2`.
Local starting head: `2cfd8256f5bb9524685072ee988a94fec5bc45ad`.
The three changed resolution files at the local starting head are byte-identical
to the review head. Between the two source SHAs, only the handler resolution
file differs among those three files.

The handler duplicated provider inference with a smaller OpenAI prefix/catalog
whitelist. That rejected previously dispatched wire identities and ignored
operator custom model rows. Resolution now reports unknown bare ids itself;
the handler consumes its existing model_not_found/ambiguous_model outcomes.
Shared inference preserves its default passthrough for other callers. Inference
routes opt into unknown rejection. The existing OpenAI catalog and lifecycle
records remain authoritative; fine-tunes infer from their base while retaining
the complete wire id. Two legacy OpenAI wire ids absent from the current catalog
are explicit compatibility identities, rather than another name-pattern regex.
Unresolved custom ids resolve through their stored provider, including node
resolution. Multiple distinct targets require qualification. Combos, aliases,
and existing prefix inference keep precedence; qualified requests still pass
through the existing resolver.

## Real handler evidence

All requests used real POST /v1/chat/completions routing, a disposable SQLite DB,
a synthetic connection key and a mocked global fetch. No provider calls occurred.
The mock responds successfully to any attempted dispatch, so an upstream 404
cannot be mistaken for the local rejection. Successful cases assert exactly one
fetch and the unchanged outgoing model; local rejection cases assert zero fetches.

| Literal | Prior source resolver | Before correction | Corrected |
| --- | --- | --- | --- |
| ft:gpt-4o-mini-2024-07-18:acme::abc123 | 200 / 1 fetch | 404 | 200 / 1 fetch |
| chatgpt-4o-latest | 200 / 1 fetch | 404 | 200 / 1 fetch |
| codex-mini-latest | 200 / 1 fetch | 404 | 200 / 1 fetch |
| custommodel (stored OpenAI custom row) | 200 / 1 fetch | 404 | 200 / 1 fetch |
| openai/custommodel | 200 / 1 fetch | 200 / 1 fetch | 200 / 1 fetch |
| computer-use-preview | 410 / 0 fetches | 404 | 410 / 0 fetches |
| genuineunknown | not rerun | 404 / 0 fetches | 404 / 0 fetches |
| review4-shared (OpenAI and xAI custom rows) | not rerun | 404 | 400 / 0 fetches |

computer-use-preview was already retired by the existing lifecycle policy.
Restoring resolution reaches that policy; it does not authorize new dispatch.
Malformed JSON, schema, slash syntax, image and non-chat rejection assertions
remain unchanged. Alias and combo fallback assertions also remain unchanged.

Before editing production code, the expanded handler suite had 6 failures and
15 passes. After correction it had 21 passes. Related verification passed all
84 tests across six files. The prior-source comparison ran the same six literal
cases after temporarily substituting the three resolver files from 491948ee;
all six passed. This is a resolver-source comparison on the local integration
runtime, not a claim of a whole-tree CI run on either historical commit.
The edited files were restored byte-for-byte after that comparison.

## Reproduction and checks

Install root, CLI and tests dependencies with their frozen lockfiles and
--prefer-offline. Run commands with a 300-second ceiling and a private run
directory, with mode 0700 HOME, DATA_DIR and XDG_CACHE_HOME subdirectories.
Use env -i with only PATH and those private paths to exclude host credentials.
The test fixture creates and removes its own additional private HOME/DATA_DIR.

From the repository root:

```sh
timeout 300 node tests/node_modules/vitest/vitest.mjs run \
  --config tests/vitest.config.js --maxWorkers=2 \
  tests/unit/unknown-model-404.test.js \
  tests/unit/claude-bare-model-fallback.test.js \
  tests/unit/model-lifecycle.test.js \
  tests/unit/chatcore-model-lifecycle.test.js \
  tests/unit/non-chat-model-guard.test.js \
  tests/unit/port9r-3871-bare-model-lookup.test.js

NODE_PATH="$PWD/node_modules" timeout 300 node node_modules/eslint/bin/eslint.js \
  open-sse/services/model.js src/sse/services/model.js \
  src/sse/handlers/chat/singleModel/resolveModel.js \
  tests/unit/unknown-model-404.test.js

git diff --check
```

Scoped ESLint passed. Its initial invocation without NODE_PATH failed to resolve
next/dist/compiled/babel/eslint-parser from the shared pnpm store; supplying this
worktree's dependency directory fixed module resolution without dependency edits.
No baseline changes, GitHub writes, service/settings changes, or full-CI claims.

## Isolation amendment

The later isolation override arrived after verification. The initial three
pnpm installs used the inherited environment, per the original work order.
That was not credential-stripped execution. Tests, prior-source comparison and
lint used env -i with private HOME/DATA_DIR/cache under /tmp; they did not set
a private TMPDIR. Test fixtures themselves created disposable private runtime
state. No live provider calls or real runtime data were used. Remaining checks
and commit use env -i, private HOME/DATA_DIR/TMPDIR and caches under /var/tmp,
with a 300-second ceiling. No dependencies are reinstalled.

The final isolated rerun passed all 84 focused tests and scoped ESLint.

## Protected-test gate correction

The gate rejected edits to tests/unit/unknown-model-404.test.js. That file is
restored byte-for-byte to local starting head 2cfd8256f5bb9524685072ee988a94fec5bc45ad.
New real-handler cases now live in tests/unit/review4-bare-model-identities.test.js;
the original protected assertions run unchanged. Earlier test commands and counts
above describe the initial proof before this move. The final command includes both
files, plus the same five related suites. No production behavior changes in this
correction. The gate rejection was a protected-path rejection, not a test failure.

After the protected-test correction: 85 tests passed across seven files; scoped ESLint passed.

## Current-integration continuation

Integration base: `c453942a3f6b7fd192db91f2d61f925fd645fad8`.
Preserved branch head: `725358ac70bb3cd16a5dd897d7383529c13d170a`.
Clean merge and verified local source head:
`bbfc5bc17c1fcbbfebb8d7f6b79a34c8fc0f2f41`.
The merge required no conflict resolution or additional production edits.

Fresh real-handler reproduction temporarily substituted the three resolution
files from the integration base, retaining the actual standalone regression
file. It collected nine tests: three passed and six failed. The fine-tune,
chatgpt-4o-latest, codex-mini-latest and custommodel returned 404 instead of 200;
review4-shared returned 404 instead of 400; computer-use-preview returned 404
instead of 410. A finally block restored all three merged files byte-for-byte.
This compares resolver versions on the current integration runtime, not entire
historical trees.

This worktree initially had no dependencies. Essential frozen-lockfile installs
for root, tests and CLI used env -i, private HOME, DATA_DIR, TMPDIR, cache and
pnpm store under a mode-0700 /var/tmp run directory. Each install, test command
and scoped lint command had a 300-second ceiling. No inherited ORQ variables,
provider credentials or publisher credentials were supplied.

The following portable command replaces the earlier selector example. Run it
from the repository root with dependencies installed. It explicitly guards and
collects the actual new test file alongside the protected existing suites.

```sh
run_dir=$(mktemp -d /var/tmp/review4-check.XXXXXX)
mkdir -m 700 "$run_dir/home" "$run_dir/data" "$run_dir/tmp" "$run_dir/cache"
test -s tests/unit/review4-bare-model-identities.test.js || exit 1
env -i PATH=/usr/local/bin:/usr/bin:/bin \
  HOME="$run_dir/home" DATA_DIR="$run_dir/data" TMPDIR="$run_dir/tmp" \
  XDG_CACHE_HOME="$run_dir/cache" npm_config_cache="$run_dir/cache/npm" \
  NODE_PATH="$PWD/node_modules" \
  timeout 300 node tests/node_modules/vitest/vitest.mjs run \
  --config tests/vitest.config.js --maxWorkers=2 \
  tests/unit/review4-bare-model-identities.test.js \
  tests/unit/unknown-model-404.test.js \
  tests/unit/claude-bare-model-fallback.test.js \
  tests/unit/model-lifecycle.test.js \
  tests/unit/chatcore-model-lifecycle.test.js \
  tests/unit/non-chat-model-guard.test.js \
  tests/unit/port9r-3871-bare-model-lookup.test.js
```

Fresh corrected run: 85 passed, zero failed across seven files, including all
nine standalone regression cases. Scoped ESLint passed for the three production
resolution files and the standalone regression file. All six protected existing
suites are byte-identical to local unit base
`2cfd8256f5bb9524685072ee988a94fec5bc45ad`. Restored production files match the
merged source head exactly. `git diff --check` passed. Private JSON reports and
logs are retained under `/var/tmp/review4-continuation.j3zwWY`; these paths are
local evidence, not portable prerequisites. No full-suite or full-CI claim.
