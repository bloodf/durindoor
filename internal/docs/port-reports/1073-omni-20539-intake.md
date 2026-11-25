# OmniRoute #20539 intake

**Disposition — skip the UI-kit adoption. Keep component-level interaction differences pending where local equivalence has not been established.** The existing [OmniRoute intake inventory](../omniroute-open-prs-1073.md) groups #20539 with the follow-on CI UI Kit syncs and skips the visual rewrite as design divergence. This review records the merged change separately and leaves that decision in place. No upstream code was applied.

## Source and coverage

- [Upstream PR #20539](https://github.com/cheaper-inference/OmniRoute/pull/20539), PR head `b14d0a6f2aaaa629cbaf6a71d3eb31451db756b7`, API base `a334036c150d8ae3777b9f7fffa4261477a5bd82`.
- [Merge commit](https://github.com/cheaper-inference/OmniRoute/commit/3648db7a48138c87fbeda683260f1a69c96fd4aa) `3648db7a48138c87fbeda683260f1a69c96fd4aa`, first parent `9a663869b73399e47d0d2a93f21a2fbdf48ffb37`.
- Compared against DurinDoor `main` at `286a5791e6937cd2271333d65c8b75de7232cb00`. The [#1073 inventory](https://github.com/bloodf/durindoor/issues/1073) already records this row as skipped. [#1300](https://github.com/bloodf/durindoor/issues/1300) is closed with local V5 integration evidence. [#1067](https://github.com/bloodf/durindoor/issues/1067) owns remaining V5 release acceptance, including cross-browser evidence and legacy removal.

The paginated PR files endpoint returned 774 unique paths, with 62 added, 709 modified and three removed. The first-parent Git diff matched that path set exactly and supplied the missing API patch for `packages/ui-kit/src/ci-ui.css`. Review covered the complete inventory, the first-parent diff by surface, and targeted behavior comparisons below. It did not establish per-component parity across all 774 files.

## Disposition by surface

| Upstream change | Local evidence and disposition |
| --- | --- |
| 101 vendored UI-kit paths, including design tokens, global kit CSS, components and package metadata. Root lockfile, lint suppressions, architecture note and changelog accompany the adoption. | **Not applicable as a package sync.** DurinDoor uses its own [V5 tokens and styles](../../../src/shared/ui/v5/v5.css) and [shared primitives](../../../src/shared/ui/v5/components.jsx). The upstream lockfile and suppression changes support a different package and component tree. |
| 447 dashboard files and 55 shared paths adopt the kit across provider, API-key, combo, usage, limits, settings and other screens. Root layout, global error, global CSS, landing animation and English strings also change. | **Local behavior already present where evidenced.** The [V5 integration inventory](../v5-production-integration.md) and [production audit](../audits/v5-production-2026-11-22) cover the local surfaces. The [provider](../../../tests/unit/v5-int-06-providers.test.js), [combo](../../../tests/unit/v5-int-09-combos.test.js) and [usage](../../../tests/unit/v5-int-10-usage-reports.test.js) integration tests record local behavior. The alternate upstream render tree and landing treatment are out of scope for this intake. The upstream inventory contains no API route, executor or database paths. |
| 162 test and fixture paths update kit selectors and assertions, including provider management, API-key and combo flows, tooltip and hover-card helpers. | **Upstream selectors are not applicable.** Local [primitive tests](../../../tests/unit/v5-int-02-primitives.test.js) cover submit and disabled semantics, form participation, tooltip dismissal and reduced motion. The [Storybook browser suite](../../../tests/unit/v5-storybook.browser.test.js) covers modal keyboard interaction and keyboard scrolling. |
| Kit additions include focusable soft-disabled controls, keyboard chart tooltips, searchable-select form participation and responsive wizard substeps. | **Pending at the interaction level.** The local primitive tests establish select form participation and normal disabled controls, but do not establish equivalence for the upstream soft-disabled click and keyboard contract. The local usage and browser evidence covers chart rendering and keyboard-reachable table regions, with no verified match for upstream per-point chart tooltips. No local match was established for responsive wizard substep navigation. These differences stay with the local UI acceptance scope if selected as requirements. |

No product or baseline changes are part of this intake.
