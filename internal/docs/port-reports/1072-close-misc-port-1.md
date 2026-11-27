# Miscellaneous provider and connection reconciliation, pass 1

Result: **PARTIAL**. Checked the three requested reports in their listed order at local base `dddfa270a8bf20fc69f69b00e24cbc7bcaa19df6`. Only two table rows have a remaining or partial final status. Ledger B has none; ledger C has one concrete PR; the PM report has one aggregate historical backlog row. No runtime behaviour changed.

| Row | PR | Final status | Evidence |
| --- | --- | --- | --- |
| 1. [Ledger C](1072-close-ledger-c.md), Gemini CLI retirement | [#1999](https://github.com/decolua/9router/pull/1999) | out of scope: provider retirement policy, rather than a bug fix or hardening | Fetched PR metadata and the complete diff with `gh api repos/decolua/9router/pulls/1999`, using the diff Accept header for the latter. Current head is `3528c160d015291525dcc74c6661a63eb7473874`, matching the [prior review](1072-nov22-deferred-14.md). The diff deletes the Gemini CLI registry, executor, OAuth service, usage handling, and routing registrations. Local [registry](../../../open-sse/providers/registry/gemini-cli.js), [executor registration](../../../open-sse/executors/index.js), [Google refresh dispatch](../../../open-sse/services/tokenRefresh.js), and [OAuth service](../../../src/lib/oauth/services/gemini.js) still support saved connections. The [documented risk notice](../../../docs/providers/retired.mdx) explicitly preserves routing, refresh, and quota handling. These local paths exist; this is an intentional support-policy difference, not an absent feature. No independent provider bug fix was identified in the deletion patch. A retirement and migration policy remains separate work. |
| 2. [PM report](1072-nov26-pm.md), earlier 9router reports | No PR or head specified | remaining | The source row explicitly says historical deferred, port-candidate, pending, and remaining rows were not enumerated and their final dispositions are unknown. It supplies neither a concrete upstream PR nor local paths, so there is no row-specific diff to fetch. Resolving this requires a separate historical census and reconciliation against later reports. This pass does not claim that backlog is closed or substitute arbitrary historical PRs for the requested table rows. |

## Validation

Staged this report before running the requested documentation, Storybook inventory, model catalog, and settings completeness tests. No test expectations, failure baselines, registry files, or older reports were changed. Documentation-only classification needs no new runtime test or behaviour commit.

Passed all four requested files, 12 tests total:

```sh
cd tests && DATA_DIR=$(mktemp -d) node node_modules/vitest/vitest.mjs run unit/review-l-docs.test.js unit/1300-v5-storybook-inventory.test.js unit/model-catalog-consistency.test.js unit/review-r-settings-complete.test.js --maxWorkers=2
```
