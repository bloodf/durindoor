# #1073 Preserve explicit ClinePass thinking budgets

## Source comparison

Inspected OmniRoute PR [#14912](https://github.com/cheaper-inference/OmniRoute/pull/14912) at exact head [`0ef8cd582c9907ef1046a163b8ff04fc039f3a4c`](https://github.com/cheaper-inference/OmniRoute/commit/0ef8cd582c9907ef1046a163b8ff04fc039f3a4c) and enclosing merge [`726c9bcef0ee0df4175a50ff2f30d9b9f1652031`](https://github.com/cheaper-inference/OmniRoute/commit/726c9bcef0ee0df4175a50ff2f30d9b9f1652031) in the public source. The PR head is commit `executors: stop raising a client-set thinking budget to 4096 (#14888)`; the enclosing merge has the same four-file patch. Upstream removes the branch that raised positive values below 4096 and writes the default only when the selected field is absent or non-positive. Its tests change prior positive-value expectations to the exact caller value and add both field spellings plus omitted-budget coverage.

The local September executor report records the same mismatch in [the runtime tail report](1073-september-existing-executor-runtime-tail.md): local `computeThinkingBudget` raised positive client budgets when `maxOutput` allowed the floor, and existing ClinePass assertions expected 512/256 to become 4096.

## Port evidence

- [Executor implementation](../../../open-sse/executors/default.js): `computeThinkingBudget` now returns no write for every positive value. `ensureThinkingBudget` remains scoped to ClinePass and reasoning-enabled model capabilities, keeps the selected field, and uses `maxOutput` when inserting a default for an absent or non-positive value. `transformRequest` still applies request defaults before the budget helper.
- [ClinePass executor tests](../../../tests/unit/clinepass-2332.test.js): prior assertions for both `max_tokens` and `max_completion_tokens` now assert exact equality with the supplied value. Coverage includes omitted, zero, negative, reasoning-off, provider scope, a low cap, and both positive spellings through `transformRequest`.
- [Custom capability tests](../../../tests/unit/custom-caps-runtime.test.js): a positive budget remains exact under a low custom cap; an omitted budget is inserted at that cap; reasoning-disabled capabilities leave the body unchanged.
- Exported pure helper usage was checked with repository search: it is called only by `ensureThinkingBudget` and the unit tests in `clinepass-2332.test.js`.

Verification: `test -s internal/docs/port-reports/1073-clinepass-client-thinking-budget-14912.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/clinepass-2332.test.js unit/custom-caps-runtime.test.js)`.
