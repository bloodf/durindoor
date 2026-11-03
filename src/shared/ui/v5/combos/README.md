# Combo review redesign

Storybook-only copies retain the current API fields and model discovery rules. The inventory lists members as ordered rows. The picker has provider filtering, full model IDs, provider marks, checked selection, capability icons with accessible names and titles, compact token limits and a separate selected-member list. Add/remove updates the caller immediately, preserving its contract; the combo form applies its draft only with Save or Create.

The form retains keyboard/pointer ordering, one-shot provider/name sorting, weights, nested combos, inline model ID editing, capability ceilings and media kind filters. The page retains connection groups, allow-lists, six routing strategies, timeout, fusion judge, copy, delete and bulk operations. Duplicate copies the combo fields and routing strategy. Failed strategy writes retain the saved value. Rejected deletion stays open with an error inside the confirmation dialog and allows retry. Partial bulk deletion keeps rejected combos visible.

`ReviewCombosPage` replaces the page in the v5 review scope. `ReviewSharedComboFormModal` retains the shared modal's forcePrefix and payload contract; `ReviewComboFormModal` includes page member weights. `ReviewModelSelectModal` replaces the shared picker in that scope. Production imports and gateway behavior are unchanged.

Modal footers use the shared Modal's explicit footer slot. Filters never inherit footer positioning or spacing. The selected-model list scrolls independently with 44px remove targets. Capability checkboxes have human accessible names; invalid weights and token ceilings show field feedback and prevent saving until corrected.
Weight errors use a stable Field wrapper so validation does not replace the focused input while typing.

### Confirmed routing changes

Timeouts are local drafts until Enter or blur. Invalid/blank drafts never write a
zero accidentally. Per-row saving, saved, rejection and Retry states retain the
operator's failed draft; all strategy patches share one queue and merge against
the latest accepted settings map, including changes on different combos.

Connection allow-list changes stay visible until accepted. Remove, group-add,
connection-add and clear share one submission guard; a rejected draft remains
available through Retry. Capabilities and limits remain available in a disclosure
that starts open for existing overrides. An empty mobile selection pane is hidden
so it does not consume catalog space; selection counts and selected rows remain.
