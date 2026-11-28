# PR #2709 focused correction continuation

## Scope and provenance

This unit recovers only the owned diff from source base
`de463e2da47b46311f5a4ad439ba3cf09e025bfc` to
`b32559eab3a2feb7942c9186fffdc677c0c1c6ee`, on unit base
`a926a098adc2923cd96f974ea30afb2f3d86a54c`. The exact production patch applied without conflicts and preserved
later source changes. The historical `model-resolution-review-2709.md` report
was neither copied nor edited. No unrelated integration history was applied.

The only new correction is three exact `getModelInfo` assertions in
`chat-policy-sequence.test.js`, each retaining its model string and adding
`{ rejectUnknownBare: true }`. All nine rows, endpoint decoding controls,
policy/error assertions and media positive controls remain.

## Recovered behavior

Shared `getModelInfo` defaults to the prior OpenAI passthrough for unknown bare
media names. The real media pipeline and TTS callers use that default; the chat
resolution stage explicitly requests unknown-bare rejection. Unknown404,
qualified raw model identities and custom-model visibility are preserved.

Unresolved and ambiguous names undergo API-key model policy before routing
details are returned. Restricted ambiguity returns 403 without credential
selection or dispatch; unrestricted ambiguity retains 400. Only optional custom
metadata reads fail open. Routing alias-store failures still throw.

The unit base already had registry-supported `openai/gpt-4o` fixtures in both
protected admission chat rows. Those literals and all four credential/status
cases remain unchanged. Recovery adds only the owned explanatory comment there.

## Evidence

Every test child used the existing credential-allowlisting
`run-isolated-evidence.py` wrapper with private HOME, DATA_DIR, TMPDIR and caches
under `/var/tmp`, an outer 295-second ceiling and inner command ceilings.
Shared dependency directories were borrowed through local symlinks without
installation. The initial default Vitest config loader created temporary cache
files under the borrowed dependency link. This did not satisfy the read-only
cache boundary. The final verification uses native config loading and disables
caching. No shared cache cleanup or dependency repair was attempted. No source
fetch or live provider request ran.

Initial unit-base control with the recovered regression file, original chat
sequence and full admission file used two workers. It failed six assertions:
four reproduced product regressions plus two unrelated database-lock failures.
It is not a clean baseline verdict. Log:
`/var/tmp/durindoor-evidence-0829tabm/home/before.log`.
The subsequent controls and final gate use one worker to avoid shared private
DATA_DIR contention.

With corrected production and the original chat sequence assertions, the exact
focused command failed three and passed six rows, matching the diagnosed call
arity mismatch. Log:
`/var/tmp/durindoor-evidence-40r_jm_e/home/arity-before.log`.

For reviewed-source reproduction, only the two production files and protected
admission file were temporarily substituted from pinned reviewed head
`77215b64e55bedca6c3c60b0b26fd4be537911b0` into this unit worktree.
The recovered exported-function regressions and complete protected admission
file produced eight failures and 41 passes: media passthrough, two ambiguity
policy rows, optional metadata failure and all four chat admission cases.
The four admission failures retained the exact expected credential error and
received the unknown `invalid` model error. This is a pinned-file substitution
control on the current dependency/source context, not an untouched historical
checkout. A finally block restored every candidate file byte-for-byte. Log:
`/var/tmp/durindoor-evidence-40r_jm_e/home/reviewed-source-before.log`.

The corrected six-file gate passed 92 tests, including all nine chat sequence
rows, the full admission file, media controls and unchanged unknown404 coverage.
Log: `/var/tmp/durindoor-evidence-bwrgcqcy/home/after.log`.

The gate payload is:

```sh
cd tests
timeout 290 node node_modules/vitest/vitest.mjs run \
  unit/model-resolution-review-2709.test.js \
  unit/review4-bare-model-identities.test.js \
  unit/review4-model-policy-precedence.test.js \
  unit/unknown-model-404.test.js \
  unit/review-r-admit-migrate.test.js \
  unit/chat-policy-sequence.test.js --maxWorkers=1 --configLoader native --no-cache --reporter=verbose
```

Final verification after byte-for-byte restoration also passed all 92 tests
with `--configLoader native --no-cache`, exit 0. Log:
`/var/tmp/durindoor-evidence-d6feh1tt/home/final-no-cache.log`.
Scoped ESLint passed for both production files and all four changed/new test
files, exit 0. Log: `/var/tmp/durindoor-evidence-ee5grgel/home/lint.log`.
Documentation integrity and `git diff --check` passed. Docs log:
`/var/tmp/durindoor-evidence-9rnpfn1f/home/docs.log`.

The red-control commands, each run from `tests/` within the same private wrapper,
were `timeout 130 node node_modules/vitest/vitest.mjs run
unit/chat-policy-sequence.test.js --maxWorkers=1 --reporter=verbose` and
`timeout 130 node node_modules/vitest/vitest.mjs run
unit/model-resolution-review-2709.test.js unit/review-r-admit-migrate.test.js
--maxWorkers=1 --reporter=verbose`. Each exited 1; raw logs above retain the
literal failing expectations. The substitution/restore script remains at
`/var/tmp/2709-red-controls.py`.

Post-commit commitlint could not run: `timeout 120 node
node_modules/@commitlint/cli/cli.js --from HEAD^ --to HEAD` exited 1 with
`MODULE_NOT_FOUND` for `node_modules/@commitlint/cli/cli.js`. The borrowed root
dependencies also have no `.bin/commitlint`. No install was attempted. The local
subject uses `fix(models):` and is under 100 characters; this does not replace
the missing commitlint gate.

## Delivery boundary

This is a bounded local correction, not full CI or independent-review approval.
No baseline entries or registry/UI/gate changes were made. No tracked indexes
or bundles were generated.
No published PR/head, frozen source, production service or other worktree was
changed. No push or merge is authorized. Root retains final assembly, independent
review and exact-head full-CI qualification.
