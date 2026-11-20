# V5 interface integration (#1300)

PR #1313 delivered review-only compositions, not production or release acceptance. The current dashboard has continued to evolve since that merge. Its live provider, key, routing, usage and data-management workflows remain the authority when reconciling each composition; review fixtures and Storybook transforms are not evidence of live behavior.

This increment carries the provider detail RPM label from the review into the production control at all viewport widths. The existing value, limits, change handler and blur-to-save behavior are retained. The matching Storybook-only override is removed so the review uses the production label.

Remaining scope includes reconciling the other review compositions and subsequent production changes, agreeing ownership and scope with the integration owner, reviewing the changed interface visually, and recording interaction, loading, empty, error, responsive and accessibility evidence for each integrated surface. An independently reviewed PR and the applicable exact-head checks remain required. Final V5 candidate verification and release readiness are still outstanding; this increment is not release-candidate acceptance.

Focused evidence: `cd tests && node node_modules/vitest/vitest.mjs run unit/1300-v5-ui.test.js --maxWorkers=2`. This checks the control's programmatic label, visible label classes, bounds, edit and blur save. Browser and responsive visual review remain necessary.
