# V5 interface integration (#1300)

PR #1313 delivered review-only compositions, not production or release acceptance. The current dashboard has continued to evolve since that merge. Its live provider, key, routing, usage and data-management workflows remain the authority when reconciling each composition; review fixtures and Storybook transforms are not evidence of live behavior.

This increment carries the provider detail RPM label from the review into the production control at all viewport widths. The existing value, limits, change handler and blur-to-save behavior are retained. The matching Storybook-only override is removed so the review uses the production label.

## Storybook inventory

The rebuilt Storybook catalog contains 2,310 stories, including 1,101 scenarios across 192 generated V5 review compositions. The regenerated compositions add Playground Compare, Network Node Status and LAN Discovery, plus the synced image model, custom speech-to-text model and unavailable batch provider states.

The [surface manifest](../../tests/e2e/storybook-surfaces.json) matches the current source and built catalog. It records 623 source rows, with 360 pending review and 263 retaining prior source approvals. Another 1,298 reference stories are pending review. The manifest preserves prior review records where source changes require another review. Pending entries need independent verification of classification and scenario ownership before they can receive coverage credit.

## Remaining V5 scope

- Address the provider-detail composition gaps for `AutoPingScheduleModal`, `InferenceStatus`, `ModelCatalogProvenance`, `NativeProviderReadiness` and `ProviderRpmControl`. Each has a pending source row with no scenario association.
- Reconcile the remaining review compositions against live dashboard workflows and confirm ownership with the integration owner.
- Review the integrated surfaces visually and record interaction, loading, empty, error, responsive and accessibility evidence. Final coverage requires approved associations and candidate-bound runtime evidence. Final V5 candidate acceptance and release readiness remain open.

## Evidence

Rebuild from the current source and validate inventory consistency from the repository root.

```sh
node scripts/gen-v5-stories.mjs
pnpm run storybook:build
node scripts/sync-storybook-inventory.mjs --check
node scripts/check-storybook-coverage.mjs --manifest tests/e2e/storybook-surfaces.json --index storybook-static/index.json --mode inventory
```

Run the focused evidence from `tests/`.

```sh
node node_modules/vitest/vitest.mjs run unit/1300-v5-storybook-inventory.test.js --maxWorkers=2
node node_modules/vitest/vitest.mjs run unit/1300-v5-ui.test.js --maxWorkers=2
```

The inventory test checks current source hashes, the review scenario inventory and the final gate's rejection of pending rows and references. The UI test checks the RPM label, input bounds and blur-to-save behavior. Visual and runtime evidence remain pending.
