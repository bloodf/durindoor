# V5 interface integration (#1300)

PR #1313 delivered compositions for review. The dashboard has continued to evolve since that merge. Use the live provider, key, routing, usage and data-management workflows as the source of truth when reconciling each composition.

This increment carries the provider detail RPM label from the review into the production control at all viewport widths. The existing value, limits, change handler and blur-to-save behavior are retained. The matching Storybook-only override is removed so the review uses the production label.

Recent requests now include a non-secret API key identity and label; the Requests panel displays the label. Deleted keys use installation-scoped identities, while local and MCP requests retain their own labels.

## Storybook inventory

The [surface manifest](../../tests/e2e/storybook-surfaces.json) records the current source and catalog reconciliation, including the inventory basis, source and reference review status, scenario mappings and runtime status. Final coverage credit requires approved classifications, mappings and evidence.

## Candidate 7260640 inventory repair (2026-11-27)

Rebuilt Storybook from parent `7260640b92f784b352c5e21ac2e68b16689e72a0`
and ran `node scripts/sync-storybook-inventory.mjs --write`. The generated
inventory adds the pending `ModelsCardContext` surface and refreshes source and
scenario hashes for the three existing pending `ModelsCard.js` rows. The built
catalog hash is unchanged.

All 196 active source approvals and 12 active reference approvals are retained.
The 441 historical source approvals, 252 reference records with historical
reviews, and six historical inventory rows are unchanged. No active approval
was invalidated by this repair, so none needed moving to history; no approval
was created. There are now 454 pending source rows and 1,496 pending references.

Validation passed: `pnpm run storybook:build`, the inventory generator's
`--check`, the coverage checker in `--mode inventory` against the rebuilt index,
and both `1300-v5-storybook-inventory.test.js` (3 tests) and
`storybook-inventory-sync.test.js` (16 tests). `git diff --check` also passed.
Builds, generators and tests used fresh disposable HOME and DATA_DIR directories
and an environment allowlist with no inherited provider or publisher credentials.

This repair establishes source inventory consistency only. No browser interaction,
accessibility, responsive or cross-engine runtime acceptance was performed, and
no live provider or service was used. Source/scenario review and runtime evidence
remain pending; the new context surface's generated file association does not
prove branch coverage. Final coverage and release acceptance remain open.

## Remaining V5 scope

The five provider-detail rows in S05 (`AutoPingScheduleModal`, `InferenceStatus`, `ModelCatalogProvenance`, `NativeProviderReadiness` and `ProviderRpmControl`) record proposed scenario mappings and supporting source-story evidence. Independent source review and approval of those mappings and evidence remain pending. This guide records no new approved coverage.

Reconcile the remaining review compositions against live dashboard workflows and confirm ownership with the integration owner. Visual, interaction, loading, empty, error, responsive and accessibility coverage still requires approved scenario associations. Final V5 candidate acceptance and release readiness remain open under #1067.

## Evidence and validation commands

Run the following commands from the repository root to regenerate the story catalog and check the inventory.

```sh
node scripts/gen-v5-stories.mjs
pnpm run storybook:build
node scripts/sync-storybook-inventory.mjs --check
node scripts/check-storybook-coverage.mjs --manifest tests/e2e/storybook-surfaces.json --index storybook-static/index.json --mode inventory
```

Run the following focused unit tests from `tests/`.

```sh
node node_modules/vitest/vitest.mjs run unit/1300-v5-storybook-inventory.test.js --maxWorkers=2
node node_modules/vitest/vitest.mjs run unit/1300-v5-ui.test.js --maxWorkers=2
```

The inventory test checks current source hashes, review scenario inventory and that the final gate rejects pending rows and references. The UI test checks the RPM label, input bounds and blur-to-save behavior.

Follow the local browser prerequisites in the [testing guide](./testing.mdx#v5-storybook-browser-evidence). Run the registered route evidence test from `tests/` with one browser engine per run. This example uses Chromium and the registered `dialog/Modal` fixture.

```sh
RUN_V5_EVIDENCE=1 V5_BROWSER_ENGINE=chromium V5_EVIDENCE_ROUTES=dialog/Modal V5_EVIDENCE_REPORT=/private/path/chromium.json node node_modules/vitest/vitest.mjs run unit/v5-route-evidence.browser.test.js --maxWorkers=2
```

The [November 22 production acceptance audit](./audits/v5-production-2026-11-22/README.md) records 1,640 passing historical Chromium cases for tested checkout `78aef4edadc5`.

The scoped provider catalog fixture run recorded 60 passing cases, 20 each in Chromium, Firefox and WebKit. [PR #2422](https://github.com/bloodf/durindoor/pull/2422)

The Firefox and WebKit matrix for the exact integrated release candidate remains open under [#1067](https://github.com/bloodf/durindoor/issues/1067).

## Production integration status

The [production integration plan](./v5-production-integration.md#1-acceptance-status) says S20 made V5 the default and retained the documented `DURINDOOR_UI_V5=0` opt-out. It defers S21 removal of legacy branches, the switch and the Storybook boundary until #1067 accepts the release candidate.

The plan's surface status table still labels S05 and S09–S19 as Planned. The `tests/unit/v5-int-*.test.js` slice suites record the implemented behavior, including [S01 foundation](../../tests/unit/v5-int-01-foundation.test.js), [S08 model picker](../../tests/unit/v5-int-08-model-picker.test.js) and the dashboard surfaces from [S09 combos](../../tests/unit/v5-int-09-combos.test.js) through [S19 settings](../../tests/unit/v5-int-19-settings.test.js). The [S05 provider-story suite](../../tests/unit/v5-int-05-provider-stories.test.js) checks the source stories and inventory entries. Approval of the five mappings remains subject to source review.
