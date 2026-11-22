# V5 interface integration (#1300)

PR #1313 delivered review-only compositions, not production or release acceptance. The current dashboard has continued to evolve since that merge. Its live provider, key, routing, usage and data-management workflows remain the authority when reconciling each composition; review fixtures and Storybook transforms are not evidence of live behavior.

This increment carries the provider detail RPM label from the review into the production control at all viewport widths. The existing value, limits, change handler and blur-to-save behavior are retained. The matching Storybook-only override is removed so the review uses the production label.

## Storybook inventory

The regenerated V5 review catalog contains 1,208 scenarios across 205 source-backed compositions. The regenerated compositions add Playground Compare, Network Node Status and LAN Discovery, plus the synced image model, custom speech-to-text model and unavailable batch provider states.

The [surface manifest](../../tests/e2e/storybook-surfaces.json) matches the current source and built catalog. It records 638 source rows, with 428 pending review and 210 retaining prior source approvals. Another 1,486 reference stories are pending review. The manifest preserves prior review records where source changes require another review. Pending entries need independent verification of classification and scenario ownership before they can receive coverage credit.

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

## Production integration status (from v5-production-integration.md)

**S01–S08 merged in PR #2320** behind `DURINDOOR_UI_V5`:
- S01 Foundation: switch, tokens, root attribute, Storybook skip rule
- S02 Primitives: motion button, icon help, select, pagination
- S03 Shell: navigation icons, header, language marks, redirect
- S04 Login and callback: doorway login, callback states
- S05 Provider-detail review coverage: source stories for five modals
- S06 Providers list: tokens, primitives, states
- S07 Provider detail: auto-sync card and placement
- S08 Model picker and shared combo form: picker and shared form

**S09–S19 planned** per the slice table in `v5-production-integration.md`.

**Per-slice evidence** (updated from deferral to #1067):
- Lint (`npm run lint`)
- Slice unit test (`tests/unit/v5-int-XX-*.test.js`)
- Storybook build (`npm run storybook:build`) when `src/shared/ui/v5/**` or `.storybook/**` changes
- Inventory check (`tests/unit/v5-route-evidence.browser.test.js`: chromium, 1440 and 360, dark and light, axe serious/critical = 0, no console errors)

**S21** removes legacy code after S20 flips the default and the evidence passes on the integrated head.
