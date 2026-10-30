# Unslop followup

Applied [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop), CC BY 4.0, pinned to `4652254daff586ff4739849395a127b56f7f8cc7`. This is bounded polish of the existing review design, not a new brand or a production rollout.

## Direction

- Product: A self-hosted AI gateway for operators managing providers, routing, usage and budgets.
- Character: Calm, exact, tactile.
- World: Operator instruments on graphite and neutral reading surfaces.
- Moments: The doorway identity, provider topology and selected usage trend.
- Signature: The doorway mark and the existing animated action glyphs with icon-only explanations.

## Findings and repairs

The user's narrow-canvas screenshots exposed a real table sizing defect. Both CardContent and DataTable allow wrapping anywhere. This reduces automatic table columns to individual characters instead of engaging their local scroll regions. The previous browser geometry check covered provider-health and pricing tables only and did not detect this.

The review table boundary now restores normal word sizing, keeps headers, row identities and numeric values together, and retains each focusable horizontal scroll region. No columns, figures, pagination, sorting or expandable details are removed. The same rule covers tables inside resized widgets, independent of viewport breakpoints. The regression first failed on the unchanged build with fragmented Requests, gpt-4o, 3,200 and cost values; it then checks the rendered word ranges in three engines, two themes and three canvas widths. Keyboard scrolling must reveal the last combo/key-limit column. Desktop coverage resizes real widgets to one third through the existing editor. The Compact widgets story exposes this layout directly for review.

The remaining craft changes keep the same layout, fonts and artwork. Surfaces use a quieter neutral ramp with the existing green action accent. Uppercase tracked labels use their authored sentence case, small headings have normal tracking, and page-title weight is 600. Combo usage and key-limit cards no longer repeat their default title immediately above the card. Renamed titles and editing controls remain visible.

The nine-pass review preserved spacing, existing icons, copy, content layout, diagrams and purposeful animation where no confirmed defect required a change. The user's animated-icon requirement overrides the skill's preference for fewer icons. Provider artwork and locale identity remain intact, with existing keyboard help and reduced-motion behavior. No generated image, dependency or gate-policy change is needed.

## Evidence boundary

The PR records fresh exact-head build, browser and independently verified full CI results. The earlier audit receipts remain historical. Storybook fixtures do not prove deployed/provider behavior or grant visual acceptance. Strict coverage classifications remain pending; this followup does not manufacture approval.
