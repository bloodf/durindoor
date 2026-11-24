# V5 interface integration (#1300)

PR #1313 delivered compositions for review. The dashboard has continued to evolve since that merge. Use the live provider, key, routing, usage and data-management workflows as the source of truth when reconciling each composition.

This increment carries the provider detail RPM label from the review into the production control at all viewport widths. The existing value, limits, change handler and blur-to-save behavior are retained. The matching Storybook-only override is removed so the review uses the production label.

Recent requests now include a non-secret API key identity and label; the Requests panel displays the label. Deleted keys use installation-scoped identities, while local and MCP requests retain their own labels.

## Storybook inventory

The [surface manifest](../../tests/e2e/storybook-surfaces.json) records the current source and catalog reconciliation, including the inventory basis, source and reference review status, scenario mappings and runtime status. Final coverage credit requires approved classifications, mappings and evidence.

## Remaining V5 scope

S05 covers five provider-detail surfaces (`AutoPingScheduleModal`, `InferenceStatus`, `ModelCatalogProvenance`, `NativeProviderReadiness` and `ProviderRpmControl`). The manifest maps these surfaces to scenarios and records source-story evidence for the mapped states. Independent source review remains pending for the five surfaces and their scoped evidence.

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

Scoped browser runs have recorded evidence in Chromium, Firefox and WebKit. The historical [production acceptance audit](./audits/v5-production-2026-11-22/README.md) records passing Chromium cases and attributes them to its tested checkout SHA. #1067 tracks final browser evidence across the release candidate, with results tied to the exact candidate SHA.

## Production integration status

The canonical [production integration plan](./v5-production-integration.md) records S01–S20 as integrated. PR #2320 integrated S01–S08. S09–S19 completed the remaining surface slices. S20 made V5 the default for the release candidate and retained the documented `DURINDOOR_UI_V5=0` opt-out.

S21 removes legacy branches, the switch and Storybook boundary only after #1067 accepts the release candidate.
