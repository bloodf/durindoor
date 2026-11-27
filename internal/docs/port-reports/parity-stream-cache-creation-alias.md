# Top-level cache creation alias

Disposition: DONE. Reviewed and implemented 2026-11-27.

## Revisions and ownership

- Starting candidate: `43e836bd087afaef16e2972c413834129f268ced`.
- Refreshed `origin/main`: `f14f877ec13d6a9c58ed5a7d8f665526f748e76e`.
- Refreshed 9router `master`: `5ae63d22847e07042e235b40e1d926b65e509013`.
- Fetched #5904 source: `b2b7ce1c6f9437ea344c9e05d1cd743d79892eea`.
- Inspected local #2627 snapshot `2d8065ac5df9e1543be790347b8a4b6ad7da2b24`, including its translator diff against main. Its `estimated !== true` measurement guard and interrupted-tool handling remain separate changes. This patch changes only cache alias selection, with no edits to measurement/estimate handling or terminal state. That snapshot is not an ancestor of this candidate; this bounded port does not merge it.

Read the contributor contract, tooling guide and [literal acceptance report](parity-stream-usage-review.md). The CodeGraph ownership query `sh scripts/codegraph.sh query extractUsage --limit 5 --json` returned “CodeGraph not initialized”. Bounded searches of the named usage/translator files and tests supplied ownership evidence. No index or generated files were changed.

## Behavior

The existing shared normalizer and OpenAI-to-Claude conversion now accept top-level `cache_creation_tokens` as an inclusive prompt subset. Shared OpenAI extraction forwards the alias to normalization. Canonical cache creation and the existing flat cache-write spelling retain precedence, including explicit zero. The new alias accepts only finite nonnegative numbers.

For prompt 100, completion 5, cached 20 and creation alias 30, both inline and trailing usage produce exactly input 50, output 5, read 20 and write 30. Shared extraction and the completion callback retain canonical prompt 100 and write 30. Nested aliases and ordinary usage retain their existing behavior.

No #5890 timing code was ported. The existing finish hold, measured usage path and single terminal emission remain in place. `stream.js` was not changed.

Numeric-validation divergence from #5904 is intentional. The new alias does not coerce numeric strings, booleans or objects. Existing `hasValidUsage` typed validation still rejects string-only prompt/completion receipts. Existing coercion in shared normalization for older fields remains untouched; this report does not claim that every shared helper rejects all numeric strings. Upstream `Number(...)` conversion and its conflicting alias precedence were not copied.

## Evidence

Installed root, CLI and tests dependencies using frozen lockfiles and prefer-offline. No lockfile changed.

Before the fix, the new gateway regression tests failed in both inline and trailer variants: input 80 and no write count instead of input 50 and write 30. An independent shared-extraction assertion also failed against the original usageTracking.js implementation, restored only for that red check and then returned to the fixed contents.

Final required command, from `tests/`, exited 0 with four files and 36 tests passing:

```sh
timeout 300 node node_modules/vitest/vitest.mjs run unit/parity-stream-cache-creation-alias.test.js unit/port9r-5890-claude-stream-usage.test.js unit/stream-heartbeat-usage-trailer.test.js translator/port-2279-claude-finish-guard.test.js --maxWorkers=2
```

The final run used an empty child environment with PATH, locale and private temporary HOME, DATA_DIR, cache and tmp directories. It received no provider or publisher credentials. Coverage includes top-level and nested aliases, canonical zero, negative/nonfinite/malformed aliases, numeric-string validation, ordinary usage, inline/trailing counts, completion callback accounting and exactly one terminal pair. Nonfinite aliases reach shared extraction directly and serialize as null over SSE, matching JSON transport behavior. `git diff --check` passed.

No full suite, build, production service operation or GitHub write ran. Failure baseline unchanged. Full local CI and independent cross-family review remain PR gates outside this work order. This report belongs to the same commit as the implementation and regression tests; the handoff records its exact commit SHA.

## Gate follow-up

The external gate reported 714 passing tests across 79 files, but rejected the new runtime `typeof` expression under `anti-slop(no-runtime-typeof)`. Replaced that expression with the already imported `isNumber` predicate, matching the Claude converter and existing validation conventions. Finite and nonnegative checks remain intact. No baseline or generated artifact was changed.

After the correction, `pnpm run lint:anti-slop` passed with zero diagnostics across 3226 files. The exact four-file command above passed again with 36 tests in a private child environment. `git diff --check` passed.
